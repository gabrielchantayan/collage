import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Download, FolderOpen, Plus, Trash2, Upload, X } from 'lucide-react';
import type { ProjectSummary } from '../storage';
import './ProjectManager.css';

export interface ProjectManagerProps {
  projects: ProjectSummary[];
  currentId: string;
  disabled: boolean;
  onOpen: (id: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onError: (message: string) => void;
}

interface ProjectRowProps {
  project: ProjectSummary;
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ProjectRow({ project, current, disabled, onOpen, onRename, onDuplicate, onDelete }: ProjectRowProps) {
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name]);
  return (
    <li className="project-manager-row" aria-current={current ? 'true' : undefined}>
      <form className="project-manager-name" onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && name.trim() && name.trim() !== project.name) onRename(name);
      }}>
        <input
          aria-label={`Project name: ${project.name || 'Untitled'}`} value={name} disabled={disabled}
          onChange={(event) => setName(event.target.value)} required
        />
        <button type="submit" disabled={disabled || !name.trim() || name.trim() === project.name}>Rename</button>
      </form>
      <div className="project-manager-row-actions">
        {current ? <span className="project-manager-current">Current</span> : (
          <button type="button" disabled={disabled} onClick={onOpen}>Open</button>
        )}
        <button type="button" disabled={disabled} onClick={onDuplicate} aria-label={`Duplicate ${project.name}`}>
          <Copy size={13} aria-hidden="true" />Duplicate
        </button>
        <button type="button" disabled={disabled} onClick={onDelete} aria-label={`Delete ${project.name}`}>
          <Trash2 size={13} aria-hidden="true" />Delete
        </button>
      </div>
    </li>
  );
}

export default function ProjectManager({
  projects, currentId, disabled, onOpen, onCreate, onRename, onDuplicate, onDelete, onExport, onImport, onError,
}: ProjectManagerProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const actionLock = useRef(false);
  const titleId = useId();
  const dialogId = useId();
  const busy = disabled || pending;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  async function run(action: () => Promise<void>, closeAfter = false) {
    if (disabled || actionLock.current) return;
    actionLock.current = true;
    setPending(true);
    setError('');
    try {
      await action();
      if (closeAfter) setOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The project action could not be completed.';
      setError(message);
      onError(message);
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button" ref={triggerRef} className="project-manager-trigger" disabled={busy}
        aria-label="Projects" title="Projects" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
        onClick={() => { setError(''); setOpen(true); }}
      >
        <FolderOpen size={16} aria-hidden="true" /><span>Projects</span>
      </button>
      {open && (
        <dialog
          id={dialogId} ref={dialogRef} className="project-manager-dialog" aria-labelledby={titleId} aria-modal="true"
          onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}
          onCancel={(event) => { event.preventDefault(); setOpen(false); }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setOpen(false);
          }}
        >
          <header className="project-manager-header">
            <h2 id={titleId}>Projects</h2>
            <button type="button" ref={closeRef} onClick={() => setOpen(false)} aria-label="Close projects">
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="project-manager-content" aria-busy={pending}>
            <button type="button" className="project-manager-create" disabled={busy} onClick={() => void run(onCreate, true)}>
              <Plus size={15} aria-hidden="true" />New project
            </button>
            <ul className="project-manager-list" aria-label="Saved projects">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id} project={project} current={project.id === currentId} disabled={busy}
                  onOpen={() => void run(() => onOpen(project.id), true)}
                  onRename={(name) => void run(() => onRename(project.id, name))}
                  onDuplicate={() => void run(() => onDuplicate(project.id), true)}
                  onDelete={() => {
                    if (busy || !window.confirm(`Delete “${project.name || 'Untitled collage'}”? This cannot be undone.`)) return;
                    void run(() => onDelete(project.id));
                  }}
                />
              ))}
            </ul>
            <div className="project-manager-backups">
              <button type="button" disabled={busy} onClick={() => void run(onExport)}>
                <Download size={15} aria-hidden="true" />Export backup
              </button>
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload size={15} aria-hidden="true" />Import backup
              </button>
              <input
                ref={fileRef} type="file" className="project-manager-file" tabIndex={-1} disabled={busy}
                aria-label="Import project backup" accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void run(() => onImport(file), true);
                }}
              />
            </div>
            {pending && <p className="project-manager-status" role="status">Saving…</p>}
            {error && <p className="project-manager-error" role="alert">{error}</p>}
          </div>
        </dialog>
      )}
    </>
  );
}
