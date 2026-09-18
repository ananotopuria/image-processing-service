import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AuthResponseDto, ProfileResponseDto } from './dto/auth-response.dto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from './guards/jwt-auth/jwt-auth.guard';

@ApiTags('Auth')
@UseGuards(ThrottlerGuard)
@ApiInternalServerErrorResponse({
  description: 'An unexpected server or database error occurred.',
})
@ApiTooManyRequestsResponse({
  description:
    'Sign-up and sign-in: 10 requests/minute each per IP. Profile: 60/minute per IP. Retry after the Retry-After header delay.',
})
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Register a user and return an access token and public account details.',
  })
  @ApiCreatedResponse({
    description: 'Account created successfully.',
    type: AuthResponseDto,
    example: {
      message: 'Account created successfully',
      accessToken: '<jwt-access-token>',
      user: {
        id: '66e83a109af861ce27c86a01',
        username: 'ana',
        email: 'ana@example.com',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid request fields or unexpected properties.',
  })
  @ApiConflictResponse({
    description: 'A user with this email already exists.',
  })
  async signUp(@Body() signUpDto: SignUpDto) {
    return this.authService.signUp(signUpDto);
  }

  @Post('sign-in')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Authenticate with email and password to obtain a JWT access token.',
  })
  @ApiOkResponse({
    description: 'Signed in successfully.',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request fields or unexpected properties.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password.' })
  @HttpCode(HttpStatus.OK)
  async signIn(@Body() signInDto: SignInDto) {
    return this.authService.signIn(signInDto);
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the authenticated profile',
    description: 'Return claims from the verified access token.',
  })
  @ApiOkResponse({
    description: 'Verified JWT claims.',
    type: ProfileResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication token is required, invalid, or expired.',
  })
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() request: AuthenticatedRequest) {
    return {
      user: request.user,
    };
  }
}
