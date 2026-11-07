export const SLIDE_WIDTH = 1080;
export const MAX_SLIDES = 20;
export type Aspect = 'portrait' | 'square';
export interface ImageAsset {
  id: string;
  name: string;
  thumbnail: string;
  naturalWidth: number;
  naturalHeight: number;
  addedAt?: number;
  takenAt?: number;
}
export interface Photo {
  id: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  crop: { x: number; y: number; width: number; height: number };
  groupId?: string;
  locked?: boolean;
  hidden?: boolean;
}
export type ResolvedPhoto = Photo & Omit<ImageAsset, 'id'>;
export interface Project {
  version: 3;
  name: string;
  slides: number;
  aspect: Aspect;
  background: string;
  assets: ImageAsset[];
  photos: Photo[];
}
export interface LegacyImageAsset {
  id: string;
  name: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}
type LegacyPhoto = Omit<Photo, 'assetId'> & Omit<LegacyImageAsset, 'id'>;
type LegacyProjectV1 = Omit<Project, 'version' | 'assets' | 'photos'> & { version: 1; photos: LegacyPhoto[] };
type LegacyProjectV2 = Omit<Project, 'version' | 'assets'> & { version: 2; assets: LegacyImageAsset[] };
export type StoredProject = Project | LegacyProjectV1 | LegacyProjectV2;
export interface Bounds { x: number; y: number; width: number; height: number }

export const slideHeight = (aspect: Aspect) => aspect === 'portrait' ? 1350 : 1080;
export const initialProject: Project = {
  version: 3,
  name: 'Untitled collage',
  slides: 3,
  aspect: 'portrait',
  background: '#e8e5de',
  assets: [],
  photos: [],
};

export function resolvePhotos(project: Project): ResolvedPhoto[] {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  return project.photos.map((photo) => ({ ...assets.get(photo.assetId)!, ...photo }));
}

export function photoIntersects(photo: Photo, bounds: Bounds): boolean {
  const angle = photo.rotation * Math.PI / 180;
  const dx = photo.width * Math.cos(angle);
  const dy = photo.width * Math.sin(angle);
  const hx = -photo.height * Math.sin(angle);
  const hy = photo.height * Math.cos(angle);
  const left = photo.x + Math.min(0, dx, hx, dx + hx);
  const right = photo.x + Math.max(0, dx, hx, dx + hx);
  const top = photo.y + Math.min(0, dy, hy, dy + hy);
  const bottom = photo.y + Math.max(0, dy, hy, dy + hy);
  return right > bounds.x && left < bounds.x + bounds.width && bottom > bounds.y && top < bounds.y + bounds.height;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('This image could not be opened.'));
  image.src = src;
  return promise;
}
