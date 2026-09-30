import type { Image } from './schemas/image.schema';

// Derive a user-facing name without changing source metadata or storage keys.
// Legacy records have no reliable original/version identity; keep their names.
export function imageFilename(
  image: Pick<Image, 'kind' | 'originalName' | 'format'>,
): string {
  if (image.kind !== 'transformed') return image.originalName;
  const dot = image.originalName.lastIndexOf('.');
  const basename =
    dot > 0 ? image.originalName.slice(0, dot) : image.originalName;
  const extension = image.format === 'jpeg' ? 'jpg' : image.format;
  return `${basename}.${extension}`;
}
