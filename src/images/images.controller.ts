import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { ImageResponseDto } from './dto/image-response.dto';
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

@ApiTags('Images')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Authentication token is required, invalid, or expired.',
})
@Controller('images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Upload and transform an image',
    description:
      'Upload a JPEG, PNG, or WebP image smaller than 5 MiB (5,242,880 bytes). Optional transformations are query parameters. Store the processed image in S3 and return its metadata.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'Required JPEG, PNG, or WebP image file smaller than 5 MiB.',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Image processed and stored successfully.',
    type: ImageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Missing file, unsupported file type, file size at or above 5 MiB, invalid transformation values, or unexpected query properties.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Image processing, storage, or database operation failed.',
  })
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
  @ApiOperation({
    summary: 'List my images',
    description:
      'Return all image metadata owned by the authenticated user, newest first. Returns an empty array when no images exist.',
  })
  @ApiOkResponse({
    description: 'Image metadata ordered by creation time descending.',
    type: ImageResponseDto,
    isArray: true,
  })
  @UseGuards(JwtAuthGuard)
  async getMyImages(@Req() request: AuthenticatedRequest) {
    return this.imagesService.findAllByUser(request.user!.sub);
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Get image metadata',
    description:
      'Return metadata for an image owned by the authenticated user.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB image identifier.',
    example: '66e83a109af861ce27c86a02',
  })
  @ApiOkResponse({ description: 'Image metadata.', type: ImageResponseDto })
  @ApiNotFoundResponse({
    description:
      'Image not found: the identifier is invalid, the image does not exist, or it belongs to another user.',
  })
  @UseGuards(JwtAuthGuard)
  async getImageById(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.findOneByUser(id, request.user!.sub);
  }
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an image',
    description:
      'Delete an owned image from S3 and remove its database record.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB image identifier.',
    example: '66e83a109af861ce27c86a02',
  })
  @ApiOkResponse({
    description: 'Image deleted successfully.',
    schema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', example: 'Image deleted successfully' },
      },
    },
  })
  @ApiNotFoundResponse({
    description:
      'Image not found: the identifier is invalid, the image does not exist, or it belongs to another user.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Storage or database deletion failed.',
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async deleteImage(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.removeByUser(id, request.user!.sub);
  }
}
