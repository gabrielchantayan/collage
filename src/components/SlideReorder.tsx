import { useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, X } from 'lucide-react';
import { IconButton } from './Controls';
import './SlideReorder.css';

interface Props {
  slides: number;
  onReorder: (fromSlide: number, toSlide: number) => void;
  onClose: () => void;
  disabled?: boolean;
}

const SLIDE_DRAG_TYPE = 'application/x-collage-slide';

export default function SlideReorder({ slides, onReorder, onClose, disabled = false }: Props) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  return <div id="slide-reorder" className="slide-reorder" role="region" aria-label="Reorder slides"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <ol className="slide-reorder-list" aria-label="Slides">
      {Array.from({ length: slides }, (_, index) => <li key={index} className="slide-reorder-item"
        data-dragging={dragged === index || undefined}
        data-drop={target === index ? (dragged !== null && dragged < index ? 'after' : 'before') : undefined}
        draggable={!disabled && slides > 1}
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
        <button type="button" className="slide-reorder-arrow" aria-label={`Move slide ${index + 1} left`}
          disabled={disabled || index === 0} onClick={() => onReorder(index, index - 1)}>
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <span className="slide-reorder-label" role="img" aria-label={`Slide ${index + 1}`} title={`Slide ${index + 1}. Drag to reorder`}>
          <GripVertical size={12} aria-hidden="true" /><span className="slide-reorder-number" aria-hidden="true">{index + 1}</span>
        </span>
        <button type="button" className="slide-reorder-arrow" aria-label={`Move slide ${index + 1} right`}
          disabled={disabled || index === slides - 1} onClick={() => onReorder(index, index + 1)}>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </li>)}
    </ol>
    <IconButton label="Close reorder slides" onClick={onClose}><X size={16} /></IconButton>
  </div>;
}
