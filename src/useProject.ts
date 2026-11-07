import { useEffect, useReducer, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { initialProject } from './model';
import type { Project, StoredProject } from './model';
import { pruneUnusedSources, restoreProject } from './storage';

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

type StorageOperation = 'load' | 'migrate' | 'cleanup' | 'save';

function describeStorageError(error: unknown, operation: StorageOperation): string {
  const quota = typeof error === 'object' && error !== null && 'name' in error
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
  if (operation === 'save') {
    return quota
      ? 'Browser storage is full. Your current project is still open, but the latest changes could not be saved. Export your current work before closing this tab, and free browser storage.'
      : 'Could not save locally. Your current project is still open. Export your current work before closing this tab.';
  }
  const preserved = operation === 'migrate'
    ? 'Your original saved project is unchanged.'
    : operation === 'cleanup'
      ? 'Your loaded project is preserved, but unused photo storage could not be cleaned up.'
      : 'Your saved project has not been changed.';
  const reason = quota ? 'Browser storage is full.' : operation === 'migrate' ? 'Could not migrate your saved project.' : 'Could not open local storage.';
  return `${reason} ${preserved} ${quota ? 'Free browser storage, then reopen this workspace.' : 'Keep this tab open and restore access to browser storage before reopening.'} Export current work in any other open workspace tabs before closing them.`;
}

export function useProject() {
  const [history, dispatch] = useReducer(reducer, { past: [], present: initialProject, future: [] });
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [storageError, setStorageError] = useState('');
  const loading = useRef<Promise<Project> | null>(null);
  const loadOperation = useRef<Exclude<StorageOperation, 'save'>>('load');
  const skipInitialSave = useRef(true);

  useEffect(() => {
    let active = true;
    // Reuse the same load through StrictMode effect cleanup/re-entry.
    if (!loading.current) {
      loading.current = get<StoredProject>('collage-project').then(async (saved) => {
        if (saved !== undefined && saved.version !== 3) loadOperation.current = 'migrate';
        const project = saved === undefined ? initialProject : await restoreProject(saved);
        loadOperation.current = 'cleanup';
        await pruneUnusedSources(new Set(project.assets.map((asset) => asset.id)));
        return project;
      });
    }
    void loading.current.then((project) => {
      if (!active) return;
      dispatch({ type: 'load', project });
      setStorageError('');
      setSaveState('saved');
      setReady(true);
    }).catch((error: unknown) => {
      if (!active) return;
      setSaveState('error');
      setStorageError(describeStorageError(error, loadOperation.current));
      // Without a safely loaded project, never enable editing or autosave.
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }
    let active = true;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      set('collage-project', history.present).then(() => {
        if (active) {
          setSaveState('saved');
          setStorageError('');
        }
      }).catch((error: unknown) => {
        if (active) {
          setSaveState('error');
          setStorageError(describeStorageError(error, 'save'));
        }
      });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [history.present, ready]);

  return { project: history.present, dispatch, ready, saveState, storageError,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
