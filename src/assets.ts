import { heicTo } from 'heic-to/csp';
import { get, setMany } from 'idb-keyval';
import { loadImage } from './model';
import type { ImageAsset } from './model';

const heicBrands: Record<string, true> = { heic: true, heix: true, hevc: true, hevx: true, heim: true, heis: true, hevm: true, hevs: true, mif1: true, msf1: true };
const previews = new Map<string, PreviewEntry>();

interface PreviewEntry {
  users: number;
  promise: Promise<HTMLImageElement>;
  image?: HTMLImageElement;
  url?: string;
}

export interface PreparedAsset {
  asset: ImageAsset;
  source: Blob;
  preview: Blob;
}

// Browser image decoding matches export decoding, including EXIF orientation.
// Keep the decoded original only while producing the two bounded derivatives.
export async function prepareAsset(blob: Blob, identity: { id: string; name: string }): Promise<PreparedAsset> {
  const header = await blob.slice(0, 64).arrayBuffer();
  const signature = new TextDecoder('latin1').decode(header);
  let heic = false;
  if (signature.slice(4, 8) === 'ftyp') {
    heic = /^image\/hei[cf](?:-sequence)?$/i.test(blob.type) || /\.hei[cf]$/i.test(identity.name)
      || Boolean(heicBrands[signature.slice(8, 12).toLowerCase()]);
    const boxSize = new DataView(header).getUint32(0);
    const end = Math.min(header.byteLength, boxSize || header.byteLength);
    for (let offset = 16; !heic && offset + 4 <= end; offset += 4) {
      heic = Boolean(heicBrands[signature.slice(offset, offset + 4).toLowerCase()]);
    }
  }
  const source = heic ? await heicTo({ blob, type: 'image/png' }) : blob;
  const url = URL.createObjectURL(source);
  const canvas = document.createElement('canvas');
  let image: HTMLImageElement | undefined;
  try {
    image = await loadImage(url);
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    if (!naturalWidth || !naturalHeight) throw new Error(`Could not read ${identity.name}.`);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    const previewScale = Math.min(1, 1280 / Math.max(naturalWidth, naturalHeight));
    canvas.width = Math.max(1, Math.round(naturalWidth * previewScale));
    canvas.height = Math.max(1, Math.round(naturalHeight * previewScale));
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { promise, resolve, reject } = Promise.withResolvers<Blob>();
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error(`Could not create a preview for ${identity.name}.`));
    }, 'image/webp', 0.88);
    const preview = await promise;

    const thumbnailScale = Math.min(1, 192 / Math.max(naturalWidth, naturalHeight));
    canvas.width = Math.max(1, Math.round(naturalWidth * thumbnailScale));
    canvas.height = Math.max(1, Math.round(naturalHeight * thumbnailScale));
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL('image/webp', 0.8);
    return { asset: { ...identity, thumbnail, naturalWidth, naturalHeight }, source, preview };
  } finally {
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    canvas.width = 1;
    canvas.height = 1;
    URL.revokeObjectURL(url);
  }
}

export async function storeAsset(blob: Blob, identity: { id: string; name: string }): Promise<ImageAsset> {
  const { asset, source, preview } = await prepareAsset(blob, identity);
  // An aborted transaction must not leave a source without its matching preview.
  await setMany([
    [`collage-source:${identity.id}`, source],
    [`collage-preview:${identity.id}`, preview],
  ]);
  return asset;
}

export async function createAsset(file: File): Promise<ImageAsset> {
  return storeAsset(file, { id: crypto.randomUUID(), name: file.name });
}

export async function readSource(assetId: string): Promise<Blob> {
  const source = await get<Blob>(`collage-source:${assetId}`);
  if (!(source instanceof Blob)) throw new Error('The original photo is missing from browser storage. Keep this workspace open and restore the photo before exporting.');
  return source;
}

export function acquirePreview(assetId: string): Promise<HTMLImageElement> {
  const cached = previews.get(assetId);
  if (cached) {
    cached.users += 1;
    return cached.promise;
  }
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const entry: PreviewEntry = { users: 1, promise };
  previews.set(assetId, entry);
  void (async () => {
    try {
      const preview = await get<Blob>(`collage-preview:${assetId}`);
      if (!(preview instanceof Blob)) throw new Error('The photo preview is missing from browser storage.');
      const url = URL.createObjectURL(preview);
      entry.url = url;
      const image = await loadImage(url);
      image.onload = null;
      image.onerror = null;
      if (entry.users === 0 || previews.get(assetId) !== entry) {
        image.removeAttribute('src');
        URL.revokeObjectURL(url);
        entry.url = undefined;
      } else {
        entry.image = image;
      }
      resolve(image);
    } catch (error) {
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.url = undefined;
      reject(error);
    }
  })();
  return promise;
}

export function releasePreview(assetId: string): void {
  const entry = previews.get(assetId);
  if (!entry || entry.users === 0) return;
  entry.users -= 1;
  if (entry.users !== 0) return;
  // StrictMode and duplicate placements can release and reacquire in one turn.
  queueMicrotask(() => {
    if (entry.users !== 0 || previews.get(assetId) !== entry) return;
    previews.delete(assetId);
    if (entry.image) {
      entry.image.removeAttribute('src');
      entry.image = undefined;
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.url = undefined;
    }
  });
}
