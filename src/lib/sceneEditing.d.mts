import type { TourProject, TourScene } from '../types/project.js';

export function reorderById<T extends { id: string }>(items: readonly T[], sourceId: string, targetId: string, afterTarget?: boolean): T[];
export interface DeleteSceneResult {
  project: TourProject;
  removedScene: TourScene;
  removedNavigationHotspots: number;
  orphanedAssetIds: string[];
  orphanedUploadedAssetIds: string[];
  nextActiveSceneId: string;
}
export function deleteSceneFromProject(project: TourProject, sceneId: string, updatedAt?: string): DeleteSceneResult;
