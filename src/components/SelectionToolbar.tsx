import { AlignCenter, AlignHorizontalDistributeCenter, AlignLeft, AlignRight, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Copy, Crop, Group, ImagePlus, Trash2, Ungroup } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IconButton, NumberField } from './Controls';
import { cropPhotoEdge, restorePhotoCrop } from '../crop';
import { selectionUnits } from '../selection';
import type { Alignment } from '../selection';
import type { Photo, ResolvedPhoto } from '../model';

const alignmentActions: Record<Alignment, { label: string; icon: LucideIcon }> = {
  left: { label: 'Align left', icon: AlignLeft },
  'center-x': { label: 'Align horizontal centers', icon: AlignCenter },
  right: { label: 'Align right', icon: AlignRight },
  top: { label: 'Align top', icon: ArrowUpToLine },
  'center-y': { label: 'Align vertical centers', icon: AlignVerticalJustifyCenter },
  bottom: { label: 'Align bottom', icon: ArrowDownToLine },
  'distribute-x': { label: 'Distribute horizontally', icon: AlignHorizontalDistributeCenter },
  'distribute-y': { label: 'Distribute vertically', icon: AlignVerticalDistributeCenter },
};

interface Props {
  photos: ResolvedPhoto[];
  canBackward: boolean;
  canForward: boolean;
  onChange: (id: string, patch: Partial<Photo>) => void;
  onAlign: (alignment: Alignment) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onReorder: (direction: number) => void;
}

export default function SelectionToolbar({ photos, canBackward, canForward, onChange, onAlign, onGroup, onUngroup, onDuplicate, onDelete, onReplace, onReorder }: Props) {
  if (!photos.length) return null;
  const selected = photos.length === 1 ? photos[0] : undefined;
  const units = selectionUnits(photos, new Set(photos.map((photo) => photo.id))).length;
  const grouped = photos.length > 1 && photos[0].groupId && photos.every((photo) => photo.groupId === photos[0].groupId);
  return <div className="selection-toolbar" aria-label="Photo tools">
    <span className="selected-name">{selected ? selected.name : `${photos.length} selected`}</span>
    {selected ? <>
      <button onClick={onReplace}><ImagePlus size={14} />Replace</button>
      <button onClick={() => onChange(selected.id, restorePhotoCrop(selected))}
        disabled={selected.crop.x === 0 && selected.crop.y === 0 && selected.crop.width === selected.naturalWidth && selected.crop.height === selected.naturalHeight}><Crop size={14} />Reset crop</button>
      <NumberField label="Crop width" value={selected.width} min={30} max={(selected.naturalWidth - selected.crop.x) * selected.width / selected.crop.width} suffix="px" onCommit={(width) => onChange(selected.id, cropPhotoEdge(selected, 'right', width - selected.width))} />
      <NumberField label="Crop height" value={selected.height} min={30} max={(selected.naturalHeight - selected.crop.y) * selected.height / selected.crop.height} suffix="px" onCommit={(height) => onChange(selected.id, cropPhotoEdge(selected, 'bottom', height - selected.height))} />
      <NumberField label="Rotation" value={selected.rotation} min={-360} max={360} suffix="°" onCommit={(rotation) => onChange(selected.id, { rotation })} />
    </> : <>
      {!grouped && <button onClick={onGroup}><Group size={14} />Group</button>}
      {photos.some((photo) => photo.groupId) && <button onClick={onUngroup}><Ungroup size={14} />Ungroup</button>}
      <div className="alignment-tools" aria-label="Alignment">{(Object.keys(alignmentActions) as Alignment[]).map((alignment) => {
        const { label, icon: Icon } = alignmentActions[alignment];
        return <IconButton key={alignment} label={label} disabled={units < (alignment.startsWith('distribute') ? 3 : 2)} onClick={() => onAlign(alignment)}><Icon size={14} /></IconButton>;
      })}</div>
    </>}
    <div className="layer-actions">
      <IconButton label="Send backward" disabled={!canBackward} onClick={() => onReorder(-1)}><ArrowDown size={15} /></IconButton>
      <IconButton label="Bring forward" disabled={!canForward} onClick={() => onReorder(1)}><ArrowUp size={15} /></IconButton>
      <IconButton label={selected ? 'Duplicate photo' : 'Duplicate selection'} onClick={onDuplicate}><Copy size={15} /></IconButton>
      <IconButton label={selected ? 'Delete photo' : 'Delete selection'} onClick={onDelete}><Trash2 size={15} /></IconButton>
    </div>
  </div>;
}
