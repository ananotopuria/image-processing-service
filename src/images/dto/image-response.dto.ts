import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImageResponseDto {
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
    description: 'Generated output filename.',
    example: '9c1c0381-01af-4210-970c-68292d28c577.webp',
  })
  filename: string;

  @ApiProperty({
    description: 'S3 object key, not a download URL.',
    example: 'processed/9c1c0381-01af-4210-970c-68292d28c577.webp',
  })
  path: string;

  @ApiProperty({ enum: ['jpeg', 'png', 'webp'], example: 'webp' })
  format: string;

  @ApiPropertyOptional({
    description: 'Stored target width in pixels.',
    type: 'integer',
    example: 1200,
  })
  width?: number;

  @ApiPropertyOptional({
    description:
      'Stored target height in pixels; omitted when no height was requested.',
    type: 'integer',
    example: 800,
  })
  height?: number;

  @ApiProperty({ minimum: 1, maximum: 100, type: 'integer', example: 85 })
  quality: number;

  @ApiProperty({
    description: 'Uploaded file size in bytes.',
    type: 'integer',
    example: 2457600,
  })
  originalSize: number;

  @ApiProperty({
    description: 'Processed file size in bytes.',
    type: 'integer',
    example: 184320,
  })
  processedSize: number;

  @ApiProperty({ format: 'date-time', example: '2026-09-17T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-17T12:00:00.000Z' })
  updatedAt: string;
}
