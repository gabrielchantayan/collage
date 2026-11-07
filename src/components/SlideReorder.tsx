import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, GripVertical, Link2, X } from 'lucide-react';
import type { Project } from '../model';
import { slideBlocks } from '../slides';
import './SlideReorder.css';

export interface SlideReorderProps {
  project: Project;
  onReorder: (fromSlide: number, toSlide: number) => void;
  disabled?: boolean;
}

const SLIDE_DRAG_TYPE = 'application/x-collage-slide';

export default function SlideReorder({ project, onReorder, disabled = false }: SlideReorderProps) {
  const blocks = useMemo(() => slideBlocks(project), [project]);
  const [dragged, setDragged] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => { dialog.close(); triggerRef.current?.focus({ preventScroll: true }); };
  }, [open]);
  return <>
    <button ref={triggerRef} className="slide-reorder-trigger" disabled={disabled} aria-label="Reorder slides" title="Reorder slides"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><ArrowLeftRight size={14} /><span>Reorder slides</span></button>
    {open && <dialog ref={dialogRef} className="slide-reorder" aria-labelledby={titleId}
      onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
    <header><h2 id={titleId}>Reorder slides</h2><button aria-label="Close reorder slides" onClick={() => setOpen(false)}><X size={17} /></button></header>
    <p className="slide-reorder-hint">Drag or use arrows. Linked slides move together.</p>
    <ol className="slide-reorder-list" aria-label="Slide blocks">
      {blocks.map((block, index) => {
        const linked = block.start !== block.end;
        const numbers = Array.from({ length: block.end - block.start + 1 }, (_, offset) => block.start + offset + 1);
        const label = linked ? `Slides ${block.start + 1}–${block.end + 1}, linked` : `Slide ${block.start + 1}`;
        return <li key={`${block.start}-${block.end}`} className="slide-reorder-block"
          data-dragging={dragged === block.start || undefined}
          data-drop={target === block.start ? (dragged !== null && dragged < block.start ? 'after' : 'before') : undefined}
          draggable={!disabled && blocks.length > 1}
          onDragStart={(event) => {
            if (disabled) { event.preventDefault(); return; }
            event.dataTransfer.setData(SLIDE_DRAG_TYPE, String(block.start));
            event.dataTransfer.effectAllowed = 'move';
            setDragged(block.start);
          }}
          onDragOver={(event) => {
            if (disabled || !event.dataTransfer.types.includes(SLIDE_DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setTarget(dragged === block.start ? null : block.start);
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
            if (source !== '' && Number.isInteger(Number(source))) onReorder(Number(source), block.start);
          }}
          onDragEnd={() => { setDragged(null); setTarget(null); }}>
          <button type="button" className="slide-reorder-arrow" aria-label={`Move ${label.toLowerCase()} left`}
            disabled={disabled || index === 0} onClick={() => onReorder(block.start, blocks[index - 1].start)}>
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <span className="slide-reorder-label" role="img" aria-label={label} title={linked ? `${label}. Linked slides move together` : `${label}. Drag to reorder`}>
            {linked ? <Link2 size={13} aria-hidden="true" /> : <GripVertical size={12} aria-hidden="true" />}
            <span className="slide-reorder-numbers" aria-hidden="true">{numbers.map((number) => <span key={number}>{number}</span>)}</span>
          </span>
          <button type="button" className="slide-reorder-arrow" aria-label={`Move ${label.toLowerCase()} right`}
            disabled={disabled || index === blocks.length - 1} onClick={() => onReorder(block.start, blocks[index + 1].start)}>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </li>;
      })}
    </ol>
    <footer><button className="primary" onClick={() => setOpen(false)}>Done</button></footer>
    </dialog>}
  </>;
}
