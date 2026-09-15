import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

import { TransformImageDto } from './dto/transform-image.dto';

@Injectable()
export class ImagesService {
  async resizeImage(
    file: Express.Multer.File,
    transformations: TransformImageDto,
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

    const outputDirectory = join(process.cwd(), 'uploads', 'processed');

    await mkdir(outputDirectory, {
      recursive: true,
    });

    const filename = `${randomUUID()}.${format}`;
    const outputPath = join(outputDirectory, filename);

    await writeFile(outputPath, processedImage);

    return {
      originalName: file.originalname,
      originalSize: file.size,
      processedSize: processedImage.length,
      width,
      height: height ?? null,
      quality,
      format,
      filename,
      path: `uploads/processed/${filename}`,
    };
  }
}
