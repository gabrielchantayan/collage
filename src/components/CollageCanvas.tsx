import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import Konva from 'konva';
import { Group, Image as CanvasImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import { photoIntersects, SLIDE_WIDTH, slideHeight, type Photo, type Project, type ResolvedPhoto } from '../model';
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
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPhotoChange: (id: string, patch: Partial<Photo>) => void;
  onContextMenu: (id: string, point: ClientPoint) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

const PADDING = 40;
const MIN_FRAME = 30;
const clampZoom = (value: number) => Math.max(0.1, Math.min(1, value));
type Guides = { x: number | null; y: number | null };
const NO_GUIDES: Guides = { x: null, y: null };

interface FrameProps {
  photo: ResolvedPhoto;
  pinching: boolean;
  onSelect: Props['onSelect'];
  onPhotoChange: Props['onPhotoChange'];
  onContextMenu: Props['onContextMenu'];
  onDrag: (node: Konva.Group) => void;
  onEnd: () => void;
  register: (id: string, node: Konva.Group | null) => void;
  onImageStatus: (id: string, failed: boolean) => void;
}

const PhotoFrame = memo(function PhotoFrame({ photo, pinching, onSelect, onPhotoChange, onContextMenu, onDrag, onEnd, register, onImageStatus }: FrameProps) {
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
    <Group
      ref={registerNode}
      x={photo.x} y={photo.y} width={photo.width} height={photo.height} rotation={photo.rotation}
      draggable={!pinching}
      onMouseDown={(event) => { event.cancelBubble = true; onSelect(photo.id); }}
      onTouchStart={(event) => { if (event.evt.touches.length === 1) { event.cancelBubble = true; onSelect(photo.id); } }}
      onContextMenu={(event) => {
        event.evt.preventDefault();
        event.cancelBubble = true;
        onContextMenu(photo.id, { x: event.evt.clientX, y: event.evt.clientY });
      }}
      onDragStart={() => onSelect(photo.id)}
      onDragMove={(event) => { if (event.currentTarget instanceof Konva.Group) onDrag(event.currentTarget); }}
      onDragEnd={(event) => {
        const node = event.target;
        onPhotoChange(photo.id, { x: node.x(), y: node.y() });
        onEnd();
      }}
      onTransform={(event) => {
        const node = event.target;
        node.scaleX(Math.max(MIN_FRAME / photo.width, node.scaleX()));
        node.scaleY(Math.max(MIN_FRAME / photo.height, node.scaleY()));
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const width = Math.max(MIN_FRAME, photo.width * node.scaleX());
        const height = Math.max(MIN_FRAME, photo.height * node.scaleY());
        node.scale({ x: 1, y: 1 });
        onPhotoChange(photo.id, { x: node.x(), y: node.y(), width, height, rotation: node.rotation() });
        onEnd();
      }}
    >
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

export default function CollageCanvas({ project, photos, selectedId, onSelect, onPhotoChange, onContextMenu, zoom, onZoomChange, onInsert, ref }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [viewport, setViewport] = useState({ width: 800, height: 500 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const [pinching, setPinching] = useState(false);
  const [errors, setErrors] = useState<Set<string>>(() => new Set());
  const [cropDraft, setCropDraft] = useState<ResolvedPhoto | null>(null);
  const selectedPhoto = photos.find((photo) => photo.id === selectedId);
  const activeDraft = cropDraft?.id === selectedId ? cropDraft : null;
  const displayedPhoto = activeDraft ?? selectedPhoto;
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
  const visiblePhotos = photos.filter((photo) => photo.id === selectedId || photoIntersects(photo, visibleBounds));
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
    if (!transformer) return;
    const node = selectedId ? nodes.current.get(selectedId) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, project.photos, displayZoom, activeDraft]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let pinch: { distance: number; zoom: number; worldX: number; worldY: number } | null = null;
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
      zoomCallbackRef.current(nextZoom);
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      pinch = null;
      setPinching(false);
    };
    const wheel = (event: WheelEvent) => {
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const currentZoom = clampZoom(zoomRef.current);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const nextZoom = clampZoom(currentZoom * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)));
      if (nextZoom === currentZoom) return;
      pendingScroll.current = {
        x: (element.scrollLeft + x - PADDING) / currentZoom * nextZoom + PADDING - x,
        y: (element.scrollTop + y - PADDING) / currentZoom * nextZoom + PADDING - y,
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

  const snap = useCallback((node: Konva.Group) => {
    const layer = node.getLayer();
    if (!layer) return;
    const bounds = node.getClientRect({ relativeTo: layer, skipStroke: true, skipShadow: true });
    const threshold = 7 / displayZoom;
    const horizontalAnchors = [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width];
    let xDelta = threshold;
    let xGuide: number | null = null;
    for (let index = 0; index <= project.slides * 2; index++) {
      const target = index * SLIDE_WIDTH / 2;
      for (const anchor of horizontalAnchors) {
        const delta = target - anchor;
        if (Math.abs(delta) < Math.abs(xDelta)) { xDelta = delta; xGuide = target; }
      }
    }
    const verticalAnchors = [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
    let yDelta = threshold;
    let yGuide: number | null = null;
    for (const target of [0, height / 2, height]) {
      for (const anchor of verticalAnchors) {
        const delta = target - anchor;
        if (Math.abs(delta) < Math.abs(yDelta)) { yDelta = delta; yGuide = target; }
      }
    }
    if (xGuide !== null) node.x(node.x() + xDelta);
    if (yGuide !== null) node.y(node.y() + yDelta);
    setGuides((previous) => previous.x === xGuide && previous.y === yGuide ? previous : { x: xGuide, y: yGuide });
  }, [displayZoom, project.slides, height]);

  const clearSelection = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (event.target === event.target.getStage() || event.target.name() === 'canvas-background') onSelect(null);
  };
  const failedNames = photos.filter((photo) => errors.has(photo.id)).map((photo) => photo.name);

  return (
    <div className="canvas-workspace" style={{ position: 'relative', minWidth: 0, minHeight: 0, height: '100%' }}>
      <div ref={viewportRef} className="canvas-viewport" role="region" aria-label="Collage canvas. Select a photo; drag edges to crop or corners to resize. Scroll or pinch to zoom; Shift-scroll to pan."
        tabIndex={0} style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', position: 'relative' }}
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
            <Stage ref={stageRef} width={viewport.width} height={viewport.height} onMouseDown={clearSelection} onTouchStart={clearSelection}>
              <Layer x={originX} y={originY} scaleX={displayZoom} scaleY={displayZoom} clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
                <Rect name="canvas-background" width={width} height={height} fill={project.background} preventDefault={false} />
                {visiblePhotos.map((photo) => <PhotoFrame key={photo.id} photo={activeDraft?.id === photo.id ? activeDraft : photo} pinching={pinching}
                  onSelect={onSelect} onPhotoChange={onPhotoChange} onContextMenu={onContextMenu} onDrag={snap} onEnd={clearGuides} register={register} onImageStatus={onImageStatus} />)}
              </Layer>
              <Layer x={originX} y={originY} scaleX={displayZoom} scaleY={displayZoom} listening={false}>
                {Array.from({ length: project.slides }, (_, index) => <Group key={index}>
                  <Text x={index * SLIDE_WIDTH} y={-25 / displayZoom} text={String(index + 1).padStart(2, '0')} fontSize={11 / displayZoom} fill="#b5b3ac" />
                  {index > 0 && <Line points={[index * SLIDE_WIDTH, 0, index * SLIDE_WIDTH, height]} stroke="#282a2b" opacity={0.45} strokeWidth={1 / displayZoom} dash={[5 / displayZoom, 5 / displayZoom]} />}
                </Group>)}
                {guides.x !== null && <Line points={[guides.x, 0, guides.x, height]} stroke="#cae8a4" strokeWidth={1 / displayZoom} />}
                {guides.y !== null && <Line points={[0, guides.y, width, guides.y]} stroke="#cae8a4" strokeWidth={1 / displayZoom} />}
              </Layer>
              <Layer x={originX} y={originY} scaleX={displayZoom} scaleY={displayZoom}>
                <Transformer ref={transformerRef} flipEnabled={false} keepRatio={true} enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']} rotateEnabled={!pinching} resizeEnabled={!pinching}
                  borderStroke="#d2edab" anchorStroke="#222522" anchorFill="#d2edab" anchorSize={9} anchorCornerRadius={0}
                  rotateAnchorOffset={28} padding={0} rotationSnaps={[0, 90, 180, 270]} rotationSnapTolerance={4}
                  boundBoxFunc={(oldBox, newBox) => newBox.width < MIN_FRAME * displayZoom || newBox.height < MIN_FRAME * displayZoom ? oldBox : newBox} />
                {selectedPhoto && displayedPhoto && !pinching && <CropHandles photo={displayedPhoto} original={selectedPhoto} zoom={displayZoom} onPreview={setCropDraft} onCommit={onPhotoChange} />}
              </Layer>
            </Stage>
          </div>
        </div>
      </div>
      {failedNames.length > 0 && <div className="canvas-error" role="alert" style={{ position: 'absolute', left: 16, bottom: 16, padding: '10px 14px', background: '#502e2e', color: '#fff9ef', maxWidth: 'calc(100% - 32px)' }}>Could not load: {failedNames.join(', ')}. Remove and import the photo again.</div>}
    </div>
  );
}
