import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { S3Module } from '../s3/s3.module';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { UserThrottlerGuard } from './guards/user-throttler.guard';
import { Image, ImageSchema } from './schemas/image.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Image.name,
        schema: ImageSchema,
      },
    ]),
    AuthModule,
    S3Module,
  ],
  controllers: [ImagesController],
  providers: [ImagesService, UserThrottlerGuard],
})
export class ImagesModule {}
