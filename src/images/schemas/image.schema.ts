import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { ImageTransformationsDto } from '../dto/transform-image.dto';

export type ImageDocument = HydratedDocument<Image>;

@Schema({
  timestamps: true,
  versionKey: false,
})
export class Image {
  // No default: records created before original preservation remain identifiable.
  @Prop({ enum: ['original', 'transformed'] })
  kind?: 'original' | 'transformed';

  @Prop({
    type: Types.ObjectId,
    ref: 'Image',
    index: true,
    required: function (this: Image) {
      return this.kind === 'transformed';
    },
  })
  originalImageId?: Types.ObjectId;

  @Prop({
    required: function (this: Image) {
      return this.kind !== undefined;
    },
  })
  originalKey?: string;

  @Prop({
    enum: ['image/jpeg', 'image/png', 'image/webp'],
    required: function (this: Image) {
      return this.kind !== undefined;
    },
  })
  mimeType?: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  user: Types.ObjectId;

  @Prop({
    required: true,
  })
  originalName: string;

  @Prop({
    required: true,
  })
  filename: string;

  @Prop({
    required: true,
  })
  path: string;

  @Prop({
    required: true,
    enum: ['jpeg', 'png', 'webp'],
  })
  format: string;

  // Validated by the request DTO; absent on original and pre-Day-2 records.
  @Prop({ type: MongooseSchema.Types.Mixed })
  transformations?: ImageTransformationsDto;

  @Prop()
  width?: number;

  @Prop()
  height?: number;

  @Prop({
    required: function (this: Image) {
      return this.kind === 'transformed';
    },
    min: 1,
    max: 100,
  })
  quality?: number;

  @Prop({
    required: true,
  })
  originalSize: number;

  @Prop({
    required: function (this: Image) {
      return this.kind === 'transformed';
    },
  })
  processedSize?: number;
}

export const ImageSchema = SchemaFactory.createForClass(Image);
