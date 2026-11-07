import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, FileArchive, Share2, X } from 'lucide-react';
import { downloadZip, renderSlides, type RenderedSlide } from '../export';
import { SLIDE_WIDTH, slideHeight, type Project } from '../model';
import './ExportDialog.css';

interface ExportDialogProps {
  project: Project;
  onClose: () => void;
}

interface ExportState {
  status: 'rendering' | 'ready' | 'error';
  completed: number;
  slides: RenderedSlide[];
  error: string;
}

interface ExportJob {
  project: Project;
  started: boolean;
  active: boolean;
  state: ExportState;
  notify?: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function releaseSlides(job: ExportJob) {
  for (const slide of job.state.slides) URL.revokeObjectURL(slide.url);
  job.state = { ...job.state, slides: [] };
}

function startExport(job: ExportJob) {
  if (job.started) return;
  job.started = true;
  void renderSlides(job.project, (completed) => {
    job.state = { ...job.state, completed };
    job.notify?.();
  }).then((slides) => {
    job.state = { status: 'ready', completed: slides.length, slides, error: '' };
    if (job.active) job.notify?.();
    else releaseSlides(job);
  }, (error: unknown) => {
    job.state = { ...job.state, status: 'error', error: errorMessage(error) };
    job.notify?.();
  });
}

function downloadImage(slide: RenderedSlide) {
  const anchor = document.createElement('a');
  anchor.href = slide.url;
  anchor.download = slide.name;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

export default function ExportDialog({ project, onClose }: ExportDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const live = useRef(false);
  const jobRef = useRef<ExportJob | null>(null);
  const [state, setState] = useState<ExportState>({
    status: 'rendering', completed: 0, slides: [], error: '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let job = jobRef.current;
    if (!job || job.project !== project) {
      job = {
        project, started: false, active: false,
        state: { status: 'rendering', completed: 0, slides: [], error: '' },
      };
      jobRef.current = job;
    }
    const current = job;
    current.active = true;
    current.notify = () => setState(current.state);
    setState(current.state);
    setActionError('');
    startExport(current);
    return () => {
      current.active = false;
      current.notify = undefined;
      // StrictMode immediately reattaches to this same job. A real unmount
      // releases completed URLs here, or in startExport when it finishes.
      queueMicrotask(() => {
        if (!current.active) releaseSlides(current);
      });
    };
  }, [project]);

  useEffect(() => {
    live.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });

    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) {
          event.preventDefault();
          dialogRef.current?.focus();
        } else if (!dialogRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) {
        (focusable()[0] ?? dialogRef.current)?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      live.current = false;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const files = useMemo(() => state.slides.map((slide) => {
    const file = new File([slide.blob], slide.name, { type: 'image/png' });
    let shareable = false;
    try {
      shareable = typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] });
    } catch {
      // Some browsers expose Web Share but reject file capability checks.
    }
    return { file, shareable };
  }), [state.slides]);

  async function saveImage(index: number) {
    const slide = state.slides[index];
    const entry = files[index];
    if (!slide || !entry || busy) return;
    setActionError('');
    if (!entry.shareable) {
      try {
        downloadImage(slide);
      } catch (error) {
        setActionError(`Could not download the image: ${errorMessage(error)} You can long-press the preview instead.`);
      }
      return;
    }
    setBusy(slide.name);
    try {
      await navigator.share({ files: [entry.file], title: `Slide ${index + 1}` });
    } catch (error) {
      if (live.current && !(error instanceof DOMException && error.name === 'AbortError')) {
        setActionError('Sharing could not be opened. Use Download file below the image, or long-press its preview to save it.');
      }
    } finally {
      if (live.current) setBusy(null);
    }
  }

  async function saveZip() {
    if (busy) return;
    setBusy('zip');
    setActionError('');
    try {
      await downloadZip(state.slides, project.name);
    } catch (error) {
      if (live.current) setActionError(`Could not download the ZIP: ${errorMessage(error)} You can still save images individually.`);
    } finally {
      if (live.current) setBusy(null);
    }
  }

  return (
    <div className="export-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="export-dialog" ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}
      >
        <header className="export-header">
          <div>
            <h2 id={titleId}>Export slides</h2>
          </div>
          <button type="button" ref={closeRef} className="export-close" onClick={onClose} aria-label="Close export dialog">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="export-content">
          <p className="export-description" id={descriptionId}>
            PNG · {SLIDE_WIDTH} × {slideHeight(project.aspect)} px
          </p>
          {state.status === 'rendering' && (
            <div className="export-progress" role="status" aria-live="polite">
              <p>Preparing your slides… {state.completed} / {project.slides}</p>
              <progress aria-label="Slides exported" value={state.completed} max={project.slides} />
            </div>
          )}
          {state.status === 'error' && (
            <div className="export-error" role="alert">
              <p>Export could not be completed.</p>
              <p>{state.error}</p>
              <p>Close this window and try again. Your collage has not been changed.</p>
            </div>
          )}
          {actionError && <p className="export-error" role="alert">{actionError}</p>}
          {state.status === 'ready' && (
            <>
              <div className="export-actions">
                <p>{state.slides.length} slides</p>
                <button type="button" className="export-zip" onClick={() => void saveZip()} disabled={busy !== null}>
                  <FileArchive size={17} aria-hidden="true" />
                  {busy === 'zip' ? 'Creating ZIP…' : 'Download all as ZIP'}
                </button>
              </div>
              <p className="export-save-help">
                Save / share opens your device’s save options. Or download a PNG or long-press a preview.
              </p>
              <ol className="export-grid">
                {state.slides.map((slide, index) => (
                  <li className="export-slide" key={slide.name}>
                    <div className="export-slide-label"><span>SLIDE {String(index + 1).padStart(2, '0')}</span><span>PNG</span></div>
                    <img className="export-preview" src={slide.url} alt={`Exported slide ${index + 1}`} loading="lazy" draggable={false} width={SLIDE_WIDTH} height={slideHeight(project.aspect)} />
                    <button type="button" className="export-save" onClick={() => void saveImage(index)} disabled={busy !== null}>
                      {files[index]?.shareable ? <Share2 size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                      {busy === slide.name ? 'Opening share menu…' : files[index]?.shareable ? 'Save / share image' : 'Download image'}
                      <span className="export-sr-only"> {index + 1}</span>
                    </button>
                    {files[index]?.shareable && (
                      <a className="export-download-link" href={slide.url} download={slide.name}>Download file<span className="export-sr-only"> for slide {index + 1}</span></a>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
