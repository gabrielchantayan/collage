import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadBackup, readBackup } from './backup';
import { initialProject } from './model';
import type { Project } from './model';
import { newSavedProject, pruneUnusedSources, readProjectLibrary, updateProjectLibrary } from './storage';
import type { ProjectLibrary, ProjectSummary } from './storage';

export type { ProjectSummary } from './storage';

interface History {
  past: Project[];
  present: Project;
  future: Project[];
}
type Action =
  | { type: 'load'; project: Project }
  | { type: 'change'; update: (project: Project) => Project }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(state: History, action: Action): History {
  if (action.type === 'load') return { past: [], present: action.project, future: [] };
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
  }
  const next = action.update(state.present);
  if (next === state.present) return state;
  return { past: [...state.past.slice(-49), state.present], present: next, future: [] };
}

function quotaError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

function saveError(error: unknown): string {
  return quotaError(error)
    ? 'Browser storage is full. Your current project is still open, but the latest changes could not be saved. Export a project backup before closing this tab; free browser storage before switching projects.'
    : 'Could not save locally. Your current project is still open. Export a project backup before closing this tab; restore access to browser storage before switching projects.';
}

export function useProject() {
  const [history, setHistory] = useState<History>({ past: [], present: initialProject, future: [] });
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [storageError, setStorageError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectBusy, setProjectBusy] = useState(false);
  const loading = useRef<Promise<{ library: ProjectLibrary; warning: string }> | null>(null);
  const historyRef = useRef(history);
  const readyRef = useRef(false);
  const idRef = useRef('');
  const savedRef = useRef<Project | null>(null);
  const generation = useRef(0);
  const busyCount = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const applyLibrary = useCallback((library: ProjectLibrary) => {
    setProjects(library.projects.map(({ id, updatedAt, project }) => ({ id, name: project.name, updatedAt })));
  }, []);

  const activate = useCallback((library: ProjectLibrary) => {
    const entry = library.projects.find(({ id }) => id === library.currentId);
    if (!entry) throw new Error('The requested project is missing from the saved library.');
    generation.current += 1;
    idRef.current = entry.id;
    savedRef.current = entry.project;
    historyRef.current = { past: [], present: entry.project, future: [] };
    setHistory(historyRef.current);
    setProjectId(entry.id);
    applyLibrary(library);
    setSaveState('saved');
    setStorageError('');
  }, [applyLibrary]);

  // Updating this ref synchronously also captures edits dispatched immediately
  // before a project action, before React has rendered those edits.
  const dispatch = useCallback((action: Action) => {
    if (!readyRef.current || busyCount.current) return;
    const next = reducer(historyRef.current, action);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    setSaveState(next.present === savedRef.current ? 'saved' : 'saving');
  }, []);

  const enqueue = useCallback((work: () => Promise<void>): Promise<void> => {
    const result = queue.current.then(work);
    queue.current = result.catch(() => undefined);
    return result;
  }, []);

  const saveActive = useCallback(async () => {
    const project = historyRef.current.present;
    if (!readyRef.current || savedRef.current === project) return;
    const id = idRef.current;
    const token = generation.current;
    setSaveState('saving');
    try {
      const library = await updateProjectLibrary((current) => {
        if (!current.projects.some((entry) => entry.id === id)) {
          throw new Error('This project was removed from browser storage. Your open edits have not been discarded.');
        }
        return {
          ...current,
          projects: current.projects.map((entry) => entry.id === id ? { ...entry, project, updatedAt: Date.now() } : entry),
        };
      });
      if (idRef.current !== id || generation.current !== token) return;
      savedRef.current = project;
      applyLibrary(library);
      setStorageError('');
      setSaveState(historyRef.current.present === project ? 'saved' : 'saving');
    } catch (error) {
      const message = saveError(error);
      if (idRef.current === id && generation.current === token) {
        setSaveState('error');
        setStorageError(message);
      }
      throw new Error(message);
    }
  }, [applyLibrary]);

  useEffect(() => {
    if (readyRef.current) return;
    let active = true;
    // StrictMode effect re-entry must not repeat migration or source cleanup.
    if (!loading.current) {
      loading.current = readProjectLibrary().then(async (library) => {
        let warning = '';
        try {
          await pruneUnusedSources();
        } catch {
          warning = 'Your saved projects are preserved, but unused photo storage could not be cleaned up.';
        }
        return { library, warning };
      });
    }
    void loading.current.then(({ library, warning }) => {
      if (!active) return;
      activate(library);
      readyRef.current = true;
      setReady(true);
      setStorageError(warning);
    }).catch((error: unknown) => {
      if (!active) return;
      setSaveState('error');
      const reason = quotaError(error) ? 'Browser storage is full.' : 'Could not open the saved project library.';
      setStorageError(`${reason} Your original saved data has not been changed. Keep any other open workspace tabs open and restore access to browser storage before reopening.`);
      // No loaded project means no editing, autosave, or blank overwrite.
    });
    return () => { active = false; };
  }, [activate]);

  useEffect(() => {
    if (!ready || projectBusy || history.present === savedRef.current) return;
    const timer = window.setTimeout(() => {
      void enqueue(saveActive).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [enqueue, history.present, projectBusy, ready, saveActive]);

  const runProjectOperation = useCallback((operation: () => Promise<void>, flush = true): Promise<void> => {
    busyCount.current += 1;
    setProjectBusy(true);
    return enqueue(async () => {
      if (!readyRef.current) throw new Error('The saved project library is not ready.');
      // A backup can rescue in-memory edits even when local saving fails.
      if (flush) await saveActive();
      await operation();
    }).catch((error: unknown) => {
      if (quotaError(error)) {
        throw new Error('Browser storage is full. The project operation was not saved; your open project and existing backups are unchanged. Free browser storage and try again.');
      }
      throw error;
    }).finally(() => {
      busyCount.current -= 1;
      setProjectBusy(busyCount.current > 0);
    });
  }, [enqueue, saveActive]);

  const createProject = useCallback((): Promise<void> => runProjectOperation(async () => {
    const entry = newSavedProject();
    const library = await updateProjectLibrary((current) => ({
      ...current, currentId: entry.id, projects: [...current.projects, entry],
    }));
    activate(library);
  }), [activate, runProjectOperation]);

  const openProject = useCallback((id: string): Promise<void> => runProjectOperation(async () => {
    if (idRef.current === id) return;
    const library = await updateProjectLibrary((current) => {
      if (!current.projects.some((entry) => entry.id === id)) throw new Error('This saved project no longer exists.');
      return { ...current, currentId: id };
    });
    activate(library);
  }), [activate, runProjectOperation]);

  const renameProject = useCallback((id: string, name: string): Promise<void> => runProjectOperation(async () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a project name.');
    const library = await updateProjectLibrary((current) => {
      if (!current.projects.some((entry) => entry.id === id)) throw new Error('This saved project no longer exists.');
      return {
        ...current,
        projects: current.projects.map((entry) => entry.id === id
          ? { ...entry, updatedAt: Date.now(), project: { ...entry.project, name: trimmed } } : entry),
      };
    });
    applyLibrary(library);
    if (idRef.current === id) {
      const project = library.projects.find((entry) => entry.id === id)!.project;
      historyRef.current = reducer(historyRef.current, { type: 'change', update: () => project });
      savedRef.current = project;
      setHistory(historyRef.current);
      setSaveState('saved');
    }
  }), [applyLibrary, runProjectOperation]);

  const duplicateProject = useCallback((id: string): Promise<void> => runProjectOperation(async () => {
    const library = await updateProjectLibrary((current) => {
      const original = current.projects.find((entry) => entry.id === id);
      if (!original) throw new Error('This saved project no longer exists.');
      // Only metadata is duplicated. Original source IDs remain shared.
      const entry = newSavedProject({ ...original.project, name: `${original.project.name || initialProject.name} copy` });
      return { ...current, currentId: entry.id, projects: [...current.projects, entry] };
    });
    activate(library);
  }), [activate, runProjectOperation]);

  const deleteProject = useCallback((id: string): Promise<void> => runProjectOperation(async () => {
    const deletingActive = id === idRef.current;
    const library = await updateProjectLibrary((current) => {
      if (!current.projects.some((entry) => entry.id === id)) throw new Error('This saved project no longer exists.');
      const remaining = current.projects.filter((entry) => entry.id !== id);
      if (!remaining.length) remaining.push(newSavedProject());
      return {
        ...current, projects: remaining,
        currentId: deletingActive || current.currentId === id ? remaining[0].id : current.currentId,
      };
    });
    if (deletingActive) activate(library);
    else applyLibrary(library);
  }), [activate, applyLibrary, runProjectOperation]);

  const exportBackup = useCallback((): Promise<void> => runProjectOperation(async () => {
    await downloadBackup(historyRef.current.present);
  }, false), [runProjectOperation]);

  const importBackup = useCallback((file: File): Promise<void> => runProjectOperation(async () => {
    const imported = await readBackup(file);
    const entry = newSavedProject(imported.project);
    const library = await updateProjectLibrary((current) => ({
      ...current, currentId: entry.id, projects: [...current.projects, entry],
    }), imported.sources);
    activate(library);
  }), [activate, runProjectOperation]);

  return {
    project: history.present, dispatch, ready, saveState, storageError,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    projectId, projects, projectBusy, createProject, openProject, renameProject,
    duplicateProject, deleteProject, exportBackup, importBackup,
  };
}
