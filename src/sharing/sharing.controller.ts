import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth/jwt-auth.guard';
import { UserThrottlerGuard } from '../images/guards/user-throttler.guard';
import { CreateShareDto } from './dto/create-share.dto';
import {
  ListSharingDto,
  PaginatedSharesDto,
  SharedImageResponseDto,
  ShareResponseDto,
} from './dto/sharing-response.dto';
import { SharingService } from './sharing.service';

@ApiTags('Shares')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid, or expired authentication token.',
})
@ApiBadRequestResponse({
  description: 'Invalid body/query, unknown properties, or self-sharing.',
})
@ApiNotFoundResponse({
  description: 'Invalid ID, missing resource, or access denied.',
})
@ApiTooManyRequestsResponse({
  description:
    'Create: 10/minute per user. Other routes: 60/minute per user per route. Honor Retry-After.',
})
@ApiInternalServerErrorResponse({
  description: 'Database or unexpected failure; details are not exposed.',
})
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@Controller('shares')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Share an owned image with a registered recipient by email',
  })
  @ApiCreatedResponse({ type: ShareResponseDto })
  @ApiConflictResponse({
    description: 'An active share already exists for this image and recipient.',
  })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateShareDto) {
    return this.sharing.create(request.user!.sub, dto);
  }

  @Get('received')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'List received shares, including unavailable history, newest first',
  })
  @ApiOkResponse({ type: PaginatedSharesDto })
  received(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListSharingDto,
  ) {
    return this.sharing.list(request.user!.sub, 'received', query);
  }

  @Get('sent')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List sent shares, including unavailable history, newest first',
  })
  @ApiOkResponse({ type: PaginatedSharesDto })
  sent(@Req() request: AuthenticatedRequest, @Query() query: ListSharingDto) {
    return this.sharing.list(request.user!.sub, 'sent', query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiParam({ name: 'id', description: 'Received share ID, not image ID.' })
  @ApiOperation({
    summary:
      'Retrieve a received share and fresh URLs for only its selected image',
    description:
      'Recipient-only access. Signed links remain valid until expiry; downloaded copies cannot be revoked.',
  })
  @ApiOkResponse({ type: SharedImageResponseDto })
  @ApiBadGatewayResponse({ description: 'Unable to create image access URLs.' })
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sharing.getReceived(request.user!.sub, id);
  }

  @Delete(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiParam({ name: 'id', description: 'Owned share ID.' })
  @ApiOperation({
    summary:
      'Revoke a sent share (idempotent); a new share can be created afterward',
  })
  @ApiOkResponse({ type: ShareResponseDto })
  revoke(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sharing.revoke(request.user!.sub, id);
  }
}
