import {
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Get,
  Post,
  Query,
  Param,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Delete,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/jwt-auth/jwt-auth.guard';
import { TransformImageDto } from './dto/transform-image.dto';
import { ImagesService } from './images.service';

@Controller('images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: 5 * 1024 * 1024,
          }),
          new FileTypeValidator({
            fileType: /^image\/(jpeg|png|webp)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Query() transformations: TransformImageDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.resizeImage(
      file,
      transformations,
      request.user!.sub,
    );
  }
  @Get()
  @UseGuards(JwtAuthGuard)
  async getMyImages(@Req() request: AuthenticatedRequest) {
    return this.imagesService.findAllByUser(request.user!.sub);
  }
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getImageById(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.findOneByUser(id, request.user!.sub);
  }
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async deleteImage(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.removeByUser(id, request.user!.sub);
  }
}
