import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { S3Service } from '../s3/s3.service';
import { TransformImageDto } from './dto/transform-image.dto';
import { Image, ImageDocument } from './schemas/image.schema';

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    @InjectModel(Image.name)
    private readonly imageModel: Model<ImageDocument>,
    private readonly s3Service: S3Service,
  ) {}

  async uploadImage(file: Express.Multer.File, userId: string) {
    // The file validator supplies the MIME type detected from the file bytes.
    const format = file.mimetype.split('/')[1];
    if (!['jpeg', 'png', 'webp'].includes(format)) {
      throw new BadRequestException('Unsupported image type');
    }

    const filename = `${randomUUID()}.${format}`;
    const key = `originals/${userId}/${filename}`;
    await this.s3Service.uploadFile(key, file.buffer, file.mimetype);

    return this.saveUploadedImage({
      kind: 'original',
      user: new Types.ObjectId(userId),
      originalName: file.originalname,
      filename,
      path: key,
      originalKey: key,
      mimeType: file.mimetype,
      format,
      originalSize: file.size,
    });
  }

  async transformImage(
    imageId: string,
    transformations: TransformImageDto,
    userId: string,
  ) {
    const original = await this.findOneByUser(imageId, userId);
    if (original.kind === 'transformed') {
      throw new BadRequestException(
        'Use the original image ID to transform an image',
      );
    }
    if (original.kind !== 'original' || !original.originalKey) {
      throw new ConflictException(
        'Original file is unavailable for this legacy image; upload the original again',
      );
    }

    const originalBuffer = await this.s3Service.getFile(original.originalKey);
    const {
      width = 800,
      height,
      quality = 80,
      format = 'webp',
    } = transformations;

    let processed: { data: Buffer; info: sharp.OutputInfo };
    try {
      // Preserve the existing resize defaults and encoding behavior.
      processed = await sharp(originalBuffer)
        .resize({ width, height })
        .toFormat(format, { quality })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new UnprocessableEntityException(
        'Unable to process the original image',
      );
    }

    const filename = `${randomUUID()}.${format}`;
    const key = `transformed/${userId}/${original._id.toString()}/${filename}`;
    const mimeType = `image/${format}`;
    await this.s3Service.uploadFile(key, processed.data, mimeType);

    return this.saveUploadedImage({
      kind: 'transformed',
      originalImageId: original._id,
      originalKey: original.originalKey,
      user: new Types.ObjectId(userId),
      originalName: original.originalName,
      filename,
      path: key,
      mimeType,
      format,
      // Actual output dimensions allow the frontend to display each version.
      width: processed.info.width,
      height: processed.info.height,
      quality,
      originalSize: original.originalSize,
      processedSize: processed.data.length,
    });
  }

  private async saveUploadedImage(metadata: Image) {
    try {
      return await this.imageModel.create(metadata);
    } catch {
      // Compensate for a failed database write after a successful S3 upload.
      try {
        await this.s3Service.deleteFile(metadata.path);
      } catch {
        this.logger.error(
          'Failed to clean up an image after metadata persistence failed',
        );
      }
      throw new InternalServerErrorException('Unable to save image metadata');
    }
  }

  async findAllByUser(userId: string) {
    return this.imageModel
      .find({ user: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOneByUser(imageId: string, userId: string) {
    if (!Types.ObjectId.isValid(imageId)) {
      throw new NotFoundException('Image not found');
    }

    const image = await this.imageModel
      .findOne({
        _id: new Types.ObjectId(imageId),
        user: new Types.ObjectId(userId),
      })
      .exec();

    if (!image) {
      throw new NotFoundException('Image not found');
    }
    return image;
  }

  async removeByUser(imageId: string, userId: string) {
    const image = await this.findOneByUser(imageId, userId);
    if (image.kind === 'original') {
      const versions = await this.imageModel
        .find({ originalImageId: image._id, user: new Types.ObjectId(userId) })
        .exec();
      // Keep the original until its versions have been removed. A failed delete
      // leaves remaining metadata available for a retry.
      for (const version of versions) {
        await this.s3Service.deleteFile(version.path);
        await this.imageModel.deleteOne({
          _id: version._id,
          user: new Types.ObjectId(userId),
        });
      }
    }

    await this.s3Service.deleteFile(image.path);
    await this.imageModel.deleteOne({
      _id: image._id,
      user: new Types.ObjectId(userId),
    });

    return { message: 'Image deleted successfully' };
  }
}
