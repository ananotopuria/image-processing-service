import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ timestamps: true, versionKey: false })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipientId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Share', required: true, unique: true })
  shareId: Types.ObjectId;

  @Prop({ required: true, enum: ['image.shared'], default: 'image.shared' })
  type: 'image.shared';

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ recipientId: 1, createdAt: -1, _id: -1 });
NotificationSchema.index({ recipientId: 1, readAt: 1 });
