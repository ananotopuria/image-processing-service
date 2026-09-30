import { imageFilename } from './image-filename';
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
import { instanceToPlain } from 'class-transformer';
import sharp from 'sharp';

import { S3Service } from '../s3/s3.service';
import { ListImagesDto } from './dto/list-images.dto';
import {
  ImageTransformationsDto,
  TransformImageDto,
} from './dto/transform-image.dto';
import { Image, ImageDocument } from './schemas/image.schema';
import { Favorite, FavoriteDocument } from './schemas/favorite.schema';

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    @InjectModel(Image.name)
    private readonly imageModel: Model<ImageDocument>,
    private readonly s3Service: S3Service,
    @InjectModel(Favorite.name)
    private readonly favoriteModel: Model<FavoriteDocument>,
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

    const savedImage = await this.saveUploadedImage({
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
    return this.withAccessUrls(savedImage);
  }

  async transformImage(
    imageId: string,
    request: TransformImageDto,
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
    // Remove unset DTO fields, including nested ones, before storing a recipe
    // that clients can send back as a valid transformation request.
    const transformations = instanceToPlain(request.transformations, {
      exposeUnsetFields: false,
    }) as ImageTransformationsDto;
    const {
      quality = 80,
      format = 'webp',
      resize,
      flip,
      mirror,
      rotate,
      filters,
    } = transformations;
    const crop = transformations.crop
      ? {
          ...transformations.crop,
          x: transformations.crop.x ?? 0,
          y: transformations.crop.y ?? 0,
        }
      : undefined;
    const applied = {
      ...transformations,
      ...(crop && { crop }),
      quality,
      format,
    };

    // Decode once, before applying user operations, so damaged originals retain
    // their 422 response and transformation failures can return useful 400s.
    let pixels: { data: Buffer; info: sharp.OutputInfo };
    try {
      pixels = await sharp(originalBuffer)
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new UnprocessableEntityException(
        'Unable to decode the original image',
      );
    }

    if (
      crop &&
      (crop.x > pixels.info.width - crop.width ||
        crop.y > pixels.info.height - crop.height)
    ) {
      throw new BadRequestException(
        `Crop rectangle must fit within the original image (${pixels.info.width} x ${pixels.info.height} pixels)`,
      );
    }

    // OutputInfo.premultiplied describes work Sharp performed, not the returned
    // pixels. Pass only raw dimensions/channels when starting the next stage.
    const fromPixels = () =>
      sharp(pixels.data, {
        raw: {
          width: pixels.info.width,
          height: pixels.info.height,
          channels: pixels.info.channels,
        },
      });

    let processed: { data: Buffer; info: sharp.OutputInfo };
    try {
      // Materialize lossless raw pixels between stages: Sharp may reorder
      // operations within a single pipeline (especially flip and rotation).
      let image = fromPixels();
      if (crop)
        image = image.extract({
          left: crop.x,
          top: crop.y,
          width: crop.width,
          height: crop.height,
        });
      if (resize)
        image = image.resize({ width: resize.width, height: resize.height });
      if (crop || resize) {
        pixels = await image.raw().toBuffer({ resolveWithObject: true });
        image = fromPixels();
      }

      if (flip) image = image.flip();
      if (mirror) image = image.flop();
      if (rotate !== undefined)
        image = image.rotate(rotate, {
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      if (flip || mirror || rotate !== undefined) {
        pixels = await image.raw().toBuffer({ resolveWithObject: true });
        image = fromPixels();
      }

      if (filters?.grayscale) image = image.grayscale();
      if (filters?.sepia) {
        image = image.recomb([
          [0.393, 0.769, 0.189],
          [0.349, 0.686, 0.168],
          [0.272, 0.534, 0.131],
        ]);
      }
      processed = await image
        .toFormat(format, { quality })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException(
        'Unable to apply transformations; check crop, resize, rotation, and output options',
      );
    }

    const filename = `${randomUUID()}.${format}`;
    const key = `transformed/${userId}/${original._id.toString()}/${filename}`;
    const mimeType = `image/${format}`;
    await this.s3Service.uploadFile(key, processed.data, mimeType);

    const savedImage = await this.saveUploadedImage({
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
      transformations: applied,
    });
    return this.withAccessUrls(savedImage);
  }

  private async saveUploadedImage(
    metadata: Omit<Image, 'createdAt' | 'updatedAt'>,
  ) {
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

  private async withAccessUrls(image: ImageDocument, isFavorite = false) {
    // Explicit public metadata keeps persistence fields and storage keys private.
    const fields = [
      '_id',
      'user',
      'originalName',
      'filename',
      'format',
      'kind',
      'originalImageId',
      'mimeType',
      'transformations',
      'width',
      'height',
      'quality',
      'originalSize',
      'processedSize',
      'createdAt',
      'updatedAt',
    ] as const;
    const metadata = image.toObject();
    return {
      ...Object.fromEntries(
        fields
          .filter((field) => metadata[field] !== undefined)
          .map((field) => [field, metadata[field]]),
      ),
      isFavorite,
      ...(await this.s3Service.getFileUrls(image.path, imageFilename(image))),
    };
  }

  async getImageByUser(imageId: string, userId: string) {
    // Sign the stored key only after the owner-filtered lookup succeeds.
    const image = await this.findOneByUser(imageId, userId);
    const favorites = await this.favoriteIds(userId, [image._id]);
    return this.withAccessUrls(image, favorites.has(image._id.toString()));
  }

  async findAllByUser(userId: string, { page, limit }: ListImagesDto) {
    const filter = { user: new Types.ObjectId(userId) };
    const [images, total] = await Promise.all([
      this.imageModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.imageModel.countDocuments(filter).exec(),
    ]);
    const favorites = await this.favoriteIds(
      userId,
      images.map((image) => image._id),
    );
    const items = await Promise.all(
      images.map((image) =>
        this.withAccessUrls(image, favorites.has(image._id.toString())),
      ),
    );
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  private async favoriteIds(userId: string, imageIds: Types.ObjectId[]) {
    if (imageIds.length === 0) return new Set<string>();
    const favorites = await this.favoriteModel
      .find({
        userId: new Types.ObjectId(userId),
        imageId: { $in: imageIds },
      })
      .select('imageId')
      .lean()
      .exec();
    return new Set(favorites.map((favorite) => favorite.imageId.toString()));
  }

  async addFavorite(imageId: string, userId: string) {
    const image = await this.findOneByUser(imageId, userId);
    const filter = { userId: new Types.ObjectId(userId), imageId: image._id };
    try {
      await this.favoriteModel
        .updateOne(filter, { $setOnInsert: filter }, { upsert: true })
        .exec();
    } catch (error) {
      // Concurrent upserts may race on the unique user/image index.
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 11000
      )) {
        throw error;
      }
    }
    // If deletion overlapped the upsert, do not leave a dangling favorite.
    try {
      await this.findOneByUser(imageId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        await this.favoriteModel.deleteOne(filter).exec();
      }
      throw error;
    }
    return { imageId: image._id.toString(), isFavorite: true };
  }

  async removeFavorite(imageId: string, userId: string) {
    const image = await this.findOneByUser(imageId, userId);
    await this.favoriteModel
      .deleteOne({
        userId: new Types.ObjectId(userId),
        imageId: image._id,
      })
      .exec();
    return { imageId: image._id.toString(), isFavorite: false };
  }

  async findFavoritesByUser(userId: string, { page, limit }: ListImagesDto) {
    // Filter missing/inaccessible images before both pagination and counting.
    const [result] = await this.favoriteModel
      .aggregate<{
        items: Record<string, unknown>[];
        count: { total: number }[];
      }>([
        { $match: { userId: new Types.ObjectId(userId) } },
        {
          $lookup: {
            from: this.imageModel.collection.name,
            localField: 'imageId',
            foreignField: '_id',
            as: 'image',
          },
        },
        { $unwind: '$image' },
        { $match: { 'image.user': new Types.ObjectId(userId) } },
        { $replaceRoot: { newRoot: '$image' } },
        {
          $facet: {
            items: [
              { $sort: { createdAt: -1, _id: -1 } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    const total = result?.count[0]?.total ?? 0;
    const items = await Promise.all(
      (result?.items ?? []).map((image) =>
        this.withAccessUrls(this.imageModel.hydrate(image), true),
      ),
    );
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
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
        await this.favoriteModel.deleteMany({ imageId: version._id }).exec();
      }
    }

    await this.s3Service.deleteFile(image.path);
    await this.imageModel.deleteOne({
      _id: image._id,
      user: new Types.ObjectId(userId),
    });

    await this.favoriteModel.deleteMany({ imageId: image._id }).exec();

    return { message: 'Image deleted successfully' };
  }
}
