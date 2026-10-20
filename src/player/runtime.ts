import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import './runtime.css';
import type { TourHotspot, TourProject, TourScene, TiledPanoramaSource } from '../types/project';

interface ArchiveFile { path: string; assetId: string; name: string; mimeType: string; size: number }
interface ArchiveManifest { format: string; schemaVersion: number; files: ArchiveFile[]; externalDependencies?: Array<{ url: string; label: string; reason: string }> }
interface TilesPanorama extends TiledPanoramaSource { embeddedFiles?: Record<string, string>; baseAssetId?: string }
interface RuntimeScene extends TourScene { tiledPanorama?: TilesPanorama }
interface RuntimeProject extends Omit<TourProject, 'scenes'> { scenes: RuntimeScene[] }
interface MarkerApi {
  setMarkers(markers: Array<Record<string, unknown>>): void;
  addEventListener(name: 'select-marker', callback: (event: { marker: { id: string; data?: { hotspotId?: string } } }) => void): void;
}

const htmlEscape = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
const safeColor = (value: string | undefined): string => value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#a3e635';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validateProject(value: unknown): RuntimeProject {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string' || !Array.isArray(value.scenes) || !Array.isArray(value.assets) || !isRecord(value.settings)) {
    throw new Error('This production bundle does not contain a supported 360 Studio project.');
  }
  if (value.scenes.some((scene) => !isRecord(scene) || typeof scene.id !== 'string' || !Array.isArray(scene.hotspots))) throw new Error('The tour configuration contains an invalid scene.');
  return value as unknown as RuntimeProject;
}
function validateManifest(value: unknown): ArchiveManifest {
  if (!isRecord(value) || !Array.isArray(value.files)) throw new Error('The production bundle is missing its media manifest.');
  const files = value.files.filter((file): file is unknown => !!file).map((file) => {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.assetId !== 'string') throw new Error('The media manifest contains an invalid asset record.');
    if (file.path.startsWith('/') || file.path.split('/').some((part) => part === '..' || part === '.')) throw new Error('The media manifest contains an unsafe asset path.');
    return file as unknown as ArchiveFile;
  });
  return { format: String(value.format ?? ''), schemaVersion: Number(value.schemaVersion ?? 0), files, externalDependencies: Array.isArray(value.externalDependencies) ? value.externalDependencies as ArchiveManifest['externalDependencies'] : [] };
}

class StandaloneTourPlayer {
  private readonly project: RuntimeProject;
  private readonly pathByAssetId = new Map<string, string>();
  private readonly root: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly sceneTitle: HTMLElement;
  private readonly sceneMenu: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly soundStatus: HTMLElement;
  private readonly errorBox: HTMLElement;
  private viewer: InstanceType<typeof Viewer> | null = null;
  private markerPlugin: MarkerApi | null = null;
  private adapterMode: 'single' | 'tiles' | null = null;
  private currentSceneId = '';
  private soundEnabled = false;
  private audio = new Audio();
  private transitionSequence = 0;
  private readonly baseUrl = new URL('./', window.location.href);

  constructor(root: HTMLElement, project: RuntimeProject, manifest: ArchiveManifest) {
    this.root = root;
    this.project = project;
    manifest.files.forEach((file) => this.pathByAssetId.set(file.assetId, file.path));
    this.root.style.setProperty('--tour-accent', safeColor(project.settings.accentColor));
    this.root.innerHTML = `
      <div class="tour-app">
        <header class="tour-header">
          <button class="tour-brand" type="button" data-action="toggle-scenes" aria-label="Open scene list"><span class="tour-brand-mark">360</span><span class="tour-brand-copy"><strong data-tour-brand></strong><small>VIRTUAL EXPERIENCE</small></span></button>
          <div class="tour-scene-heading"><span>YOU ARE EXPLORING</span><strong data-scene-title></strong></div>
          <nav class="tour-controls" aria-label="Tour controls"><button type="button" data-action="toggle-scenes" aria-expanded="false">Scenes</button><button type="button" data-action="sound" aria-pressed="false">Sound off</button><button type="button" data-action="fullscreen">Fullscreen</button></nav>
        </header>
        <main class="tour-main"><aside class="tour-scene-menu" aria-label="Tour scenes" hidden></aside><section class="tour-stage"><div class="tour-canvas" aria-label="360-degree virtual tour"></div><div class="tour-loader" role="status">Preparing your experience…</div><div class="tour-error" role="alert" hidden></div><div class="tour-stage-hint">Drag to look around <span>·</span> Scroll or pinch to zoom</div><div class="tour-popover-root"></div></section></main>
        <footer class="tour-footer"><span data-tour-title></span><span><i></i> INTERACTIVE 360° EXPERIENCE</span></footer>
      </div>`;
    this.canvas = this.root.querySelector<HTMLElement>('.tour-canvas')!;
    this.sceneTitle = this.root.querySelector<HTMLElement>('[data-scene-title]')!;
    this.sceneMenu = this.root.querySelector<HTMLElement>('.tour-scene-menu')!;
    this.soundButton = this.root.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
    this.soundStatus = this.soundButton;
    this.errorBox = this.root.querySelector<HTMLElement>('.tour-error')!;
    this.audio.preload = 'none';
    this.audio.addEventListener('error', () => this.setSoundStatus('Sound could not be loaded for this scene.'));
    const brand = this.root.querySelector<HTMLElement>('[data-tour-brand]')!;
    brand.textContent = this.project.settings.brandName || this.project.name;
    this.root.querySelector<HTMLElement>('[data-tour-title]')!.textContent = this.project.name;
    document.title = this.project.name;
    this.renderSceneMenu();
    this.bindControls();
  }

  async start(): Promise<void> {
    const firstScene = this.project.scenes.find((scene) => scene.id === this.project.settings.startSceneId) ?? this.project.scenes[0];
    if (!firstScene) throw new Error('This tour does not contain any scenes.');
    await this.loadScene(firstScene.id, true);
  }

  destroy(): void {
    this.transitionSequence += 1;
    this.audio.pause();
    this.viewer?.destroy();
    this.viewer = null;
  }

  private bindControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-scenes"]').forEach((button) => button.addEventListener('click', () => {
      const opening = this.sceneMenu.hidden;
      this.sceneMenu.hidden = !opening;
      this.root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-scenes"]').forEach((item) => item.setAttribute('aria-expanded', String(opening)));
    }));
    this.sceneMenu.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('button[data-scene-id]');
      if (button?.dataset.sceneId) void this.loadScene(button.dataset.sceneId);
    });
    this.soundButton.addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      if (this.soundEnabled) {
        this.soundButton.setAttribute('aria-pressed', 'true');
        void this.startSceneAudio(true);
        this.setSoundStatus('Sound on');
      } else {
        this.soundButton.setAttribute('aria-pressed', 'false');
        this.audio.pause();
        this.setSoundStatus('Sound off');
      }
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="fullscreen"]')!.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void this.root.requestFullscreen().catch(() => this.showError('Fullscreen is not available in this browser.'));
    });
    window.addEventListener('pagehide', () => this.destroy(), { once: true });
  }

  private setSoundStatus(message: string): void {
    this.soundStatus.textContent = message;
    this.soundStatus.setAttribute('aria-label', message);
  }

  private assetUrl(assetId: string | undefined): string | undefined {
    if (!assetId) return undefined;
    const path = this.pathByAssetId.get(assetId);
    if (!path) return undefined;
    return new URL(path.split('/').map(encodeURIComponent).join('/'), this.baseUrl).href;
  }

  private scenePanorama(scene: RuntimeScene): { mode: 'single' | 'tiles'; panorama: string | Record<string, unknown> } | null {
    if (scene.tiledPanorama) {
      const source = scene.tiledPanorama;
      const baseUrl = this.assetUrl(source.baseAssetId) ?? source.baseUrl;
      const panorama: Record<string, unknown> = {
        levels: source.levels,
        ...(baseUrl ? { baseUrl } : {}),
        tileUrl: (col: number, row: number, rawLevel: unknown) => {
          const levelIndex = typeof rawLevel === 'number'
            ? rawLevel
            : this.levelIndexForWidth(source.levels, isRecord(rawLevel) && typeof rawLevel.width === 'number' ? rawLevel.width : -1);
          const level = source.levels[levelIndex];
          if (!level) return null;
          const relativePath = `tiles/${level.width}/${col}_${row}.jpg`;
          const embeddedAssetId = source.embeddedFiles?.[relativePath];
          const embeddedUrl = this.assetUrl(embeddedAssetId);
          if (embeddedUrl) return embeddedUrl;
          if (!source.tileUrlTemplate) return null;
          return source.tileUrlTemplate.replaceAll('{width}', String(level.width)).replaceAll('{level}', String(levelIndex)).replaceAll('{col}', String(col)).replaceAll('{row}', String(row));
        },
      };
      return { mode: 'tiles', panorama };
    }
    const imageUrl = this.assetUrl(scene.panoramaAssetId) ?? scene.panoramaUrl;
    return imageUrl ? { mode: 'single', panorama: imageUrl } : null;
  }

  private levelIndexForWidth(levels: TilesPanorama['levels'], width: number): number {
    return levels.findIndex((level) => level.width === width);
  }

  private markersFor(scene: RuntimeScene): Array<Record<string, unknown>> {
    return scene.hotspots.map((hotspot) => ({
      id: hotspot.id,
      html: `<div class="tour-hotspot"><span>${hotspot.kind === 'navigation' ? '↗' : hotspot.kind === 'video' ? '▶' : hotspot.kind === 'audio' ? '♫' : hotspot.kind === 'image' ? '▧' : 'i'}</span><strong>${htmlEscape(hotspot.title)}</strong></div>`,
      size: { width: Math.max(76, Math.min(210, hotspot.title.length * 7 + 42)), height: 34 },
      anchor: 'center center',
      position: { yaw: `${hotspot.yaw}deg`, pitch: `${hotspot.pitch}deg` },
      tooltip: { content: htmlEscape(hotspot.title), position: 'top' },
      data: { hotspotId: hotspot.id },
    }));
  }

  private createViewer(scene: RuntimeScene, source: { mode: 'single' | 'tiles'; panorama: string | Record<string, unknown> }): void {
    const ViewerConstructor = Viewer as unknown as new (options: Record<string, unknown>) => InstanceType<typeof Viewer>;
    const options: Record<string, unknown> = {
      container: this.canvas,
      panorama: source.panorama,
      navbar: false,
      defaultYaw: `${scene.initialYaw}deg`,
      defaultPitch: `${scene.initialPitch}deg`,
      defaultZoomLvl: scene.initialZoom > 0 ? scene.initialZoom : 50,
      minFov: 25,
      maxFov: 100,
      moveInertia: 0.72,
      plugins: [[MarkersPlugin, { markers: this.markersFor(scene) }]],
    };
    if (source.mode === 'tiles') options.adapter = EquirectangularTilesAdapter;
    this.viewer = new ViewerConstructor(options);
    this.adapterMode = source.mode;
    this.markerPlugin = this.viewer.getPlugin(MarkersPlugin) as unknown as MarkerApi;
    this.markerPlugin.addEventListener('select-marker', ({ marker }) => {
      const hotspotId = marker.data?.hotspotId ?? marker.id;
      const hotspot = this.currentScene()?.hotspots.find((item) => item.id === hotspotId);
      if (hotspot) void this.activateHotspot(hotspot);
    });
  }

  private currentScene(): RuntimeScene | undefined { return this.project.scenes.find((scene) => scene.id === this.currentSceneId); }

  private async loadScene(sceneId: string, initial = false): Promise<void> {
    const scene = this.project.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const sequence = ++this.transitionSequence;
    const source = this.scenePanorama(scene);
    const loader = this.root.querySelector<HTMLElement>('.tour-loader')!;
    this.errorBox.hidden = true;
    this.currentSceneId = scene.id;
    this.sceneTitle.textContent = scene.name;
    this.sceneMenu.querySelectorAll<HTMLButtonElement>('button[data-scene-id]').forEach((button) => {
      const active = button.dataset.sceneId === scene.id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (!initial) this.sceneMenu.hidden = true;
    this.syncSceneAudio(scene);

    if (!source) {
      this.viewer?.destroy();
      this.viewer = null;
      this.markerPlugin = null;
      this.adapterMode = null;
      this.canvas.innerHTML = '<div class="tour-no-panorama"><span>360°</span><strong>This location has no panorama yet.</strong></div>';
      loader.hidden = true;
      return;
    }

    const modeChanged = this.adapterMode !== source.mode;
    if (!this.viewer || modeChanged) {
      this.viewer?.destroy();
      this.viewer = null;
      this.markerPlugin = null;
      this.canvas.innerHTML = '';
      loader.hidden = false;
      this.createViewer(scene, source);
      if (!initial && scene.transition?.kind !== 'none') {
        this.canvas.classList.remove('tour-scene-transition');
        void this.canvas.offsetWidth;
        this.canvas.classList.add('tour-scene-transition');
        window.setTimeout(() => this.canvas.classList.remove('tour-scene-transition'), Math.max(200, scene.transition?.durationMs ?? 700));
      }
      const viewer = this.viewer as InstanceType<typeof Viewer> | null;
      viewer?.addEventListener('ready', () => { if (sequence === this.transitionSequence) loader.hidden = true; });
      return;
    }

    loader.hidden = false;
    const duration = Math.max(0, scene.transition?.durationMs ?? 700);
    const targetPosition = { yaw: `${scene.initialYaw}deg`, pitch: `${scene.initialPitch}deg` };
    try {
      if (scene.transition?.kind === 'zoom' && this.viewer) {
        await this.viewer.animate({ zoom: 92, speed: Math.max(1, duration / 2), easing: 'inOutSine' });
        if (sequence !== this.transitionSequence) return;
        await this.viewer.setPanorama(source.panorama as never, { transition: false, position: targetPosition, zoom: 18, showLoader: true } as never);
        if (sequence !== this.transitionSequence) return;
        await this.viewer.animate({ zoom: scene.initialZoom > 0 ? scene.initialZoom : 50, speed: Math.max(1, duration / 2), easing: 'inOutSine' });
      } else {
        const transition = scene.transition?.kind === 'none' ? false : { effect: scene.transition?.kind === 'fade-through-black' ? 'black' : 'fade', speed: duration, rotation: true };
        await this.viewer!.setPanorama(source.panorama as never, { transition, position: targetPosition, zoom: scene.initialZoom > 0 ? scene.initialZoom : 50, showLoader: true } as never);
      }
      if (sequence !== this.transitionSequence) return;
      this.markerPlugin?.setMarkers(this.markersFor(scene));
      loader.hidden = true;
    } catch (error) {
      if (sequence !== this.transitionSequence) return;
      loader.hidden = true;
      this.showError(`Could not load “${scene.name}”. ${error instanceof Error ? error.message : ''}`);
    }
  }

  private renderSceneMenu(): void {
    this.sceneMenu.innerHTML = this.project.scenes.map((scene, index) => `<button type="button" data-scene-id="${htmlEscape(scene.id)}"><span class="tour-scene-number">${String(index + 1).padStart(2, '0')}</span><span class="tour-scene-copy"><strong>${htmlEscape(scene.name)}</strong><small>${scene.hotspots.length} interactive point${scene.hotspots.length === 1 ? '' : 's'}</small></span><span class="tour-scene-arrow">↗</span></button>`).join('');
  }

  private mediaUrl(hotspot: TourHotspot): string | undefined { return this.assetUrl(hotspot.assetId) ?? hotspot.url; }
  private async activateHotspot(hotspot: TourHotspot): Promise<void> {
    if (hotspot.kind === 'navigation' && hotspot.targetSceneId) {
      await this.loadScene(hotspot.targetSceneId);
      return;
    }
    this.openMedia(hotspot);
  }

  private openMedia(hotspot: TourHotspot): void {
    this.closeMedia();
    const popover = this.root.querySelector<HTMLElement>('.tour-popover-root')!;
    const backdrop = document.createElement('div'); backdrop.className = 'tour-modal-backdrop'; backdrop.addEventListener('click', () => this.closeMedia());
    const panel = document.createElement('section'); panel.className = 'tour-media-modal'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', hotspot.title);
    const close = document.createElement('button'); close.className = 'tour-media-close'; close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close'); close.addEventListener('click', () => this.closeMedia());
    const title = document.createElement('h2'); title.textContent = hotspot.title;
    panel.append(close, title);
    const url = this.mediaUrl(hotspot);
    if (hotspot.kind === 'image' && url) {
      const image = document.createElement('img'); image.src = url; image.alt = hotspot.title; image.className = 'tour-media-image'; panel.append(image);
    } else if (hotspot.kind === 'video' && url) {
      const video = document.createElement('video'); video.src = url; video.controls = true; video.playsInline = true; video.className = 'tour-media-video'; panel.append(video);
    } else if (hotspot.kind === 'audio' && url) {
      const audio = document.createElement('audio'); audio.src = url; audio.controls = true; audio.autoplay = false; audio.className = 'tour-media-audio'; panel.append(audio);
    } else {
      const description = document.createElement('p'); description.textContent = url ? 'Open the media source using the control below.' : hotspot.kind === 'info' ? 'More information about this location.' : 'This media is not available in the exported bundle. Check the original URL or export permissions.'; panel.append(description);
    }
    if (url && /^https?:/i.test(url)) {
      const external = document.createElement('a'); external.href = url; external.target = '_blank'; external.rel = 'noopener noreferrer'; external.className = 'tour-media-external'; external.textContent = 'Open media in a new tab'; panel.append(external);
    }
    panel.addEventListener('click', (event) => event.stopPropagation()); backdrop.append(panel); popover.append(backdrop); close.focus();
  }

  private closeMedia(): void {
    this.root.querySelectorAll<HTMLMediaElement>('.tour-modal-backdrop video, .tour-modal-backdrop audio').forEach((media) => {
      media.pause();
      media.removeAttribute('src');
      media.load();
    });
    this.root.querySelector('.tour-modal-backdrop')?.remove();
  }

  private sceneAudioUrl(scene: RuntimeScene): string | undefined { return this.assetUrl(scene.audio?.assetId) ?? scene.audio?.url; }
  private syncSceneAudio(scene: RuntimeScene): void {
    const url = this.sceneAudioUrl(scene);
    this.audio.pause();
    if (!url) { this.audio.removeAttribute('src'); this.audio.load(); return; }
    if (this.audio.src !== new URL(url, window.location.href).href) this.audio.src = url;
    this.audio.loop = Boolean(scene.audio?.loop);
    this.audio.volume = Math.max(0, Math.min(1, scene.audio?.volume ?? 0.7));
    if (this.soundEnabled && scene.audio?.autoplayAfterGesture) void this.audio.play().catch(() => this.setSoundStatus('Tap Sound to start audio'));
  }
  private async startSceneAudio(manual: boolean): Promise<void> {
    const scene = this.currentScene();
    if (!scene) return;
    const url = this.sceneAudioUrl(scene);
    if (!url) { this.setSoundStatus('No audio for this scene'); return; }
    if (this.audio.src !== new URL(url, window.location.href).href) this.audio.src = url;
    this.audio.loop = Boolean(scene.audio?.loop);
    this.audio.volume = Math.max(0, Math.min(1, scene.audio?.volume ?? 0.7));
    if (manual || scene.audio?.autoplayAfterGesture) {
      try { await this.audio.play(); this.setSoundStatus('Sound on'); }
      catch { this.setSoundStatus('Browser blocked audio playback'); }
    } else {
      this.setSoundStatus('Sound enabled');
    }
  }

  private showError(message: string): void { this.errorBox.textContent = message; this.errorBox.hidden = false; }
}

async function boot(): Promise<void> {
  const root = document.getElementById('tour-root');
  if (!root) return;
  try {
    const [projectResponse, manifestResponse] = await Promise.all([
      fetch(new URL('./project.json', document.baseURI), { cache: 'no-cache' }),
      fetch(new URL('./archive-manifest.json', document.baseURI), { cache: 'no-cache' }),
    ]);
    if (!projectResponse.ok) throw new Error(`Could not load tour configuration (HTTP ${projectResponse.status}).`);
    if (!manifestResponse.ok) throw new Error(`Could not load media manifest (HTTP ${manifestResponse.status}).`);
    const project = validateProject(await projectResponse.json());
    const manifest = validateManifest(await manifestResponse.json());
    if (manifest.format !== '360studio-project-archive' || manifest.schemaVersion !== 1 || !manifest.files.length && project.assets.some((asset) => asset.source === 'uploaded')) throw new Error('The media manifest does not match the project assets. Rebuild the tour export.');
    root.querySelector('.tour-boot')?.remove();
    const player = new StandaloneTourPlayer(root, project, manifest);
    await player.start();
  } catch (error) {
    root.innerHTML = '<main class="tour-boot-error"><div class="tour-boot-error-mark">360</div><h1>We could not open this tour</h1><p data-error-message></p><small>Make sure the entire ZIP was extracted and the folder is served over HTTP or HTTPS.</small></main>';
    root.querySelector<HTMLElement>('[data-error-message]')!.textContent = error instanceof Error ? error.message : 'Unknown tour loading error.';
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
else void boot();
