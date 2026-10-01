import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListImagesDto } from '../../images/dto/list-images.dto';

export class ListSharingDto extends ListImagesDto {
  @ApiPropertyOptional({
    description: 'Records per page.',
    default: 10,
    minimum: 1,
    maximum: 50,
    type: 'integer',
  })
  declare limit: number;
}

export class ShareResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() senderId: string;
  @ApiProperty() recipientId: string;
  @ApiProperty() imageId: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({
    description:
      'False if revoked or the exact image no longer exists with its owner.',
  })
  available: boolean;
}

export class SentShareImageDto {
  @ApiProperty({
    description:
      'Filename derived from the stored image name and actual format, matching shared-image access.',
  })
  filename: string;
  @ApiProperty({ enum: ['jpeg', 'png', 'webp'] }) format: string;
}

export class SentShareResponseDto extends ShareResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Current email resolved from recipientId; null if the recipient was deleted.',
  })
  recipientEmail: string | null;
  @ApiProperty({
    type: SentShareImageDto,
    nullable: true,
    description:
      'Exact image resolved from imageId, including revoked shares; null if deleted or no longer owned by the sender. No storage keys or signed URLs.',
  })
  image: SentShareImageDto | null;
}

export class SharedImageDto {
  @ApiProperty() _id: string;
  @ApiProperty({
    description: 'Download filename with extension matching the stored format.',
  })
  filename: string;
  @ApiProperty({ enum: ['jpeg', 'png', 'webp'] }) format: string;
  @ApiPropertyOptional({ enum: ['original', 'transformed'] }) kind?: string;
  @ApiProperty() mimeType: string;
  @ApiPropertyOptional() width?: number;
  @ApiPropertyOptional() height?: number;
  @ApiProperty({
    format: 'uri',
    description: 'Temporary display URL, valid for up to 15 minutes.',
  })
  url: string;
  @ApiProperty({
    format: 'uri',
    description: 'Temporary attachment URL; refresh via GET /api/shares/:id.',
  })
  downloadUrl: string;
  @ApiProperty({ format: 'date-time' }) urlExpiresAt: string;
}

export class SharedImageResponseDto {
  @ApiProperty({ type: ShareResponseDto }) share: ShareResponseDto;
  @ApiProperty({ type: SharedImageDto }) image: SharedImageDto;
}

export class NotificationResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty({ enum: ['image.shared'] }) type: string;
  @ApiProperty() shareId: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) readAt:
    string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({
    description:
      'False for missing/revoked shares or deleted images; notification remains readable.',
  })
  available: boolean;
}

class PageDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1, description: 'Zero when total is zero.' })
  totalPages: number;
}

export class PaginatedSharesDto extends PageDto {
  @ApiProperty({ type: [ShareResponseDto] }) items: ShareResponseDto[];
}

export class PaginatedSentSharesDto extends PageDto {
  @ApiProperty({ type: [SentShareResponseDto] }) items: SentShareResponseDto[];
}

export class PaginatedNotificationsDto extends PageDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items: NotificationResponseDto[];
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 }) unreadCount: number;
}
