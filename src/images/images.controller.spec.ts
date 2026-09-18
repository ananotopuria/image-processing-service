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
      imports: [JwtModule.register({ secret: 'test-only-secret' })],
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

  it('accepts existing transform options and coerces numeric values', async () => {
    const value = await pipe.transform(
      { width: '1200', height: 800, quality: '85', format: 'jpeg' },
      { type: 'body', metatype: TransformImageDto },
    );
    expect(value).toMatchObject({
      width: 1200,
      height: 800,
      quality: 85,
      format: 'jpeg',
    });
    await expect(
      pipe.transform({}, { type: 'body', metatype: TransformImageDto }),
    ).resolves.toEqual({});
  });

  it.each([
    { width: 0 },
    { height: 4001 },
    { width: 12.5 },
    { quality: 101 },
    { quality: 0 },
    { format: 'gif' },
    { rotate: 90 },
    { crop: 'center' },
  ])('rejects invalid or unsupported transform options: %j', async (value) => {
    await expect(
      pipe.transform(value, { type: 'body', metatype: TransformImageDto }),
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
