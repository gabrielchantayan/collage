import type { Bounds, Photo } from './model';

export type { Bounds } from './model';
export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'distribute-x' | 'distribute-y';

const editable = (photo: Photo) => !photo.locked && !photo.hidden;

export function selectPhoto(photos: Photo[], currentIds: string[], id: string, additive: boolean): string[] {
  const target = photos.find((photo) => photo.id === id && editable(photo));
  const current = new Set(currentIds);
  if (!target) return photos.filter((photo) => editable(photo) && current.has(photo.id)).map((photo) => photo.id);
  const members = photos.filter((photo) => editable(photo) && (photo.id === id || !!target.groupId && photo.groupId === target.groupId));
  if (!additive) return members.map((photo) => photo.id);
  const remove = members.every((photo) => current.has(photo.id));
  for (const member of members) {
    if (remove) current.delete(member.id);
    else current.add(member.id);
  }
  return photos.filter((photo) => editable(photo) && current.has(photo.id)).map((photo) => photo.id);
}

export function photoBounds(photo: Photo): Bounds {
  const angle = photo.rotation * Math.PI / 180;
  const dx = photo.width * Math.cos(angle);
  const dy = photo.width * Math.sin(angle);
  const hx = -photo.height * Math.sin(angle);
  const hy = photo.height * Math.cos(angle);
  const left = Math.min(0, dx, hx, dx + hx);
  const top = Math.min(0, dy, hy, dy + hy);
  return {
    x: photo.x + left,
    y: photo.y + top,
    width: Math.max(0, dx, hx, dx + hx) - left,
    height: Math.max(0, dy, hy, dy + hy) - top,
  };
}

export function selectionBounds(photos: Photo[]): Bounds {
  if (!photos.length) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const photo of photos) {
    const bounds = photoBounds(photo);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function selectionUnits(photos: Photo[], ids: ReadonlySet<string>): Photo[][] {
  const groups = new Set(photos.filter((photo) => editable(photo) && ids.has(photo.id) && photo.groupId).map((photo) => photo.groupId!));
  const grouped = new Map<string, Photo[]>();
  const units: Photo[][] = [];
  for (const photo of photos) {
    if (!editable(photo) || !ids.has(photo.id) && !(photo.groupId && groups.has(photo.groupId))) continue;
    if (!photo.groupId) {
      units.push([photo]);
      continue;
    }
    let unit = grouped.get(photo.groupId);
    if (!unit) {
      unit = [];
      grouped.set(photo.groupId, unit);
      units.push(unit);
    }
    unit.push(photo);
  }
  return units;
}

export function alignPhotos(photos: Photo[], ids: ReadonlySet<string>, alignment: Alignment): Photo[] {
  const units = selectionUnits(photos, ids);
  const distributing = alignment === 'distribute-x' || alignment === 'distribute-y';
  if (units.length < (distributing ? 3 : 2)) return photos;
  const bounds = selectionBounds(units.flat());
  const entries = units.map((unit) => ({ unit, bounds: selectionBounds(unit) }));
  const offsets = new Map<string, { x: number; y: number }>();
  if (distributing) {
    const horizontal = alignment === 'distribute-x';
    const axis = horizontal ? 'x' : 'y';
    const size = horizontal ? 'width' : 'height';
    entries.sort((a, b) => a.bounds[axis] - b.bounds[axis]);
    const gap = (bounds[size] - entries.reduce((sum, entry) => sum + entry.bounds[size], 0)) / (entries.length - 1);
    let position = bounds[axis];
    for (const entry of entries) {
      const offset = position - entry.bounds[axis];
      for (const photo of entry.unit) offsets.set(photo.id, { x: horizontal ? offset : 0, y: horizontal ? 0 : offset });
      position += entry.bounds[size] + gap;
    }
  } else {
    for (const entry of entries) {
      let x = 0;
      let y = 0;
      if (alignment === 'left') x = bounds.x - entry.bounds.x;
      if (alignment === 'center-x') x = bounds.x + bounds.width / 2 - entry.bounds.x - entry.bounds.width / 2;
      if (alignment === 'right') x = bounds.x + bounds.width - entry.bounds.x - entry.bounds.width;
      if (alignment === 'top') y = bounds.y - entry.bounds.y;
      if (alignment === 'center-y') y = bounds.y + bounds.height / 2 - entry.bounds.y - entry.bounds.height / 2;
      if (alignment === 'bottom') y = bounds.y + bounds.height - entry.bounds.y - entry.bounds.height;
      for (const photo of entry.unit) offsets.set(photo.id, { x, y });
    }
  }
  let changed = false;
  const result = photos.map((photo) => {
    const offset = offsets.get(photo.id);
    if (!offset || Math.abs(offset.x) < 1e-9 && Math.abs(offset.y) < 1e-9) return photo;
    changed = true;
    return { ...photo, x: photo.x + offset.x, y: photo.y + offset.y };
  });
  return changed ? result : photos;
}
