import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Project, ResolvedPhoto } from '../model';
import { IconButton } from './Controls';
import SlideThumbnail from './SlideThumbnail';
import './SlideReorder.css';

interface Props {
  project: Project;
  photos: ResolvedPhoto[];
  onReorder: (fromSlide: number, toSlide: number) => void;
  onClose: () => void;
  disabled?: boolean;
}

interface TouchDrag {
  from: number;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
  target: number | null;
  frame: number;
}

const SLIDE_DRAG_TYPE = 'application/x-collage-slide';

export default function SlideReorder({ project, photos, onReorder, onClose, disabled = false }: Props) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const touch = useRef<TouchDrag | null>(null);
  const slides = project.slides;

  useEffect(() => () => { if (touch.current) cancelAnimationFrame(touch.current.frame); }, []);

  function trackTouch() {
    const current = touch.current;
    const list = listRef.current;
    if (!current?.dragging || !list) return;
    const rect = list.getBoundingClientRect();
    const insideY = current.y >= rect.top && current.y <= rect.bottom;
    if (insideY) {
      if (current.x < rect.left + 28) list.scrollLeft -= Math.min(12, (rect.left + 28 - current.x) / 2);
      else if (current.x > rect.right - 28) list.scrollLeft += Math.min(12, (current.x - rect.right + 28) / 2);
    }
    const hit = document.elementFromPoint(current.x, current.y)?.closest<HTMLButtonElement>('button[data-slide-index]');
    const next = hit && list.contains(hit) ? Number(hit.dataset.slideIndex) : null;
    current.target = next === current.from ? null : next;
    setTarget(current.target);
    current.frame = requestAnimationFrame(trackTouch);
  }

  function finishTouch(commit: boolean) {
    const current = touch.current;
    if (!current) return;
    if (commit && current.dragging) {
      const hit = document.elementFromPoint(current.x, current.y)?.closest<HTMLButtonElement>('button[data-slide-index]');
      current.target = hit && listRef.current?.contains(hit) ? Number(hit.dataset.slideIndex) : null;
    }
    touch.current = null;
    cancelAnimationFrame(current.frame);
    setDragged(null);
    setTarget(null);
    if (commit && !disabled && current.dragging && current.target !== null) onReorder(current.from, current.target);
  }

  return <div id="slide-reorder" className="slide-reorder" role="region" aria-label="Reorder slides"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); finishTouch(false); onClose(); } }}>
    <ol ref={listRef} className="slide-reorder-list" aria-label="Slides">
      {Array.from({ length: slides }, (_, index) => <li key={index} className="slide-reorder-item"
        data-dragging={dragged === index || undefined}
        data-drop={target === index ? (dragged !== null && dragged < index ? 'after' : 'before') : undefined}
        onDragStart={(event) => {
          if (disabled) { event.preventDefault(); return; }
          event.dataTransfer.setData(SLIDE_DRAG_TYPE, String(index));
          event.dataTransfer.effectAllowed = 'move';
          setDragged(index);
        }}
        onDragOver={(event) => {
          if (disabled || !event.dataTransfer.types.includes(SLIDE_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setTarget(dragged === index ? null : index);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
        }}
        onDrop={(event) => {
          if (disabled || !event.dataTransfer.types.includes(SLIDE_DRAG_TYPE)) return;
          event.preventDefault();
          const source = event.dataTransfer.getData(SLIDE_DRAG_TYPE);
          setDragged(null);
          setTarget(null);
          if (source !== '' && Number.isInteger(Number(source))) onReorder(Number(source), index);
        }}
        onDragEnd={() => { setDragged(null); setTarget(null); }}>
        <button type="button" className="slide-reorder-button" data-slide-index={index} aria-label={`Slide ${index + 1}`}
          aria-description="Drag to reorder, or use the left and right arrow keys." disabled={disabled} draggable={!disabled && slides > 1}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
            if (next < 0 || next >= slides) return;
            onReorder(index, next);
            const button = listRef.current?.querySelector<HTMLButtonElement>(`button[data-slide-index="${next}"]`);
            button?.focus({ preventScroll: true });
            button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' || touch.current || disabled || slides <= 1) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            touch.current = { from: index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
              x: event.clientX, y: event.clientY, dragging: false, target: null, frame: 0 };
          }}
          onPointerMove={(event) => {
            const current = touch.current;
            if (!current || current.pointerId !== event.pointerId) return;
            current.x = event.clientX;
            current.y = event.clientY;
            if (!current.dragging && Math.hypot(current.x - current.startX, current.y - current.startY) > 8) {
              current.dragging = true;
              setDragged(current.from);
              trackTouch();
            }
          }}
          onPointerUp={(event) => {
            const current = touch.current;
            if (!current || current.pointerId !== event.pointerId) return;
            current.x = event.clientX;
            current.y = event.clientY;
            finishTouch(true);
          }}
          onPointerCancel={(event) => { if (touch.current?.pointerId === event.pointerId) finishTouch(false); }}
          onLostPointerCapture={(event) => { if (touch.current?.pointerId === event.pointerId) finishTouch(false); }}>
          <span className="slide-reorder-number" aria-hidden="true">{index + 1}</span>
          <SlideThumbnail index={index} aspect={project.aspect} background={project.background} photos={photos} />
        </button>
      </li>)}
    </ol>
    <IconButton label="Close reorder slides" onClick={onClose}><X size={16} /></IconButton>
  </div>;
}
