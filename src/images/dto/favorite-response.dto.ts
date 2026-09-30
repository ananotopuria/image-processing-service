import { ApiProperty } from '@nestjs/swagger';

export class FavoriteResponseDto {
  @ApiProperty({ example: '66e83a109af861ce27c86a02' })
  imageId: string;

  @ApiProperty({
    description:
      'Whether this image is now a favorite of the authenticated user.',
    example: true,
  })
  isFavorite: boolean;
}
