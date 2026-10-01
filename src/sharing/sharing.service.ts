import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { isEmail } from 'class-validator';
import { UsersService } from '../users/users.service';
import { Image, ImageDocument } from '../images/schemas/image.schema';
import { imageFilename } from '../images/image-filename';
import { S3Service } from '../s3/s3.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { Share, ShareDocument } from './schemas/share.schema';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import { CreateShareDto } from './dto/create-share.dto';
import { ListSharingDto } from './dto/sharing-response.dto';

@Injectable()
export class SharingService implements OnModuleInit {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Share.name) private readonly shares: Model<ShareDocument>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<NotificationDocument>,
    @InjectModel(Image.name) private readonly images: Model<ImageDocument>,
    private readonly users: UsersService,
    private readonly storage: S3Service,
    private readonly gateway: NotificationsGateway,
  ) {}

  async onModuleInit() {
    // Do not accept requests until database-enforced uniqueness is ready, even
    // when automatic index creation is disabled by deployment configuration.
    await this.shares.createIndexes();
    await this.notifications.createIndexes();
  }

  private userId(value: string) {
    if (!Types.ObjectId.isValid(value))
      throw new UnauthorizedException('Invalid authentication subject');
    return new Types.ObjectId(value);
  }

  private id(value: string, resource: string) {
    if (!Types.ObjectId.isValid(value))
      throw new NotFoundException(`${resource} not found`);
    return new Types.ObjectId(value);
  }

  async create(sender: string, dto: CreateShareDto) {
    const senderId = this.userId(sender);
    const imageId = this.id(dto.imageId, 'Image');
    const email = dto.recipientEmail.trim().toLowerCase();
    if (!isEmail(email))
      throw new BadRequestException('Invalid recipient email');
    // Check ownership before looking up another account.
    if (!(await this.images.exists({ _id: imageId, user: senderId })))
      throw new NotFoundException('Image not found');
    const recipient = await this.users.findByEmail(email);
    if (!recipient) throw new NotFoundException('Recipient not found');
    if (recipient._id.equals(senderId))
      throw new BadRequestException('Cannot share an image with yourself');

    let saved: { share: ShareDocument; notification: NotificationDocument };
    try {
      saved = await this.connection.transaction(
        async (session) => {
          if (
            !(await this.images
              .exists({ _id: imageId, user: senderId })
              .session(session))
          )
            throw new NotFoundException('Image not found');
          const [share] = await this.shares.create(
            [{ senderId, recipientId: recipient._id, imageId }],
            { session },
          );
          const [notification] = await this.notifications.create(
            [
              {
                recipientId: recipient._id,
                shareId: share._id,
                type: 'image.shared',
              },
            ],
            { session },
          );
          return { share, notification };
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          'An active share already exists for this image and recipient',
        );
      }
      throw error;
    }
    // Emission is a best-effort hint. Never retry or roll back a committed write
    // because a socket/adapter fails; REST recovers missed notifications.
    try {
      await this.gateway.notify(recipient._id.toString(), {
        notificationId: saved.notification._id.toString(),
        type: saved.notification.type,
        shareId: saved.share._id.toString(),
        createdAt: saved.notification.createdAt.toISOString(),
      });
    } catch {
      this.logger.warn('Notification socket delivery failed after persistence');
    }
    return this.shareResponse(saved.share, true);
  }

  private async availableShareIds(shares: ShareDocument[]) {
    const active = shares.filter((share) => !share.revokedAt);
    if (!active.length) return new Set<string>();
    const images = await this.images
      .find({ _id: { $in: active.map((share) => share.imageId) } })
      .select('_id user')
      .exec();
    const ownership = new Set(
      images.map((image) => `${image._id}:${image.user}`),
    );
    return new Set(
      active
        .filter((share) => ownership.has(`${share.imageId}:${share.senderId}`))
        .map((share) => share._id.toString()),
    );
  }

  private shareResponse(share: ShareDocument, available: boolean) {
    return {
      _id: share._id.toString(),
      senderId: share.senderId.toString(),
      recipientId: share.recipientId.toString(),
      imageId: share.imageId.toString(),
      revokedAt: share.revokedAt,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt,
      available,
    };
  }

  private async sentResponses(
    shares: ShareDocument[],
    senderId: Types.ObjectId,
  ) {
    if (!shares.length) return [];
    // Resolve only the current page, using the stored relationships. Do not store
    // email/name snapshots or expose user profiles, object keys or signed URLs.
    const [recipients, images] = await Promise.all([
      this.users.findEmailsByIds(shares.map((share) => share.recipientId)),
      this.images
        .find({
          _id: { $in: shares.map((share) => share.imageId) },
          user: senderId,
        })
        .select('_id originalName format')
        .lean()
        .exec(),
    ]);
    const emails = new Map(
      recipients.map((recipient) => [
        recipient._id.toString(),
        recipient.email,
      ]),
    );
    const summaries = new Map(
      images.map((image) => [
        image._id.toString(),
        {
          filename: imageFilename({ ...image, kind: 'transformed' }),
          format: image.format,
        },
      ]),
    );
    return shares.map((share) => {
      const image = summaries.get(share.imageId.toString()) ?? null;
      return {
        ...this.shareResponse(share, !share.revokedAt && image !== null),
        recipientEmail: emails.get(share.recipientId.toString()) ?? null,
        image,
      };
    });
  }

  async list(
    user: string,
    direction: 'received' | 'sent',
    { page, limit }: ListSharingDto,
  ) {
    const userId = this.userId(user);
    const filter = {
      [direction === 'received' ? 'recipientId' : 'senderId']: userId,
    };
    const [shares, total] = await Promise.all([
      this.shares
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.shares.countDocuments(filter).exec(),
    ]);
    const available =
      direction === 'received'
        ? await this.availableShareIds(shares)
        : new Set<string>();
    const items =
      direction === 'sent'
        ? await this.sentResponses(shares, userId)
        : shares.map((share) =>
            this.shareResponse(share, available.has(share._id.toString())),
          );
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getReceived(user: string, id: string) {
    const filter = {
      _id: this.id(id, 'Share'),
      recipientId: this.userId(user),
      revokedAt: null,
    };
    const share = await this.shares.findOne(filter).exec();
    if (!share) throw new NotFoundException('Share not found');
    const image = await this.images
      .findOne({ _id: share.imageId, user: share.senderId })
      .exec();
    if (!image) throw new NotFoundException('Shared image is unavailable');
    // Force the extension to match the actual format, including originals with
    // misleading upload names. Never sign originalKey or follow originalImageId.
    const filename = imageFilename({
      ...image.toObject(),
      kind: 'transformed',
    });
    const urls = await this.storage.getFileUrls(image.path, filename);
    if (
      !(await this.shares.exists(filter)) ||
      !(await this.images.exists({ _id: image._id, user: share.senderId }))
    ) {
      throw new NotFoundException('Shared image is unavailable');
    }
    return {
      share: this.shareResponse(share, true),
      image: {
        _id: image._id.toString(),
        filename,
        format: image.format,
        kind: image.kind,
        mimeType: `image/${image.format}`,
        width: image.width,
        height: image.height,
        ...urls,
      },
    };
  }

  async revoke(user: string, id: string) {
    const filter = { _id: this.id(id, 'Share'), senderId: this.userId(user) };
    // Conditional update preserves the first revocation timestamp on retries.
    await this.shares
      .updateOne(
        { ...filter, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
    const share = await this.shares.findOne(filter).exec();
    if (!share) throw new NotFoundException('Share not found');
    return this.shareResponse(share, false);
  }

  private async notificationResponses(
    notifications: NotificationDocument[],
    recipientId: Types.ObjectId,
  ) {
    const shares = notifications.length
      ? await this.shares
          .find({
            _id: {
              $in: notifications.map((notification) => notification.shareId),
            },
            recipientId,
          })
          .exec()
      : [];
    const available = await this.availableShareIds(shares);
    return notifications.map((notification) => ({
      _id: notification._id.toString(),
      type: notification.type,
      shareId: notification.shareId.toString(),
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      available: available.has(notification.shareId.toString()),
    }));
  }

  async listNotifications(user: string, { page, limit }: ListSharingDto) {
    const recipientId = this.userId(user);
    const [notifications, total] = await Promise.all([
      this.notifications
        .find({ recipientId })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.notifications.countDocuments({ recipientId }).exec(),
    ]);
    return {
      items: await this.notificationResponses(notifications, recipientId),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async unreadCount(user: string) {
    return {
      unreadCount: await this.notifications
        .countDocuments({ recipientId: this.userId(user), readAt: null })
        .exec(),
    };
  }

  async markRead(user: string, id: string) {
    const recipientId = this.userId(user);
    const filter = { _id: this.id(id, 'Notification'), recipientId };
    await this.notifications
      .updateOne({ ...filter, readAt: null }, { $set: { readAt: new Date() } })
      .exec();
    const notification = await this.notifications.findOne(filter).exec();
    if (!notification) throw new NotFoundException('Notification not found');
    const [response] = await this.notificationResponses(
      [notification],
      recipientId,
    );
    return response;
  }
}
