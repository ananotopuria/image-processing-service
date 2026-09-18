import { Throttle } from '@nestjs/throttler';
import { UserThrottlerGuard } from './guards/user-throttler.guard';
import { ListImagesDto } from './dto/list-images.dto';
import { PaginatedImagesDto } from './dto/paginated-images.dto';
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
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiUnprocessableEntityResponse,
  ApiTooManyRequestsResponse,
  ApiPayloadTooLargeResponse,
} from '@nestjs/swagger';
import { ImageResponseDto } from './dto/image-response.dto';
import {
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Get,
  Post,
  Body,
  Param,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Delete,
  HttpCode,
  Query,
  Header,
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
@ApiInternalServerErrorResponse({
  description:
    'An unexpected server or database error occurred. Internal details are not returned.',
})
@ApiTooManyRequestsResponse({
  description:
    'Rate limit exceeded. Upload and transform: 10/minute each per user; other image endpoints: 60/minute each per user. Retry after the Retry-After header delay.',
})
@Controller('images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post('upload')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Header('Cache-Control', 'private, no-store')
  @ApiPayloadTooLargeResponse({
    description: 'File size must be smaller than 5 MiB (5,242,880 bytes).',
  })
  @ApiOperation({
    summary: 'Upload an original image',
    description:
      'Upload a JPEG, PNG, or WebP image smaller than 5 MiB (5,242,880 bytes). Preserve its original bytes in S3 and return metadata. To resize or convert it, use POST /images/{id}/transform with the returned ID.',
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
    description: 'Original image stored successfully.',
    type: ImageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Missing file, unsupported file type, or unexpected file fields/files.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Unable to save image metadata.',
  })
  @ApiBadGatewayResponse({
    description: 'Unable to upload image or create access URLs.',
  })
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // Multer 2.4 uses an inclusive limit; the API requires strictly less than 5 MiB.
      limits: { fileSize: 5 * 1024 * 1024 - 1, files: 1 },
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
            overrideMimeType: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.uploadImage(file, request.user!.sub);
  }
  @Post(':id/transform')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Create a transformed version of an original image',
    description:
      'Apply one or more nested transformations to an owned original and save a separate version. Order: crop in original pixel coordinates, resize, vertical flip/horizontal mirror, rotate, grayscale, sepia, then encode. Omitted operations are skipped; there is no implicit resize. Output defaults to WebP at quality 80. EXIF orientation is not auto-applied; only the first frame of animated input is processed.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ID of the original image returned by upload.',
    example: '66e83a109af861ce27c86a02',
  })
  @ApiBody({
    type: TransformImageDto,
    examples: {
      rotateOnly: {
        summary: 'Rotate only, without resizing',
        value: { transformations: { rotate: 90 } },
      },
      combined: {
        summary: 'Resize, rotate, grayscale and encode',
        value: {
          transformations: {
            resize: { width: 800, height: 600 },
            rotate: 90,
            mirror: true,
            filters: { grayscale: true },
            format: 'webp',
            quality: 75,
          },
        },
      },
      crop: {
        summary: 'Crop in original pixel coordinates',
        value: {
          transformations: { crop: { width: 500, height: 400, x: 10, y: 20 } },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Transformed version stored successfully, linked through originalImageId.',
    type: ImageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid or empty transformations, null values, unexpected properties, crop outside the original, invalid Sharp operations, or an ID that identifies a transformed version.',
  })
  @ApiNotFoundResponse({
    description:
      'Image not found: invalid ID, nonexistent image, or image owned by another user.',
  })
  @ApiConflictResponse({
    description:
      'Legacy image has no preserved original. Upload the original again.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The stored original could not be decoded.',
  })
  @ApiBadGatewayResponse({
    description:
      'Unable to retrieve the original, upload the transformed image, or create access URLs.',
  })
  @ApiInternalServerErrorResponse({ description: 'Database operation failed.' })
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  async transformImage(
    @Param('id') id: string,
    @Body() transformations: TransformImageDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.transformImage(
      id,
      transformations,
      request.user!.sub,
    );
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiBadRequestResponse({
    description: 'Invalid pagination values or unknown query parameters.',
  })
  @ApiBadGatewayResponse({ description: 'Unable to create image access URLs.' })
  @ApiOperation({
    summary: 'List my images',
    description:
      'Return a page of owned originals, versions, and legacy records, newest first (ID breaks timestamp ties). Includes temporary display/download URLs. Defaults: page 1, limit 10; maximum limit 50. Group versions by originalImageId. Out-of-range pages have empty items.',
  })
  @ApiOkResponse({
    description: 'Paginated image metadata with temporary access URLs.',
    type: PaginatedImagesDto,
  })
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  async getMyImages(
    @Query() pagination: ListImagesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.findAllByUser(request.user!.sub, pagination);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiBadGatewayResponse({ description: 'Unable to create image access URLs.' })
  @ApiOperation({
    summary: 'Retrieve an image with temporary access URLs',
    description:
      'Return owned image metadata and fresh 15-minute display/download URLs. Use the original ID for the original file or a version ID for its transformed file. The bucket remains private; anyone holding a URL can use it until expiry.',
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
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  async getImageById(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.getImageByUser(id, request.user!.sub);
  }
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an image',
    description:
      'Delete an owned image from S3 and MongoDB. Deleting an original also deletes its transformed versions. Deleting a version leaves the original and other versions intact.',
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
    description: 'Database deletion failed.',
  })
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @ApiBadGatewayResponse({
    description: 'Unable to delete image from storage; retry the request.',
  })
  @HttpCode(200)
  async deleteImage(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imagesService.removeByUser(id, request.user!.sub);
  }
}
