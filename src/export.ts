import JSZip from 'jszip';
import { photoIntersects, SLIDE_WIDTH, slideHeight, type Project } from './model';
import { readSource } from './assets';

export interface RenderedSlide {
  blob: Blob;
  url: string;
  name: string;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('The browser could not create this PNG. Please try exporting again.'));
  }, 'image/png');
  return promise;
}

export async function renderSlides(
  project: Project,
  onProgress?: (completed: number) => void,
): Promise<RenderedSlide[]> {
  const slides: RenderedSlide[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_WIDTH;
  canvas.height = slideHeight(project.aspect);
  const images = new Map<string, { image: HTMLImageElement; url: string }>();
  const releaseImage = (entry: { image: HTMLImageElement; url: string }) => {
    entry.image.onload = null;
    entry.image.onerror = null;
    entry.image.removeAttribute('src');
    URL.revokeObjectURL(entry.url);
  };
  const getImage = async (assetId: string): Promise<HTMLImageElement> => {
    const cached = images.get(assetId);
    if (cached) {
      images.delete(assetId);
      images.set(assetId, cached);
      return cached.image;
    }
    // Evict before decoding so even the in-flight source stays within the limit.
    if (images.size >= 3) {
      const oldest = images.entries().next().value!;
      images.delete(oldest[0]);
      releaseImage(oldest[1]);
    }
    const url = URL.createObjectURL(await readSource(assetId));
    const image = new Image();
    const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('An original image could not be opened for export.'));
    try {
      image.src = url;
      await promise;
      images.set(assetId, { image, url });
      return image;
    } catch (error) {
      releaseImage({ image, url });
      throw error;
    } finally {
      image.onload = null;
      image.onerror = null;
    }
  };

  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not open a canvas for export.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    for (let index = 0; index < project.slides; index += 1) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = project.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const bounds = { x: index * SLIDE_WIDTH, y: 0, width: canvas.width, height: canvas.height };

      for (const photo of project.photos) {
        if (photo.hidden || !photoIntersects(photo, bounds)) continue;
        const image = await getImage(photo.assetId);
        context.save();
        context.translate(photo.x - index * SLIDE_WIDTH, photo.y);
        context.rotate(photo.rotation * Math.PI / 180);
        // Canvas clipping handles rotated photos crossing a slide boundary.
        context.drawImage(
          image,
          photo.crop.x, photo.crop.y, photo.crop.width, photo.crop.height,
          0, 0, photo.width, photo.height,
        );
        context.restore();
      }

      const blob = await canvasPng(canvas);
      const url = URL.createObjectURL(blob);
      slides.push({ blob, url, name: `slide-${String(index + 1).padStart(2, '0')}.png` });
      onProgress?.(index + 1);
    }
    return slides;
  } catch (error) {
    for (const slide of slides) URL.revokeObjectURL(slide.url);
    throw error;
  } finally {
    for (const entry of images.values()) releaseImage(entry);
    images.clear();
    // Release the single rendering surface; previews retain only their PNGs.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function downloadZip(
  slides: { blob: Blob; name: string }[],
  name: string,
): Promise<void> {
  const zip = new JSZip();
  for (const slide of slides) zip.file(slide.name, slide.blob);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const filename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'collage';
  anchor.href = url;
  anchor.download = filename.toLowerCase().endsWith('.zip') ? filename : `${filename}.zip`;
  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Allow the browser to begin consuming the download before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
