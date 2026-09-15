import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

@Injectable()
export class ImagesService {
  async resizeImage(file: Express.Multer.File) {
    const processedImage = await sharp(file.buffer)
      .resize({
        width: 800,
      })
      .webp({
        quality: 80,
      })
      .toBuffer();
    const outputDirectory = join(process.cwd(), 'uploads', 'processed');

    await mkdir(outputDirectory, {
      recursive: true,
    });
    const filename = `${randomUUID()}.webp`;
    const outputPath = join(outputDirectory, filename);
    await writeFile(outputPath, processedImage);
    return {
      originalName: file.originalname,
      originalSize: file.size,
      processedSize: processedImage.length,
      filename,
      path: `uploads/processed/${filename}`,
    };
  }
}
