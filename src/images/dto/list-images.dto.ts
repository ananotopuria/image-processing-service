import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ListImagesDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based).',
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: 100000,
    example: 1,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100000)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Images per page, including originals and versions.',
    type: 'integer',
    default: 10,
    minimum: 1,
    maximum: 50,
    example: 10,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
