// Native Node runs Nest's ESM file-type detection without Jest's VM restrictions.
// Uses real controllers, validation, JWT, bcrypt, Sharp, and throttler; no cloud credentials.
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { JwtModule, JwtService } = require('@nestjs/jwt');
const { ThrottlerModule } = require('@nestjs/throttler');
const { BadGatewayException } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { configureApp, parseCorsOrigins } = require('../dist/app.config');
const { getModelToken } = require('@nestjs/mongoose');
const { model } = require('mongoose');
const request = require('supertest');
const sharp = require('sharp');
const { AuthController } = require('../dist/auth/auth.controller');
const { AuthService } = require('../dist/auth/auth.service');
const { UsersService } = require('../dist/users/users.service');
const { UserSchema } = require('../dist/users/schemas/user.schema');
const { ImagesController } = require('../dist/images/images.controller');
const { ImagesService } = require('../dist/images/images.service');
const { ImageSchema } = require('../dist/images/schemas/image.schema');
const { S3Service } = require('../dist/s3/s3.service');
const UserModel = model('HttpTestUser', UserSchema);
const ImageModel = model('HttpTestImage', ImageSchema);

async function setup() {
  const rows = [];
  const users = [];
  const objects = new Map();
  const calls = { sign: 0, read: 0 };
  const matches = (row, query) =>
    Object.entries(query).every(
      ([key, value]) => String(row[key]) === String(value),
    );
  const imageDb = {
    create: async (data) => {
      const row = new ImageModel({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await row.validate();
      rows.push(row);
      return row;
    },
    findOne: (query) => ({
      exec: async () => rows.find((row) => matches(row, query)),
    }),
    find: (query) => {
      let skip = 0,
        limit = Infinity;
      const cursor = {
        sort: () => cursor,
        skip: (n) => {
          skip = n;
          return cursor;
        },
        limit: (n) => {
          limit = n;
          return cursor;
        },
        exec: async () =>
          rows
            .filter((row) => matches(row, query))
            .sort((a, b) => String(b._id).localeCompare(String(a._id)))
            .slice(skip, skip + limit),
      };
      return cursor;
    },
    countDocuments: (query) => ({
      exec: async () => rows.filter((row) => matches(row, query)).length,
    }),
    deleteOne: async (query) => {
      const index = rows.findIndex((row) => matches(row, query));
      if (index >= 0) rows.splice(index, 1);
    },
  };
  const userDb = {
    create: async (data) => {
      const row = new UserModel(data);
      await row.validate();
      users.push(row);
      return row;
    },
    findOne: (query) => {
      const result = Promise.resolve(users.find((row) => matches(row, query)));
      result.select = () => result;
      return result;
    },
  };
  const storage = {
    uploadFile: async (key, bytes) => objects.set(key, Buffer.from(bytes)),
    getFile: async (key) => {
      calls.read++;
      return objects.get(key);
    },
    getFileUrls: async (key) => {
      calls.sign++;
      return {
        url: `https://example.test/${key}?display`,
        downloadUrl: `https://example.test/${key}?download`,
        urlExpiresAt: new Date(Date.now() + 900000).toISOString(),
      };
    },
    deleteFile: async (key) => objects.delete(key),
  };
  const module = await Test.createTestingModule({
    imports: [
      JwtModule.register({ secret: 'http-test-only-secret' }),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    ],
    controllers: [AuthController, ImagesController],
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({
          CORS_ORIGINS:
            ' http://localhost:5173, , https://frontend.example.test, ',
        }),
      },
      AuthService,
      UsersService,
      ImagesService,
      { provide: getModelToken('User'), useValue: userDb },
      { provide: getModelToken('Image'), useValue: imageDb },
      { provide: S3Service, useValue: storage },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return {
    app,
    api: request(app.getHttpServer()),
    jwt: app.get(JwtService),
    objects,
    rows,
    storage,
    imageDb,
    userDb,
    calls,
  };
}

async function sampleImage() {
  return sharp({
    create: { width: 100, height: 60, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
}

test('CORS origins are trimmed, empty entries ignored, and invalid configuration rejected', () => {
  assert.deepEqual(
    parseCorsOrigins(
      ' http://localhost:5173, ,https://frontend.example.test, ',
    ),
    ['http://localhost:5173', 'https://frontend.example.test'],
  );
  for (const value of [
    undefined,
    '',
    ' , ',
    '*',
    'null',
    'localhost:5173',
    'ftp://frontend.example.test',
    'https://*.example.test',
    'https://frontend.example.test/',
    'https://frontend.example.test/path',
    'https://frontend.example.test?query=1',
    'https://frontend.example.test#fragment',
    'https://user:password@frontend.example.test',
    'http://localhost:99999',
    'http://localhost:5173,invalid',
  ]) {
    assert.throws(() => parseCorsOrigins(value), /CORS_ORIGINS/);
  }
});

function assertCors(response, origin = 'http://localhost:5173') {
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
  assert.match(response.headers.vary, /\bOrigin\b/);
  assert.equal(
    response.headers['access-control-expose-headers'],
    'Retry-After',
  );
}

test('real app CORS handles preflights before guards and only permits configured origins', async () => {
  const { app, api, jwt } = await setup();
  try {
    for (const origin of [
      'http://localhost:5173',
      'https://frontend.example.test',
    ]) {
      for (const [path, method] of [
        ['/api/auth/sign-in', 'POST'],
        ['/api/auth/profile', 'GET'],
        ['/api/images/some-id', 'DELETE'],
      ]) {
        const response = await api
          .options(path)
          .set('Origin', origin)
          .set('Access-Control-Request-Method', method)
          .set('Access-Control-Request-Headers', 'authorization,content-type')
          .expect(204);
        assertCors(response, origin);
        const methods =
          response.headers['access-control-allow-methods'].split(',');
        for (const allowed of ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS']) {
          assert(methods.includes(allowed));
        }
        assert.deepEqual(
          response.headers['access-control-allow-headers']
            .toLowerCase()
            .split(',')
            .sort(),
          ['authorization', 'content-type'],
        );
      }
      assertCors(
        await api.get('/api/auth/profile').set('Origin', origin).expect(401),
        origin,
      );
    }

    for (const origin of [
      'https://unlisted.example.test',
      'http://localhost:5174',
      'http://localhost:5173.evil.example.test',
      'null',
    ]) {
      const preflight = await api
        .options('/api/auth/sign-in')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      assert.equal(preflight.headers['access-control-allow-origin'], undefined);
      const response = await api
        .get('/api/auth/profile')
        .set('Origin', origin)
        .expect(401);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    }

    await api.get('/api/auth/profile').expect(401);
    const token = await jwt.signAsync({ sub: '66e83a109af861ce27c86a01' });
    const response = await api
      .get('/api/auth/profile')
      .auth(token, { type: 'bearer' })
      .expect(200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.body.user.sub, '66e83a109af861ce27c86a01');
  } finally {
    await app.close();
  }
});

test('allowed origins receive CORS headers on real 400, 401, 409, 429 and 500 responses', async () => {
  const { app, api, userDb } = await setup();
  const origin = 'http://localhost:5173';
  try {
    // Preflights must not consume the sign-in throttling allowance.
    for (let i = 0; i < 12; i++) {
      await api
        .options('/api/auth/sign-in')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
    }
    for (let i = 0; i < 10; i++) {
      assertCors(
        await api
          .post('/api/auth/sign-in')
          .set('Origin', origin)
          .send({})
          .expect(400),
      );
    }
    const limited = await api
      .post('/api/auth/sign-in')
      .set('Origin', origin)
      .send({})
      .expect(429);
    assertCors(limited);
    assert(Number(limited.headers['retry-after']) > 0);

    assertCors(
      await api.get('/api/auth/profile').set('Origin', origin).expect(401),
    );
    const credentials = {
      username: 'cors',
      email: 'cors@example.test',
      password: 'ExamplePass123!',
    };
    assertCors(
      await api
        .post('/api/auth/sign-up')
        .set('Origin', origin)
        .send(credentials)
        .expect(201),
    );
    assertCors(
      await api
        .post('/api/auth/sign-up')
        .set('Origin', origin)
        .send(credentials)
        .expect(409),
    );

    userDb.findOne = () => {
      throw new Error('simulated database failure');
    };
    assertCors(
      await api
        .post('/api/auth/sign-up')
        .set('Origin', origin)
        .send(credentials)
        .expect(500),
    );
  } finally {
    await app.close();
  }
});

test('complete backend flow, ownership, validation, storage failures and private retrieval', async () => {
  const { app, api, jwt, objects, storage, imageDb, calls } = await setup();
  try {
    const credentials = {
      username: 'ana',
      email: 'ana@example.com',
      password: 'ExamplePass123!',
    };
    const signup = await api
      .post('/api/auth/sign-up')
      .send(credentials)
      .expect(201);
    assert(signup.body.accessToken);
    assert(!signup.body.user.password);
    await api.post('/api/auth/sign-up').send(credentials).expect(409);
    await api
      .post('/api/auth/sign-in')
      .send({ email: credentials.email, password: 'WrongPass123!' })
      .expect(401);
    const login = await api
      .post('/api/auth/sign-in')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const token = login.body.accessToken;
    const otherToken = await jwt.signAsync({
      sub: '66e83a109af861ce27c86aff',
      email: 'other@example.com',
    });
    const expired = await jwt.signAsync(
      { sub: signup.body.user.id },
      { expiresIn: -1 },
    );
    await api.get('/api/images').expect(401);
    await api
      .get('/api/images')
      .auth('invalid', { type: 'bearer' })
      .expect(401);
    await api.get('/api/images').auth(expired, { type: 'bearer' }).expect(401);
    await api
      .get('/api/auth/profile')
      .auth(token, { type: 'bearer' })
      .expect(200);
    await api
      .post('/api/images/upload')
      .auth(token, { type: 'bearer' })
      .expect(400);
    await api
      .post('/api/images/upload')
      .auth(token, { type: 'bearer' })
      .attach('file', Buffer.from('plain text'), {
        filename: 'bad.png',
        contentType: 'image/png',
      })
      .expect(400);
    for (const size of [5 * 1024 * 1024, 5 * 1024 * 1024 + 1]) {
      await api
        .post('/api/images/upload')
        .auth(token, { type: 'bearer' })
        .attach('file', Buffer.alloc(size), { filename: 'large.png' })
        .expect(413);
    }
    const bytes = await sampleImage();
    // The inclusive Multer limit must accept one byte below 5 MiB.
    const largestAllowed = Buffer.alloc(5 * 1024 * 1024 - 1);
    bytes.copy(largestAllowed);
    const boundaryUpload = await api
      .post('/api/images/upload')
      .auth(token, { type: 'bearer' })
      .attach('file', largestAllowed, { filename: 'boundary.png' })
      .expect(201);
    assert.equal(boundaryUpload.body.originalSize, largestAllowed.length);
    await api
      .delete(`/api/images/${boundaryUpload.body._id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);

    const upload = await api
      .post('/api/images/upload')
      .auth(token, { type: 'bearer' })
      .attach('file', bytes, { filename: 'photo.png' })
      .expect(201);
    assert.deepEqual(objects.get(upload.body.path), bytes);
    assert(
      upload.body.url && upload.body.downloadUrl && upload.body.urlExpiresAt,
    );
    assert.equal(upload.headers['cache-control'], 'private, no-store');
    const id = upload.body._id;
    const signCount = calls.sign;
    await api
      .get(`/api/images/${id}`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    await api
      .get('/api/images/not-an-id')
      .auth(token, { type: 'bearer' })
      .expect(404);
    assert.equal(calls.sign, signCount);
    await api
      .post(`/api/images/${id}/transform`)
      .auth(otherToken, { type: 'bearer' })
      .send({ transformations: { rotate: 90 } })
      .expect(404);
    assert.equal(calls.read, 0);
    const listed = await api
      .get('/api/images?page=1&limit=10')
      .auth(token, { type: 'bearer' })
      .expect(200);
    assert.deepEqual(
      [
        listed.body.page,
        listed.body.limit,
        listed.body.total,
        listed.body.totalPages,
      ],
      [1, 10, 1, 1],
    );
    const otherList = await api
      .get('/api/images')
      .auth(otherToken, { type: 'bearer' })
      .expect(200);
    assert.deepEqual(otherList.body.items, []);
    for (const query of [
      'page=0',
      'limit=51',
      'page=abc',
      'limit=1.5',
      'extra=1',
    ])
      await api
        .get(`/api/images?${query}`)
        .auth(token, { type: 'bearer' })
        .expect(400);
    for (const transformations of [
      { format: 'gif' },
      { quality: 101 },
      { flip: 'true' },
      { crop: { width: 101, height: 60 } },
    ]) {
      await api
        .post(`/api/images/${id}/transform`)
        .auth(token, { type: 'bearer' })
        .send({ transformations })
        .expect(400);
    }
    const transformed = await api
      .post(`/api/images/${id}/transform`)
      .auth(token, { type: 'bearer' })
      .send({
        transformations: {
          resize: { width: 40 },
          rotate: 90,
          filters: { sepia: true },
          format: 'webp',
        },
      })
      .expect(201);
    assert.equal(transformed.body.width, 24);
    assert.equal(transformed.body.height, 40);
    assert.deepEqual(objects.get(upload.body.path), bytes);
    const page = await api
      .get('/api/images?page=2&limit=1')
      .auth(token, { type: 'bearer' })
      .expect(200);
    assert.equal(page.body.totalPages, 2);
    assert.equal(page.body.items[0]._id, id);
    const retrieved = await api
      .get(`/api/images/${transformed.body._id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    assert(retrieved.body.url.includes(transformed.body.path));
    storage.getFile = async () => {
      throw new BadGatewayException('Unable to retrieve image from storage');
    };
    await api
      .post(`/api/images/${id}/transform`)
      .auth(token, { type: 'bearer' })
      .send({ transformations: { rotate: 90 } })
      .expect(502);
    const countDocuments = imageDb.countDocuments;
    imageDb.countDocuments = () => {
      throw new Error('private database details');
    };
    const failure = await api
      .get('/api/images')
      .auth(token, { type: 'bearer' })
      .expect(500);
    assert(!JSON.stringify(failure.body).includes('private database details'));
    assert(!failure.body.stack);
    imageDb.countDocuments = countDocuments;
    await api
      .delete(`/api/images/${id}`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    await api
      .delete(`/api/images/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    assert.equal(objects.size, 0);
    await api
      .get(`/api/images/${transformed.body._id}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  } finally {
    await app.close();
  }
});

test('real HTTP 429 responses for image transformations and sign-in', async () => {
  const { app, api, jwt } = await setup();
  try {
    const token = await jwt.signAsync({ sub: '66e83a109af861ce27c86a01' });
    const upload = await api
      .post('/api/images/upload')
      .auth(token, { type: 'bearer' })
      .attach('file', await sampleImage(), { filename: 'image.png' })
      .expect(201);
    for (let i = 0; i < 10; i++) {
      await api
        .post(`/api/images/${upload.body._id}/transform`)
        .auth(token, { type: 'bearer' })
        .send({ transformations: { rotate: 90 } })
        .expect(201);
    }
    const response = await api
      .post(`/api/images/${upload.body._id}/transform`)
      .auth(token, { type: 'bearer' })
      .send({ transformations: { rotate: 90 } })
      .expect(429);
    assert(Number(response.headers['retry-after']) > 0);
    for (let i = 0; i < 10; i++)
      await api.post('/api/auth/sign-in').send({}).expect(400);
    const authLimit = await api.post('/api/auth/sign-in').send({}).expect(429);
    assert(Number(authLimit.headers['retry-after']) > 0);
  } finally {
    await app.close();
  }
});
