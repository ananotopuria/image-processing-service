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
const { model, Types } = require('mongoose');
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
const { FavoriteSchema } = require('../dist/images/schemas/favorite.schema');
const FavoriteModel = model('HttpTestFavorite', FavoriteSchema);
const UserModel = model('HttpTestUser', UserSchema);
const ImageModel = model('HttpTestImage', ImageSchema);

async function setup() {
  const rows = [];
  const users = [];
  const favorites = [];
  const objects = new Map();
  const calls = { sign: 0, read: 0 };
  const matches = (row, query) =>
    Object.entries(query).every(([key, value]) =>
      value && value.$in
        ? value.$in.some((id) => String(row[key]) === String(id))
        : String(row[key]) === String(value),
    );
  const imageDb = {
    collection: { name: ImageModel.collection.name },
    hydrate: (data) => ImageModel.hydrate(data),
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
  const favoriteDb = {
    updateOne: (query, update) => ({
      exec: async () => {
        if (!favorites.some((row) => matches(row, query))) {
          const row = new FavoriteModel(update.$setOnInsert);
          await row.validate();
          favorites.push(row);
        }
      },
    }),
    deleteOne: (query) => ({
      exec: async () => {
        const index = favorites.findIndex((row) => matches(row, query));
        if (index >= 0) favorites.splice(index, 1);
      },
    }),
    deleteMany: (query) => ({
      exec: async () => {
        for (let i = favorites.length - 1; i >= 0; i--) {
          if (matches(favorites[i], query)) favorites.splice(i, 1);
        }
      },
    }),
    find: (query) => {
      const cursor = {
        select: () => cursor,
        lean: () => cursor,
        exec: async () => favorites.filter((row) => matches(row, query)),
      };
      return cursor;
    },
    // A small interpreter for the aggregation stages used by the service.
    // Unit tests also assert the actual pipeline's ownership/count placement.
    aggregate: (pipeline) => ({
      exec: async () => {
        const run = (input, stages) =>
          stages.reduce((data, stage) => {
            if (stage.$match)
              return data.filter((row) =>
                Object.entries(stage.$match).every(([key, value]) => {
                  const actual = key
                    .split('.')
                    .reduce((item, part) => item?.[part], row);
                  return String(actual) === String(value);
                }),
              );
            if (stage.$lookup) {
              assert.equal(stage.$lookup.from, ImageModel.collection.name);
              return data.map((row) => ({
                ...row,
                [stage.$lookup.as]: rows
                  .filter(
                    (image) =>
                      String(image[stage.$lookup.foreignField]) ===
                      String(row[stage.$lookup.localField]),
                  )
                  .map((image) => image.toObject()),
              }));
            }
            if (stage.$unwind)
              return data.flatMap((row) =>
                row[stage.$unwind.slice(1)].map((value) => ({
                  ...row,
                  [stage.$unwind.slice(1)]: value,
                })),
              );
            if (stage.$replaceRoot)
              return data.map(
                (row) => row[stage.$replaceRoot.newRoot.slice(1)],
              );
            if (stage.$sort)
              return [...data].sort((a, b) => {
                for (const [key, direction] of Object.entries(stage.$sort)) {
                  const left =
                    a[key] instanceof Date ? a[key].getTime() : String(a[key]);
                  const right =
                    b[key] instanceof Date ? b[key].getTime() : String(b[key]);
                  if (left !== right)
                    return (left > right ? 1 : -1) * direction;
                }
                return 0;
              });
            if (stage.$skip !== undefined) return data.slice(stage.$skip);
            if (stage.$limit !== undefined) return data.slice(0, stage.$limit);
            if (stage.$count)
              return data.length ? [{ [stage.$count]: data.length }] : [];
            if (stage.$facet)
              return [
                Object.fromEntries(
                  Object.entries(stage.$facet).map(([key, stages]) => [
                    key,
                    run(data, stages),
                  ]),
                ),
              ];
            throw new Error('Unsupported test aggregation stage');
          }, input);
        return run(
          favorites.map((row) => row.toObject()),
          pipeline,
        );
      },
    }),
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
      { provide: getModelToken('Favorite'), useValue: favoriteDb },
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
    favorites,
    favoriteDb,
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
        ['/api/images/some-id/favorite', 'PUT'],
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
        for (const allowed of [
          'GET',
          'HEAD',
          'POST',
          'PUT',
          'DELETE',
          'OPTIONS',
        ]) {
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
  const { app, api, jwt, objects, rows, storage, imageDb, calls } =
    await setup();
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
    assert.deepEqual(
      objects.get(rows.find((row) => String(row._id) === upload.body._id).path),
      bytes,
    );
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
    assert.deepEqual(
      objects.get(rows.find((row) => String(row._id) === upload.body._id).path),
      bytes,
    );
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
    assert(
      retrieved.body.url.includes(
        rows.find((row) => String(row._id) === transformed.body._id).path,
      ),
    );
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

test('favorites are authenticated, owner-only, idempotent, paginated and cleaned up', async () => {
  const { app, api, jwt, imageDb, favoriteDb, favorites, rows, calls } =
    await setup();
  const userId = '66e83a109af861ce27c86a01';
  const otherId = '66e83a109af861ce27c86a09';
  const token = await jwt.signAsync({ sub: userId });
  const otherToken = await jwt.signAsync({ sub: otherId });
  const owned = (req) => req.auth(token, { type: 'bearer' });
  const other = (req) => req.auth(otherToken, { type: 'bearer' });
  const create = (user, extra = {}) =>
    imageDb.create({
      user,
      originalName: 'photo.png',
      filename: 'photo.png',
      path: 'originals/private/photo.png',
      originalKey: 'originals/private/photo.png',
      format: 'png',
      mimeType: 'image/png',
      kind: 'original',
      originalSize: 10,
      ...extra,
    });
  try {
    const first = await create(userId);
    const second = await create(userId);
    await create(userId); // Owned, but never favorited: must not affect favorite total.
    const foreign = await create(otherId);
    const version = await create(userId, {
      kind: 'transformed',
      originalImageId: first._id,
      path: 'transformed/private/version.png',
      quality: 80,
      processedSize: 8,
    });
    // Equal timestamps exercise deterministic ID ordering.
    for (const row of rows) row.createdAt = new Date('2026-09-01T00:00:00Z');
    const path = `/api/images/${first._id}/favorite`;
    for (const req of [
      api.put(path),
      api.delete(path),
      api.get('/api/images/favorites'),
    ]) {
      const result = await req.expect(401);
      assert.equal(result.body.message, 'Authentication token is required');
    }
    await api
      .get('/api/images/favorites')
      .auth('invalid', { type: 'bearer' })
      .expect(401);
    for (const id of ['invalid-id', new Types.ObjectId(), foreign._id]) {
      for (const method of ['put', 'delete']) {
        const response = await owned(
          api[method](`/api/images/${id}/favorite`),
        ).expect(404);
        assert.deepEqual(response.body, {
          message: 'Image not found',
          error: 'Not Found',
          statusCode: 404,
        });
      }
    }
    assert.equal(favorites.length, 0);
    for (let i = 0; i < 2; i++) {
      const response = await owned(api.put(path))
        .send({ userId: otherId })
        .expect(200);
      assert.deepEqual(response.body, {
        imageId: String(first._id),
        isFavorite: true,
      });
    }
    assert.equal(favorites.length, 1);
    assert.equal(String(favorites[0].userId), userId); // Body cannot override JWT identity.
    await owned(api.put(`/api/images/${second._id}/favorite`)).expect(200);
    await owned(api.put(`/api/images/${version._id}/favorite`)).expect(200);
    await other(api.put(`/api/images/${foreign._id}/favorite`)).expect(200);
    await other(api.delete(path)).expect(404);
    const detail = await owned(api.get(`/api/images/${first._id}`)).expect(200);
    assert.equal(detail.body.isFavorite, true);
    const list = await owned(api.get('/api/images')).expect(200);
    assert.equal(list.body.total, 4);
    assert.equal(list.body.items.filter((item) => item.isFavorite).length, 3);

    // Simulate stale and inaccessible references, including another user's
    // reference to the same image (future sharing must not merge memberships).
    for (const [user, image] of [
      [userId, new Types.ObjectId()],
      [userId, foreign._id],
      [otherId, first._id],
    ]) {
      const filter = { userId: new Types.ObjectId(user), imageId: image };
      await favoriteDb.updateOne(filter, { $setOnInsert: filter }).exec();
    }
    const signedBefore = calls.sign;
    const page1 = await owned(
      api.get('/api/images/favorites?page=1&limit=2'),
    ).expect(200);
    assert.deepEqual(
      Object.keys(page1.body).sort(),
      ['items', 'page', 'limit', 'total', 'totalPages'].sort(),
    );
    assert.equal(page1.body.total, 3);
    assert.equal(page1.body.totalPages, 2);
    assert.equal(page1.body.page, 1);
    assert.equal(page1.body.limit, 2);
    assert.deepEqual(
      page1.body.items.map((item) => item._id),
      [String(version._id), String(second._id)],
    );
    assert.equal(calls.sign - signedBefore, 2);
    for (const item of page1.body.items) {
      assert.equal(item.isFavorite, true);
      assert(item.url && item.downloadUrl && item.urlExpiresAt);
      for (const field of ['path', 'originalKey', '__v', 'imageId', 'userId'])
        assert.equal(item[field], undefined);
    }
    const page2 = await owned(
      api.get('/api/images/favorites?page=2&limit=2'),
    ).expect(200);
    assert.deepEqual(
      page2.body.items.map((item) => item._id),
      [String(first._id)],
    );
    const pastEnd = await owned(
      api.get('/api/images/favorites?page=3&limit=2'),
    ).expect(200);
    assert.deepEqual(pastEnd.body, {
      items: [],
      page: 3,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    const foreignList = await other(api.get('/api/images/favorites')).expect(
      200,
    );
    assert.equal(foreignList.body.total, 1);
    assert.deepEqual(
      foreignList.body.items.map((item) => item._id),
      [String(foreign._id)],
    );
    for (const query of [
      'page=0',
      'limit=51',
      'page=abc',
      'userId=' + otherId,
      'page=1&page=2',
    ]) {
      await owned(api.get('/api/images/favorites?' + query)).expect(400);
    }
    for (let i = 0; i < 2; i++) {
      const response = await owned(api.delete(path)).expect(200);
      assert.deepEqual(response.body, {
        imageId: String(first._id),
        isFavorite: false,
      });
    }
    assert(
      favorites.some(
        (row) =>
          String(row.imageId) === String(first._id) &&
          String(row.userId) === otherId,
      ),
    );
    const removed = await owned(api.get(`/api/images/${first._id}`)).expect(
      200,
    );
    assert.equal(removed.body.isFavorite, false);
    await owned(api.put(path)).expect(200);
    await owned(api.delete(`/api/images/${version._id}`)).expect(200);
    assert(
      !favorites.some((row) => String(row.imageId) === String(version._id)),
    );
    assert(favorites.some((row) => String(row.imageId) === String(first._id)));
    const anotherVersion = await create(userId, {
      kind: 'transformed',
      originalImageId: first._id,
      path: 'transformed/private/another.png',
      quality: 80,
      processedSize: 8,
    });
    await owned(api.put(`/api/images/${anotherVersion._id}/favorite`)).expect(
      200,
    );
    await owned(api.delete(`/api/images/${first._id}`)).expect(200);
    for (const id of [first._id, anotherVersion._id]) {
      assert(!favorites.some((row) => String(row.imageId) === String(id)));
    }
    await owned(api.delete(path)).expect(404); // Missing image is safe and retains existing 404 convention.
    await owned(api.delete(`/api/images/${second._id}/favorite`)).expect(200);
    const empty = await owned(api.get('/api/images/favorites')).expect(200);
    assert.deepEqual(empty.body, {
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  } finally {
    await app.close();
  }
});
