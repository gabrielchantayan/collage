import { delMany, keys, setMany } from 'idb-keyval';
import { prepareAsset } from './assets';
import type { ImageAsset, Photo, Project, StoredProject } from './model';

export async function restoreProject(saved: StoredProject): Promise<Project> {
  if (saved.version === 3) return saved;
  if (saved.version !== 1 && saved.version !== 2) throw new Error('This saved project uses an unsupported format.');

  const assets: ImageAsset[] = [];
  let photos: Photo[] = [];
  const sources: [IDBValidKey, Blob][] = [];
  if (saved.version === 2) {
    for (const legacy of saved.assets) {
      const response = await fetch(legacy.src);
      if (!response.ok) throw new Error(`Could not restore the original photo ${legacy.name}.`);
      const { asset, source, preview } = await prepareAsset(await response.blob(), { id: legacy.id, name: legacy.name });
      assets.push({ ...asset, naturalWidth: legacy.naturalWidth, naturalHeight: legacy.naturalHeight });
      sources.push([`collage-source:${asset.id}`, source], [`collage-preview:${asset.id}`, preview]);
    }
    photos = saved.photos;
  } else {
    const bySource = new Map<string, ImageAsset>();
    for (const legacy of saved.photos) {
      let asset = bySource.get(legacy.src);
      if (!asset) {
        const response = await fetch(legacy.src);
        if (!response.ok) throw new Error(`Could not restore the original photo ${legacy.name}.`);
        // Placement IDs remain untouched, and an interrupted migration reuses the same source keys.
        const prepared = await prepareAsset(await response.blob(), { id: `asset-${legacy.id}`, name: legacy.name });
        asset = { ...prepared.asset, naturalWidth: legacy.naturalWidth, naturalHeight: legacy.naturalHeight };
        bySource.set(legacy.src, asset);
        assets.push(asset);
        sources.push([`collage-source:${asset.id}`, prepared.source], [`collage-preview:${asset.id}`, prepared.preview]);
      }
      photos.push({
        id: legacy.id,
        assetId: asset.id,
        x: legacy.x,
        y: legacy.y,
        width: legacy.width,
        height: legacy.height,
        rotation: legacy.rotation,
        crop: legacy.crop,
      });
    }
  }
  const project: Project = {
    version: 3,
    name: saved.name,
    slides: saved.slides,
    aspect: saved.aspect,
    background: saved.background,
    assets,
    photos,
  };
  // Replace the large legacy value first, so its space is available to source writes.
  // All writes commit together; quota or decoding failures never replace the saved project.
  await setMany([['collage-project', project], ...sources]);
  return project;
}


export async function pruneUnusedSources(assetIds: ReadonlySet<string>): Promise<void> {
  const unused = (await keys()).filter((key) => {
    if (typeof key !== 'string') return false;
    if (key.startsWith('collage-source:')) return !assetIds.has(key.slice('collage-source:'.length));
    if (key.startsWith('collage-preview:')) return !assetIds.has(key.slice('collage-preview:'.length));
    return false;
  });
  if (unused.length) await delMany(unused);
}