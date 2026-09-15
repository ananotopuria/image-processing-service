import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ImageDocument = HydratedDocument<Image>;

@Schema({
  timestamps: true,
  versionKey: false,
})
export class Image {
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

  @Prop()
  width?: number;

  @Prop()
  height?: number;

  @Prop({
    required: true,
    min: 1,
    max: 100,
  })
  quality: number;

  @Prop({
    required: true,
  })
  originalSize: number;

  @Prop({
    required: true,
  })
  processedSize: number;
}

export const ImageSchema = SchemaFactory.createForClass(Image);
