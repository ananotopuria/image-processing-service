import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignInDto {
  @ApiProperty({
    description: 'Registered email address.',
    format: 'email',
    example: 'ana@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Account password.',
    format: 'password',
    minLength: 8,
    example: 'ExamplePass123!',
    writeOnly: true,
  })
  @IsString()
  @MinLength(8)
  password: string;
}
