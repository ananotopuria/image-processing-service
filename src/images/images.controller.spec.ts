import { ThrottlerModule } from '@nestjs/throttler';
import { ListImagesDto } from './dto/list-images.dto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { TransformImageDto } from './dto/transform-image.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';

describe('Images API contract', () => {
  let app: INestApplication;
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test-only-secret' }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
      ],
      controllers: [ImagesController],
      providers: [{ provide: ImagesService, useValue: {} }, JwtAuthGuard],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
  });

  afterAll(async () => app?.close());

  it('documents upload and transformation as separate authenticated operations', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const upload = doc.paths['/api/images/upload'].post!;
    const transform = doc.paths['/api/images/{id}/transform'].post!;
    expect(upload.parameters).toEqual([]);
    expect(upload.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: {
            required: ['file'],
            properties: { file: { format: 'binary' } },
          },
        },
      },
    });
    expect(transform.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TransformImageDto' },
        },
      },
    });
    expect(doc.components!.schemas!.TransformImageDto).toMatchObject({
      required: ['transformations'],
      properties: {
        transformations: {
          allOf: [{ $ref: '#/components/schemas/ImageTransformationsDto' }],
        },
      },
    });
    expect(doc.components!.schemas!.ImageTransformationsDto).toMatchObject({
      properties: {
        resize: { allOf: [{ $ref: '#/components/schemas/ResizeImageDto' }] },
        crop: { allOf: [{ $ref: '#/components/schemas/CropImageDto' }] },
        filters: { $ref: '#/components/schemas/ImageFiltersDto' },
        flip: { type: 'boolean' },
        mirror: { type: 'boolean' },
      },
    });
    expect(transform.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(transform.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '404', '409', '422', '502']),
    );
    expect(doc.components!.schemas!.ImageResponseDto).toMatchObject({
      properties: {
        originalImageId: { type: 'string' },
        kind: { enum: ['original', 'transformed'] },
      },
    });
  });

  it.each([
    'uploadImage',
    'transformImage',
    'getMyImages',
    'getImageById',
    'deleteImage',
  ] as const)('keeps the JWT guard on %s', (method) => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ImagesController.prototype[method]),
    ).toContain(JwtAuthGuard);
  });

  it.each([
    { resize: { width: 1200 } },
    { resize: { height: 800 } },
    { resize: { width: 800, height: 600 } },
    { crop: { width: 500, height: 400, x: 10, y: 20 } },
    { crop: { width: 1, height: 1 } },
    { rotate: 90 },
    { rotate: -12.5 },
    { rotate: 0 },
    { flip: false },
    { mirror: true },
    { filters: { grayscale: true, sepia: false } },
    { format: 'png', quality: 1 },
    { quality: 100 },
    {
      resize: { width: 800 },
      rotate: 90,
      flip: true,
      mirror: true,
      filters: { sepia: true },
      format: 'webp',
      quality: 75,
    },
  ])(
    'accepts single and combined nested transformations: %j',
    async (transformations) => {
      const body = { transformations };
      await expect(
        pipe.transform(body, { type: 'body', metatype: TransformImageDto }),
      ).resolves.toMatchObject(body);
    },
  );

  it.each([
    {},
    { width: 800 },
    { transformations: {} },
    { transformations: null },
    { transformations: [] },
    { transformations: 'rotate' },
    { transformations: { rotate: 90 }, extra: true },
    ...[
      { resize: {} },
      { resize: null },
      { resize: [] },
      { resize: { width: 0 } },
      { resize: { height: 4001 } },
      { resize: { width: 12.5 } },
      { resize: { width: '800' } },
      { resize: { width: true } },
      { resize: { width: null } },
      { resize: { height: null } },
      { resize: { width: 20, fit: 'fill' } },
      { crop: {} },
      { crop: { width: 20 } },
      { crop: { width: 0, height: 20 } },
      { crop: { width: 20, height: 20, x: -1 } },
      { crop: { width: 20, height: 20, y: 0.5 } },
      { crop: { width: 20, height: 20, x: null } },
      { crop: { width: 20, height: 20, left: 0 } },
      { quality: 101 },
      { quality: 0 },
      { quality: 2.5 },
      { quality: '80' },
      { quality: null },
      { format: 'gif' },
      { format: null },
      { rotate: '90' },
      { rotate: null },
      { rotate: 361 },
      { rotate: -361 },
      { rotate: Infinity },
      { rotate: NaN },
      { flip: 'false' },
      { flip: null },
      { mirror: 1 },
      { mirror: 'true' },
      { filters: {} },
      { filters: null },
      { filters: [] },
      { filters: { grayscale: 'true' } },
      { filters: { sepia: 1 } },
      { filters: { grayscale: null } },
      { filters: { blur: true } },
      { watermark: 'text' },
      { unknown: true },
    ].map((transformations) => ({ transformations })),
  ])('rejects invalid, empty, null, or unexpected input: %j', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: TransformImageDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('documents pagination and access URLs', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(doc.paths['/api/images'].get!.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'page', in: 'query', required: false }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          required: false,
        }),
      ]),
    );
    expect(doc.paths['/api/images'].get!.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PaginatedImagesDto' },
        },
      },
    });
    expect(doc.components!.schemas!.ImageResponseDto).toMatchObject({
      required: expect.arrayContaining(['url', 'downloadUrl', 'urlExpiresAt']),
    });
    expect(
      doc.paths['/api/images/{id}/transform'].post!.responses,
    ).toHaveProperty('429');
  });

  it.each([
    [{}, { page: 1, limit: 10 }],
    [
      { page: '2', limit: '50' },
      { page: 2, limit: 50 },
    ],
  ])(
    'validates pagination defaults and numeric query strings',
    async (input, expected) => {
      await expect(
        pipe.transform(input, { type: 'query', metatype: ListImagesDto }),
      ).resolves.toMatchObject(expected);
    },
  );

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '' },
    { page: 'foo' },
    { page: '1e2' },
    { page: '100001' },
    { page: ['1', '2'] },
    { page: null },
    { limit: '51' },
    { limit: '0' },
    { limit: true },
    { limit: '1.1' },
    { extra: 'field' },
  ])('rejects invalid pagination: %j', async (input) => {
    await expect(
      pipe.transform(input, { type: 'query', metatype: ListImagesDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('uses the existing token service without changing authentication', async () => {
    const jwt = app.get(JwtService);
    const token = await jwt.signAsync({
      sub: '66e83a109af861ce27c86a01',
      email: 'ana@example.com',
    });
    await expect(jwt.verifyAsync(token)).resolves.toMatchObject({
      sub: '66e83a109af861ce27c86a01',
    });
  });
});
