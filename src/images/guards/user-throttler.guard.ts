import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../../auth/guards/jwt-auth/jwt-auth.guard';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  // Always registered after JwtAuthGuard. Count across tokens, IPs, and image IDs.
  protected async getTracker(request: AuthenticatedRequest): Promise<string> {
    return `user:${request.user!.sub}`;
  }
}
