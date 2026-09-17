import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SignUpDto {
  @ApiProperty({
    description: 'Display name for the account.',
    minLength: 2,
    maxLength: 50,
    example: 'ana',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username: string;

  @ApiProperty({
    description:
      'Email address used to sign in; must not already be registered.',
    format: 'email',
    example: 'ana@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Password for the new account.',
    format: 'password',
    minLength: 8,
    maxLength: 72,
    example: 'ExamplePass123!',
    writeOnly: true,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
