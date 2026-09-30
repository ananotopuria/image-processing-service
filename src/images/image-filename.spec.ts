import { imageFilename } from './image-filename';

describe('imageFilename', () => {
  it.each([
    ['photo.jpg', 'photo'],
    ['photo.JPEG', 'photo'],
    ['photo.PNG', 'photo'],
    ['photo.WEBP', 'photo'],
    ['my.photo.final.JPG', 'my.photo.final'],
    ['photo', 'photo'],
    ['.photo', '.photo'],
    ['photo.', 'photo'],
  ])(
    'preserves the basename of %s for each actual output format',
    (originalName, basename) => {
      for (const format of ['jpeg', 'png', 'webp']) {
        const image = Object.freeze({
          kind: 'transformed' as const,
          originalName,
          format,
        });
        expect(imageFilename(image)).toBe(
          `${basename}.${format === 'jpeg' ? 'jpg' : format}`,
        );
        expect(imageFilename({ ...image, kind: 'original' })).toBe(
          originalName,
        );
        expect(imageFilename({ ...image, kind: undefined })).toBe(originalName);
        expect(image.originalName).toBe(originalName);
      }
    },
  );
});
