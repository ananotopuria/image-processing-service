import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { S3Module } from '../s3/s3.module';
import { Image, ImageSchema } from '../images/schemas/image.schema';
import { UserThrottlerGuard } from '../images/guards/user-throttler.guard';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsController } from '../notifications/notifications.controller';
import { Share, ShareSchema } from './schemas/share.schema';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    S3Module,
    MongooseModule.forFeature([
      { name: Share.name, schema: ShareSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: Image.name, schema: ImageSchema },
    ]),
  ],
  controllers: [SharingController, NotificationsController],
  providers: [SharingService, NotificationsGateway, UserThrottlerGuard],
})
export class SharingModule {}
