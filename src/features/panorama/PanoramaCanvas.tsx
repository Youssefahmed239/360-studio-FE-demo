import { useEffect, useRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
import type { EquirectangularMultiTilesPanorama } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import type { TourHotspot, TourScene, TiledPanoramaSource } from '../../types/project';

type Props = {
  scene: TourScene;
  placementMode: boolean;
  onPlaceHotspot: (yaw: number, pitch: number) => void;
  onHotspotAction: (hotspot: TourHotspot) => void;
};

type ViewerMarker = { id: string; data?: { hotspotId?: string } };
type MarkerPlugin = {
  setMarkers: (markers: Array<Record<string, unknown>>) => void;
  addEventListener: (name: 'select-marker', callback: (event: { marker: ViewerMarker }) => void) => void;
};

const degrees = (radians: number) => (radians * 180) / Math.PI;
const normalizeYaw = (yaw: number) => ((yaw % 360) + 360) % 360;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));

function makeMarkers(hotspots: TourHotspot[]) {
  return hotspots.map((hotspot) => ({
    id: hotspot.id,
    html: `<div class="studio-pano-marker"><span class="studio-pano-marker-icon">${hotspot.kind === 'navigation' ? '↗' : hotspot.kind === 'video' ? '▶' : hotspot.kind === 'audio' ? '♫' : hotspot.kind === 'image' ? '▧' : 'i'}</span><span class="studio-pano-marker-label">${escapeHtml(hotspot.title)}</span></div>`,
    anchor: 'center center',
    size: { width: Math.max(90, Math.min(190, hotspot.title.length * 7 + 44)), height: 34 },
    position: { yaw: `${hotspot.yaw}deg`, pitch: `${hotspot.pitch}deg` },
    tooltip: { content: escapeHtml(hotspot.title), position: 'top' },
    data: { hotspotId: hotspot.id },
  }));
}

function panoramaKey(scene: TourScene): string | null {
  if (scene.tiledPanorama) return `tiles:${JSON.stringify(scene.tiledPanorama)}`;
  return scene.panoramaUrl ?? null;
}

function makeTiledPanorama(source: TiledPanoramaSource): EquirectangularMultiTilesPanorama {
  return {
    ...(source.baseUrl ? { baseUrl: source.baseUrl } : {}),
    levels: source.levels.map(({ width, cols, rows }) => ({ width, cols, rows })),
    tileUrl: (col, row, level) => {
      const levelConfig = source.levels[level];
      if (!levelConfig) return null;
      return source.tileUrlTemplate
        .replaceAll('{width}', String(levelConfig.width))
        .replaceAll('{level}', String(level))
        .replaceAll('{col}', String(col))
        .replaceAll('{row}', String(row));
    },
  };
}

function panoramaInput(scene: TourScene): string | EquirectangularMultiTilesPanorama {
  return scene.tiledPanorama ? makeTiledPanorama(scene.tiledPanorama) : scene.panoramaUrl!;
}

export default function PanoramaCanvas({ scene, placementMode, onPlaceHotspot, onHotspotAction }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const pluginRef = useRef<MarkerPlugin | null>(null);
  const lastPanoramaRef = useRef<string | null>(null);
  const lastSceneIdRef = useRef<string | null>(null);
  const transitionSequenceRef = useRef(0);
  const latestRef = useRef({ placementMode, onPlaceHotspot, onHotspotAction, hotspots: scene.hotspots });
  latestRef.current = { placementMode, onPlaceHotspot, onHotspotAction, hotspots: scene.hotspots };

  const hasPanorama = Boolean(scene.tiledPanorama || scene.panoramaUrl);
  const adapterMode = scene.tiledPanorama ? 'tiled' : 'single';

  // Keep a viewer instance for each adapter type. Photo Sphere Viewer adapters are
  // selected at construction, so switching a scene between single-image and tiled
  // panoramas needs a controlled renderer recreation.
  useEffect(() => {
    if (!hasPanorama || !hostRef.current) return;

    const baseOptions = {
      container: hostRef.current,
      navbar: false,
      defaultYaw: `${scene.initialYaw}deg`,
      defaultPitch: `${scene.initialPitch}deg`,
      defaultZoomLvl: scene.initialZoom > 0 ? scene.initialZoom : 50,
      minFov: 25,
      maxFov: 100,
      moveInertia: 0.72,
      plugins: [[MarkersPlugin, { markers: makeMarkers(scene.hotspots) }]] as never,
    };
    const viewer = scene.tiledPanorama
      ? new Viewer({ ...baseOptions, adapter: EquirectangularTilesAdapter, panorama: panoramaInput(scene) as never } as never)
      : new Viewer({ ...baseOptions, panorama: scene.panoramaUrl! } as never);

    viewerRef.current = viewer;
    pluginRef.current = viewer.getPlugin(MarkersPlugin) as unknown as MarkerPlugin;
    lastPanoramaRef.current = panoramaKey(scene);
    lastSceneIdRef.current = scene.id;

    viewer.addEventListener('click', ({ data }) => {
      if (data.rightclick || !latestRef.current.placementMode) return;
      latestRef.current.onPlaceHotspot(normalizeYaw(degrees(data.yaw)), degrees(data.pitch));
    });

    pluginRef.current.addEventListener('select-marker', ({ marker }) => {
      const id = marker.data?.hotspotId ?? marker.id;
      const hotspot = latestRef.current.hotspots.find((item) => item.id === id);
      if (hotspot) latestRef.current.onHotspotAction(hotspot);
    });

    return () => {
      transitionSequenceRef.current += 1;
      lastPanoramaRef.current = null;
      lastSceneIdRef.current = null;
      pluginRef.current = null;
      viewerRef.current = null;
      viewer.destroy();
    };
    // `adapterMode` controls renderer lifetime; source changes of the same type are
    // handled by setPanorama below so the viewer can perform a configured transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPanorama, adapterMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || (!scene.tiledPanorama && !scene.panoramaUrl)) return;

    const nextPanoramaKey = panoramaKey(scene);
    const samePanorama = lastPanoramaRef.current === nextPanoramaKey;
    const sameScene = lastSceneIdRef.current === scene.id;
    if (samePanorama && sameScene) return;

    const transitionSequence = ++transitionSequenceRef.current;
    const duration = Math.max(0, scene.transition.durationMs);
    const targetZoom = scene.initialZoom > 0 ? scene.initialZoom : 50;
    const targetPosition = { yaw: `${scene.initialYaw}deg`, pitch: `${scene.initialPitch}deg` };
    lastSceneIdRef.current = scene.id;
    if (samePanorama) {
      void viewer.animate({ ...targetPosition, zoom: targetZoom, speed: Math.max(1, duration), easing: 'inOutSine' });
      return;
    }
    lastPanoramaRef.current = nextPanoramaKey;

    if (scene.transition.kind === 'zoom') {
      // Zoom into the outgoing scene, switch while close, then widen into the destination.
      void (async () => {
        try {
          await viewer.animate({ zoom: 92, speed: Math.max(1, duration / 2), easing: 'inOutSine' });
          if (transitionSequence !== transitionSequenceRef.current) return;
          await viewer.setPanorama(panoramaInput(scene) as never, { transition: false, position: targetPosition, zoom: 18, showLoader: true } as never);
          if (transitionSequence !== transitionSequenceRef.current) return;
          await viewer.animate({ zoom: targetZoom, speed: Math.max(1, duration / 2), easing: 'inOutSine' });
        } catch {
          if (transitionSequence === transitionSequenceRef.current) lastPanoramaRef.current = null;
        }
      })();
      return;
    }

    const effect: 'black' | 'fade' = scene.transition.kind === 'fade-through-black' ? 'black' : 'fade';
    const transition = scene.transition.kind === 'none' ? false : { effect, speed: duration, rotation: true };
    void viewer.setPanorama(panoramaInput(scene) as never, {
      transition,
      position: targetPosition,
      zoom: targetZoom,
      showLoader: true,
    } as never).catch(() => {
      if (transitionSequence === transitionSequenceRef.current) lastPanoramaRef.current = null;
    });
  }, [scene.id, scene.panoramaUrl, scene.tiledPanorama, scene.initialYaw, scene.initialPitch, scene.initialZoom, scene.transition]);

  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    plugin.setMarkers(makeMarkers(scene.hotspots));
  }, [scene.hotspots, scene.id]);

  return <div
    ref={hostRef}
    className={`panorama-viewer${placementMode ? ' placing-hotspot' : ''}`}
    aria-label={hasPanorama ? `Interactive 360-degree panorama: ${scene.name}` : '360-degree panorama canvas'}
  />;
}
