import { useRef } from 'react';
import { Group, Rect } from 'react-konva';
import Konva from 'konva';
import { cropPhotoEdge } from '../crop';
import type { CropEdge } from '../crop';
import type { Photo, ResolvedPhoto } from '../model';

interface Props {
  photo: ResolvedPhoto;
  original: ResolvedPhoto;
  zoom: number;
  onPreview: (photo: ResolvedPhoto | null) => void;
  onCommit: (id: string, patch: Partial<Photo>) => void;
}

export default function CropHandles({ photo, original, zoom, onPreview, onCommit }: Props) {
  const drag = useRef<{ photo: ResolvedPhoto; start: Konva.Vector2d; inverse: Konva.Transform; patch: Partial<Photo> } | null>(null);
  const edges: { edge: CropEdge; x: number; y: number; vertical: boolean }[] = [
    { edge: 'left', x: 0, y: photo.height / 2, vertical: true },
    { edge: 'right', x: photo.width, y: photo.height / 2, vertical: true },
    { edge: 'top', x: photo.width / 2, y: 0, vertical: false },
    { edge: 'bottom', x: photo.width / 2, y: photo.height, vertical: false },
  ];
  function beginCrop(node: Konva.Node) {
    const point = node.getStage()?.getPointerPosition();
    const layer = node.getLayer();
    if (!point || !layer) return;
    const inverse = layer.getAbsoluteTransform().copy().invert();
    drag.current = { photo: original, start: inverse.point(point), inverse, patch: {} };
  }
  return <Group x={photo.x} y={photo.y} rotation={photo.rotation}>
    {edges.map(({ edge, x, y, vertical }) => <Rect key={edge} name={`crop-handle crop-${edge}`}
      x={x} y={y} width={(vertical ? 6 : 18) / zoom} height={(vertical ? 18 : 6) / zoom}
      offsetX={(vertical ? 3 : 9) / zoom} offsetY={(vertical ? 9 : 3) / zoom}
      fill="#d6f89a" stroke="#222522" strokeWidth={1 / zoom} hitStrokeWidth={24 / zoom}
      draggable dragDistance={0}
      onMouseEnter={(event) => { event.target.getStage()!.container().style.cursor = vertical ? 'ew-resize' : 'ns-resize'; }}
      onMouseLeave={(event) => { event.target.getStage()!.container().style.cursor = ''; }}
      onMouseDown={(event) => { event.cancelBubble = true; beginCrop(event.target); }}
      onTouchStart={(event) => { event.cancelBubble = true; beginCrop(event.target); }}
      onDragMove={(event) => {
        const current = drag.current;
        const point = event.target.getStage()?.getPointerPosition();
        if (!current || !point) return;
        const world = current.inverse.point(point);
        const dx = world.x - current.start.x;
        const dy = world.y - current.start.y;
        const angle = current.photo.rotation * Math.PI / 180;
        const delta = vertical ? dx * Math.cos(angle) + dy * Math.sin(angle) : -dx * Math.sin(angle) + dy * Math.cos(angle);
        current.patch = cropPhotoEdge(current.photo, edge, delta);
        onPreview({ ...current.photo, ...current.patch });
      }}
      onDragEnd={() => {
        const current = drag.current;
        drag.current = null;
        if (current && Object.keys(current.patch).length) onCommit(current.photo.id, current.patch);
        onPreview(null);
      }} />)}
  </Group>;
}
