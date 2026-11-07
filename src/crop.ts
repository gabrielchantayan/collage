import type { Photo, ResolvedPhoto } from './model';

export type CropEdge = 'left' | 'right' | 'top' | 'bottom';

// Delta is in the photo's local display pixels, before rotation.
export function cropPhotoEdge(photo: ResolvedPhoto, edge: CropEdge, delta: number): Partial<Photo> {
  const scaleX = photo.width / photo.crop.width;
  const scaleY = photo.height / photo.crop.height;
  const crop = { ...photo.crop };
  let { x, y, width, height } = photo;
  const angle = photo.rotation * Math.PI / 180;
  if (edge === 'left') {
    const shift = Math.max(-crop.x * scaleX, Math.min(width - 30, delta));
    crop.x += shift / scaleX;
    crop.width -= shift / scaleX;
    width -= shift;
    x += shift * Math.cos(angle);
    y += shift * Math.sin(angle);
  } else if (edge === 'right') {
    const shift = Math.max(30 - width, Math.min((photo.naturalWidth - crop.x - crop.width) * scaleX, delta));
    crop.width += shift / scaleX;
    width += shift;
  } else if (edge === 'top') {
    const shift = Math.max(-crop.y * scaleY, Math.min(height - 30, delta));
    crop.y += shift / scaleY;
    crop.height -= shift / scaleY;
    height -= shift;
    x -= shift * Math.sin(angle);
    y += shift * Math.cos(angle);
  } else {
    const shift = Math.max(30 - height, Math.min((photo.naturalHeight - crop.y - crop.height) * scaleY, delta));
    crop.height += shift / scaleY;
    height += shift;
  }
  return { x, y, width, height, crop };
}

export function restorePhotoCrop(photo: ResolvedPhoto): Partial<Photo> {
  const scaleX = photo.width / photo.crop.width;
  const scaleY = photo.height / photo.crop.height;
  const dx = -photo.crop.x * scaleX;
  const dy = -photo.crop.y * scaleY;
  const angle = photo.rotation * Math.PI / 180;
  return {
    x: photo.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: photo.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    width: photo.naturalWidth * scaleX,
    height: photo.naturalHeight * scaleY,
    crop: { x: 0, y: 0, width: photo.naturalWidth, height: photo.naturalHeight },
  };
}
