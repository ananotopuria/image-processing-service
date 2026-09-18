import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { ImagesController } from '../images.controller';
import { UserThrottlerGuard } from './user-throttler.guard';

// Exercise the real throttler storage and route decorators without a listener.
describe('UserThrottlerGuard', () => {
  let module: TestingModule;
  let guard: UserThrottlerGuard;
  const header = jest.fn();
  const context = (
    userId: string,
    method: 'transformImage' | 'uploadImage' = 'transformImage',
    imageId = 'first',
    ip = '127.0.0.1',
  ) =>
    ({
      getClass: () => ImagesController,
      getHandler: () => ImagesController.prototype[method],
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: userId },
          params: { id: imageId },
          ip,
          headers: {},
        }),
        getResponse: () => ({ header }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    jest.useFakeTimers();
    header.mockClear();
    module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
      providers: [UserThrottlerGuard],
    }).compile();
    await module.init();
    guard = module.get(UserThrottlerGuard);
  });

  afterEach(async () => {
    await module.close();
    jest.useRealTimers();
  });

  it('returns 429 on request 11 across image IDs/IPs, with Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(
        guard.canActivate(
          context('owner', 'transformImage', String(i), `192.0.2.${i + 1}`),
        ),
      ).resolves.toBe(true);
    }
    await expect(guard.canActivate(context('owner'))).rejects.toMatchObject({
      status: 429,
    });
    expect(header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    await expect(guard.canActivate(context('other-owner'))).resolves.toBe(true);
    await expect(
      guard.canActivate(context('owner', 'uploadImage')),
    ).resolves.toBe(true);
  });

  it('permits requests after the window/block expires', async () => {
    for (let i = 0; i < 10; i++) await guard.canActivate(context('owner'));
    await expect(guard.canActivate(context('owner'))).rejects.toMatchObject({
      status: 429,
    });
    await jest.advanceTimersByTimeAsync(61000);
    await expect(guard.canActivate(context('owner'))).resolves.toBe(true);
  });
});
