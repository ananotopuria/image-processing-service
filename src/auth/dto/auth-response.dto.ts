import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty({
    description: 'User identifier.',
    example: '66e83a109af861ce27c86a01',
  })
  id: string;

  @ApiProperty({ example: 'ana' })
  username: string;

  @ApiProperty({ format: 'email', example: 'ana@example.com' })
  email: string;
}

export class AuthResponseDto {
  @ApiProperty({
    description:
      'Account created successfully for sign-up; Signed in successfully for sign-in.',
    example: 'Signed in successfully',
  })
  message: string;

  @ApiProperty({
    description:
      'JWT access token. Use it as a Bearer token in the Authorization header.',
    example: '<jwt-access-token>',
  })
  accessToken: string;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}

export class JwtClaimsDto {
  @ApiProperty({
    description: 'Authenticated user identifier.',
    example: '66e83a109af861ce27c86a01',
  })
  sub: string;

  @ApiProperty({ format: 'email', example: 'ana@example.com' })
  email: string;

  @ApiPropertyOptional({
    description: 'Token issuance time, in Unix seconds.',
    type: 'integer',
    example: 1789646400,
  })
  iat?: number;

  @ApiPropertyOptional({
    description: 'Token expiration time, in Unix seconds.',
    type: 'integer',
    example: 1789650000,
  })
  exp?: number;
}

export class ProfileResponseDto {
  @ApiProperty({ description: 'Verified JWT claims.', type: JwtClaimsDto })
  user: JwtClaimsDto;
}
