// Real temporary MongoDB replica set + HTTP/Socket.IO. S3 alone is substituted.
// The first run downloads a MongoDB binary into the OS temporary directory.
require('reflect-metadata');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { MongooseModule, getModelToken } = require('@nestjs/mongoose');
const { ThrottlerModule } = require('@nestjs/throttler');
const { JwtService } = require('@nestjs/jwt');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const request = require('supertest');
const { io } = require('socket.io-client');
const { configureApp } = require('../dist/app.config');
const { SharingModule } = require('../dist/sharing/sharing.module');
const { ImagesModule } = require('../dist/images/images.module');
const { S3Service } = require('../dist/s3/s3.service');
const {
  NotificationsGateway,
} = require('../dist/notifications/notifications.gateway');

let repl,
  app,
  api,
  jwt,
  models,
  owner,
  recipient,
  stranger,
  original,
  version,
  sibling;
let signs = [],
  clients = [];
const storage = {
  getFileUrls: async (key, filename) => {
    signs.push({ key, filename });
    return {
      url: `https://storage.test/${key}?display`,
      downloadUrl: `https://storage.test/${key}?attachment`,
      urlExpiresAt: '2026-09-30T12:15:00.000Z',
    };
  },
  deleteFile: async () => {},
};

async function startApp() {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [
          () => ({
            JWT_SECRET: 'sharing-test-only-secret',
            JWT_EXPIRES_IN: '1h',
            CORS_ORIGINS: 'http://localhost:5173',
          }),
        ],
      }),
      MongooseModule.forRoot(repl.getUri(), { dbName: 'sharing_test' }),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
      SharingModule,
      ImagesModule,
    ],
  })
    .overrideProvider(S3Service)
    .useValue(storage)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  api = request(app.getHttpServer());
  jwt = app.get(JwtService);
  models = Object.fromEntries(
    ['User', 'Image', 'Share', 'Notification'].map((name) => [
      name,
      app.get(getModelToken(name)),
    ]),
  );
}

before(
  async () => {
    repl = await MongoMemoryReplSet.create({
      binary: { downloadDir: join(tmpdir(), 'image-service-mongodb-binaries') },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await startApp();
  },
  { timeout: 180000 },
);

beforeEach(async () => {
  for (const client of clients) client.disconnect();
  clients = [];
  for (const model of Object.values(models)) await model.deleteMany({});
  [owner, recipient, stranger] = await models.User.create(
    ['owner', 'recipient', 'stranger'].map((name) => ({
      username: name,
      email: `${name}@example.com`,
      password: 'test-hash-never-exposed',
    })),
  );
  original = await models.Image.create({
    user: owner._id,
    kind: 'original',
    originalName: 'photo.png',
    filename: 'original.png',
    path: 'private/original.png',
    originalKey: 'private/original.png',
    mimeType: 'image/png',
    format: 'png',
    originalSize: 100,
  });
  [version, sibling] = await models.Image.create(
    ['selected', 'sibling'].map((name) => ({
      user: owner._id,
      kind: 'transformed',
      originalImageId: original._id,
      originalKey: original.path,
      originalName: 'photo.png',
      filename: `${name}.webp`,
      path: `private/${name}.webp`,
      mimeType: 'image/webp',
      format: 'webp',
      originalSize: 100,
      processedSize: 60,
      quality: 80,
    })),
  );
  signs = [];
});

after(async () => {
  for (const client of clients) client.disconnect();
  await app?.close();
  await repl?.stop();
});

function token(user, options = {}) {
  return jwt.sign({ sub: user._id.toString(), email: user.email }, options);
}
function auth(user) {
  return `Bearer ${token(user)}`;
}
function create(image = version, user = owner, email = recipient.email) {
  return api
    .post('/api/shares')
    .set('Authorization', auth(user))
    .send({ imageId: image._id.toString(), recipientEmail: email });
}
function event(client, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${name}`)),
      5000,
    );
    client.once(name, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}
function socket(
  authPayload,
  origin = 'http://localhost:5173',
  transports = ['websocket'],
) {
  const client = io(
    `http://127.0.0.1:${app.getHttpServer().address().port}/notifications`,
    {
      path: '/socket.io',
      auth: authPayload,
      extraHeaders: { Origin: origin },
      transports,
      reconnection: false,
      autoConnect: false,
    },
  );
  clients.push(client);
  return client;
}
async function connect(user, extra = {}) {
  const client = socket({ token: token(user), ...extra });
  const connected = event(client, 'connect');
  client.connect();
  await connected;
  return client;
}

test('normalizes email, persists offline, survives app restart, and exposes only the selected version', async () => {
  const response = await create(
    version,
    owner,
    '  RECIPIENT@EXAMPLE.COM  ',
  ).expect(201);
  const share = response.body;
  assert.equal(share.imageId, version.id);
  assert.equal(share.recipientId, recipient.id);
  assert.equal(share.available, true);
  assert.match(response.headers['cache-control'], /no-store/);
  assert.equal(await models.Share.countDocuments(), 1);
  assert.equal(await models.Notification.countDocuments(), 1);
  assert.equal(signs.length, 0);
  const stored = await models.Share.findById(share._id).lean();
  assert.equal(stored.url, undefined);
  await app.close();
  await startApp();
  const received = await api
    .get('/api/shares/received')
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(received.body.items[0]._id, share._id);
  const notifications = await api
    .get('/api/notifications')
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(notifications.body.items[0].shareId, share._id);
  assert.equal(notifications.body.items[0].readAt, null);
  assert.deepEqual(
    (
      await api
        .get('/api/notifications/unread-count')
        .set('Authorization', auth(recipient))
    ).body,
    { unreadCount: 1 },
  );
  const detail = await api
    .get(`/api/shares/${share._id}`)
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(detail.body.image._id, version.id);
  assert.equal(detail.body.image.filename, 'photo.webp');
  assert.deepEqual(signs, [{ key: version.path, filename: 'photo.webp' }]);
  for (const field of [
    'path',
    'originalKey',
    'originalImageId',
    'password',
    'email',
  ])
    assert.equal(detail.body.image[field], undefined);
  for (const image of [original, version, sibling]) {
    await api
      .get(`/api/images/${image.id}`)
      .set('Authorization', auth(recipient))
      .expect(404);
    await api
      .delete(`/api/images/${image.id}`)
      .set('Authorization', auth(recipient))
      .expect(404);
    await api
      .post(`/api/images/${image.id}/transform`)
      .set('Authorization', auth(recipient))
      .send({ transformations: { rotate: 90 } })
      .expect(404);
    await create(image, recipient, stranger.email).expect(404);
  }
});

test('can share exactly an original and corrects misleading filename extensions', async () => {
  await models.Image.updateOne(
    { _id: original._id },
    { originalName: 'actually-png.jpg' },
  );
  const { body: share } = await create(original).expect(201);
  const { body } = await api
    .get(`/api/shares/${share._id}`)
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(body.image.filename, 'actually-png.png');
  assert.deepEqual(signs, [
    { key: original.path, filename: 'actually-png.png' },
  ]);
});

test('validates auth, input, ownership, missing recipients, and self-sharing', async () => {
  await api.post('/api/shares').send({}).expect(401);
  for (const body of [
    { imageId: 'bad', recipientEmail: recipient.email },
    { imageId: version.id, recipientEmail: 'invalid' },
    {
      imageId: version.id,
      recipientEmail: recipient.email,
      username: 'recipient',
    },
  ]) {
    const response = await api
      .post('/api/shares')
      .set('Authorization', auth(owner))
      .send(body)
      .expect(400);
    assert.ok(Array.isArray(response.body.message));
  }
  await create(version, stranger).expect(404);
  await create(version, owner, 'missing@example.com').expect(404);
  await create(version, owner, 'OWNER@example.com').expect(400);
  assert.equal(await models.Share.countDocuments(), 0);
  assert.equal(await models.Notification.countDocuments(), 0);
});

test('concurrent duplicate requests create one active share and one notification; retries return 409', async () => {
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => create()),
  );
  assert.equal(
    responses.filter((response) => response.status === 201).length,
    1,
  );
  assert.equal(
    responses.filter((response) => response.status === 409).length,
    5,
  );
  await create().expect(409);
  assert.equal(await models.Share.countDocuments(), 1);
  assert.equal(await models.Notification.countDocuments(), 1);
  const index = (await models.Share.collection.indexes()).find(
    (index) => index.name === 'unique_active_share',
  );
  assert.equal(index.unique, true);
  assert.deepEqual(index.partialFilterExpression, { revokedAt: null });
});

test('only recipient can obtain URLs; only sender can revoke, and sharing again creates new history', async () => {
  const { body: share } = await create().expect(201);
  for (const user of [owner, stranger])
    await api
      .get(`/api/shares/${share._id}`)
      .set('Authorization', auth(user))
      .expect(404);
  for (const user of [recipient, stranger])
    await api
      .delete(`/api/shares/${share._id}`)
      .set('Authorization', auth(user))
      .expect(404);
  assert.equal(signs.length, 0);
  const revoked = await api
    .delete(`/api/shares/${share._id}`)
    .set('Authorization', auth(owner))
    .expect(200);
  const retry = await api
    .delete(`/api/shares/${share._id}`)
    .set('Authorization', auth(owner))
    .expect(200);
  assert.equal(revoked.body.revokedAt, retry.body.revokedAt);
  await api
    .get(`/api/shares/${share._id}`)
    .set('Authorization', auth(recipient))
    .expect(404);
  const { body: again } = await create().expect(201);
  assert.notEqual(again._id, share._id);
  assert.equal(await models.Notification.countDocuments(), 2);
  const { body } = await api
    .get('/api/notifications')
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.deepEqual(
    body.items.map((item) => item.available),
    [true, false],
  );
});

test('deletion of a version blocks refresh and leaves siblings available; deleting original blocks all its versions', async () => {
  const { body: selected } = await create().expect(201);
  const { body: other } = await create(sibling).expect(201);
  await api
    .delete(`/api/images/${version.id}`)
    .set('Authorization', auth(owner))
    .expect(200);
  await api
    .get(`/api/shares/${selected._id}`)
    .set('Authorization', auth(recipient))
    .expect(404);
  await api
    .get(`/api/shares/${other._id}`)
    .set('Authorization', auth(recipient))
    .expect(200);
  await api
    .delete(`/api/images/${original.id}`)
    .set('Authorization', auth(owner))
    .expect(200);
  await api
    .get(`/api/shares/${other._id}`)
    .set('Authorization', auth(recipient))
    .expect(404);
  const { body } = await api
    .get('/api/shares/received')
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(body.total, 2);
  assert.ok(body.items.every((item) => !item.available));
});

test('notifications remain readable for missing shares, are private, and mark-read is idempotent', async () => {
  await create().expect(201);
  const notification = await models.Notification.findOne();
  await models.Share.deleteMany({});
  const { body } = await api
    .get('/api/notifications')
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(body.items[0].available, false);
  await api
    .put(`/api/notifications/${notification.id}/read`)
    .set('Authorization', auth(stranger))
    .expect(404);
  const first = await api
    .put(`/api/notifications/${notification.id}/read`)
    .set('Authorization', auth(recipient))
    .expect(200);
  const second = await api
    .put(`/api/notifications/${notification.id}/read`)
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(first.body.readAt, second.body.readAt);
  assert.deepEqual(
    (
      await api
        .get('/api/notifications/unread-count')
        .set('Authorization', auth(recipient))
    ).body,
    { unreadCount: 0 },
  );
  assert.equal(
    (await api.get('/api/notifications').set('Authorization', auth(stranger)))
      .body.total,
    0,
  );
});

test('transaction rolls back a share if notification persistence fails and emits nothing', async () => {
  const createNotification = models.Notification.create;
  const gateway = app.get(NotificationsGateway);
  const notify = gateway.notify;
  let emitted = 0;
  gateway.notify = () => emitted++;
  models.Notification.create = async () => {
    throw new Error('simulated notification failure');
  };
  try {
    await create().expect(500);
    assert.equal(await models.Share.countDocuments(), 0);
    assert.equal(await models.Notification.countDocuments(), 0);
    assert.equal(emitted, 0);
  } finally {
    models.Notification.create = createNotification;
    gateway.notify = notify;
  }
});

test('socket failure after commit does not fail a share or lose the offline notification', async () => {
  const gateway = app.get(NotificationsGateway);
  const notify = gateway.notify;
  gateway.notify = async () => {
    assert.equal(await models.Share.countDocuments(), 1);
    assert.equal(await models.Notification.countDocuments(), 1);
    throw new Error('simulated socket failure');
  };
  try {
    await create().expect(201);
  } finally {
    gateway.notify = notify;
  }
  assert.equal(
    (await api.get('/api/notifications').set('Authorization', auth(recipient)))
      .body.total,
    1,
  );
});

test('pagination, invalid IDs, private list filters, throttling, and Swagger schemas follow API conventions', async () => {
  await create().expect(201);
  const page = await api
    .get('/api/shares/sent?page=2&limit=1')
    .set('Authorization', auth(owner))
    .expect(200);
  assert.deepEqual(page.body, {
    items: [],
    page: 2,
    limit: 1,
    total: 1,
    totalPages: 1,
  });
  assert.equal(
    (await api.get('/api/shares/sent').set('Authorization', auth(stranger)))
      .body.total,
    0,
  );
  for (const path of [
    '/api/shares/received?limit=51',
    '/api/notifications?page=0',
    '/api/notifications?unknown=true',
  ])
    await api.get(path).set('Authorization', auth(recipient)).expect(400);
  await api
    .get('/api/shares/bad-id')
    .set('Authorization', auth(recipient))
    .expect(404);
  await api
    .delete('/api/shares/bad-id')
    .set('Authorization', auth(owner))
    .expect(404);
  await api
    .put('/api/notifications/bad-id/read')
    .set('Authorization', auth(recipient))
    .expect(404);
  for (let i = 0; i < 9; i++) await create().expect(409);
  const limited = await create().expect(429);
  assert.ok(limited.headers['retry-after']);
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().addBearerAuth().build(),
  );
  assert.ok(doc.paths['/api/shares'].post.requestBody);
  assert.ok(doc.components.schemas.CreateShareDto.properties.recipientEmail);
  assert.ok(doc.components.schemas.SharedImageResponseDto);
  assert.equal(
    doc.paths['/api/shares/sent'].get.responses['200'].content[
      'application/json'
    ].schema.$ref,
    '#/components/schemas/PaginatedSentSharesDto',
  );
  const sentSchema = doc.components.schemas.SentShareResponseDto;
  assert.equal(sentSchema.properties.recipientEmail.nullable, true);
  assert.equal(sentSchema.properties.image.nullable, true);
  assert.ok(sentSchema.required.includes('recipientEmail'));
  assert.ok(sentSchema.required.includes('image'));
  assert.deepEqual(
    Object.keys(doc.components.schemas.SentShareImageDto.properties).sort(),
    ['filename', 'format'],
  );

  assert.ok(doc.paths['/api/notifications/{id}/read'].put.responses['200']);
});

test('Socket.IO authenticates tokens and joins only server-derived rooms across recipient sessions', async () => {
  const a = await connect(recipient, { userId: stranger.id });
  const b = await connect(recipient);
  const unrelated = await connect(stranger, { userId: recipient.id });
  const sender = await connect(owner);
  let leaked = 0;
  unrelated.on('notification.created', () => leaked++);
  sender.on('notification.created', () => leaked++);
  unrelated.emit('join', `user:${recipient.id}`);
  unrelated.emit('share', {
    imageId: version.id,
    recipientEmail: recipient.email,
  });
  const events = [
    event(a, 'notification.created'),
    event(b, 'notification.created'),
  ];
  const { body: share } = await create().expect(201);
  const [first, second] = await Promise.all(events);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), [
    'createdAt',
    'notificationId',
    'shareId',
    'type',
  ]);
  assert.equal(first.shareId, share._id);
  assert.equal(first.type, 'image.shared');
  assert.ok(await models.Notification.findById(first.notificationId));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(leaked, 0);
  const serverSocket = app
    .get(NotificationsGateway)
    .server.sockets.get(unrelated.id);
  assert.ok(serverSocket.rooms.has(`user:${stranger.id}`));
  assert.equal(serverSocket.rooms.has(`user:${recipient.id}`), false);
  a.disconnect();
  const reconnected = await connect(recipient);
  assert.ok(reconnected.connected);
  assert.equal(
    (await api.get('/api/notifications').set('Authorization', auth(recipient)))
      .body.total,
    1,
  );
});

test('Socket.IO rejects missing, forged, expired, nonexpiring, or malformed identity tokens', async () => {
  const nonexpiring = new JwtService({
    secret: 'sharing-test-only-secret',
  }).sign({ sub: recipient.id });
  for (const payload of [
    { userId: recipient.id },
    { token: 'forged' },
    { token: token(recipient, { expiresIn: -1 }) },
    { token: nonexpiring },
    { token: jwt.sign({ sub: 'invalid-id' }) },
  ]) {
    const client = socket(payload);
    const error = event(client, 'connect_error');
    client.connect();
    assert.equal((await error).data.code, 'UNAUTHORIZED');
    assert.equal(client.connected, false);
    client.disconnect();
  }
});

test('Socket.IO enforces origin allowlist for websocket and polling and supports allowed polling', async () => {
  for (const transports of [['websocket'], ['polling']]) {
    const blocked = socket(
      { token: token(recipient) },
      'https://untrusted.example',
      transports,
    );
    const failure = event(blocked, 'connect_error');
    blocked.connect();
    await failure;
    assert.equal(blocked.connected, false);
    blocked.disconnect();
  }
  const allowed = socket({ token: token(recipient) }, 'http://localhost:5173', [
    'polling',
  ]);
  const connected = event(allowed, 'connect');
  allowed.connect();
  await connected;
  assert.ok(allowed.connected);
});

test('long-lived sockets disconnect on token expiry and can reconnect with a newly issued token', async () => {
  const client = socket({ token: token(recipient, { expiresIn: 2 }) });
  const connected = event(client, 'connect');
  client.connect();
  await connected;
  const expired = event(client, 'auth.expired');
  const disconnected = event(client, 'disconnect');
  assert.deepEqual(await expired, { code: 'TOKEN_EXPIRED' });
  assert.equal(await disconnected, 'io server disconnect');
  assert.equal(client.connected, false);
  client.auth = { token: token(recipient) };
  const reconnected = event(client, 'connect');
  client.connect();
  await reconnected;
  assert.ok(client.connected);
});

test('sent share summaries resolve stored IDs after restart without client labels', async () => {
  const stored = await models.Share.create({
    senderId: owner._id,
    recipientId: recipient._id,
    imageId: version._id,
  });
  await app.close();
  await startApp();
  const { body } = await api
    .get('/api/shares/sent')
    .set('Authorization', auth(owner))
    .expect(200);
  const item = body.items[0];
  assert.equal(item._id, stored.id);
  assert.equal(item.recipientEmail, recipient.email, JSON.stringify(item));
  assert.deepEqual(item.image, { filename: 'photo.webp', format: 'webp' });
  assert.equal(item.available, true);
  assert.deepEqual(
    Object.keys(item).sort(),
    [
      '_id',
      'senderId',
      'recipientId',
      'imageId',
      'revokedAt',
      'createdAt',
      'updatedAt',
      'available',
      'recipientEmail',
      'image',
    ].sort(),
  );
  assert.equal(signs.length, 0);
  const saved = await models.Share.findById(stored._id).lean();
  assert.equal(saved.recipientEmail, undefined);
  assert.equal(saved.image, undefined);
  const received = await api
    .get('/api/shares/received')
    .set('Authorization', auth(recipient))
    .expect(200);
  assert.equal(received.body.items[0].recipientEmail, undefined);
  assert.equal(received.body.items[0].image, undefined);
  await api.get('/api/shares/sent').expect(401);
  assert.deepEqual(
    (
      await api
        .get('/api/shares/sent')
        .set('Authorization', auth(stranger))
        .expect(200)
    ).body.items,
    [],
  );
});

test('sent summaries reflect current recipient details and tolerate deleted or reassigned records', async () => {
  const { body: share } = await create().expect(201);
  const sent = async () =>
    (
      await api
        .get('/api/shares/sent')
        .set('Authorization', auth(owner))
        .expect(200)
    ).body.items[0];
  await models.User.updateOne(
    { _id: recipient._id },
    { email: 'updated@example.com' },
  );
  assert.equal((await sent()).recipientEmail, 'updated@example.com');
  await api
    .delete(`/api/shares/${share._id}`)
    .set('Authorization', auth(owner))
    .expect(200);
  assert.deepEqual((await sent()).image, {
    filename: 'photo.webp',
    format: 'webp',
  });
  assert.equal((await sent()).available, false);
  await models.User.deleteOne({ _id: recipient._id });
  assert.equal((await sent()).recipientEmail, null);
  await models.Image.updateOne({ _id: version._id }, { user: stranger._id });
  assert.equal((await sent()).image, null);
  await models.Image.deleteOne({ _id: version._id });
  assert.equal((await sent()).image, null);
  assert.equal((await sent()).available, false);
  assert.equal(await models.Share.countDocuments(), 1);
});

test('sent filenames match exact selected-image access for formats and filename edge cases', async () => {
  const { body: share } = await create().expect(201);
  const originalShare = (await create(original).expect(201)).body;
  for (const [originalName, format, expected] of [
    ['photo.JPG', 'webp', 'photo.webp'],
    ['photo.WEBP', 'jpeg', 'photo.jpg'],
    ['archive.plate.JPG', 'png', 'archive.plate.png'],
    ['untitled', 'webp', 'untitled.webp'],
    ['photo.JPEG', 'jpeg', 'photo.jpg'],
    ['archive.plate.PNG', 'png', 'archive.plate.png'],
  ]) {
    await models.Image.updateOne(
      { _id: version._id },
      { originalName, format },
    );
    const list = await api
      .get('/api/shares/sent')
      .set('Authorization', auth(owner))
      .expect(200);
    const item = list.body.items.find((item) => item._id === share._id);
    assert.deepEqual(item.image, { filename: expected, format });
    const detail = await api
      .get(`/api/shares/${share._id}`)
      .set('Authorization', auth(recipient))
      .expect(200);
    assert.equal(detail.body.image.filename, item.image.filename);
    assert.deepEqual(
      list.body.items.find((item) => item._id === originalShare._id).image,
      { filename: 'photo.png', format: 'png' },
    );
  }
  const saved = await models.Image.findById(version._id).lean();
  assert.equal(saved.originalName, 'archive.plate.PNG');
  assert.equal(saved.path, 'private/selected.webp');
  assert.equal(saved.filename, 'selected.webp');
  await models.Image.deleteOne({ _id: original._id });
  const deleted = (
    await api
      .get('/api/shares/sent')
      .set('Authorization', auth(owner))
      .expect(200)
  ).body.items.find((item) => item._id === originalShare._id);
  assert.equal(deleted.image, null);
  assert.equal(deleted.available, false);
  assert.equal(deleted.recipientEmail, recipient.email);
});
