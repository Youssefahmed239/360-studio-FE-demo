import { create } from 'zustand';
import type { TourProject, TourScene } from '../../types/project';
import { restoreUploadedAssetUrls, stripTransientAssetUrls } from '../assets/assetStorage';

const STORAGE_KEY = '360-studio-demo-project-v1';
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export function createStarterProject(): TourProject {
  const lobbyId = id();
  const ballroomId = id();
  return {
    schemaVersion: 1,
    id: id(),
    name: 'My first virtual experience',
    updatedAt: now(),
    settings: { brandName: 'Your Event', accentColor: '#a3e635', startSceneId: lobbyId, allowFullscreen: true },
    assets: [],
    scenes: [
      { id: lobbyId, name: 'Welcome Lobby', initialYaw: 0, initialPitch: 0, initialZoom: 0, transition: { kind: 'fade', durationMs: 700 }, audio: { autoplayAfterGesture: true, loop: false, volume: 0.7 }, hotspots: [{ id: id(), kind: 'navigation', title: 'Explore the Ballroom', yaw: 35, pitch: -5, targetSceneId: ballroomId }] },
      { id: ballroomId, name: 'Main Ballroom', initialYaw: 0, initialPitch: 0, initialZoom: 0, transition: { kind: 'fade-through-black', durationMs: 900 }, audio: { autoplayAfterGesture: true, loop: true, volume: 0.45 }, hotspots: [{ id: id(), kind: 'navigation', title: 'Back to Lobby', yaw: -120, pitch: -3, targetSceneId: lobbyId }] },
    ],
  };
}

interface ProjectState {
  project: TourProject;
  activeSceneId: string;
  saveState: 'saved' | 'unsaved' | 'saving' | 'error';
  setProjectName: (name: string) => void;
  selectScene: (id: string) => void;
  addScene: () => void;
  updateScene: (id: string, patch: Partial<TourScene>) => void;
  updateProject: (project: TourProject) => void;
  save: () => void;
  load: () => Promise<boolean>;
  replaceProject: (project: TourProject) => void;
}

function isProject(value: unknown): value is TourProject {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<TourProject>;
  return p.schemaVersion === 1 && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.scenes) && Array.isArray(p.assets) && !!p.settings;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const initial = createStarterProject();
  return {
    project: initial,
    activeSceneId: initial.scenes[0].id,
    saveState: 'saved',
    setProjectName: (name) => set((state) => ({ project: { ...state.project, name, updatedAt: now() }, saveState: 'unsaved' })),
    selectScene: (activeSceneId) => set({ activeSceneId, saveState: 'unsaved' }),
    addScene: () => {
      const scene: TourScene = { id: id(), name: `New Scene ${get().project.scenes.length + 1}`, initialYaw: 0, initialPitch: 0, initialZoom: 0, transition: { kind: 'fade', durationMs: 700 }, hotspots: [] };
      set((state) => ({ project: { ...state.project, scenes: [...state.project.scenes, scene], updatedAt: now() }, activeSceneId: scene.id, saveState: 'unsaved' }));
    },
    updateScene: (sceneId, patch) => set((state) => ({ project: { ...state.project, scenes: state.project.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene), updatedAt: now() }, saveState: 'unsaved' })),
    updateProject: (project) => set({ project: { ...project, updatedAt: now() }, saveState: 'unsaved' }),
    save: () => {
      set({ saveState: 'saving' });
      try {
        const state = get();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ draftVersion: 1, activeSceneId: state.activeSceneId, project: stripTransientAssetUrls(state.project) }));
        set({ saveState: 'saved' });
      }
      catch { set({ saveState: 'error' }); }
    },
    load: async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const parsed: unknown = JSON.parse(raw);
        // Backward-compatible with v0.1 drafts that stored the project directly.
        const isEnvelope = !!parsed && typeof parsed === 'object' && 'project' in parsed;
        const projectValue = isEnvelope ? (parsed as { project?: unknown }).project : parsed;
        if (!isProject(projectValue)) return false;
        const restored = await restoreUploadedAssetUrls(projectValue);
        const storedSceneId = isEnvelope ? (parsed as { activeSceneId?: unknown }).activeSceneId : undefined;
        const preferredSceneId = typeof storedSceneId === 'string' && restored.scenes.some((scene) => scene.id === storedSceneId)
          ? storedSceneId
          : restored.scenes.find((scene) => scene.id === restored.settings.startSceneId)?.id ?? restored.scenes[0]?.id ?? '';
        set({ project: restored, activeSceneId: preferredSceneId, saveState: 'saved' });
        return true;
      } catch { set({ saveState: 'error' }); return false; }
    },
    replaceProject: (project) => set({ project, activeSceneId: project.scenes.find((scene) => scene.id === project.settings.startSceneId)?.id ?? project.scenes[0]?.id ?? '', saveState: 'unsaved' }),
  };
});

export const projectStorageKey = STORAGE_KEY;
