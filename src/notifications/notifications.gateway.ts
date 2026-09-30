import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Namespace, Socket } from 'socket.io';
import { Types } from 'mongoose';
import type { JwtPayload } from '../auth/guards/jwt-auth/jwt-auth.guard';

export interface NotificationEvent {
  notificationId: string;
  type: 'image.shared';
  shareId: string;
  createdAt: string;
}

@WebSocketGateway({ namespace: '/notifications', path: '/socket.io' })
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Namespace;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly jwt: JwtService) {}

  afterInit(server: Namespace) {
    server.use(async (socket, next) => {
      try {
        const token: unknown = socket.handshake.auth?.token;
        if (typeof token !== 'string' || !token) throw new Error();
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        if (
          typeof payload.sub !== 'string' ||
          !Types.ObjectId.isValid(payload.sub) ||
          typeof payload.exp !== 'number' ||
          !Number.isFinite(payload.exp) ||
          payload.exp * 1000 <= Date.now()
        )
          throw new Error();
        socket.data.userId = new Types.ObjectId(payload.sub).toString();
        socket.data.expiresAt = payload.exp * 1000;
        next();
      } catch {
        next(
          Object.assign(new Error('Invalid or expired authentication token'), {
            data: { code: 'UNAUTHORIZED' },
          }),
        );
      }
    });
  }

  async handleConnection(socket: Socket) {
    if (!socket.data.userId || socket.data.expiresAt <= Date.now()) {
      socket.disconnect(true);
      return;
    }
    // No client message can join rooms or mutate sharing/notification state.
    await socket.join(this.room(socket.data.userId));
    if (!socket.connected) return;
    this.scheduleExpiration(socket);
  }

  private scheduleExpiration(socket: Socket) {
    const remaining = socket.data.expiresAt - Date.now();
    if (remaining <= 0) {
      socket.emit('auth.expired', { code: 'TOKEN_EXPIRED' });
      socket.disconnect(true);
      return;
    }
    // Node timers overflow beyond ~24.8 days. Recheck for longer token lifetimes.
    const timer = setTimeout(
      () => this.scheduleExpiration(socket),
      Math.min(remaining, 2_147_483_647),
    );
    timer.unref();
    this.timers.set(socket.id, timer);
  }

  handleDisconnect(socket: Socket) {
    clearTimeout(this.timers.get(socket.id));
    this.timers.delete(socket.id);
  }

  private room(userId: string) {
    return `user:${userId}`;
  }

  notify(recipientId: string, event: NotificationEvent) {
    if (!this.server) return;
    // Check at delivery as well, in case an expired socket's timer was delayed.
    for (const socket of this.server.sockets.values()) {
      if (
        socket.rooms.has(this.room(recipientId)) &&
        socket.data.expiresAt <= Date.now()
      )
        socket.disconnect(true);
    }
    this.server.to(this.room(recipientId)).emit('notification.created', event);
  }
}
