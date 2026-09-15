import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Module({
  imports: [AuthModule],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
