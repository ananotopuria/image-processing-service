import * as presigner from '@aws-sdk/s3-request-presigner';
import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3Service } from './s3.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

describe('S3Service', () => {
  let service: S3Service;
  let send: jest.SpyInstance;

  beforeEach(() => {
    jest
      .mocked(presigner.getSignedUrl)
      .mockReset()
      .mockImplementation(
        jest.requireActual('@aws-sdk/s3-request-presigner').getSignedUrl,
      );
    send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never);
    service = new S3Service(
      new ConfigService({
        AWS_S3_BUCKET: 'test-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'test-only',
        AWS_SECRET_ACCESS_KEY: 'test-only',
      }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates scoped display/download URLs with expiry without reading object bytes', async () => {
    const before = Date.now();
    const result = await service.getFileUrls(
      'transformed/user/original/image.webp',
    );
    const display = new URL(result.url);
    const download = new URL(result.downloadUrl);
    expect(display.protocol).toBe('https:');
    expect(display.pathname).toBe('/transformed/user/original/image.webp');
    expect(display.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(display.searchParams.get('response-content-disposition')).toBe(
      'inline',
    );
    expect(download.searchParams.get('response-content-disposition')).toBe(
      'attachment',
    );
    expect(display.searchParams.get('response-cache-control')).toBe(
      'private, no-store',
    );
    expect(display.searchParams.has('X-Amz-Signature')).toBe(true);
    expect(new Date(result.urlExpiresAt).getTime()).toBeGreaterThanOrEqual(
      before + 900000,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('returns a safe 502 if URL signing fails', async () => {
    jest
      .mocked(presigner.getSignedUrl)
      .mockRejectedValue(new Error('private credential detail'));
    await expect(service.getFileUrls('key')).rejects.toMatchObject({
      status: 502,
      message: 'Unable to create image access URLs',
    });
  });

  it('retrieves object bytes as a Buffer', async () => {
    send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    await expect(service.getFile('originals/test.png')).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'test-bucket',
      Key: 'originals/test.png',
    });
  });

  it.each([
    {},
    {
      Body: {
        transformToByteArray: async () => {
          throw new Error('stream failed');
        },
      },
    },
  ])('handles missing or unreadable object bodies', async (response) => {
    send.mockResolvedValue(response);
    await expect(service.getFile('originals/test.png')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('uploads bytes with their content type', async () => {
    const data = Buffer.from('image bytes');
    await service.uploadFile('originals/test.png', data, 'image/png');
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'test-bucket',
      Key: 'originals/test.png',
      Body: data,
      ContentType: 'image/png',
    });
  });

  it('deletes the requested object', async () => {
    await service.deleteFile('originals/test.png');
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(send.mock.calls[0][0].input.Key).toBe('originals/test.png');
  });

  it.each(['get', 'upload', 'delete'])(
    'returns a safe 502 for %s failures',
    async (operation) => {
      send.mockRejectedValue(new Error('internal storage details'));
      const result =
        operation === 'get'
          ? service.getFile('key')
          : operation === 'upload'
            ? service.uploadFile('key', Buffer.from('bytes'), 'image/png')
            : service.deleteFile('key');
      try {
        await result;
        throw new Error('Expected a storage error');
      } catch (error) {
        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as BadGatewayException).getResponse()).not.toEqual(
          expect.objectContaining({
            message: expect.stringContaining('internal storage details'),
          }),
        );
      }
    },
  );
});
