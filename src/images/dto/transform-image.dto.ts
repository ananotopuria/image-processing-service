import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class TransformImageDto {
  @ApiPropertyOptional({
    description: 'Target width in pixels.',
    type: 'integer',
    minimum: 1,
    maximum: 4000,
    default: 800,
    example: 1200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4000)
  width?: number;

  @ApiPropertyOptional({
    description:
      'Target height in pixels. When omitted, height follows the original aspect ratio. When both dimensions are set, the image is resized to cover them and may be cropped.',
    type: 'integer',
    minimum: 1,
    maximum: 4000,
    example: 800,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4000)
  height?: number;

  @ApiPropertyOptional({
    description: 'Output encoding quality.',
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 80,
    example: 85,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quality?: number;

  @ApiPropertyOptional({
    description: 'Output image format.',
    enum: ['jpeg', 'png', 'webp'],
    default: 'webp',
    example: 'webp',
  })
  @IsOptional()
  @IsIn(['jpeg', 'png', 'webp'])
  format?: 'jpeg' | 'png' | 'webp';
}
