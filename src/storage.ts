import { createStore, get, promisifyRequest } from 'idb-keyval';
import { prepareAsset } from './assets';
import { initialProject, MAX_SLIDES } from './model';
import type { ImageAsset, Photo, Project, StoredProject } from './model';

const LIBRARY_KEY = 'collage-project-library';
const LEGACY_KEY = 'collage-project';
// This is idb-keyval's default store, shared with the original photo storage.
const useStore = createStore('keyval-store', 'keyval');

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface SavedProject {
  id: string;
  updatedAt: number;
  project: Project;
}

export interface ProjectLibrary {
  version: 1;
  currentId: string;
  projects: SavedProject[];
}

export type SourceEntry = [IDBValidKey, Blob];
export interface ProjectSources {
  project: Project;
  sources: SourceEntry[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Check untrusted metadata before it can reference or replace locally stored originals. */
export function validateProject(value: unknown): Project {
  const invalid = () => new Error('The project contains invalid metadata, photo references, or geometry.');
  if (!record(value) || value.version !== 3 || typeof value.name !== 'string'
    || !Number.isInteger(value.slides) || !positive(value.slides) || value.slides > MAX_SLIDES
    || (value.aspect !== 'portrait' && value.aspect !== 'square') || !text(value.background)
    || !Array.isArray(value.assets) || !Array.isArray(value.photos)) throw invalid();

  const assets = new Map<string, ImageAsset>();
  for (const item of value.assets) {
    if (!record(item) || !text(item.id) || assets.has(item.id) || typeof item.name !== 'string'
      || typeof item.thumbnail !== 'string' || !positive(item.naturalWidth) || !positive(item.naturalHeight)
      || !Number.isInteger(item.naturalWidth) || !Number.isInteger(item.naturalHeight)
      || (item.addedAt !== undefined && !finite(item.addedAt))
      || (item.takenAt !== undefined && !finite(item.takenAt))) throw invalid();
    const asset: ImageAsset = {
      id: item.id, name: item.name, thumbnail: item.thumbnail,
      naturalWidth: item.naturalWidth, naturalHeight: item.naturalHeight,
    };
    if (item.addedAt !== undefined) asset.addedAt = item.addedAt as number;
    if (item.takenAt !== undefined) asset.takenAt = item.takenAt as number;
    assets.set(asset.id, asset);
  }

  const photoIds = new Set<string>();
  const photos: Photo[] = [];
  for (const item of value.photos) {
    if (!record(item) || !text(item.id) || photoIds.has(item.id) || !text(item.assetId)
      || !finite(item.x) || !finite(item.y) || !positive(item.width) || !positive(item.height)
      || !finite(item.rotation) || !record(item.crop)
      || !finite(item.crop.x) || !finite(item.crop.y) || item.crop.x < 0 || item.crop.y < 0
      || !positive(item.crop.width) || !positive(item.crop.height)
      || (item.groupId !== undefined && !text(item.groupId))
      || (item.locked !== undefined && typeof item.locked !== 'boolean')
      || (item.hidden !== undefined && typeof item.hidden !== 'boolean')) throw invalid();
    const asset = assets.get(item.assetId);
    if (!asset || item.crop.x + item.crop.width > asset.naturalWidth + 0.000001
      || item.crop.y + item.crop.height > asset.naturalHeight + 0.000001) throw invalid();
    const photo: Photo = {
      id: item.id, assetId: item.assetId, x: item.x, y: item.y,
      width: item.width, height: item.height, rotation: item.rotation,
      crop: { x: item.crop.x, y: item.crop.y, width: item.crop.width, height: item.crop.height },
    };
    if (item.groupId !== undefined) photo.groupId = item.groupId as string;
    if (item.locked !== undefined) photo.locked = item.locked as boolean;
    if (item.hidden !== undefined) photo.hidden = item.hidden as boolean;
    photoIds.add(photo.id);
    photos.push(photo);
  }
  return {
    version: 3, name: value.name, slides: value.slides, aspect: value.aspect,
    background: value.background, assets: [...assets.values()], photos,
  };
}

function validateLibrary(value: unknown): ProjectLibrary {
  if (!record(value) || value.version !== 1 || !text(value.currentId) || !Array.isArray(value.projects)
    || !value.projects.length) throw new Error('The saved project library could not be opened. Its data has not been changed.');
  const ids = new Set<string>();
  const projects: SavedProject[] = value.projects.map((item: unknown) => {
    if (!record(item) || !text(item.id) || ids.has(item.id) || !finite(item.updatedAt)) {
      throw new Error('The saved project library contains invalid entries. Its data has not been changed.');
    }
    ids.add(item.id);
    return { id: item.id, updatedAt: item.updatedAt, project: validateProject(item.project) };
  });
  if (!ids.has(value.currentId)) throw new Error('The active saved project is missing. The library has not been changed.');
  return { version: 1, currentId: value.currentId, projects };
}

export function newSavedProject(project: Project = { ...initialProject, assets: [], photos: [] }): SavedProject {
  return { id: crypto.randomUUID(), updatedAt: Date.now(), project };
}

interface LibraryMutation {
  library: ProjectLibrary;
  sources?: SourceEntry[];
  removeLegacy?: boolean;
}

function transactLibrary(update: (library: ProjectLibrary | undefined) => LibraryMutation): Promise<ProjectLibrary> {
  return useStore('readwrite', (store) => {
    const { promise, resolve, reject } = Promise.withResolvers<ProjectLibrary>();
    const transaction = store.transaction;
    let result: ProjectLibrary;
    let failure: unknown;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('Local storage transaction failed.'));
    const request = store.get(LIBRARY_KEY);
    request.onsuccess = () => {
      try {
        const previous = request.result === undefined ? undefined : validateLibrary(request.result);
        const mutation = update(previous);
        result = mutation.library;
        if (mutation.removeLegacy) store.delete(LEGACY_KEY);
        store.put(result, LIBRARY_KEY);
        for (const [key, blob] of mutation.sources ?? []) store.put(blob, key);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    return promise;
  });
}

/** Metadata and any newly imported originals commit in the same transaction. */
export function updateProjectLibrary(
  update: (library: ProjectLibrary) => ProjectLibrary,
  sources: SourceEntry[] = [],
): Promise<ProjectLibrary> {
  return transactLibrary((library) => {
    if (!library) throw new Error('The project library is unavailable. Your open project has not been changed.');
    return { library: update(library), sources };
  });
}

async function restoreLegacyProject(saved: StoredProject): Promise<ProjectSources> {
  if (saved.version === 3) return { project: validateProject(saved), sources: [] };
  if (saved.version !== 1 && saved.version !== 2) throw new Error('This saved project uses an unsupported format.');

  const assets: ImageAsset[] = [];
  const photos: Photo[] = [];
  const sources: SourceEntry[] = [];
  if (saved.version === 2) {
    for (const legacy of saved.assets) {
      const response = await fetch(legacy.src);
      if (!response.ok) throw new Error(`Could not restore the original photo ${legacy.name}.`);
      const prepared = await prepareAsset(await response.blob(), { id: legacy.id, name: legacy.name });
      assets.push({ ...prepared.asset, naturalWidth: legacy.naturalWidth, naturalHeight: legacy.naturalHeight });
      sources.push([`collage-source:${prepared.asset.id}`, prepared.source], [`collage-preview:${prepared.asset.id}`, prepared.preview]);
    }
    photos.push(...saved.photos);
  } else {
    const bySource = new Map<string, ImageAsset>();
    for (const legacy of saved.photos) {
      let asset = bySource.get(legacy.src);
      if (!asset) {
        const response = await fetch(legacy.src);
        if (!response.ok) throw new Error(`Could not restore the original photo ${legacy.name}.`);
        const prepared = await prepareAsset(await response.blob(), { id: `asset-${legacy.id}`, name: legacy.name });
        asset = { ...prepared.asset, naturalWidth: legacy.naturalWidth, naturalHeight: legacy.naturalHeight };
        bySource.set(legacy.src, asset);
        assets.push(asset);
        sources.push([`collage-source:${asset.id}`, prepared.source], [`collage-preview:${asset.id}`, prepared.preview]);
      }
      photos.push({
        id: legacy.id, assetId: asset.id, x: legacy.x, y: legacy.y, width: legacy.width,
        height: legacy.height, rotation: legacy.rotation, crop: legacy.crop,
        ...(legacy.groupId !== undefined ? { groupId: legacy.groupId } : {}),
        ...(legacy.locked !== undefined ? { locked: legacy.locked } : {}),
        ...(legacy.hidden !== undefined ? { hidden: legacy.hidden } : {}),
      });
    }
  }
  return {
    project: validateProject({
      version: 3, name: saved.name, slides: saved.slides, aspect: saved.aspect,
      background: saved.background, assets, photos,
    }),
    sources,
  };
}

export async function readProjectLibrary(): Promise<ProjectLibrary> {
  const current = await get<unknown>(LIBRARY_KEY);
  if (current !== undefined) return validateLibrary(current);
  const legacy = await get<StoredProject>(LEGACY_KEY);
  const restored = legacy === undefined
    ? { project: { ...initialProject, assets: [], photos: [] }, sources: [] }
    : await restoreLegacyProject(legacy);
  const entry = newSavedProject(restored.project);
  // A failed migration leaves the singleton and all its originals untouched. A
  // concurrent tab that already migrated wins without receiving stale sources.
  return transactLibrary((existing) => existing
    ? { library: existing }
    : { library: { version: 1, currentId: entry.id, projects: [entry] }, sources: restored.sources, removeLegacy: true });
}

/** Run only on initial load; every saved project protects its shared originals. */
export function pruneUnusedSources(): Promise<void> {
  return useStore('readwrite', (store) => {
    const completion = promisifyRequest(store.transaction);
    const request = store.get(LIBRARY_KEY);
    request.onsuccess = () => {
      try {
        const library = validateLibrary(request.result);
        const referenced = new Set(library.projects.flatMap(({ project }) => project.assets.map(({ id }) => id)));
        const keyRequest = store.getAllKeys();
        keyRequest.onsuccess = () => {
          for (const key of keyRequest.result) {
            if (typeof key !== 'string') continue;
            const prefix = key.startsWith('collage-source:') ? 'collage-source:'
              : key.startsWith('collage-preview:') ? 'collage-preview:' : null;
            if (prefix && !referenced.has(key.slice(prefix.length))) store.delete(key);
          }
        };
      } catch {
        store.transaction.abort();
      }
    };
    return completion;
  });
}
