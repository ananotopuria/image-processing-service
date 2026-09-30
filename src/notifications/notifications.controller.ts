import {
  Controller,
  Get,
  Header,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth/jwt-auth.guard';
import { UserThrottlerGuard } from '../images/guards/user-throttler.guard';
import {
  ListSharingDto,
  NotificationResponseDto,
  PaginatedNotificationsDto,
  UnreadCountDto,
} from '../sharing/dto/sharing-response.dto';
import { SharingService } from '../sharing/sharing.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid, or expired authentication token.',
})
@ApiBadRequestResponse({
  description: 'Invalid pagination or unknown query properties.',
})
@ApiTooManyRequestsResponse({
  description: '60/minute per user per route. Honor Retry-After.',
})
@ApiInternalServerErrorResponse({
  description: 'Database or unexpected failure; details are not exposed.',
})
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly sharing: SharingService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'List persisted notifications, newest first, including unavailable shares',
  })
  @ApiOkResponse({ type: PaginatedNotificationsDto })
  list(@Req() request: AuthenticatedRequest, @Query() query: ListSharingDto) {
    return this.sharing.listNotifications(request.user!.sub, query);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Count unread notifications, including those referencing unavailable shares',
  })
  @ApiOkResponse({ type: UnreadCountDto })
  count(@Req() request: AuthenticatedRequest) {
    return this.sharing.unreadCount(request.user!.sub);
  }

  @Put(':id/read')
  @Header('Cache-Control', 'private, no-store')
  @ApiParam({ name: 'id', description: 'Current user’s notification ID.' })
  @ApiOperation({ summary: 'Mark an owned notification as read (idempotent)' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiNotFoundResponse({
    description: 'Invalid, missing, or another user’s notification ID.',
  })
  read(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sharing.markRead(request.user!.sub, id);
  }
}
