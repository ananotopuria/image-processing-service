import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsMongoId } from 'class-validator';

export class CreateShareDto {
  @ApiProperty({
    description: 'Exact original or processed image to share.',
    example: '66e83a109af861ce27c86a02',
  })
  @IsMongoId()
  imageId: string;

  @ApiProperty({ format: 'email', example: 'recipient@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  recipientEmail: string;
}
