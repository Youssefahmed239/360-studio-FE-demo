import { useEffect, useRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import type { TourHotspot, TourScene } from '../../types/project';

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

export default function PanoramaCanvas({ scene, placementMode, onPlaceHotspot, onHotspotAction }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const pluginRef = useRef<MarkerPlugin | null>(null);
  const lastPanoramaRef = useRef<string | null>(null);
  const lastSceneIdRef = useRef<string | null>(null);
  const transitionSequenceRef = useRef(0);
  const latestRef = useRef({ placementMode, onPlaceHotspot, onHotspotAction, hotspots: scene.hotspots });
  latestRef.current = { placementMode, onPlaceHotspot, onHotspotAction, hotspots: scene.hotspots };

  const hasPanorama = Boolean(scene.panoramaUrl);

  // Create one viewer for the active canvas. Changing from a scene with a panorama
  // to one without one disposes the WebGL renderer so it does not retain GPU memory.
  useEffect(() => {
    if (!hasPanorama || !scene.panoramaUrl || !hostRef.current) return;

    const viewer = new Viewer({
      container: hostRef.current,
      panorama: scene.panoramaUrl,
      navbar: false,
      defaultYaw: `${scene.initialYaw}deg`,
      defaultPitch: `${scene.initialPitch}deg`,
      defaultZoomLvl: scene.initialZoom > 0 ? scene.initialZoom : 50,
      minFov: 25,
      maxFov: 100,
      moveInertia: 0.72,
      plugins: [[MarkersPlugin, { markers: makeMarkers(scene.hotspots) }]],
    });

    viewerRef.current = viewer;
    pluginRef.current = viewer.getPlugin(MarkersPlugin) as unknown as MarkerPlugin;
    lastPanoramaRef.current = scene.panoramaUrl;
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
      lastPanoramaRef.current = null;
      lastSceneIdRef.current = null;
      pluginRef.current = null;
      viewerRef.current = null;
      viewer.destroy();
    };
    // `hasPanorama` intentionally controls the renderer lifetime. Scene source changes
    // are handled below with setPanorama so the viewer can perform a scene transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPanorama]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !scene.panoramaUrl) return;

    const samePanorama = lastPanoramaRef.current === scene.panoramaUrl;
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
    lastPanoramaRef.current = scene.panoramaUrl;

    if (scene.transition.kind === 'zoom') {
      // Zoom into the outgoing scene, switch while close, then widen into the destination.
      void (async () => {
        try {
          await viewer.animate({ zoom: 92, speed: Math.max(1, duration / 2), easing: 'inOutSine' });
          if (transitionSequence !== transitionSequenceRef.current) return;
          await viewer.setPanorama(scene.panoramaUrl!, { transition: false, position: targetPosition, zoom: 18, showLoader: true });
          if (transitionSequence !== transitionSequenceRef.current) return;
          await viewer.animate({ zoom: targetZoom, speed: Math.max(1, duration / 2), easing: 'inOutSine' });
        } catch {
          // The viewer shows its own loading/error state; do not break the editor.
          if (transitionSequence === transitionSequenceRef.current) lastPanoramaRef.current = null;
        }
      })();
      return;
    }

    const effect: 'black' | 'fade' = scene.transition.kind === 'fade-through-black' ? 'black' : 'fade';
    const transition = scene.transition.kind === 'none' ? false : { effect, speed: duration, rotation: true };
    void viewer.setPanorama(scene.panoramaUrl, {
      transition,
      position: targetPosition,
      zoom: targetZoom,
      showLoader: true,
    }).catch(() => {
      // The viewer displays its own loader/error state; keep the editor alive.
      if (transitionSequence === transitionSequenceRef.current) lastPanoramaRef.current = null;
    });
  }, [scene.id, scene.panoramaUrl, scene.initialYaw, scene.initialPitch, scene.initialZoom, scene.transition]);

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
