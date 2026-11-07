import type { ImageAsset, Photo, ResolvedPhoto } from './model';

export function replacementPatch(photo: ResolvedPhoto, asset: ImageAsset): Partial<Photo> {
  const scale = Math.min(asset.naturalWidth / photo.width, asset.naturalHeight / photo.height);
  const width = Math.min(asset.naturalWidth, photo.width * scale);
  const height = Math.min(asset.naturalHeight, photo.height * scale);
  return {
    assetId: asset.id,
    crop: {
      x: Math.max(0, (asset.naturalWidth - width) / 2),
      y: Math.max(0, (asset.naturalHeight - height) / 2),
      width,
      height,
    },
  };
}
