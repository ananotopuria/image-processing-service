import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmptyObject,
  IsNumber,
  IsObject,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ResizeImageDto {
  @ApiPropertyOptional({
    description:
      'Width in pixels. At least width or height is required. One dimension preserves aspect ratio; both use centered cover resizing.',
    type: 'integer',
    minimum: 1,
    maximum: 4000,
    example: 800,
  })
  @ValidateIf(
    (object: ResizeImageDto, value: unknown) =>
      value !== undefined || object.height === undefined,
  )
  @IsInt()
  @Min(1)
  @Max(4000)
  width?: number;

  @ApiPropertyOptional({
    description: 'Height in pixels.',
    type: 'integer',
    minimum: 1,
    maximum: 4000,
    example: 600,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(4000)
  height?: number;
}

export class CropImageDto {
  @ApiProperty({
    description:
      'Crop width in original-image pixels; the rectangle must fit within the original.',
    type: 'integer',
    minimum: 1,
    maximum: 4000,
    example: 500,
  })
  @IsInt()
  @Min(1)
  @Max(4000)
  width: number;

  @ApiProperty({
    description: 'Crop height in original-image pixels.',
    type: 'integer',
    minimum: 1,
    maximum: 4000,
    example: 400,
  })
  @IsInt()
  @Min(1)
  @Max(4000)
  height: number;

  @ApiPropertyOptional({
    description:
      'Left offset from the original image edge, before resizing or rotation.',
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
    example: 10,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  x?: number;

  @ApiPropertyOptional({
    description:
      'Top offset from the original image edge, before resizing or rotation.',
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
    example: 20,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  y?: number;
}

export class ImageFiltersDto {
  @ApiPropertyOptional({
    description:
      'Convert to grayscale. Applied before sepia when both are true.',
    example: true,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  grayscale?: boolean;

  @ApiPropertyOptional({
    description: 'Apply a sepia RGB color matrix.',
    example: false,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  sepia?: boolean;
}

export class ImageTransformationsDto {
  @ApiPropertyOptional({
    type: ResizeImageDto,
    description: 'Optional resize; omitted means no resizing.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @IsNotEmptyObject({ nullable: false })
  @ValidateNested()
  @Type(() => ResizeImageDto)
  resize?: ResizeImageDto;

  @ApiPropertyOptional({
    type: CropImageDto,
    description:
      'Extract a rectangle from the original before all other operations. Uses x/y coordinates (not left/top aliases).',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @IsNotEmptyObject({ nullable: false })
  @ValidateNested()
  @Type(() => CropImageDto)
  crop?: CropImageDto;

  @ApiPropertyOptional({
    description:
      'Clockwise angle in degrees; negative values rotate counterclockwise. Fractional angles are allowed. Non-right angles expand the canvas with a transparent background (black in JPEG).',
    minimum: -360,
    maximum: 360,
    example: 90,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-360)
  @Max(360)
  rotate?: number;

  @ApiPropertyOptional({
    description: 'Vertical flip (top and bottom exchanged), before rotation.',
    example: false,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  flip?: boolean;

  @ApiPropertyOptional({
    description:
      'Horizontal mirror (left and right exchanged), before rotation.',
    example: true,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  mirror?: boolean;

  @ApiPropertyOptional({
    description:
      'Output encoding quality. PNG uses palette quantization; a smaller output file is not guaranteed.',
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 80,
    example: 80,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(100)
  quality?: number;

  @ApiPropertyOptional({
    description: 'Output format.',
    enum: ['jpeg', 'png', 'webp'],
    default: 'webp',
    example: 'webp',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['jpeg', 'png', 'webp'])
  format?: 'jpeg' | 'png' | 'webp';

  @ApiPropertyOptional({ type: ImageFiltersDto })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @IsNotEmptyObject({ nullable: false })
  @ValidateNested()
  @Type(() => ImageFiltersDto)
  filters?: ImageFiltersDto;
}

export class TransformImageDto {
  @ApiProperty({
    type: ImageTransformationsDto,
    description:
      'One or more operations. Order: crop, resize, flip/mirror, rotate, grayscale, sepia, output encoding. Omitted operations are skipped. Numbers and booleans must be JSON numbers and booleans; null is not accepted.',
    example: {
      resize: { width: 800, height: 600 },
      rotate: 90,
      mirror: true,
      filters: { grayscale: true },
      format: 'webp',
      quality: 75,
    },
  })
  @IsDefined()
  @IsObject()
  @IsNotEmptyObject({ nullable: false })
  @ValidateNested()
  @Type(() => ImageTransformationsDto)
  transformations: ImageTransformationsDto;
}
