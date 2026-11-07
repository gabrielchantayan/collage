import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { IconButton } from './Controls';
import type { ResolvedPhoto } from '../model';
import type { ClientPoint } from './PhotoTray';

interface Props {
  photos: ResolvedPhoto[];
  selectedIds: ReadonlySet<string>;
  multiSelect: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onContextMenu: (id: string, point: ClientPoint) => void;
  onToggleLock: (photo: ResolvedPhoto) => void;
  onToggleHidden: (photo: ResolvedPhoto) => void;
}

export default function LayersPanel({ photos, selectedIds, multiSelect, onSelect, onContextMenu, onToggleLock, onToggleHidden }: Props) {
  return <div className="photo-list">{[...photos].reverse().map((photo, index) => <div
    key={photo.id} className={`photo-row ${selectedIds.has(photo.id) ? 'is-selected' : ''} ${photo.hidden ? 'is-hidden' : ''}`}>
    <button className="photo-item" aria-pressed={selectedIds.has(photo.id)}
      onClick={(event) => onSelect(photo.id, event.shiftKey || event.metaKey || event.ctrlKey || multiSelect)}
      onContextMenu={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu(photo.id, { x: event.clientX || rect.left, y: event.clientY || rect.top }); }}>
      <img src={photo.thumbnail} alt="" /><span>{photo.name}</span><span className="photo-layer">{String(photos.length - index).padStart(2, '0')}</span>
    </button>
    <IconButton label={`${photo.locked ? 'Unlock' : 'Lock'} ${photo.groupId ? 'group at layer' : 'layer'} ${photos.length - index}`} onClick={() => onToggleLock(photo)}>
      {photo.locked ? <Lock size={12} /> : <LockOpen size={12} />}
    </IconButton>
    <IconButton label={`${photo.hidden ? 'Show' : 'Hide'} ${photo.groupId ? 'group at layer' : 'layer'} ${photos.length - index}`} onClick={() => onToggleHidden(photo)}>
      {photo.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
    </IconButton>
  </div>)}</div>;
}
