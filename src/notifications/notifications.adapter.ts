import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

export class NotificationsAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(
    port: number,
    options?: Parameters<IoAdapter['createIOServer']>[1],
  ): ReturnType<IoAdapter['createIOServer']> {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.origins,
        methods: ['GET', 'POST'],
        credentials: false,
      },
      // CORS alone does not protect WebSocket upgrades. Also enforce the same
      // allowlist at the transport handshake. Native clients may omit Origin.
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        callback(null, origin === undefined || this.origins.includes(origin));
      },
    } as NonNullable<Parameters<IoAdapter['createIOServer']>[1]>);
  }
}
