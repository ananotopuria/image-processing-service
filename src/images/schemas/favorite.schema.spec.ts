import { model, Types } from 'mongoose';
import { Favorite, FavoriteSchema } from './favorite.schema';
import { ImageSchema } from './image.schema';

const FavoriteModel = model<Favorite>('FavoriteSchemaTest', FavoriteSchema);

describe('Favorite schema', () => {
  it('requires both user and image references', async () => {
    await expect(new FavoriteModel().validate()).rejects.toMatchObject({
      errors: { userId: expect.anything(), imageId: expect.anything() },
    });
    const favorite = new FavoriteModel({
      userId: new Types.ObjectId(),
      imageId: new Types.ObjectId(),
    });
    await expect(favorite.validate()).resolves.toBeUndefined();
  });

  it('enforces uniqueness per user/image, with timestamps and an image cleanup index', () => {
    expect(FavoriteSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ userId: 1, imageId: 1 }, { unique: true }],
        [{ imageId: 1 }, {}],
      ]),
    );
    expect(FavoriteSchema.path('createdAt')).toBeDefined();
    expect(FavoriteSchema.path('updatedAt')).toBeDefined();
    expect(ImageSchema.path('isFavorite')).toBeUndefined();
  });
});
