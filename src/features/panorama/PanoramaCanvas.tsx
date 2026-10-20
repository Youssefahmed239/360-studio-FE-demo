import { useEffect, useRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
import type { EquirectangularMultiTilesPanorama } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import type { TourAsset, TourHotspot, TourScene, TiledPanoramaSource } from '../../types/project';

type Props = {
  scene: TourScene;
  assets: TourAsset[];
  placementMode: boolean;
  previewMode: boolean;
  moveHotspotId: string | null;
  onMoveHotspot: (hotspotId: string, yaw: number, pitch: number) => void;
  onPlaceHotspot: (yaw: number, pitch: number) => void;
  onHotspotAction: (hotspot: TourHotspot) => void;
};

type ViewerMarker = { id: string; data?: { hotspotId?: string } };
type MarkerPlugin = {
  setMarkers: (markers: Array<Record<string, unknown>>) => void;
  updateMarker: (marker: Record<string, unknown>) => void;
  addEventListener: (name: 'select-marker', callback: (event: { marker: ViewerMarker }) => void) => void;
};

const degrees = (radians: number) => (radians * 180) / Math.PI;
const normalizeYaw = (yaw: number) => ((yaw % 360) + 360) % 360;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));

function safeCssColor(value: string | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#a3e635';
}

function makeMarkers(hotspots: TourHotspot[], assets: TourAsset[], previewMode: boolean) {
  const assetUrls = new Map<string, string>(assets.filter((asset) => asset.url).map((asset) => [asset.id, asset.url!] as const));
  return hotspots.map((hotspot) => {
    const appearance = hotspot.appearance ?? {};
    const mode = appearance.mode ?? 'default';
    const size = Math.max(24, Math.min(96, appearance.size ?? 36));
    const color = safeCssColor(appearance.color);
    const hidden = mode === 'invisible';
    const imageUrl = (appearance.imageAssetId ? assetUrls.get(appearance.imageAssetId) : undefined) ?? appearance.imageUrl;
    const mediaUrl = (hotspot.assetId ? assetUrls.get(hotspot.assetId) : undefined) ?? hotspot.url;
    const showLabel = appearance.showLabel !== false;
    const animation = appearance.animation && appearance.animation !== 'none' ? 'studio-pano-marker-' + appearance.animation : '';
    const shape = 'studio-pano-marker-' + (appearance.shape ?? 'pill');
    const symbol = hotspot.kind === 'navigation' ? '↗' : hotspot.kind === 'video' ? '▶' : hotspot.kind === 'audio' ? '♫' : hotspot.kind === 'image' ? '▧' : hotspot.kind === 'link' ? '↗' : hotspot.kind === 'page' ? '▣' : 'i';
    let html: string;
    let elementLayer: HTMLElement | undefined;
    let width: number;
    let height: number;
    if (hotspot.spatialMedia?.enabled && (hotspot.kind === 'image' || hotspot.kind === 'video') && mediaUrl) {
      const mediaWidth = Math.max(96, Math.min(960, hotspot.spatialMedia?.width ?? 320));
      const mediaHeight = Math.max(64, Math.min(720, hotspot.spatialMedia?.height ?? 180));
      const surface = document.createElement('div');
      surface.className = hotspot.kind === 'image' ? 'studio-spatial-media studio-spatial-image' : 'studio-spatial-media studio-spatial-video';
      surface.dataset.hotspotId = hotspot.id;
      surface.style.width = mediaWidth + 'px';
      surface.style.height = mediaHeight + 'px';
      surface.style.background = 'transparent';
      surface.style.border = '0';
      surface.style.boxShadow = 'none';
      surface.style.overflow = 'hidden';
      surface.style.pointerEvents = 'auto';
      if (hotspot.kind === 'image') {
        const image = document.createElement('img');
        image.src = mediaUrl;
        image.alt = hotspot.title;
        image.draggable = false;
        image.style.width = '100%';
        image.style.height = '100%';
        image.style.objectFit = 'contain';
        image.style.display = 'block';
        image.style.background = 'transparent';
        image.style.border = '0';
        image.style.boxShadow = 'none';
        surface.append(image);
      } else {
        const video = document.createElement('video');
        video.src = mediaUrl;
        video.controls = true;
        video.playsInline = true;
        video.autoplay = Boolean(hotspot.spatialMedia?.autoplay);
        video.loop = Boolean(hotspot.spatialMedia?.loop);
        video.muted = hotspot.spatialMedia?.muted ?? true;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.display = 'block';
        video.style.background = '#080b10';
        surface.append(video);
      }
      elementLayer = surface;
      html = '<div class="studio-spatial-fallback" data-hotspot-id="' + escapeHtml(hotspot.id) + '"></div>';
      width = mediaWidth; height = mediaHeight;
    } else if (hidden && previewMode) {
      // Keep an actual marker hit-area, but draw no pixels in preview or the published tour.
      html = `<div class="studio-pano-marker-invisible-hit" style="width:${size}px;height:${size}px" aria-label="${escapeHtml(hotspot.title)}"></div>`;
      width = size; height = size;
    } else if (hidden) {
      // Editor-only locator so invisible clickable regions can still be found and edited.
      html = `<div class="studio-pano-marker studio-pano-marker-hidden-edit" style="--hotspot-color:${color};width:${size + 48}px;height:${size}px"><span>◉</span><small>Hidden target</small></div>`;
      width = size + 48; height = size;
    } else if (mode === 'image' && imageUrl) {
      html = `<div class="studio-pano-marker studio-pano-marker-image ${animation}" style="--hotspot-color:${color};--hotspot-size:${size}px;width:${size}px;height:${size + (showLabel ? 20 : 0)}px"><img src="${escapeHtml(imageUrl)}" alt="" />${showLabel ? `<span class="studio-pano-marker-label">${escapeHtml(hotspot.title)}</span>` : ''}</div>`;
      width = Math.max(size, showLabel ? Math.min(190, hotspot.title.length * 7 + 12) : size); height = size + (showLabel ? 20 : 0);
    } else {
      html = `<div class="studio-pano-marker studio-pano-marker-custom ${shape} ${animation}" style="--hotspot-color:${color};--hotspot-size:${size}px"><span class="studio-pano-marker-icon">${symbol}</span>${showLabel ? `<span class="studio-pano-marker-label">${escapeHtml(hotspot.title)}</span>` : ''}</div>`;
      width = showLabel ? Math.max(90, Math.min(190, hotspot.title.length * 7 + 44)) : size; height = Math.max(size, showLabel ? 34 : size);
    }
    html = html.replace('<div class="studio-', '<div data-hotspot-id="' + escapeHtml(hotspot.id) + '" class="studio-');
    const rawScaleX = Number(hotspot.scaleX ?? 1);
    const rawScaleY = Number(hotspot.scaleY ?? 1);
    const scaleX = Number.isFinite(rawScaleX) ? Math.max(0.1, Math.min(4, rawScaleX)) : 1;
    const scaleY = Number.isFinite(rawScaleY) ? Math.max(0.1, Math.min(4, rawScaleY)) : 1;
    const scaleTransform = `scale(${scaleX}, ${scaleY})`;
    if (elementLayer) {
      elementLayer.style.transform = scaleTransform;
      elementLayer.style.transformOrigin = 'center center';
    } else {
      html = html.replace(/class="(studio-[^"]+)"/, (_match, className: string) =>
        `class="${className}" style="transform:${scaleTransform};transform-origin:center center;"`);
    }
    const spatialRotation = hotspot.spatialMedia?.enabled ? {
      yaw: `${hotspot.spatialMedia.rotationYawDeg ?? 0}deg`,
      pitch: `${hotspot.spatialMedia.rotationPitchDeg ?? 0}deg`,
      roll: `${hotspot.spatialMedia.rotationRollDeg ?? 0}deg`,
    } : { roll: `${appearance.rotationDeg ?? 0}deg` };
    return {
      id: hotspot.id, ...(elementLayer ? { elementLayer } : { html }), anchor: 'center center', size: { width, height },
      position: { yaw: `${hotspot.yaw}deg`, pitch: `${hotspot.pitch}deg` },
      rotation: spatialRotation,
      ...(!hidden && showLabel ? { tooltip: { content: escapeHtml(hotspot.title), position: 'top' } } : {}),
      data: { hotspotId: hotspot.id },
    };
  });
}

function panoramaKey(scene: TourScene): string | null {
  if (scene.tiledPanorama) return `tiles:${JSON.stringify(scene.tiledPanorama)}`;
  return scene.panoramaUrl ?? null;
}

function makeTiledPanorama(source: TiledPanoramaSource, assetUrls: Map<string, string>): EquirectangularMultiTilesPanorama {
  const baseUrl = source.baseAssetId ? assetUrls.get(source.baseAssetId) : source.baseUrl;
  return {
    ...(baseUrl ? { baseUrl } : {}),
    levels: source.levels.map(({ width, cols, rows }) => ({ width, cols, rows })),
    tileUrl: (col, row, level) => {
      const levelConfig = source.levels[level];
      if (!levelConfig) return null;
      const relativePath = 'tiles/' + levelConfig.width + '/' + col + '_' + row + '.jpg';
      if (source.embeddedFiles) {
        const assetId = source.embeddedFiles[relativePath];
        return assetId ? assetUrls.get(assetId) ?? null : null;
      }
      return source.tileUrlTemplate
        .replaceAll('{width}', String(levelConfig.width))
        .replaceAll('{level}', String(level))
        .replaceAll('{col}', String(col))
        .replaceAll('{row}', String(row));
    },
  };
}

function panoramaInput(scene: TourScene, assetUrls: Map<string, string>): string | EquirectangularMultiTilesPanorama {
  return scene.tiledPanorama ? makeTiledPanorama(scene.tiledPanorama, assetUrls) : scene.panoramaUrl!;
}

export default function PanoramaCanvas({ scene, assets, placementMode, previewMode, moveHotspotId, onMoveHotspot, onPlaceHotspot, onHotspotAction }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const pluginRef = useRef<MarkerPlugin | null>(null);
  const lastPanoramaRef = useRef<string | null>(null);
  const lastSceneIdRef = useRef<string | null>(null);
  const transitionSequenceRef = useRef(0);
  const latestRef = useRef({ placementMode, moveHotspotId, onMoveHotspot, onPlaceHotspot, onHotspotAction, hotspots: scene.hotspots });
  latestRef.current = { placementMode, moveHotspotId, onMoveHotspot, onPlaceHotspot, onHotspotAction, hotspots: scene.hotspots };
  const assetUrls = new Map<string, string>();
  for (const asset of assets) if (asset.url) assetUrls.set(asset.id, asset.url);

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
      plugins: [[MarkersPlugin, { markers: makeMarkers(scene.hotspots, assets, previewMode) }]] as never,
    };
    const viewer = scene.tiledPanorama
      ? new Viewer({ ...baseOptions, adapter: EquirectangularTilesAdapter, panorama: panoramaInput(scene, assetUrls) as never } as never)
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
      if (hotspot && !(hotspot.spatialMedia?.enabled && (hotspot.kind === 'image' || hotspot.kind === 'video'))) latestRef.current.onHotspotAction(hotspot);
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
  }, [hasPanorama, adapterMode, assets]);

  useEffect(() => {
    const host = hostRef.current;
    const viewer = viewerRef.current;
    const plugin = pluginRef.current;
    if (!host || !viewer || !plugin || !moveHotspotId) return;
    let drag: { hotspotId: string; pointerId: number; yaw: number; pitch: number; startYaw: number; startPitch: number } | null = null;
    const coordsFor = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      const position = viewer.dataHelper.viewerCoordsToSphericalCoords({ x, y });
      return { yaw: normalizeYaw(degrees(position.yaw)), pitch: Math.max(-89.9, Math.min(89.9, degrees(position.pitch))) };
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const marker = target.closest<HTMLElement>('[data-hotspot-id]');
      const hotspotId = marker?.dataset.hotspotId;
      if (!hotspotId || hotspotId !== latestRef.current.moveHotspotId) return;
      const current = latestRef.current.hotspots.find((item) => item.id === hotspotId);
      if (!current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = { hotspotId, pointerId: event.pointerId, yaw: current.yaw, pitch: current.pitch, startYaw: current.yaw, startPitch: current.pitch };
      try { host.setPointerCapture(event.pointerId); } catch { /* pointer capture may not be supported in a browser */ }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        const point = coordsFor(event);
        drag.yaw = point.yaw;
        drag.pitch = point.pitch;
        plugin.updateMarker({ id: drag.hotspotId, position: { yaw: point.yaw + 'deg', pitch: point.pitch + 'deg' } });
      } catch { /* Ignore coordinates outside the active panorama projection. */ }
    };
    const finishDrag = (event: PointerEvent, commit: boolean) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const finalDrag = drag;
      drag = null;
      try { if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
      if (commit && (Math.abs(finalDrag.yaw - finalDrag.startYaw) > 0.1 || Math.abs(finalDrag.pitch - finalDrag.startPitch) > 0.1)) {
        latestRef.current.onMoveHotspot(finalDrag.hotspotId, finalDrag.yaw, finalDrag.pitch);
      }
    };
    const onPointerUp = (event: PointerEvent) => finishDrag(event, true);
    const onPointerCancel = (event: PointerEvent) => finishDrag(event, false);
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('pointermove', onPointerMove, true);
    host.addEventListener('pointerup', onPointerUp, true);
    host.addEventListener('pointercancel', onPointerCancel, true);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('pointermove', onPointerMove, true);
      host.removeEventListener('pointerup', onPointerUp, true);
      host.removeEventListener('pointercancel', onPointerCancel, true);
    };
  }, [hasPanorama, adapterMode, assets, moveHotspotId]);

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
          await viewer.setPanorama(panoramaInput(scene, assetUrls) as never, { transition: false, position: targetPosition, zoom: 18, showLoader: true } as never);
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
    void viewer.setPanorama(panoramaInput(scene, assetUrls) as never, {
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
    plugin.setMarkers(makeMarkers(scene.hotspots, assets, previewMode));
  }, [scene.hotspots, scene.id, assets, previewMode]);

  return <div
    ref={hostRef}
    className={`panorama-viewer${placementMode ? ' placing-hotspot' : ''}`}
    aria-label={hasPanorama ? `Interactive 360-degree panorama: ${scene.name}` : '360-degree panorama canvas'}
  />;
}

/* 360-STUDIO-HOTSPOTS-V0.6.1 */

/* 360-STUDIO-SPATIAL-MEDIA-AUDIO-V0.7.0 */

/* 360-STUDIO-HOTSPOT-SPATIAL-TRANSFORMS-V0.8.0 */

/* 360-STUDIO-SCALE-CONTROLS-V0.9.1 */
