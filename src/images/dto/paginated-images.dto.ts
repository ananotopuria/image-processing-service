import { ApiProperty } from '@nestjs/swagger';
import { ImageResponseDto } from './image-response.dto';

export class PaginatedImagesDto {
  @ApiProperty({
    type: [ImageResponseDto],
    description:
      'Owned images, newest first. Empty when no results exist for this page.',
  })
  items: ImageResponseDto[];

  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 10 })
  limit: number;

  @ApiProperty({
    type: 'integer',
    example: 42,
    description: 'Total owned image records, including versions.',
  })
  total: number;

  @ApiProperty({
    type: 'integer',
    example: 5,
    description: 'Zero when there are no images.',
  })
  totalPages: number;
}
