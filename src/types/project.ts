export type HotspotKind = 'navigation' | 'image' | 'video' | 'audio' | 'info';
export type TransitionKind = 'fade' | 'fade-through-black' | 'zoom' | 'none';

export interface TourHotspot {
  id: string;
  kind: HotspotKind;
  title: string;
  yaw: number;
  pitch: number;
  targetSceneId?: string;
  assetId?: string;
  url?: string;
}

export interface TourScene {
  id: string;
  name: string;
  panoramaAssetId?: string;
  panoramaUrl?: string;
  initialYaw: number;
  initialPitch: number;
  initialZoom: number;
  transition: { kind: TransitionKind; durationMs: number };
  audio?: { assetId?: string; url?: string; autoplayAfterGesture: boolean; loop: boolean; volume: number };
  hotspots: TourHotspot[];
}

export interface TourAsset {
  id: string;
  name: string;
  kind: 'panorama' | 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  source: 'uploaded' | 'url';
  url?: string;
  originalFileName?: string;
}

export interface TourProject {
  schemaVersion: 1;
  id: string;
  name: string;
  updatedAt: string;
  settings: { brandName: string; accentColor: string; startSceneId: string; allowFullscreen: boolean };
  scenes: TourScene[];
  assets: TourAsset[];
}
