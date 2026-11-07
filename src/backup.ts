import JSZip from 'jszip';
import { prepareAsset, readSource } from './assets';
import type { Project } from './model';
import { validateProject } from './storage';
import type { ProjectSources } from './storage';

interface BackupSource {
  assetId: string;
  path: string;
  type: string;
}

interface BackupManifest {
  format: 'collage-backup';
  version: 1;
  project: Project;
  sources: BackupSource[];
}

export async function downloadBackup(project: Project): Promise<void> {
  const zip = new JSZip();
  const sources: BackupSource[] = [];
  // Include the whole photo library, including photos not placed on any slide.
  for (const [index, asset] of project.assets.entries()) {
    const source = await readSource(asset.id);
    const path = `sources/${index + 1}.bin`;
    zip.file(path, source);
    sources.push({ assetId: asset.id, path, type: source.type });
  }
  const manifest: BackupManifest = { format: 'collage-backup', version: 1, project, sources };
  zip.file('project.json', JSON.stringify(manifest));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const name = project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'collage';
  anchor.href = url;
  anchor.download = `${name}-backup.zip`;
  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Decode everything before the caller atomically commits sources and metadata. */
export async function readBackup(file: File): Promise<ProjectSources> {
  let zip: JSZip;
  let raw: unknown;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
    const entry = zip.file('project.json');
    if (!entry) throw new Error('Missing project.json.');
    raw = JSON.parse(await entry.async('string'));
  } catch {
    throw new Error('This file is not a readable collage backup ZIP.');
  }
  if (typeof raw !== 'object' || raw === null || !('format' in raw) || raw.format !== 'collage-backup'
    || !('version' in raw) || raw.version !== 1 || !('project' in raw) || !('sources' in raw) || !Array.isArray(raw.sources)) {
    throw new Error('This file uses an unsupported collage backup format.');
  }
  const project = validateProject(raw.project);
  const sourceFiles = new Map<string, BackupSource>();
  const paths = new Set<string>();
  for (const item of raw.sources) {
    if (typeof item !== 'object' || item === null || typeof item.assetId !== 'string'
      || typeof item.path !== 'string' || !/^sources\/[^/]+$/.test(item.path)
      || item.path.includes('\\') || item.path === 'sources/..' || item.path === 'sources/.'
      || typeof item.type !== 'string' || sourceFiles.has(item.assetId) || paths.has(item.path)) {
      throw new Error('The backup contains invalid or duplicate source references.');
    }
    sourceFiles.set(item.assetId, { assetId: item.assetId, path: item.path, type: item.type });
    paths.add(item.path);
  }
  if (sourceFiles.size !== project.assets.length) throw new Error('The backup does not contain exactly one original for each photo.');

  const remapped = new Map<string, string>();
  const assets: Project['assets'] = [];
  const sources: ProjectSources['sources'] = [];
  for (const asset of project.assets) {
    const sourceFile = sourceFiles.get(asset.id);
    const entry = sourceFile && zip.file(sourceFile.path);
    if (!sourceFile || !entry) throw new Error(`The backup is missing the original photo ${asset.name}.`);
    const source = new Blob([await entry.async('arraybuffer')], { type: sourceFile.type });
    if (!source.size) throw new Error(`The backup contains an empty original photo ${asset.name}.`);
    const id = crypto.randomUUID();
    const prepared = await prepareAsset(source, { id, name: asset.name });
    if (prepared.asset.naturalWidth !== asset.naturalWidth || prepared.asset.naturalHeight !== asset.naturalHeight) {
      throw new Error(`The original photo ${asset.name} does not match its saved dimensions.`);
    }
    remapped.set(asset.id, id);
    assets.push({ ...asset, ...prepared.asset });
    sources.push([`collage-source:${id}`, prepared.source], [`collage-preview:${id}`, prepared.preview]);
  }
  return {
    project: { ...project, assets, photos: project.photos.map((photo) => ({ ...photo, assetId: remapped.get(photo.assetId)! })) },
    sources,
  };
}
