import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Copy, Crop, Download, ImagePlus, Layers, Loader2, Minus, Plus, Redo2, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import CollageCanvas, { type CanvasHandle } from './components/CollageCanvas';
import ExportDialog from './components/ExportDialog';
import { IconButton, NumberField } from './components/Controls';
import ContextMenu, { type MenuAction } from './components/ContextMenu';
import { initialProject, MAX_SLIDES, resolvePhotos, SLIDE_WIDTH, slideHeight } from './model';
import type { ImageAsset, Photo, Project } from './model';
import { cropPhotoEdge, restorePhotoCrop } from './crop';
import { useProject } from './useProject';
import PhotoTray, { type ClientPoint } from './components/PhotoTray';
import { createAsset } from './assets';

const backgrounds = ['#e8e5de', '#ffffff', '#171717', '#cbd3c1', '#d7b4a0', '#b9c9d3'];


export default function App() {
  const { project, dispatch, ready, saveState, storageError, canUndo, canRedo } = useProject();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [zoom, setZoom] = useState(() => window.innerWidth < 700 ? 0.23 : 0.28);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [menu, setMenu] = useState<({ kind: 'asset' | 'photo'; id: string } & ClientPoint) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const importLock = useRef(false);
  const photos = useMemo(() => resolvePhotos(project), [project.assets, project.photos]);
  const insertedAssetIds = useMemo(() => new Set(project.photos.map((photo) => photo.assetId)), [project.photos]);
  const selected = photos.find((photo) => photo.id === selectedId);
  const height = slideHeight(project.aspect);
  const change = useCallback((update: (project: Project) => Project) => dispatch({ type: 'change', update }), [dispatch]);
  const updatePhoto = useCallback((id: string, patch: Partial<Photo>) => {
    change((current) => ({ ...current, photos: current.photos.map((photo) => photo.id === id ? { ...photo, ...patch } : photo) }));
  }, [change]);
  const deletePhoto = useCallback((id: string) => {
    change((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== id) }));
    setSelectedId((current) => current === id ? null : current);
  }, [change]);
  const openAssetMenu = useCallback((id: string, point: ClientPoint) => setMenu({ kind: 'asset', id, ...point }), []);
  const openPhotoMenu = useCallback((id: string, point: ClientPoint) => {
    setSelectedId(id);
    setMenu({ kind: 'photo', id, ...point });
  }, []);
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
    setSelectedId(photo.id);
  }, [change, height, project.assets, project.slides]);

  async function importPhotos(files: File[]) {
    if (importLock.current || !ready || !files.length) return;
    importLock.current = true;
    setImporting(true);
    setError('');
    const added: ImageAsset[] = [];
    const failed: string[] = [];
    const quotaFailed: string[] = [];
    for (const [index, file] of files.entries()) {
      try {
        added.push(await createAsset(file));
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'name' in cause && (cause.name === 'QuotaExceededError' || cause.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          quotaFailed.push(...files.slice(index).map((item) => item.name));
          break;
        }
        failed.push(file.name);
      }
    }
    if (added.length) {
      change((current) => ({ ...current, assets: [...current.assets, ...added] }));
    }
    if (quotaFailed.length) setError(`Browser storage full. ${quotaFailed.length} ${quotaFailed.length === 1 ? 'photo was' : 'photos were'} not imported. Existing project kept. Export before clearing browser data, or use smaller files.`);
    else if (failed.length) setError(`Could not open ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}. Supported formats: HEIC, JPEG, PNG, WebP.`);
    importLock.current = false;
    setImporting(false);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (exporting || resetOpen || menu || !ready || importing) return;
      if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, button') || event.target.isContentEditable)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (selectedId && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deletePhoto(selectedId);
      } else if (event.key === 'Escape') setSelectedId(null);
      else if (selectedId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        change((current) => ({ ...current, photos: current.photos.map((photo) => photo.id !== selectedId ? photo : {
          ...photo, x: photo.x + (event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0),
          y: photo.y + (event.key === 'ArrowDown' ? distance : event.key === 'ArrowUp' ? -distance : 0),
        }) }));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [change, dispatch, deletePhoto, selectedId, exporting, resetOpen, menu, ready, importing]);

  function reorder(id: string, direction: number) {
    change((current) => {
      const photos = [...current.photos];
      const index = photos.findIndex((photo) => photo.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= photos.length) return current;
      [photos[index], photos[destination]] = [photos[destination], photos[index]];
      return { ...current, photos };
    });
  }

  function duplicatePhoto(id: string) {
    const photo = project.photos.find((item) => item.id === id);
    if (!photo) return;
    const duplicate = { ...photo, id: crypto.randomUUID(), x: photo.x + 45, y: photo.y + 45 };
    change((current) => ({ ...current, photos: [...current.photos, duplicate] }));
    setSelectedId(duplicate.id);
  }

  function deleteAsset(id: string) {
    const asset = project.assets.find((item) => item.id === id);
    if (!asset) return;
    const count = project.photos.filter((photo) => photo.assetId === id).length;
    if (count && !window.confirm(`Delete "${asset.name}"? This also removes ${count} ${count === 1 ? 'placement' : 'placements'} from the collage.`)) return;
    change((current) => ({
      ...current,
      assets: current.assets.filter((item) => item.id !== id),
      photos: current.photos.filter((photo) => photo.assetId !== id),
    }));
    if (selected?.assetId === id) setSelectedId(null);
  }

  const menuPhoto = menu?.kind === 'photo' ? photos.find((photo) => photo.id === menu.id) : undefined;
  let menuActions: MenuAction[] = [];
  if (menu?.kind === 'asset') {
    const id = menu.id;
    menuActions = [
      { label: 'Insert photo', icon: Plus, onSelect: () => { canvasRef.current?.insertAsset(id); } },
      { label: 'Delete uploaded photo', icon: Trash2, danger: true, onSelect: () => deleteAsset(id) },
    ];
  } else if (menuPhoto) {
    const id = menuPhoto.id;
    menuActions = [
      { label: 'Duplicate photo', icon: Copy, onSelect: () => duplicatePhoto(id) },
      { label: 'Bring forward', icon: ArrowUp, disabled: project.photos.at(-1)?.id === id, onSelect: () => reorder(id, 1) },
      { label: 'Send backward', icon: ArrowDown, disabled: project.photos[0]?.id === id, onSelect: () => reorder(id, -1) },
      { label: 'Reset crop', icon: Crop, disabled: menuPhoto.crop.x === 0 && menuPhoto.crop.y === 0 && menuPhoto.crop.width === menuPhoto.naturalWidth && menuPhoto.crop.height === menuPhoto.naturalHeight, onSelect: () => updatePhoto(id, restorePhotoCrop(menuPhoto)) },
      { label: 'Delete photo', icon: Trash2, danger: true, onSelect: () => deletePhoto(id) },
    ];
  }

  if (!ready) return storageError
    ? <div className="loading-screen"><section className="load-error" role="alert"><h1>Could not open saved project</h1><p>{storageError}</p><button onClick={() => window.location.reload()}>Reload</button></section></div>
    : <div className="loading-screen"><Loader2 className="spin" size={22} /><span>Opening project…</span></div>;

  return <div className="app-shell" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropActive(true); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }}
    onDrop={(event) => { event.preventDefault(); setDropActive(false); void importPhotos(Array.from(event.dataTransfer.files)); }}>
    <input ref={inputRef} type="file" accept="image/*,.heic,.heif,image/heic,image/heif" multiple className="file-input" aria-label="Upload photos"
      onChange={(event) => { void importPhotos(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <header className="app-header">
      <a className="wordmark" href="./" aria-label="Collage home"><span className="brand-mark"><i /><i /><i /></span>collage<span className="brand-period">.</span></a>
      <div className="project-title"><input aria-label="Project name" value={project.name} maxLength={80}
        onChange={(event) => change((current) => ({ ...current, name: event.target.value }))} /><span className="draft-tag">LOCAL PROJECT</span></div>
      <div className="header-actions"><span className={`save-status ${saveState === 'error' ? 'save-error' : ''}`}><span />{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved on this device'}</span>
        <button className="primary export-button" onClick={() => setExporting(true)} disabled={importing}><Download size={16} />Export<span className="export-arrow"><ArrowUpRight size={16} /></span></button>
      </div>
    </header>

    <div className="editor-layout">
      <aside className="sidebar">
        <section className="settings-section">
          <div className="section-label">Layout</div>
          <label className="select-field"><span>Format</span><div><select aria-label="Slide format" value={project.aspect} onChange={(event) => change((current) => ({ ...current, aspect: event.target.value as Project['aspect'] }))}><option value="portrait">Portrait · 4:5</option><option value="square">Square · 1:1</option></select><ChevronDown size={13} /></div></label>
          <div className="slide-count"><span>Slides</span><div><IconButton label="Remove slide" disabled={project.slides <= 1} onClick={() => change((current) => ({ ...current, slides: current.slides - 1 }))}><Minus size={14} /></IconButton><output aria-label="Slide count">{String(project.slides).padStart(2, '0')}</output><IconButton label="Add slide" disabled={project.slides >= MAX_SLIDES} onClick={() => change((current) => ({ ...current, slides: current.slides + 1 }))}><Plus size={14} /></IconButton></div></div>
        </section>
        <section className="settings-section background-section"><div className="section-label">Background</div><div className="swatches">{backgrounds.map((color) => <button key={color} aria-label={`Background ${color}`} aria-pressed={project.background === color} className="swatch" style={{ background: color }} onClick={() => change((current) => ({ ...current, background: color }))}>{project.background === color && <Check size={15} color={color === '#171717' ? '#eee' : '#222'} />}</button>)}<label className="custom-swatch" title="Custom background"><Plus size={14} /><input type="color" aria-label="Custom background color" value={project.background} onChange={(event) => change((current) => ({ ...current, background: event.target.value }))} /></label></div></section>
        <section className="settings-section photos-section"><div className="section-label section-label-row"><span>Layers</span><span>{String(project.photos.length).padStart(2, '0')}</span></div>
          {photos.length > 0 && <div className="photo-list">{[...photos].reverse().map((photo, index) => <button className={`photo-item ${selectedId === photo.id ? 'selected' : ''}`} key={photo.id} onClick={() => setSelectedId(photo.id)} onContextMenu={(event) => { event.preventDefault(); openPhotoMenu(photo.id, { x: event.clientX, y: event.clientY }); }}><img src={photo.thumbnail} alt="" /><span>{photo.name}</span><span className="photo-layer">{String(photos.length - index).padStart(2, '0')}</span></button>)}</div>}
        </section>
        <div className="sidebar-bottom"><button className="text-button" onClick={() => setResetOpen(true)}><RotateCcw size={13} />New collage</button></div>
      </aside>

      <main className="workspace" ref={workspaceRef}>
        <div className="workspace-toolbar"><span className="workspace-breadcrumb">Editor</span><div className="history-actions"><IconButton label="Undo (⌘Z)" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={16} /></IconButton><IconButton label="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => dispatch({ type: 'redo' })}><Redo2 size={16} /></IconButton><span className="toolbar-divider" /><span className="dimensions">1080 × {height}</span></div></div>
        {(error || storageError) && <div className="error-banner" role="alert"><span>{error || storageError}</span>{error && <IconButton label="Dismiss error" onClick={() => setError('')}><X size={14} /></IconButton>}</div>}
        <div className="canvas-area"><div className="canvas-heading"><span>{project.slides} slides · {project.aspect === 'portrait' ? '4:5' : '1:1'}</span></div>
          <CollageCanvas ref={canvasRef} project={project} photos={photos} selectedId={selectedId} onSelect={setSelectedId} onPhotoChange={updatePhoto} onContextMenu={openPhotoMenu} zoom={zoom} onZoomChange={setZoom} onInsert={insertPhoto} />
          {project.photos.length === 0 && project.assets.length === 0 && <div className="empty-prompt"><button className="primary" onClick={() => inputRef.current?.click()} disabled={importing}>{importing ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{importing ? 'Uploading…' : 'Upload photos'}</button><span className="empty-drop">or drop images here</span></div>}
        </div>
        {selected && <div className="selection-toolbar" aria-label="Photo tools">
          <span className="selected-name">{selected.name}</span>
          <span className="crop-help">Edges crop · corners resize</span>
          <button onClick={() => updatePhoto(selected.id, restorePhotoCrop(selected))} disabled={selected.crop.x === 0 && selected.crop.y === 0 && selected.crop.width === selected.naturalWidth && selected.crop.height === selected.naturalHeight}><Crop size={14} />Reset crop</button>
          <NumberField label="Crop width" value={selected.width} min={30} max={(selected.naturalWidth - selected.crop.x) * selected.width / selected.crop.width} suffix="px" onCommit={(width) => updatePhoto(selected.id, cropPhotoEdge(selected, 'right', width - selected.width))} />
          <NumberField label="Crop height" value={selected.height} min={30} max={(selected.naturalHeight - selected.crop.y) * selected.height / selected.crop.height} suffix="px" onCommit={(height) => updatePhoto(selected.id, cropPhotoEdge(selected, 'bottom', height - selected.height))} />
          <NumberField label="Rotation" value={selected.rotation} min={-360} max={360} suffix="°" onCommit={(rotation) => updatePhoto(selected.id, { rotation })} />
          <div className="layer-actions">
            <IconButton label="Send backward" disabled={project.photos[0].id === selected.id} onClick={() => reorder(selected.id, -1)}><ArrowDown size={15} /></IconButton>
            <IconButton label="Bring forward" disabled={project.photos.at(-1)?.id === selected.id} onClick={() => reorder(selected.id, 1)}><ArrowUp size={15} /></IconButton>
            <IconButton label="Duplicate photo" onClick={() => duplicatePhoto(selected.id)}><Copy size={15} /></IconButton>
            <IconButton label="Delete photo" onClick={() => deletePhoto(selected.id)}><Trash2 size={15} /></IconButton>
          </div>
        </div>}
        <PhotoTray assets={project.assets} insertedAssetIds={insertedAssetIds} importing={importing} onUpload={() => inputRef.current?.click()} onInsert={(id) => { canvasRef.current?.insertAsset(id); }} onDrop={(id, point) => { canvasRef.current?.insertAsset(id, point); }} onDelete={deleteAsset} onContextMenu={openAssetMenu} />
        <footer className="workspace-footer"><span><Layers size={14} />{project.photos.length} {project.photos.length === 1 ? 'photo' : 'photos'}<span className="footer-dot">·</span>Local storage</span><div className="zoom-controls"><IconButton label="Zoom out" disabled={zoom <= 0.1} onClick={() => setZoom(Math.max(0.1, zoom - 0.05))}><Minus size={14} /></IconButton><label><input aria-label="Canvas zoom" type="range" min="10" max="100" value={Math.round(zoom * 100)} onChange={(event) => setZoom(Number(event.target.value) / 100)} /></label><output>{Math.round(zoom * 100)}%</output><IconButton label="Zoom in" disabled={zoom >= 1} onClick={() => setZoom(Math.min(1, zoom + 0.05))}><Plus size={14} /></IconButton><button className="fit-button" onClick={() => setZoom(Math.max(0.1, Math.min(0.65, ((workspaceRef.current?.clientWidth ?? 1000) - 96) / (SLIDE_WIDTH * project.slides))))}>Fit</button></div></footer>
      </main>
    </div>
    {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
    {menu && menuActions.length > 0 && <ContextMenu key={`${menu.kind}:${menu.id}`} point={menu} actions={menuActions} onClose={closeMenu} />}
    {resetOpen && <div className="modal-backdrop" onClick={() => setResetOpen(false)}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setResetOpen(false); }}><h2 id="reset-title">New collage?</h2><p>Replaces the current collage. Export first, or use Undo to restore it.</p><div className="dialog-actions"><button autoFocus onClick={() => setResetOpen(false)}>Cancel</button><button className="primary" onClick={() => { change(() => ({ ...initialProject, photos: [] })); setSelectedId(null); setResetOpen(false); }}>New collage</button></div></section></div>}
    {dropActive && <div className="drop-overlay"><ImagePlus size={40} /><strong>Drop images to add photos</strong></div>}
  </div>;
}
