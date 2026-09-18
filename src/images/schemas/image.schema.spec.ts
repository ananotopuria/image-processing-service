import { model, Types } from 'mongoose';
import { Image, ImageSchema } from './image.schema';

const ImageModel = model<Image>('ImageSchemaTest', ImageSchema);
const base = {
  user: new Types.ObjectId(),
  originalName: 'mountains.png',
  filename: 'source.png',
  path: 'originals/user/source.png',
  format: 'png',
  originalSize: 1024,
};

describe('Image schema compatibility', () => {
  it('accepts original metadata without processed fields', async () => {
    const image = new ImageModel({
      ...base,
      kind: 'original',
      originalKey: base.path,
      mimeType: 'image/png',
    });
    await expect(image.validate()).resolves.toBeUndefined();
  });

  it('requires original linkage and output metadata for transformed versions', async () => {
    const image = new ImageModel({ ...base, kind: 'transformed' });
    await expect(image.validate()).rejects.toMatchObject({
      errors: {
        originalKey: expect.anything(),
        originalImageId: expect.anything(),
        mimeType: expect.anything(),
        quality: expect.anything(),
        processedSize: expect.anything(),
      },
    });
  });

  it('stores nested applied transformations alongside version metadata', async () => {
    const transformations = {
      crop: { width: 100, height: 80, x: 0, y: 0 },
      resize: { width: 50 },
      rotate: 90,
      flip: false,
      mirror: true,
      filters: { grayscale: true, sepia: true },
      format: 'webp',
      quality: 75,
    };
    const image = new ImageModel({
      ...base,
      kind: 'transformed',
      originalImageId: new Types.ObjectId(),
      originalKey: base.path,
      mimeType: 'image/webp',
      format: 'webp',
      quality: 75,
      processedSize: 512,
      transformations,
    });
    await expect(image.validate()).resolves.toBeUndefined();
    expect(image.toObject().transformations).toEqual(transformations);
  });

  it('keeps Day 1 transformed versions valid without transformation history', async () => {
    const image = new ImageModel({
      ...base,
      kind: 'transformed',
      originalImageId: new Types.ObjectId(),
      originalKey: base.path,
      mimeType: 'image/png',
      quality: 80,
      processedSize: 512,
    });
    await expect(image.validate()).resolves.toBeUndefined();
    expect(image.transformations).toBeUndefined();
  });

  it('keeps legacy records valid and does not label them as originals', async () => {
    const image = new ImageModel({
      ...base,
      path: 'processed/old.webp',
      format: 'webp',
      quality: 80,
      processedSize: 512,
    });
    await expect(image.validate()).resolves.toBeUndefined();
    expect(image.kind).toBeUndefined();
    expect(image.originalKey).toBeUndefined();
  });
});
