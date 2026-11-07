import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import Konva from 'konva';
import { Group, Image as CanvasImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import { photoIntersects, SLIDE_WIDTH, slideHeight, type Bounds, type Photo, type Project, type ResolvedPhoto } from '../model';
import { selectPhoto, selectionBounds, selectionUnits } from '../selection';
import { acquirePreview, releasePreview } from '../assets';
import CropHandles from './CropHandles';
import { ASSET_DRAG_TYPE, type ClientPoint } from './PhotoTray';

export interface CanvasHandle {
  insertAsset: (id: string, clientPoint?: ClientPoint) => boolean;
}

interface Props {
  project: Project;
  photos: ResolvedPhoto[];
  onInsert: (id: string, worldPoint: ClientPoint) => void;
  ref?: Ref<CanvasHandle>;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onPhotosChange: (changes: { id: string; patch: Partial<Photo> }[]) => void;
  multiSelect: boolean;
  onContextMenu: (id: string, point: ClientPoint) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

const PADDING = 40;
const MIN_FRAME = 30;
const clampZoom = (value: number) => Math.max(0.1, Math.min(1, value));
type Guides = { x: number | null; y: number | null };
const NO_GUIDES: Guides = { x: null, y: null };
type PointerEvent = Konva.KonvaEventObject<MouseEvent | TouchEvent>;
type DragState = { id: string; photos: Photo[]; bounds: Bounds };
type TransformState = { photos: Photo[]; x: number; y: number; rotation: number; width: number; height: number };
type MarqueeState = { start: ClientPoint; end: ClientPoint; ids: string[] };

interface FrameProps {
  photo: ResolvedPhoto;
  pinching: boolean;
  onSelect: (id: string, additive: boolean) => void;
  multiSelect: boolean;
  onContextMenu: Props['onContextMenu'];
  onDragStart: (id: string, node: Konva.Group) => void;
  onDragMove: (id: string, node: Konva.Group) => void;
  onDragEnd: (id: string) => void;
  register: (id: string, node: Konva.Group | null) => void;
  onImageStatus: (id: string, failed: boolean) => void;
}

const PhotoFrame = memo(function PhotoFrame({ photo, pinching, onSelect, multiSelect, onContextMenu, onDragStart, onDragMove, onDragEnd, register, onImageStatus }: FrameProps) {
  const [image, setImage] = useState<HTMLImageElement>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setImage(undefined);
    setFailed(false);
    onImageStatus(photo.id, false);
    acquirePreview(photo.assetId).then((loaded) => {
      if (active) setImage(loaded);
    }, () => {
      if (!active) return;
      setFailed(true);
      onImageStatus(photo.id, true);
    });
    return () => {
      active = false;
      releasePreview(photo.assetId);
    };
  }, [photo.id, photo.assetId, onImageStatus]);

  const registerNode = useCallback((node: Konva.Group | null) => register(photo.id, node), [photo.id, register]);
  const crop = image ? {
    x: photo.crop.x * image.naturalWidth / photo.naturalWidth,
    y: photo.crop.y * image.naturalHeight / photo.naturalHeight,
    width: photo.crop.width * image.naturalWidth / photo.naturalWidth,
    height: photo.crop.height * image.naturalHeight / photo.naturalHeight,
  } : undefined;

  return (
    <Group ref={registerNode}
      x={photo.x} y={photo.y} width={photo.width} height={photo.height} rotation={photo.rotation}
      listening={!photo.locked} draggable={!pinching && !photo.locked}
      onMouseDown={(event) => { if (event.evt.button !== 0) return; event.cancelBubble = true; onSelect(photo.id, multiSelect || event.evt.shiftKey); }}
      onTouchStart={(event) => {
        if (event.evt.touches.length === 1) { event.cancelBubble = true; onSelect(photo.id, multiSelect); }
      }}
      onContextMenu={(event) => {
        event.evt.preventDefault();
        event.cancelBubble = true;
        onContextMenu(photo.id, { x: event.evt.clientX, y: event.evt.clientY });
      }}
      onDragStart={(event) => { if (event.currentTarget instanceof Konva.Group) onDragStart(photo.id, event.currentTarget); }}
      onDragMove={(event) => { if (event.currentTarget instanceof Konva.Group) onDragMove(photo.id, event.currentTarget); }}
      onDragEnd={() => onDragEnd(photo.id)}>
      {image ? <CanvasImage image={image} width={photo.width} height={photo.height} crop={crop} /> : (
        <>
          <Rect width={photo.width} height={photo.height} fill={failed ? '#502e2e' : '#66645f'} />
          <Text width={photo.width} height={photo.height} padding={12} align="center" verticalAlign="middle"
            fontSize={Math.min(24, photo.width / 10)} fill="#fff9ef"
            text={failed ? `Unable to load\n${photo.name}` : 'Loading photo…'} />
        </>
      )}
    </Group>
  );
});

export default function CollageCanvas({ project, photos, selectedIds, onSelect, onPhotosChange, multiSelect, onContextMenu, zoom, onZoomChange, onInsert, ref }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectionNodeRef = useRef<Konva.Rect>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const drag = useRef<DragState | null>(null);
  const transform = useRef<TransformState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 500 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const [pinching, setPinching] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [errors, setErrors] = useState<Set<string>>(() => new Set());
  const [cropDraft, setCropDraft] = useState<ResolvedPhoto | null>(null);
  const selectedPhotos = selectionUnits(photos, new Set(selectedIds)).flat();
  const selectedSet = new Set(selectedPhotos.map((photo) => photo.id));
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedPhotos.map((photo) => photo.id);
  const selectedPhoto = selectedPhotos.length === 1 ? photos.find((photo) => photo.id === selectedPhotos[0].id) : undefined;
  const activeDraft = cropDraft?.id === selectedPhoto?.id ? cropDraft : null;
  const displayedPhoto = activeDraft ?? selectedPhoto;
  const bounds = selectedPhoto && displayedPhoto
    ? { x: displayedPhoto.x, y: displayedPhoto.y, width: displayedPhoto.width, height: displayedPhoto.height }
    : selectionBounds(selectedPhotos);
  const selectionRotation = displayedPhoto?.rotation ?? 0;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomCallbackRef = useRef(onZoomChange);
  zoomCallbackRef.current = onZoomChange;
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);
  const displayZoom = clampZoom(zoom);
  const width = project.slides * SLIDE_WIDTH;
  const height = slideHeight(project.aspect);
  const contentWidth = Math.max(viewport.width, width * displayZoom + PADDING * 2);
  const contentHeight = Math.max(viewport.height, height * displayZoom + PADDING * 2);
  const originX = PADDING - scroll.x;
  const originY = PADDING - scroll.y;
  const overscan = 100 / displayZoom;
  const visibleBounds = {
    x: Math.max(0, -originX / displayZoom - overscan),
    y: Math.max(0, -originY / displayZoom - overscan),
    width: 0,
    height: 0,
  };
  visibleBounds.width = Math.max(0, Math.min(width, (viewport.width - originX) / displayZoom + overscan) - visibleBounds.x);
  visibleBounds.height = Math.max(0, Math.min(height, (viewport.height - originY) / displayZoom + overscan) - visibleBounds.y);
  const visiblePhotos = photos.filter((photo) => !photo.hidden && (selectedSet.has(photo.id) || photoIntersects(photo, visibleBounds)));
  const clearGuides = useCallback(() => setGuides((previous) => previous.x === null && previous.y === null ? previous : NO_GUIDES), []);

  function insertAsset(id: string, clientPoint?: ClientPoint): boolean {
    const element = viewportRef.current;
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    let x: number;
    let y: number;
    if (clientPoint) {
      if (clientPoint.x < rect.left || clientPoint.x > rect.right || clientPoint.y < rect.top || clientPoint.y > rect.bottom) return false;
      x = (clientPoint.x - rect.left + element.scrollLeft - PADDING) / displayZoom;
      y = (clientPoint.y - rect.top + element.scrollTop - PADDING) / displayZoom;
      if (x < 0 || x > width || y < 0 || y > height) return false;
    } else {
      x = (Math.max(0, (element.scrollLeft - PADDING) / displayZoom) + Math.min(width, (element.scrollLeft + element.clientWidth - PADDING) / displayZoom)) / 2;
      y = (Math.max(0, (element.scrollTop - PADDING) / displayZoom) + Math.min(height, (element.scrollTop + element.clientHeight - PADDING) / displayZoom)) / 2;
    }
    onInsert(id, { x, y });
    return true;
  }
  useImperativeHandle(ref, () => ({ insertAsset }));

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const resize = () => setViewport({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    if (pendingScroll.current) {
      element.scrollLeft = pendingScroll.current.x;
      element.scrollTop = pendingScroll.current.y;
      pendingScroll.current = null;
    }
    setScroll({ x: element.scrollLeft, y: element.scrollTop });
  }, [displayZoom, contentWidth, contentHeight]);

  useLayoutEffect(() => {
    const transformer = transformerRef.current;
    const node = selectionNodeRef.current;
    if (!transformer || !node || transform.current) return;
    transformer.nodes(selectedPhotos.length && !pinching ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, project.photos, displayZoom, activeDraft, pinching, selectedPhotos.length]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let pinch: { distance: number; zoom: number; worldX: number; worldY: number } | null = null;
    let wheelGesture: { mode: 'pan' | 'zoom'; time: number; modifiers: string } | null = null;
    const geometry = (touches: TouchList) => {
      const rect = element.getBoundingClientRect();
      return {
        distance: Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY),
        x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
        y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
      };
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      marqueeRef.current = null;
      setMarquee(null);
      const point = geometry(event.touches);
      const currentZoom = clampZoom(zoomRef.current);
      pinch = { distance: Math.max(1, point.distance), zoom: currentZoom,
        worldX: (element.scrollLeft + point.x - PADDING) / currentZoom,
        worldY: (element.scrollTop + point.y - PADDING) / currentZoom };
      nodes.current.forEach((node) => { if (node.isDragging()) node.stopDrag(); });
      setPinching(true);
      clearGuides();
    };
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const point = geometry(event.touches);
      const nextZoom = clampZoom(pinch.zoom * point.distance / pinch.distance);
      pendingScroll.current = { x: pinch.worldX * nextZoom + PADDING - point.x, y: pinch.worldY * nextZoom + PADDING - point.y };
      zoomRef.current = nextZoom;
      zoomCallbackRef.current(nextZoom);
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      pinch = null;
      setPinching(false);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const factorX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      const factorY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const dx = event.deltaX * factorX;
      const dy = event.deltaY * factorY;
      const modifiers = `${event.shiftKey}:${event.ctrlKey}:${event.metaKey}`;
      const time = performance.now();
      if (!wheelGesture || time - wheelGesture.time > 160 || modifiers !== wheelGesture.modifiers) {
        wheelGesture = { mode: event.ctrlKey || event.metaKey ? 'zoom' : event.shiftKey || Math.abs(dx) > Math.abs(dy) ? 'pan' : 'zoom', time, modifiers };
      }
      wheelGesture.time = time;
      if (wheelGesture.mode === 'pan') {
        // Shift maps a vertical mouse wheel onto X. Never alter scrollTop.
        element.scrollLeft += event.shiftKey && Math.abs(dy) > Math.abs(dx) ? dy : dx;
        return;
      }
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const currentZoom = clampZoom(zoomRef.current);
      const nextZoom = clampZoom(currentZoom * Math.exp(-dy * (event.ctrlKey || event.metaKey ? 0.01 : 0.002)));
      if (nextZoom === currentZoom) return;
      const currentScroll = pendingScroll.current ?? { x: element.scrollLeft, y: element.scrollTop };
      pendingScroll.current = {
        x: (currentScroll.x + x - PADDING) / currentZoom * nextZoom + PADDING - x,
        y: (currentScroll.y + y - PADDING) / currentZoom * nextZoom + PADDING - y,
      };
      zoomRef.current = nextZoom;
      zoomCallbackRef.current(nextZoom);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', end);
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
      element.removeEventListener('wheel', wheel);
    };
  }, [clearGuides]);

  const register = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);
  const onImageStatus = useCallback((id: string, failed: boolean) => {
    setErrors((previous) => {
      if (previous.has(id) === failed) return previous;
      const next = new Set(previous);
      if (failed) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  function choosePhoto(id: string, additive: boolean) {
    if (!additive && selectedIdsRef.current.includes(id)) return;
    const ids = selectPhoto(photos, selectedIdsRef.current, id, additive);
    selectedIdsRef.current = ids;
    onSelect(ids);
  }

  function beginDrag(id: string, node: Konva.Group) {
    if (!selectedIdsRef.current.includes(id)) { node.stopDrag(); return; }
    const members = selectionUnits(photos, new Set(selectedIdsRef.current)).flat();
    drag.current = { id, photos: members, bounds: selectionBounds(members) };
    setInteracting(true);
  }

  function moveDrag(id: string, node: Konva.Group) {
    const current = drag.current;
    if (!current || current.id !== id) return;
    const original = current.photos.find((photo) => photo.id === id);
    if (!original) return;
    let dx = node.x() - original.x;
    let dy = node.y() - original.y;
    const threshold = 7 / displayZoom;
    let xDelta = threshold;
    let yDelta = threshold;
    let xGuide: number | null = null;
    let yGuide: number | null = null;
    const horizontalAnchors = [current.bounds.x + dx, current.bounds.x + dx + current.bounds.width / 2, current.bounds.x + dx + current.bounds.width];
    for (let index = 0; index <= project.slides * 2; index++) {
      const target = index * SLIDE_WIDTH / 2;
      for (const anchor of horizontalAnchors) {
        const delta = target - anchor;
        if (Math.abs(delta) < Math.abs(xDelta)) { xDelta = delta; xGuide = target; }
      }
    }
    const verticalAnchors = [current.bounds.y + dy, current.bounds.y + dy + current.bounds.height / 2, current.bounds.y + dy + current.bounds.height];
    for (const target of [0, height / 2, height]) {
      for (const anchor of verticalAnchors) {
        const delta = target - anchor;
        if (Math.abs(delta) < Math.abs(yDelta)) { yDelta = delta; yGuide = target; }
      }
    }
    if (xGuide !== null) dx += xDelta;
    if (yGuide !== null) dy += yDelta;
    for (const photo of current.photos) nodes.current.get(photo.id)?.position({ x: photo.x + dx, y: photo.y + dy });
    const base = current.photos.length === 1 ? current.photos[0] : current.bounds;
    selectionNodeRef.current?.position({ x: base.x + dx, y: base.y + dy });
    setGuides((previous) => previous.x === xGuide && previous.y === yGuide ? previous : { x: xGuide, y: yGuide });
  }

  function finishDrag(id: string) {
    const current = drag.current;
    if (!current || current.id !== id) return;
    drag.current = null;
    const changes: { id: string; patch: Partial<Photo> }[] = [];
    for (const photo of current.photos) {
      const node = nodes.current.get(photo.id);
      if (node && (node.x() !== photo.x || node.y() !== photo.y)) changes.push({ id: photo.id, patch: { x: node.x(), y: node.y() } });
    }
    if (changes.length) onPhotosChange(changes);
    setInteracting(false);
    clearGuides();
  }

  function beginTransform() {
    const node = selectionNodeRef.current;
    if (!node || !selectedPhotos.length) return;
    transform.current = { photos: selectedPhotos, x: node.x(), y: node.y(), width: node.width(), height: node.height(), rotation: node.rotation() };
    setInteracting(true);
  }

  function moveTransform() {
    const current = transform.current;
    const proxy = selectionNodeRef.current;
    if (!current || !proxy) return;
    const scale = proxy.scaleX();
    const rotation = proxy.rotation() - current.rotation;
    const angle = rotation * Math.PI / 180;
    for (const photo of current.photos) {
      const node = nodes.current.get(photo.id);
      if (!node) continue;
      const x = photo.x - current.x;
      const y = photo.y - current.y;
      node.position({ x: proxy.x() + (x * Math.cos(angle) - y * Math.sin(angle)) * scale, y: proxy.y() + (x * Math.sin(angle) + y * Math.cos(angle)) * scale });
      node.scale({ x: scale, y: scale });
      node.rotation(photo.rotation + rotation);
    }
    proxy.getStage()?.batchDraw();
  }

  function finishTransform() {
    const current = transform.current;
    const proxy = selectionNodeRef.current;
    if (!current || !proxy) return;
    moveTransform();
    const scale = proxy.scaleX();
    const changes: { id: string; patch: Partial<Photo> }[] = [];
    for (const photo of current.photos) {
      const node = nodes.current.get(photo.id);
      if (!node) continue;
      const patch = { x: node.x(), y: node.y(), width: photo.width * scale, height: photo.height * scale, rotation: node.rotation() };
      node.scale({ x: 1, y: 1 });
      node.size({ width: patch.width, height: patch.height });
      if (patch.x !== photo.x || patch.y !== photo.y || patch.width !== photo.width || patch.height !== photo.height || patch.rotation !== photo.rotation) changes.push({ id: photo.id, patch });
    }
    proxy.size({ width: current.width * scale, height: current.height * scale });
    proxy.scale({ x: 1, y: 1 });
    transform.current = null;
    if (changes.length) onPhotosChange(changes);
    setInteracting(false);
  }

  function worldPointer(): ClientPoint | null {
    const point = stageRef.current?.getPointerPosition();
    return point ? { x: (point.x - originX) / displayZoom, y: (point.y - originY) / displayZoom } : null;
  }

  function beginMarquee(event: PointerEvent) {
    if (event.target !== event.target.getStage() && event.target.name() !== 'canvas-background') return;
    if ('touches' in event.evt && !multiSelect) {
      if (event.evt.touches.length === 1) { selectedIdsRef.current = []; onSelect([]); }
      return;
    }
    if ('touches' in event.evt && event.evt.touches.length !== 1 || 'button' in event.evt && event.evt.button !== 0) return;
    const point = worldPointer();
    if (!point) return;
    const additive = multiSelect || 'shiftKey' in event.evt && event.evt.shiftKey;
    const current = { start: point, end: point, ids: additive ? selectedIdsRef.current : [] };
    marqueeRef.current = current;
    setMarquee(current);
    if (!additive) { selectedIdsRef.current = []; onSelect([]); }
  }

  function moveMarquee() {
    const current = marqueeRef.current;
    const point = worldPointer();
    if (!current || !point) return;
    const next = { ...current, end: point };
    marqueeRef.current = next;
    setMarquee(next);
  }

  function finishMarquee() {
    const current = marqueeRef.current;
    if (!current) return;
    marqueeRef.current = null;
    setMarquee(null);
    if (Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y) * displayZoom < 3) return;
    const box = { x: Math.min(current.start.x, current.end.x), y: Math.min(current.start.y, current.end.y), width: Math.abs(current.end.x - current.start.x), height: Math.abs(current.end.y - current.start.y) };
    const ids = new Set(current.ids);
    for (const photo of photos) if (!photo.locked && !photo.hidden && photoIntersects(photo, box)) ids.add(photo.id);
    const next = selectionUnits(photos, ids).flat().map((photo) => photo.id);
    selectedIdsRef.current = next;
    onSelect(next);
  }

  const failedNames = photos.filter((photo) => !photo.hidden && errors.has(photo.id)).map((photo) => photo.name);

  return (
    <div className="canvas-workspace" style={{ position: 'relative', minWidth: 0, minHeight: 0, height: '100%' }}>
      <div ref={viewportRef} className="canvas-viewport" role="region" aria-label="Collage canvas. Shift-select or drag empty space to select photos. Drag edges to crop or corners to resize. Scroll or pinch to zoom; horizontal or Shift-scroll to pan."
        tabIndex={0} style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', touchAction: multiSelect ? 'none' : 'pan-x pan-y', position: 'relative' }}
        onScroll={(event) => setScroll({ x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop })}
        onDragOver={(event) => { if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={(event) => {
          const id = event.dataTransfer.getData(ASSET_DRAG_TYPE);
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          insertAsset(id, { x: event.clientX, y: event.clientY });
        }}>
        <div style={{ position: 'relative', width: contentWidth, height: contentHeight }}>
          <div style={{ position: 'sticky', top: 0, left: 0, width: viewport.width, height: viewport.height }}>
            <Stage ref={stageRef} width={viewport.width} height={viewport.height}
              onMouseDown={beginMarquee} onTouchStart={beginMarquee} onMouseMove={moveMarquee} onTouchMove={moveMarquee}
              onMouseUp={finishMarquee} onTouchEnd={finishMarquee} onMouseLeave={finishMarquee}>
              <Layer x={originX} y={originY} scaleX={displayZoom} scaleY={displayZoom} clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
                <Rect name="canvas-background" width={width} height={height} fill={project.background} preventDefault={multiSelect} />
                {visiblePhotos.map((photo) => <PhotoFrame key={photo.id} photo={activeDraft?.id === photo.id ? activeDraft : photo} pinching={pinching}
                  onSelect={choosePhoto} multiSelect={multiSelect} onContextMenu={onContextMenu}
                  onDragStart={beginDrag} onDragMove={moveDrag} onDragEnd={finishDrag} register={register} onImageStatus={onImageStatus} />)}
              </Layer>
              <Layer x={originX} y={originY} scaleX={displayZoom} scaleY={displayZoom} listening={false}>
                {Array.from({ length: project.slides }, (_, index) => <Group key={index}>
                  <Text x={index * SLIDE_WIDTH} y={-25 / displayZoom} text={String(index + 1).padStart(2, '0')} fontSize={11 / displayZoom} fill="#b5b3ac" />
                  {index > 0 && <Line points={[index * SLIDE_WIDTH, 0, index * SLIDE_WIDTH, height]} stroke="#282a2b" opacity={0.45} strokeWidth={1 / displayZoom} dash={[5 / displayZoom, 5 / displayZoom]} />}
                </Group>)}
                {guides.x !== null && <Line points={[guides.x, 0, guides.x, height]} stroke="#cae8a4" strokeWidth={1 / displayZoom} />}
                {guides.y !== null && <Line points={[0, guides.y, width, guides.y]} stroke="#cae8a4" strokeWidth={1 / displayZoom} />}
                {marquee && <Rect x={Math.min(marquee.start.x, marquee.end.x)} y={Math.min(marquee.start.y, marquee.end.y)}
                  width={Math.abs(marquee.end.x - marquee.start.x)} height={Math.abs(marquee.end.y - marquee.start.y)} fill="rgba(210,237,171,0.12)" stroke="#d2edab" strokeWidth={1 / displayZoom} />}
              </Layer>
              <Layer x={originX} y={originY} scaleX={displayZoom} scaleY={displayZoom}>
                <Rect ref={selectionNodeRef} {...bounds} rotation={selectionRotation} listening={false}
                  onTransformStart={beginTransform} onTransform={moveTransform} onTransformEnd={finishTransform} />
                <Transformer ref={transformerRef} flipEnabled={false} keepRatio shiftBehavior="none"
                  enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']} rotateEnabled={!pinching && selectedPhotos.length === 1} resizeEnabled={!pinching}
                  borderStroke="#d2edab" anchorStroke="#222522" anchorFill="#d2edab" anchorSize={9} anchorCornerRadius={0}
                  rotateAnchorOffset={28} padding={0} rotationSnaps={[0, 90, 180, 270]} rotationSnapTolerance={4}
                  boundBoxFunc={(oldBox, newBox) => {
                    const current = transform.current;
                    if (newBox.width <= 0 || newBox.height <= 0) return oldBox;
                    if (!current) return newBox;
                    const ratio = newBox.width / (current.width * displayZoom);
                    return current.photos.some((photo) => photo.width * ratio < Math.min(MIN_FRAME, photo.width) || photo.height * ratio < Math.min(MIN_FRAME, photo.height)) ? oldBox : newBox;
                  }} />
                {selectedPhoto && displayedPhoto && !pinching && !interacting && <CropHandles photo={displayedPhoto} original={selectedPhoto} zoom={displayZoom} onPreview={setCropDraft} onCommit={(id, patch) => onPhotosChange([{ id, patch }])} />}
              </Layer>
            </Stage>
          </div>
        </div>
      </div>
      {failedNames.length > 0 && <div className="canvas-error" role="alert" style={{ position: 'absolute', left: 16, bottom: 16, padding: '10px 14px', background: '#502e2e', color: '#fff9ef', maxWidth: 'calc(100% - 32px)' }}>Could not load: {failedNames.join(', ')}. Remove and import the photo again.</div>}
    </div>
  );
}
