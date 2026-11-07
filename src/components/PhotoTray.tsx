import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react';
import type { ImageAsset } from '../model';
import './PhotoTray.css';

export const ASSET_DRAG_TYPE = 'application/x-collage-asset';
export interface ClientPoint { x: number; y: number }
interface Props {
  assets: ImageAsset[];
  insertedAssetIds: ReadonlySet<string>;
  importing: boolean;
  onUpload: () => void;
  onInsert: (id: string) => void;
  onDrop: (id: string, point: ClientPoint) => void;
  onDelete: (id: string) => void;
  onContextMenu: (id: string, point: ClientPoint) => void;
}

type SortBy = 'upload' | 'filename' | 'taken';
const filenameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareAssets(a: ImageAsset, b: ImageAsset, sortBy: SortBy, descending: boolean): number {
  const direction = descending ? -1 : 1;
  if (sortBy === 'filename') return direction * filenameOrder.compare(a.name, b.name);
  const first = sortBy === 'taken' ? a.takenAt : a.addedAt;
  const second = sortBy === 'taken' ? b.takenAt : b.addedAt;
  const firstMissing = first === undefined || !Number.isFinite(first);
  const secondMissing = second === undefined || !Number.isFinite(second);
  if (firstMissing && secondMissing) return 0;
  // Legacy uploads precede timestamped uploads; unknown capture dates always go last.
  if (firstMissing) return sortBy === 'taken' ? 1 : -direction;
  if (secondMissing) return sortBy === 'taken' ? -1 : direction;
  return direction * (first! - second!);
}

export default function PhotoTray({ assets, insertedAssetIds, importing, onUpload, onInsert, onDrop, onDelete, onContextMenu }: Props) {
  const touch = useRef<{ id: string; x: number; y: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{ asset: ImageAsset; x: number; y: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [viewport, setViewport] = useState({ width: 800, stride: 102, cell: 92 });
  const [showInserted, setShowInserted] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('upload');
  const [descending, setDescending] = useState(false);
  const visibleAssets = useMemo(() => {
    const filtered = showInserted ? [...assets] : assets.filter((asset) => !insertedAssetIds.has(asset.id));
    // Array.sort is stable, so ties retain project upload order in either direction.
    return filtered.sort((a, b) => compareAssets(a, b, sortBy, descending));
  }, [assets, insertedAssetIds, showInserted, sortBy, descending]);
  const start = Math.max(0, Math.floor(scroll / viewport.stride) - 2);
  const end = Math.min(visibleAssets.length, Math.ceil((scroll + viewport.width) / viewport.stride) + 2);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const styles = getComputedStyle(element);
      const cell = Number.parseFloat(styles.getPropertyValue('--tray-cell'));
      const stride = cell + Number.parseFloat(styles.getPropertyValue('--tray-gap'));
      setViewport((previous) => previous.width === element.clientWidth && previous.stride === stride ? previous : { width: element.clientWidth, stride, cell });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
    setScroll(0);
  }, [showInserted, sortBy, descending]);
  useLayoutEffect(() => { if (viewportRef.current) setScroll(viewportRef.current.scrollLeft); }, [visibleAssets.length]);
  return <section className="photo-tray" aria-label="Photo library">
    <header className="tray-header"><span>Photos <span className="tray-count">{visibleAssets.length}</span></span>
      <div className="tray-header-actions">
        <select className="tray-sort" aria-label="Sort photos" value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
          <option value="upload">Upload order</option>
          <option value="filename">Filename</option>
          <option value="taken">Date taken</option>
        </select>
        <button className="tray-sort-direction" aria-label={descending ? 'Sort ascending' : 'Sort descending'} title={descending ? 'Descending' : 'Ascending'} onClick={() => setDescending((value) => !value)}>
          {descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
        </button>
        <label className="tray-filter"><input type="checkbox" checked={showInserted} onChange={(event) => setShowInserted(event.target.checked)} />Show inserted</label>
        <button onClick={onUpload} disabled={importing}>{importing ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}{importing ? 'Uploading…' : 'Upload'}</button>
      </div>
    </header>
    <div className="tray-scroll" ref={viewportRef} tabIndex={0} aria-label="Photo tray" onScroll={(event) => setScroll(event.currentTarget.scrollLeft)}>
      {assets.length === 0 && <button className="tray-upload" onClick={onUpload} disabled={importing}><ImagePlus size={20} /><span>Upload photos</span></button>}
      {assets.length > 0 && visibleAssets.length === 0 && <p className="tray-empty">All photos inserted</p>}
      {visibleAssets.length > 0 && <div className="tray-track" style={{ width: Math.max(viewport.width, visibleAssets.length * viewport.stride - (viewport.stride - viewport.cell)) }}>
      {visibleAssets.slice(start, end).map((asset, index) => <div className="tray-asset" key={asset.id} style={{ left: (start + index) * viewport.stride }}
        onContextMenu={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onContextMenu(asset.id, { x: event.clientX || rect.left, y: event.clientY || rect.top });
        }}>
        <button className="tray-thumbnail" aria-label={`Insert ${asset.name}`} title={`Drag or click to insert ${asset.name}`} draggable
          onDragStart={(event) => { event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id); event.dataTransfer.effectAllowed = 'copy'; }}
          onClick={() => { if (!suppressClick.current) onInsert(asset.id); suppressClick.current = false; }}
          onPointerDown={(event) => {
            suppressClick.current = false;
            if (event.pointerType !== 'touch') return;
            event.currentTarget.setPointerCapture(event.pointerId);
            touch.current = { id: asset.id, x: event.clientX, y: event.clientY, dragging: false };
          }}
          onPointerMove={(event) => {
            const current = touch.current;
            if (!current || current.id !== asset.id) return;
            if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) current.dragging = true;
            if (current.dragging) setGhost({ asset, x: event.clientX, y: event.clientY });
          }}
          onPointerUp={(event) => {
            const current = touch.current;
            if (current?.dragging) {
              suppressClick.current = true;
              onDrop(current.id, { x: event.clientX, y: event.clientY });
            }
            touch.current = null;
            setGhost(null);
          }}
          onPointerCancel={() => { touch.current = null; setGhost(null); }}>
          <img src={asset.thumbnail} alt="" draggable={false} /><span className="tray-insert"><Plus size={12} />Insert</span>
        </button>
        <button className="tray-delete" aria-label={`Delete uploaded ${asset.name}`} title="Delete uploaded photo" onClick={() => onDelete(asset.id)}><Trash2 size={13} /></button>
        <span className="tray-name" title={asset.name}>{asset.name}</span>
      </div>)}</div>}
    </div>
    {ghost && <img className="tray-drag-ghost" src={ghost.asset.thumbnail} alt="" style={{ left: ghost.x, top: ghost.y }} />}
  </section>;
}
