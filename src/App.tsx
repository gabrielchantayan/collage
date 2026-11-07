import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpRight, Check, ChevronDown, Copy, Crop, Download, Eye, EyeOff, Group, ImagePlus, Layers, Loader2, Lock, LockOpen, Minus, Plus, Redo2, Trash2, Undo2, Ungroup, X } from 'lucide-react';
import CollageCanvas, { type CanvasHandle } from './components/CollageCanvas';
import ExportDialog from './components/ExportDialog';
import { IconButton } from './components/Controls';
import ContextMenu, { type MenuAction } from './components/ContextMenu';
import LayersPanel from './components/LayersPanel';
import SelectionToolbar from './components/SelectionToolbar';
import SlideReorder from './components/SlideReorder';
import ProjectManager from './components/ProjectManager';
import PhotoTray, { type ClientPoint } from './components/PhotoTray';
import { MAX_SLIDES, resolvePhotos, SLIDE_WIDTH, slideHeight } from './model';
import type { ImageAsset, Photo, Project } from './model';
import { restorePhotoCrop } from './crop';
import { alignPhotos, selectPhoto } from './selection';
import type { Alignment } from './selection';
import { reorderSlides } from './slides';
import { replacementPatch } from './replacement';
import { useProject } from './useProject';
import { createAsset } from './assets';

const backgrounds = ['#e8e5de', '#ffffff', '#171717', '#cbd3c1', '#d7b4a0', '#b9c9d3'];
const imageAccept = 'image/*,.heic,.heif,image/heic,image/heif';

export default function App() {
  const { project, dispatch, ready, saveState, storageError, canUndo, canRedo, projectId, projects, projectBusy,
    createProject, openProject, renameProject, duplicateProject, deleteProject, exportBackup, importBackup } = useProject();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [zoom, setZoom] = useState(() => window.innerWidth < 700 ? 0.23 : 0.28);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [menu, setMenu] = useState<({ kind: 'asset' | 'photo'; id: string } & ClientPoint) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<{ projectId: string; photoId: string } | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const slideReorderTriggerRef = useRef<HTMLButtonElement>(null);
  const importLock = useRef(false);
  const photos = useMemo(() => resolvePhotos(project), [project.assets, project.photos]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selected = useMemo(() => photos.filter((photo) => selectedSet.has(photo.id) && !photo.locked && !photo.hidden), [photos, selectedSet]);
  const insertedAssetIds = useMemo(() => new Set(project.photos.map((photo) => photo.assetId)), [project.photos]);
  const height = slideHeight(project.aspect);
  const busy = importing || projectBusy;
  const change = useCallback((update: (project: Project) => Project) => dispatch({ type: 'change', update }), [dispatch]);
  const updatePhotos = useCallback((changes: { id: string; patch: Partial<Photo> }[]) => {
    const patches = new Map(changes.map(({ id, patch }) => [id, patch]));
    change((current) => ({ ...current, photos: current.photos.map((photo) => {
      const patch = patches.get(photo.id);
      return patch && !photo.locked && !photo.hidden ? { ...photo, ...patch } : photo;
    }) }));
  }, [change]);
  const updatePhoto = useCallback((id: string, patch: Partial<Photo>) => updatePhotos([{ id, patch }]), [updatePhotos]);
  const selectLayer = useCallback((id: string, additive: boolean) => {
    setSelectedIds((current) => selectPhoto(project.photos, current, id, additive));
  }, [project.photos]);
  const openAssetMenu = useCallback((id: string, point: ClientPoint) => setMenu({ kind: 'asset', id, ...point }), []);
  const openPhotoMenu = useCallback((id: string, point: ClientPoint) => {
    setSelectedIds((current) => current.includes(id) ? current : selectPhoto(project.photos, [], id, false));
    setMenu({ kind: 'photo', id, ...point });
  }, [project.photos]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const insertPhoto = useCallback((assetId: string, point: ClientPoint) => {
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    const ratio = Math.min(800 / asset.naturalWidth, height * 0.78 / asset.naturalHeight);
    const width = asset.naturalWidth * ratio;
    const photoHeight = asset.naturalHeight * ratio;
    const photo: Photo = {
      id: crypto.randomUUID(), assetId, width, height: photoHeight, rotation: 0,
      x: Math.max(0, Math.min(project.slides * SLIDE_WIDTH - width, point.x - width / 2)),
      y: Math.max(0, Math.min(height - photoHeight, point.y - photoHeight / 2)),
      crop: { x: 0, y: 0, width: asset.naturalWidth, height: asset.naturalHeight },
    };
    change((current) => ({ ...current, photos: [...current.photos, photo] }));
    setSelectedIds([photo.id]);
  }, [change, height, project.assets, project.slides]);
  const deletePhotos = useCallback((ids: string[]) => {
    const removed = new Set(ids);
    change((current) => ({ ...current, photos: current.photos.filter((photo) => !removed.has(photo.id) || photo.locked || photo.hidden) }));
    setSelectedIds((current) => current.filter((id) => !removed.has(id)));
  }, [change]);

  useEffect(() => { setSelectedIds([]); setMenu(null); setLayersOpen(false); setSlidesOpen(false); setError(''); }, [projectId]);
  useEffect(() => {
    const editable = new Set(project.photos.filter((photo) => !photo.locked && !photo.hidden).map((photo) => photo.id));
    setSelectedIds((current) => current.every((id) => editable.has(id)) ? current : current.filter((id) => editable.has(id)));
  }, [project.photos]);

  async function importPhotos(files: File[]) {
    if (importLock.current || projectBusy || !ready || !files.length) return;
    importLock.current = true;
    setImporting(true);
    setError('');
    const added: ImageAsset[] = [];
    const failed: string[] = [];
    const quotaFailed: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        try { added.push(await createAsset(file)); }
        catch (cause) {
          if (cause && typeof cause === 'object' && 'name' in cause && (cause.name === 'QuotaExceededError' || cause.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
            quotaFailed.push(...files.slice(index).map((item) => item.name));
            break;
          }
          failed.push(file.name);
        }
      }
      if (added.length) change((current) => ({ ...current, assets: [...current.assets, ...added] }));
      if (quotaFailed.length) setError(`Browser storage full. ${quotaFailed.length} ${quotaFailed.length === 1 ? 'photo was' : 'photos were'} not imported. Existing project kept. Export a backup before clearing browser data, or use smaller files.`);
      else if (failed.length) setError(`Could not open ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}. Supported formats: HEIC, JPEG, PNG, WebP.`);
    } finally { importLock.current = false; setImporting(false); }
  }

  function requestReplacement(id: string) {
    replaceTarget.current = { projectId, photoId: id };
    replaceInputRef.current?.click();
  }

  async function replaceFromFile(file: File) {
    const target = replaceTarget.current;
    const photo = photos.find((item) => item.id === target?.photoId);
    if (!target || target.projectId !== projectId || !photo || photo.locked || photo.hidden || busy || importLock.current) return;
    importLock.current = true;
    setImporting(true);
    setError('');
    try {
      const asset = await createAsset(file);
      const patch = replacementPatch(photo, asset);
      change((current) => ({ ...current, assets: [...current.assets, asset], photos: current.photos.map((item) => item.id === photo.id ? { ...item, ...patch } : item) }));
    } catch (cause) {
      const quota = cause && typeof cause === 'object' && 'name' in cause && (cause.name === 'QuotaExceededError' || cause.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      setError(quota ? 'Browser storage full. Photo not replaced. Export a backup before clearing browser data.' : `Could not replace photo. ${cause instanceof Error ? cause.message : 'Image could not be opened.'}`);
    } finally { importLock.current = false; setImporting(false); }
  }

  function setLayerFlag(id: string, flag: 'locked' | 'hidden', value: boolean) {
    change((current) => {
      const groupId = current.photos.find((photo) => photo.id === id)?.groupId;
      return { ...current, photos: current.photos.map((photo) => photo.id === id || groupId && photo.groupId === groupId ? { ...photo, [flag]: value } : photo) };
    });
  }

  function reorderPhotos(ids: string[], direction: number) {
    const moved = new Set(ids);
    change((current) => {
      const photos = [...current.photos];
      if (direction < 0) {
        for (let index = 1; index < photos.length; index++) {
          if (moved.has(photos[index].id) && !moved.has(photos[index - 1].id)) [photos[index], photos[index - 1]] = [photos[index - 1], photos[index]];
        }
      } else {
        for (let index = photos.length - 2; index >= 0; index--) {
          if (moved.has(photos[index].id) && !moved.has(photos[index + 1].id)) [photos[index], photos[index + 1]] = [photos[index + 1], photos[index]];
        }
      }
      return { ...current, photos };
    });
  }

  function duplicatePhotos(ids: string[]) {
    const copied = new Set(ids);
    const groups = new Map<string, string>();
    const duplicates = project.photos.filter((photo) => copied.has(photo.id) && !photo.locked && !photo.hidden).map((photo) => {
      if (photo.groupId && !groups.has(photo.groupId)) groups.set(photo.groupId, crypto.randomUUID());
      return { ...photo, id: crypto.randomUUID(), x: photo.x + 45, y: photo.y + 45, groupId: photo.groupId ? groups.get(photo.groupId) : undefined };
    });
    if (!duplicates.length) return;
    change((current) => ({ ...current, photos: [...current.photos, ...duplicates] }));
    setSelectedIds(duplicates.map((photo) => photo.id));
  }

  function groupPhotos() {
    const groupId = crypto.randomUUID();
    change((current) => ({ ...current, photos: current.photos.map((photo) => selectedSet.has(photo.id) && !photo.locked && !photo.hidden ? { ...photo, groupId } : photo) }));
  }

  function ungroupPhotos() {
    const groups = new Set(selected.map((photo) => photo.groupId).filter(Boolean));
    change((current) => ({ ...current, photos: current.photos.map((photo) => photo.groupId && groups.has(photo.groupId) ? { ...photo, groupId: undefined } : photo) }));
  }

  function alignSelection(alignment: Alignment) {
    change((current) => ({ ...current, photos: alignPhotos(current.photos, selectedSet, alignment) }));
  }

  function deleteAsset(id: string) {
    const asset = project.assets.find((item) => item.id === id);
    if (!asset) return;
    const count = project.photos.filter((photo) => photo.assetId === id).length;
    if (count && !window.confirm(`Delete "${asset.name}"? This also removes ${count} ${count === 1 ? 'placement' : 'placements'} from the collage.`)) return;
    change((current) => ({ ...current, assets: current.assets.filter((item) => item.id !== id), photos: current.photos.filter((photo) => photo.assetId !== id) }));
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (exporting || menu || !ready || busy || document.querySelector('[role="dialog"]')) return;
      if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select') || event.target.isContentEditable)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (command && event.key.toLowerCase() === 'a') {
        event.preventDefault(); setSelectedIds(project.photos.filter((photo) => !photo.locked && !photo.hidden).map((photo) => photo.id));
      } else if (event.key === 'Escape') { setSelectedIds([]); setLayersOpen(false); }
      else if (event.target instanceof HTMLElement && event.target.closest('button')) return;
      else if (selectedIds.length && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault(); deletePhotos(selectedIds);
      } else if (selectedIds.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        change((current) => ({ ...current, photos: current.photos.map((photo) => !selectedSet.has(photo.id) || photo.locked || photo.hidden ? photo : {
          ...photo, x: photo.x + (event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0),
          y: photo.y + (event.key === 'ArrowDown' ? distance : event.key === 'ArrowUp' ? -distance : 0),
        }) }));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [change, dispatch, deletePhotos, selectedIds, selectedSet, project.photos, exporting, menu, ready, busy]);

  const canBackward = project.photos.some((photo, index) => selectedSet.has(photo.id) && index > 0 && !selectedSet.has(project.photos[index - 1].id));
  const canForward = project.photos.some((photo, index) => selectedSet.has(photo.id) && index < project.photos.length - 1 && !selectedSet.has(project.photos[index + 1].id));
  const menuPhoto = menu?.kind === 'photo' ? photos.find((photo) => photo.id === menu.id) : undefined;
  let menuActions: MenuAction[] = [];
  if (menu?.kind === 'asset') {
    const id = menu.id;
    const asset = project.assets.find((item) => item.id === id);
    menuActions = [{ label: 'Insert photo', icon: Plus, onSelect: () => { canvasRef.current?.insertAsset(id); } }];
    if (selected.length === 1 && asset) menuActions.push({ label: 'Replace selected photo', icon: ImagePlus, disabled: selected[0].assetId === id, onSelect: () => updatePhoto(selected[0].id, replacementPatch(selected[0], asset)) });
    menuActions.push({ label: 'Delete uploaded photo', icon: Trash2, danger: true, onSelect: () => deleteAsset(id) });
  } else if (menuPhoto) {
    const id = menuPhoto.id;
    const ids = selectedSet.has(id) ? selected.map((photo) => photo.id) : [id];
    const editable = !menuPhoto.locked && !menuPhoto.hidden;
    menuActions = [
      { label: ids.length > 1 ? 'Duplicate selection' : 'Duplicate photo', icon: Copy, disabled: !editable, onSelect: () => duplicatePhotos(ids) },
      { label: 'Bring forward', icon: ArrowUp, disabled: !editable || !canForward, onSelect: () => reorderPhotos(ids, 1) },
      { label: 'Send backward', icon: ArrowDown, disabled: !editable || !canBackward, onSelect: () => reorderPhotos(ids, -1) },
    ];
    if (ids.length === 1) menuActions.push(
      { label: 'Replace photo…', icon: ImagePlus, disabled: !editable, onSelect: () => requestReplacement(id) },
      { label: 'Reset crop', icon: Crop, disabled: !editable || (menuPhoto.crop.x === 0 && menuPhoto.crop.y === 0 && menuPhoto.crop.width === menuPhoto.naturalWidth && menuPhoto.crop.height === menuPhoto.naturalHeight), onSelect: () => updatePhoto(id, restorePhotoCrop(menuPhoto)) },
    );
    if (ids.length > 1 && !(menuPhoto.groupId && selected.every((photo) => photo.groupId === menuPhoto.groupId))) menuActions.push({ label: 'Group photos', icon: Group, onSelect: groupPhotos });
    if (menuPhoto.groupId) menuActions.push({ label: 'Ungroup photos', icon: Ungroup, onSelect: ungroupPhotos, disabled: !editable });
    menuActions.push(
      { label: `${menuPhoto.locked ? 'Unlock' : 'Lock'} ${menuPhoto.groupId ? 'group' : 'photo'}`, icon: menuPhoto.locked ? LockOpen : Lock, onSelect: () => setLayerFlag(id, 'locked', !menuPhoto.locked) },
      { label: `${menuPhoto.hidden ? 'Show' : 'Hide'} ${menuPhoto.groupId ? 'group' : 'photo'}`, icon: menuPhoto.hidden ? Eye : EyeOff, onSelect: () => setLayerFlag(id, 'hidden', !menuPhoto.hidden) },
      { label: ids.length > 1 ? 'Delete selection' : 'Delete photo', icon: Trash2, danger: true, disabled: !editable, onSelect: () => deletePhotos(ids) },
    );
  }

  if (!ready) return storageError
    ? <div className="loading-screen"><section className="load-error" role="alert"><h1>Could not open saved project</h1><p>{storageError}</p><button onClick={() => window.location.reload()}>Reload</button></section></div>
    : <div className="loading-screen"><Loader2 className="spin" size={22} /><span>Opening project…</span></div>;

  return <div className="app-shell" onDragOver={(event) => { if (!busy && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropActive(true); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }}
    onDrop={(event) => { event.preventDefault(); setDropActive(false); void importPhotos(Array.from(event.dataTransfer.files)); }}>
    <input ref={inputRef} type="file" accept={imageAccept} multiple className="file-input" aria-label="Upload photos"
      onChange={(event) => { void importPhotos(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <input ref={replaceInputRef} type="file" accept={imageAccept} className="file-input" aria-label="Replace photo"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void replaceFromFile(file); event.target.value = ''; }} />
    <header className="app-header">
      <a className="wordmark" href="./" aria-label="Collage home"><span className="brand-mark"><i /><i /><i /></span>collage<span className="brand-period">.</span></a>
      <div className="project-title"><input aria-label="Project name" value={project.name} maxLength={80} disabled={busy}
        onChange={(event) => change((current) => ({ ...current, name: event.target.value }))} /></div>
      <div className="header-actions">
        <ProjectManager projects={projects} currentId={projectId} disabled={busy || exporting} onOpen={openProject} onCreate={createProject} onRename={renameProject} onDuplicate={duplicateProject} onDelete={deleteProject} onExport={exportBackup} onImport={importBackup} onError={setError} />
        <span className={`save-status ${saveState === 'error' ? 'save-error' : ''}`}><span />{projectBusy ? 'Opening…' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved on this device'}</span>
        <button className="primary export-button" onClick={() => setExporting(true)} disabled={busy}><Download size={16} />Export<span className="export-arrow"><ArrowUpRight size={16} /></span></button>
      </div>
    </header>
    <div className="editor-layout" inert={projectBusy || undefined}>
      <aside className="sidebar">
        <section className="settings-section">
          <div className="section-label">Layout</div>
          <label className="select-field"><span>Format</span><div><select aria-label="Slide format" value={project.aspect} onChange={(event) => change((current) => ({ ...current, aspect: event.target.value as Project['aspect'] }))}><option value="portrait">Portrait · 4:5</option><option value="square">Square · 1:1</option></select><ChevronDown size={13} /></div></label>
          <div className="slide-count"><span>Slides</span><div><IconButton label="Remove slide" disabled={project.slides <= 1} onClick={() => change((current) => ({ ...current, slides: current.slides - 1 }))}><Minus size={14} /></IconButton><output aria-label="Slide count">{String(project.slides).padStart(2, '0')}</output><IconButton label="Add slide" disabled={project.slides >= MAX_SLIDES} onClick={() => change((current) => ({ ...current, slides: current.slides + 1 }))}><Plus size={14} /></IconButton></div></div>
        </section>
        <section className="settings-section background-section"><div className="section-label">Background</div><div className="swatches">{backgrounds.map((color) => <button key={color} aria-label={`Background ${color}`} aria-pressed={project.background === color} className="swatch" style={{ background: color }} onClick={() => change((current) => ({ ...current, background: color }))}>{project.background === color && <Check size={15} color={color === '#171717' ? '#eee' : '#222'} />}</button>)}<label className="custom-swatch" title="Custom background"><Plus size={14} /><input type="color" aria-label="Custom background color" value={project.background} onChange={(event) => change((current) => ({ ...current, background: event.target.value }))} /></label></div><button className="mobile-layer-toggle" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)}><Layers size={14} />Layers</button></section>
        <section className={`settings-section photos-section ${layersOpen ? 'mobile-open' : ''}`}><div className="section-label section-label-row"><span>Layers</span><span>{String(project.photos.length).padStart(2, '0')}</span>{layersOpen && <IconButton label="Close layers" onClick={() => setLayersOpen(false)}><X size={14} /></IconButton>}</div>
          <LayersPanel photos={photos} selectedIds={selectedSet} multiSelect={multiSelect} onSelect={selectLayer} onContextMenu={openPhotoMenu} onToggleLock={(photo) => setLayerFlag(photo.id, 'locked', !photo.locked)} onToggleHidden={(photo) => setLayerFlag(photo.id, 'hidden', !photo.hidden)} />
        </section>
      </aside>
      <main className="workspace" ref={workspaceRef}>
        <div className="workspace-toolbar">
          <div className="editor-mode"><span className="workspace-breadcrumb">Editor</span><button className="multi-select-toggle" aria-pressed={multiSelect} onClick={() => setMultiSelect(!multiSelect)}><Copy size={13} />Multi-select</button>
            <button ref={slideReorderTriggerRef} className="slide-reorder-trigger" disabled={busy} aria-label="Reorder slides" title="Reorder slides"
              aria-controls="slide-reorder" aria-expanded={slidesOpen} onClick={() => setSlidesOpen(!slidesOpen)}><ArrowLeftRight size={14} /><span>Reorder slides</span></button>
          </div>
          <div className="history-actions"><IconButton label="Undo (⌘Z)" disabled={!canUndo || busy} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={16} /></IconButton><IconButton label="Redo (⇧⌘Z)" disabled={!canRedo || busy} onClick={() => dispatch({ type: 'redo' })}><Redo2 size={16} /></IconButton><span className="toolbar-divider" /><span className="dimensions">1080 × {height}</span></div>
        </div>
        {slidesOpen && <SlideReorder slides={project.slides} disabled={busy} onReorder={(from, to) => change((current) => reorderSlides(current, from, to))}
          onClose={() => { setSlidesOpen(false); slideReorderTriggerRef.current?.focus(); }} />}
        {(error || storageError) && <div className="error-banner" role="alert"><span>{error || storageError}</span>{error && <IconButton label="Dismiss error" onClick={() => setError('')}><X size={14} /></IconButton>}</div>}
        <div className="canvas-area"><div className="canvas-heading"><span>{project.slides} slides · {project.aspect === 'portrait' ? '4:5' : '1:1'}</span></div>
          <CollageCanvas key={projectId} ref={canvasRef} project={project} photos={photos} selectedIds={selectedIds} onSelect={setSelectedIds} onPhotosChange={updatePhotos} multiSelect={multiSelect} onContextMenu={openPhotoMenu} zoom={zoom} onZoomChange={setZoom} onInsert={insertPhoto} />
          {project.photos.length === 0 && project.assets.length === 0 && <div className="empty-prompt"><button className="primary" onClick={() => inputRef.current?.click()} disabled={busy}>{importing ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{importing ? 'Uploading…' : 'Upload photos'}</button><span className="empty-drop">or drop images here</span></div>}
        </div>
        <SelectionToolbar photos={selected} canBackward={canBackward} canForward={canForward} onChange={updatePhoto} onAlign={alignSelection} onGroup={groupPhotos} onUngroup={ungroupPhotos} onDuplicate={() => duplicatePhotos(selectedIds)} onDelete={() => deletePhotos(selectedIds)} onReplace={() => { if (selected.length === 1) requestReplacement(selected[0].id); }} onReorder={(direction) => reorderPhotos(selectedIds, direction)} />
        <PhotoTray key={projectId} assets={project.assets} insertedAssetIds={insertedAssetIds} importing={importing} onUpload={() => inputRef.current?.click()} onInsert={(id) => { canvasRef.current?.insertAsset(id); }} onDrop={(id, point) => { canvasRef.current?.insertAsset(id, point); }} onDelete={deleteAsset} onContextMenu={openAssetMenu} />
        <footer className="workspace-footer"><span><Layers size={14} />{project.photos.length} {project.photos.length === 1 ? 'photo' : 'photos'}<span className="footer-dot">·</span>Local storage</span><div className="zoom-controls"><IconButton label="Zoom out" disabled={zoom <= 0.1} onClick={() => setZoom(Math.max(0.1, zoom - 0.05))}><Minus size={14} /></IconButton><label><input aria-label="Canvas zoom" type="range" min="10" max="100" value={Math.round(zoom * 100)} onChange={(event) => setZoom(Number(event.target.value) / 100)} /></label><output>{Math.round(zoom * 100)}%</output><IconButton label="Zoom in" disabled={zoom >= 1} onClick={() => setZoom(Math.min(1, zoom + 0.05))}><Plus size={14} /></IconButton><button className="fit-button" onClick={() => setZoom(Math.max(0.1, Math.min(0.65, ((workspaceRef.current?.clientWidth ?? 1000) - 96) / (SLIDE_WIDTH * project.slides))))}>Fit</button></div></footer>
      </main>
    </div>
    {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
    {menu && menuActions.length > 0 && <ContextMenu key={`${menu.kind}:${menu.id}`} point={menu} actions={menuActions} onClose={closeMenu} />}
    {dropActive && <div className="drop-overlay"><ImagePlus size={40} /><strong>Drop images to add photos</strong></div>}
  </div>;
}
