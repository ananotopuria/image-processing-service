import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageTransformationsDto } from './transform-image.dto';

export class ImageResponseDto {
  @ApiPropertyOptional({
    type: ImageTransformationsDto,
    description:
      'Applied operations, including resolved format/quality and crop offset defaults. Absent on originals and versions created before Day 2.',
  })
  transformations?: ImageTransformationsDto;

  @ApiPropertyOptional({
    description:
      'Record type. Absent on legacy records created before originals were preserved.',
    enum: ['original', 'transformed'],
    example: 'original',
  })
  kind?: 'original' | 'transformed';

  @ApiPropertyOptional({
    description: 'Original image ID. Present only on transformed versions.',
    example: '66e83a109af861ce27c86a02',
  })
  originalImageId?: string;

  @ApiPropertyOptional({
    description:
      'S3 key of the preserved original; shared by its versions. Absent on legacy records.',
    example:
      'originals/66e83a109af861ce27c86a01/9c1c0381-01af-4210-970c-68292d28c577.jpeg',
  })
  originalKey?: string;

  @ApiPropertyOptional({
    description: 'MIME type of this stored file. Absent on legacy records.',
    enum: ['image/jpeg', 'image/png', 'image/webp'],
    example: 'image/jpeg',
  })
  mimeType?: string;

  @ApiProperty({
    description: 'Image identifier.',
    example: '66e83a109af861ce27c86a02',
  })
  _id: string;

  @ApiProperty({
    description: 'Owner identifier.',
    example: '66e83a109af861ce27c86a01',
  })
  user: string;

  @ApiProperty({ example: 'mountains.jpg' })
  originalName: string;

  @ApiProperty({
    description: 'Generated filename for this original or transformed version.',
    example: '9c1c0381-01af-4210-970c-68292d28c577.jpeg',
  })
  filename: string;

  @ApiProperty({
    description:
      'S3 key for this file, not a download URL. Originals use originals/{userId}/; versions use transformed/{userId}/{originalImageId}/.',
    example:
      'originals/66e83a109af861ce27c86a01/9c1c0381-01af-4210-970c-68292d28c577.jpeg',
  })
  path: string;

  @ApiProperty({ enum: ['jpeg', 'png', 'webp'], example: 'jpeg' })
  format: string;

  @ApiPropertyOptional({
    description:
      'Actual output width in pixels for transformed versions. Legacy records store the requested width.',
    type: 'integer',
    example: 1200,
  })
  width?: number;

  @ApiPropertyOptional({
    description:
      'Actual output height in pixels for transformed versions. Legacy records store the requested height, if any.',
    type: 'integer',
    example: 800,
  })
  height?: number;

  @ApiPropertyOptional({
    description:
      'Encoding quality for transformed or legacy images; absent on originals.',
    minimum: 1,
    maximum: 100,
    type: 'integer',
    example: 85,
  })
  quality?: number;

  @ApiProperty({
    description: 'Uploaded file size in bytes.',
    type: 'integer',
    example: 2457600,
  })
  originalSize: number;

  @ApiPropertyOptional({
    description: 'Processed file size in bytes; absent on originals.',
    type: 'integer',
    example: 184320,
  })
  processedSize?: number;

  @ApiProperty({ format: 'date-time', example: '2026-09-17T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-17T12:00:00.000Z' })
  updatedAt: string;
}
