export type HotspotKind = 'navigation' | 'image' | 'video' | 'audio' | 'info';
export type TransitionKind = 'fade' | 'fade-through-black' | 'zoom' | 'none';

/** One resolution band in a multi-resolution equirectangular panorama. */
export interface TiledPanoramaLevel {
  /** Full panorama width represented by this level; height is width / 2. */
  width: number;
  cols: number;
  rows: number;
  /** Photo Sphere Viewer zoom range for selecting this level. */
  zoomRange: [number, number];
}

/** Resolved, runtime-ready tile settings. All URLs are absolute so scene changes do not depend on the current route. */
export interface TiledPanoramaSource {
  manifestUrl: string;
  baseUrl?: string;
  tileUrlTemplate: string;
  levels: TiledPanoramaLevel[];
  sourceWidth?: number;
  sourceHeight?: number;
  originalUrl?: string;
  /** Asset IDs used when a portable ZIP embeds its preview and original. */
  baseAssetId?: string;
  originalAssetId?: string;
  /** Relative tile path to project asset ID for offline portable archives. */
  embeddedFiles?: Record<string, string>;
}

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
  /** Optional progressive tiled source. When present, this is preferred over panoramaUrl. */
  tiledPanorama?: TiledPanoramaSource;
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
