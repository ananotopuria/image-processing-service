import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import sharp from 'sharp';
import { plainToInstance } from 'class-transformer';
import { TransformImageDto } from './dto/transform-image.dto';
import { ImagesService } from './images.service';
import { ImageDocument } from './schemas/image.schema';
import { S3Service } from '../s3/s3.service';

const userId = '66e83a109af861ce27c86a01';
const imageId = '66e83a109af861ce27c86a02';

describe('ImagesService', () => {
  let service: ImagesService;
  let buffer: Buffer;
  let original: Record<string, unknown>;
  let model: {
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    deleteOne: jest.Mock;
  };
  let storage: {
    uploadFile: jest.Mock;
    getFile: jest.Mock;
    deleteFile: jest.Mock;
  };
  const file = () =>
    ({
      buffer,
      size: buffer.length,
      mimetype: 'image/png',
      originalname: 'mountains.png',
    }) as Express.Multer.File;

  beforeAll(async () => {
    buffer = await sharp({
      create: { width: 120, height: 60, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    original = {
      _id: new Types.ObjectId(imageId),
      user: new Types.ObjectId(userId),
      kind: 'original',
      originalKey: `originals/${userId}/source.png`,
      path: `originals/${userId}/source.png`,
      originalName: 'mountains.png',
      originalSize: buffer.length,
    };
    model = {
      create: jest.fn().mockImplementation(async (data) => data),
      findOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(original) }),
      find: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    storage = {
      uploadFile: jest.fn().mockResolvedValue(undefined),
      getFile: jest.fn().mockResolvedValue(buffer),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    service = new ImagesService(
      model as unknown as Model<ImageDocument>,
      storage as unknown as S3Service,
    );
  });

  it('preserves the exact original bytes without processed metadata', async () => {
    const result = await service.uploadImage(file(), userId);
    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^originals/${userId}/.+\\.png$`)),
      buffer,
      'image/png',
    );
    expect(result).toMatchObject({
      kind: 'original',
      originalKey: result.path,
      originalSize: buffer.length,
      mimeType: 'image/png',
      format: 'png',
    });
    expect(result).not.toHaveProperty('quality');
    expect(result).not.toHaveProperty('processedSize');
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('creates distinct originals when the same file is uploaded twice', async () => {
    const first = await service.uploadImage(file(), userId);
    const second = await service.uploadImage(file(), userId);
    expect(first.path).not.toBe(second.path);
  });

  it.each(['jpeg', 'png', 'webp'] as const)(
    'transforms the original into %s with real Sharp output',
    async (format) => {
      const result = await service.transformImage(
        imageId,
        { transformations: { resize: { width: 40 }, quality: 65, format } },
        userId,
      );
      const [key, output, mime] = storage.uploadFile.mock.calls[0];
      const metadata = await sharp(output).metadata();
      expect(storage.getFile).toHaveBeenCalledWith(original.originalKey);
      expect(key).toMatch(
        new RegExp(`^transformed/${userId}/${imageId}/.+\\.${format}$`),
      );
      expect(key).not.toBe(original.path);
      expect(mime).toBe(`image/${format}`);
      expect(metadata).toMatchObject({ width: 40, height: 20, format });
      expect(result).toMatchObject({
        kind: 'transformed',
        originalImageId: original._id,
        originalKey: original.originalKey,
        width: 40,
        height: 20,
        quality: 65,
        processedSize: output.length,
      });
      expect(original).not.toHaveProperty('processedSize');
    },
  );

  it('keeps encoding defaults without implicit resizing and always reads the original', async () => {
    const first = await service.transformImage(
      imageId,
      { transformations: { format: 'webp' } },
      userId,
    );
    const second = await service.transformImage(
      imageId,
      { transformations: { resize: { width: 30, height: 30 } } },
      userId,
    );
    expect(first).toMatchObject({
      width: 120,
      height: 60,
      quality: 80,
      format: 'webp',
    });
    expect(second).toMatchObject({ width: 30, height: 30 });
    expect(first.path).not.toBe(second.path);
    expect(storage.getFile.mock.calls).toEqual([
      [original.originalKey],
      [original.originalKey],
    ]);
  });

  // Distinct pixels make operation ordering observable instead of merely
  // comparing dimensions or repeating the implementation's Sharp calls.
  async function setPixelSource() {
    const values = [10, 20, 30, 40, 50, 60];
    const data = Buffer.from(values.flatMap((value) => [value, value, value]));
    const source = await sharp(data, {
      raw: { width: 3, height: 2, channels: 3 },
    })
      .png()
      .toBuffer();
    storage.getFile.mockResolvedValue(source);
  }

  async function uploadedPixels() {
    const output = storage.uploadFile.mock.calls[0][1] as Buffer;
    return sharp(output)
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
  }

  it.each([
    [{ flip: true }, [40, 50, 60, 10, 20, 30], 3, 2],
    [{ mirror: true }, [30, 20, 10, 60, 50, 40], 3, 2],
    [{ rotate: 90 }, [40, 10, 50, 20, 60, 30], 2, 3],
    [{ rotate: -90 }, [30, 60, 20, 50, 10, 40], 2, 3],
    [{ rotate: 180 }, [60, 50, 40, 30, 20, 10], 3, 2],
    [{ rotate: 0, flip: false, mirror: false }, [10, 20, 30, 40, 50, 60], 3, 2],
    [{ flip: true, mirror: true, rotate: 90 }, [30, 60, 20, 50, 10, 40], 2, 3],
    [
      { crop: { width: 2, height: 2, x: 1, y: 0 }, mirror: true, rotate: 90 },
      [60, 30, 50, 20],
      2,
      2,
    ],
  ] as const)(
    'applies geometric operations in the documented order: %j',
    async (operations, expected, width, height) => {
      await setPixelSource();
      const result = await service.transformImage(
        imageId,
        { transformations: { ...operations, format: 'png', quality: 100 } },
        userId,
      );
      const pixels = await uploadedPixels();
      expect(result).toMatchObject({ width, height });
      const values = Array.from(pixels.data).filter(
        (_value, index) => index % pixels.info.channels === 0,
      );
      expect(values).toEqual(expected);
    },
  );

  it('stores a reusable recipe without unset nested DTO fields', async () => {
    const body = plainToInstance(TransformImageDto, {
      transformations: { resize: { width: 40 }, flip: false },
    });
    const result = await service.transformImage(imageId, body, userId);
    expect(result.transformations).toStrictEqual({
      resize: { width: 40 },
      flip: false,
      format: 'webp',
      quality: 80,
    });
  });

  it('supports rotation alone without a hidden resize', async () => {
    const result = await service.transformImage(
      imageId,
      { transformations: { rotate: 90 } },
      userId,
    );
    expect(result).toMatchObject({
      width: 60,
      height: 120,
      format: 'webp',
      quality: 80,
      transformations: { rotate: 90, format: 'webp', quality: 80 },
    });
    expect(result.transformations).not.toHaveProperty('resize');
  });

  it('supports fractional rotation with a transparent expanded canvas', async () => {
    const result = await service.transformImage(
      imageId,
      { transformations: { rotate: 45.5, format: 'png' } },
      userId,
    );
    const output = await uploadedPixels();
    expect(result.width).toBeGreaterThan(120);
    expect(result.height).toBeGreaterThan(60);
    expect(output.info.channels).toBe(4);
    expect(output.data[3]).toBe(0);
  });

  it('crops before resizing and rotates after resizing, storing resolved options', async () => {
    const result = await service.transformImage(
      imageId,
      {
        transformations: {
          crop: { width: 100, height: 50 },
          resize: { width: 40 },
          rotate: 90,
        },
      },
      userId,
    );
    expect(result).toMatchObject({
      width: 20,
      height: 40,
      transformations: {
        crop: { width: 100, height: 50, x: 0, y: 0 },
        resize: { width: 40 },
        rotate: 90,
        format: 'webp',
        quality: 80,
      },
    });
    expect(storage.getFile).toHaveBeenCalledWith(original.originalKey);
  });

  it('supports height-only resizing', async () => {
    const result = await service.transformImage(
      imageId,
      { transformations: { resize: { height: 20 } } },
      userId,
    );
    expect(result).toMatchObject({ width: 40, height: 20 });
  });

  it.each([
    { width: 121, height: 60 },
    { width: 120, height: 61 },
    { width: 20, height: 10, x: 101 },
    { width: 20, height: 10, y: 51 },
  ])(
    'returns useful 400s for crop rectangles outside the original: %j',
    async (crop) => {
      await expect(
        service.transformImage(imageId, { transformations: { crop } }, userId),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('120 x 60'),
      });
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it('accepts a crop touching the original boundary', async () => {
    const result = await service.transformImage(
      imageId,
      { transformations: { crop: { width: 20, height: 10, x: 100, y: 50 } } },
      userId,
    );
    expect(result).toMatchObject({ width: 20, height: 10 });
  });

  it.each([
    { grayscale: true },
    { sepia: true },
    { grayscale: true, sepia: true },
    { grayscale: false, sepia: false },
  ])(
    'applies color filters and preserves transparency: %j',
    async (filters) => {
      const input = await sharp(Buffer.from([60, 100, 140, 128]), {
        raw: { width: 1, height: 1, channels: 4 },
      })
        .png()
        .toBuffer();
      storage.getFile.mockResolvedValue(input);
      await service.transformImage(
        imageId,
        { transformations: { filters, format: 'png', quality: 100 } },
        userId,
      );
      const output = await uploadedPixels();
      const [red, green, blue, alpha] = output.data;
      expect(alpha).toBe(128);
      if (filters.sepia) {
        expect(red).toBeGreaterThan(green);
        expect(green).toBeGreaterThan(blue);
        if (!filters.grayscale) {
          expect(red).toBeCloseTo(126, 0);
          expect(green).toBeCloseTo(113, 0);
          expect(blue).toBeCloseTo(88, 0);
        }
      } else if (filters.grayscale) {
        expect(red).toBe(green);
        expect(green).toBe(blue);
      } else {
        expect([red, green, blue]).toEqual([60, 100, 140]);
      }
    },
  );

  it('preserves translucent RGB values across resize and rotation stages', async () => {
    const input = await sharp({
      create: {
        width: 12,
        height: 6,
        channels: 4,
        background: { r: 60, g: 100, b: 140, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    storage.getFile.mockResolvedValue(input);
    await service.transformImage(
      imageId,
      {
        transformations: {
          resize: { width: 6 },
          rotate: 90,
          format: 'png',
          quality: 100,
        },
      },
      userId,
    );
    const output = await uploadedPixels();
    expect(output.info).toMatchObject({ width: 3, height: 6, channels: 4 });
    const [red, green, blue, alpha] = output.data;
    expect(Math.abs(red - 60)).toBeLessThanOrEqual(1);
    expect(Math.abs(green - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(blue - 140)).toBeLessThanOrEqual(1);
    expect(alpha).toBe(128);
  });

  it('applies grayscale before sepia when both are requested', async () => {
    await service.transformImage(
      imageId,
      {
        transformations: {
          filters: { grayscale: true },
          format: 'png',
          quality: 100,
        },
      },
      userId,
    );
    const gray = (await uploadedPixels()).data[0];
    storage.uploadFile.mockClear();
    await service.transformImage(
      imageId,
      {
        transformations: {
          filters: { grayscale: true, sepia: true },
          format: 'png',
          quality: 100,
        },
      },
      userId,
    );
    const [red, green, blue] = (await uploadedPixels()).data;
    expect(Math.abs(red - Math.floor(gray * 1.351))).toBeLessThanOrEqual(1);
    expect(Math.abs(green - Math.floor(gray * 1.203))).toBeLessThanOrEqual(1);
    expect(Math.abs(blue - Math.floor(gray * 0.937))).toBeLessThanOrEqual(1);
  });

  it('turns Sharp operation failures into 400 without uploading', async () => {
    // DTO validation normally rejects this; also guard the processing boundary.
    await expect(
      service.transformImage(
        imageId,
        { transformations: { resize: { width: -1 } } },
        userId,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects invalid IDs before database or S3 access', async () => {
    await expect(
      service.transformImage(
        'invalid-id',
        { transformations: { rotate: 90 } },
        userId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOne).not.toHaveBeenCalled();
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('checks ownership and returns 404 without S3 access for another user or a missing image', async () => {
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(
      service.transformImage(
        imageId,
        { transformations: { format: 'webp' } },
        userId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOne).toHaveBeenCalledWith({
      _id: new Types.ObjectId(imageId),
      user: new Types.ObjectId(userId),
    });
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('requires re-upload for legacy records instead of processing their old result', async () => {
    delete original.kind;
    delete original.originalKey;
    await expect(
      service.transformImage(
        imageId,
        { transformations: { format: 'webp' } },
        userId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('rejects a transformed version as the transform source', async () => {
    original.kind = 'transformed';
    await expect(
      service.transformImage(
        imageId,
        { transformations: { format: 'webp' } },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('stops on S3 retrieval failure', async () => {
    storage.getFile.mockRejectedValue(
      new BadGatewayException('Unable to retrieve image from storage'),
    );
    await expect(
      service.transformImage(
        imageId,
        { transformations: { format: 'webp' } },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('returns 422 for invalid image bytes without uploading a version', async () => {
    storage.getFile.mockResolvedValue(Buffer.from('not an image'));
    await expect(
      service.transformImage(
        imageId,
        { transformations: { format: 'webp' } },
        userId,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it.each(['upload', 'transform'])(
    'does not save metadata after failed %s storage',
    async (operation) => {
      storage.uploadFile.mockRejectedValue(
        new BadGatewayException('Unable to upload image to storage'),
      );
      const result =
        operation === 'upload'
          ? service.uploadImage(file(), userId)
          : service.transformImage(
              imageId,
              { transformations: { format: 'webp' } },
              userId,
            );
      await expect(result).rejects.toBeInstanceOf(BadGatewayException);
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it.each(['upload', 'transform'])(
    'cleans up only the newly stored %s when persistence fails',
    async (operation) => {
      model.create.mockRejectedValue(new Error('database unavailable'));
      const result =
        operation === 'upload'
          ? service.uploadImage(file(), userId)
          : service.transformImage(
              imageId,
              { transformations: { format: 'webp' } },
              userId,
            );
      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(storage.deleteFile).toHaveBeenCalledWith(
        storage.uploadFile.mock.calls[0][0],
      );
      expect(storage.deleteFile).not.toHaveBeenCalledWith(original.path);
    },
  );

  it('deletes versions before deleting their original', async () => {
    const version = {
      _id: new Types.ObjectId(),
      path: 'transformed/version.webp',
    };
    model.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([version]),
    });
    await expect(service.removeByUser(imageId, userId)).resolves.toEqual({
      message: 'Image deleted successfully',
    });
    expect(model.find).toHaveBeenCalledWith({
      originalImageId: original._id,
      user: new Types.ObjectId(userId),
    });
    expect(storage.deleteFile.mock.calls).toEqual([
      [version.path],
      [original.path],
    ]);
    expect(model.deleteOne).toHaveBeenNthCalledWith(1, {
      _id: version._id,
      user: new Types.ObjectId(userId),
    });
  });

  it.each(['transformed', undefined])(
    'deletes a %s record without touching other records',
    async (kind) => {
      original.kind = kind;
      await service.removeByUser(imageId, userId);
      expect(model.find).not.toHaveBeenCalled();
      expect(storage.deleteFile.mock.calls).toEqual([[original.path]]);
      expect(model.deleteOne).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps metadata and the original if a version cannot be removed from S3', async () => {
    model.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([{ path: 'transformed/version.webp' }]),
    });
    storage.deleteFile.mockRejectedValue(new BadGatewayException());
    await expect(service.removeByUser(imageId, userId)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(model.deleteOne).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalledWith(original.path);
  });

  it('lists all owned records newest first', async () => {
    const exec = jest.fn().mockResolvedValue([original]);
    const sort = jest.fn().mockReturnValue({ exec });
    model.find.mockReturnValue({ sort });
    await expect(service.findAllByUser(userId)).resolves.toEqual([original]);
    expect(model.find).toHaveBeenCalledWith({
      user: new Types.ObjectId(userId),
    });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });
});
