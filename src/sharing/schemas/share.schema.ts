import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ShareDocument = HydratedDocument<Share>;

@Schema({ timestamps: true, versionKey: false })
export class Share {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipientId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Image', required: true })
  imageId: Types.ObjectId;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const ShareSchema = SchemaFactory.createForClass(Share);
ShareSchema.index(
  { imageId: 1, recipientId: 1 },
  {
    unique: true,
    partialFilterExpression: { revokedAt: null },
    name: 'unique_active_share',
  },
);
ShareSchema.index({ senderId: 1, createdAt: -1, _id: -1 });
ShareSchema.index({ recipientId: 1, createdAt: -1, _id: -1 });
