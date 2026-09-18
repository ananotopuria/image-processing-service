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
        { width: 40, quality: 65, format },
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

  it('keeps existing defaults and always reads the original for each version', async () => {
    const first = await service.transformImage(imageId, {}, userId);
    const second = await service.transformImage(
      imageId,
      { width: 30, height: 30 },
      userId,
    );
    expect(first).toMatchObject({
      width: 800,
      height: 400,
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

  it('rejects invalid IDs before database or S3 access', async () => {
    await expect(
      service.transformImage('invalid-id', {}, userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOne).not.toHaveBeenCalled();
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('checks ownership and returns 404 without S3 access for another user or a missing image', async () => {
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(
      service.transformImage(imageId, {}, userId),
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
      service.transformImage(imageId, {}, userId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('rejects a transformed version as the transform source', async () => {
    original.kind = 'transformed';
    await expect(
      service.transformImage(imageId, {}, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.getFile).not.toHaveBeenCalled();
  });

  it('stops on S3 retrieval failure', async () => {
    storage.getFile.mockRejectedValue(
      new BadGatewayException('Unable to retrieve image from storage'),
    );
    await expect(
      service.transformImage(imageId, {}, userId),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('returns 422 for invalid image bytes without uploading a version', async () => {
    storage.getFile.mockResolvedValue(Buffer.from('not an image'));
    await expect(
      service.transformImage(imageId, {}, userId),
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
          : service.transformImage(imageId, {}, userId);
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
          : service.transformImage(imageId, {}, userId);
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
