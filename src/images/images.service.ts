import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { S3Service } from '../s3/s3.service';
import { TransformImageDto } from './dto/transform-image.dto';
import { Image, ImageDocument } from './schemas/image.schema';

@Injectable()
export class ImagesService {
  constructor(
    @InjectModel(Image.name)
    private readonly imageModel: Model<ImageDocument>,
    private readonly s3Service: S3Service,
  ) {}

  async resizeImage(
    file: Express.Multer.File,
    transformations: TransformImageDto,
    userId: string,
  ) {
    const {
      width = 800,
      height,
      quality = 80,
      format = 'webp',
    } = transformations;

    let image = sharp(file.buffer).resize({
      width,
      height,
    });

    switch (format) {
      case 'jpeg':
        image = image.jpeg({ quality });
        break;

      case 'png':
        image = image.png({ quality });
        break;

      case 'webp':
        image = image.webp({ quality });
        break;
    }

    const processedImage = await image.toBuffer();

    const filename = `${randomUUID()}.${format}`;
    const key = `processed/${filename}`;

    const contentType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;

    await this.s3Service.uploadFile(key, processedImage, contentType);

    const savedImage = await this.imageModel.create({
      user: new Types.ObjectId(userId),
      originalName: file.originalname,
      filename,
      path: key,
      format,
      width,
      height,
      quality,
      originalSize: file.size,
      processedSize: processedImage.length,
    });

    return savedImage;
  }
  async findAllByUser(userId: string) {
    return this.imageModel
      .find({
        user: new Types.ObjectId(userId),
      })
      .sort({
        createdAt: -1,
      })
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

    await this.s3Service.deleteFile(image.path);

    await this.imageModel.deleteOne({
      _id: image._id,
      user: new Types.ObjectId(userId),
    });

    return {
      message: 'Image deleted successfully',
    };
  }
}
