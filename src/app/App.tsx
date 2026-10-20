import { useEffect, useRef, useState } from 'react';
import { Aperture, ArrowDownToLine, AudioLines, Check, ChevronDown, CircleHelp, Cloud, ExternalLink, FolderOpen, Globe2, Image, Layers3, MonitorPlay, MoreHorizontal, Plus, Save, Settings2, Sparkles, Trash2, Video, X } from 'lucide-react';
import { useProjectStore } from '../features/projects/projectStore';
import { persistUploadedAsset, restoreUploadedAssetUrls } from '../features/assets/assetStorage';
import PanoramaCanvas from '../features/panorama/PanoramaCanvas';
import { loadTiledPanoramaManifest } from '../features/panorama/panoramaManifest';
import { exportProjectArchive, importProjectFile } from '../lib/portableProjectArchive';
import { exportProductionTourBundle } from '../lib/productionTourBundle';
import type { HotspotKind, TourHotspot, TourScene } from '../types/project';

const statusText = { saved: 'All changes saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' } as const;
const hotspotKinds: HotspotKind[] = ['navigation', 'link', 'page', 'image', 'video', 'audio', 'info'];

function safeHttpUrl(value: string | undefined): string | undefined {
  try {
    const parsed = new URL(value ?? '');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch { return undefined; }
}

export default function App() {
  const project = useProjectStore((s) => s.project);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const saveState = useProjectStore((s) => s.saveState);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const selectScene = useProjectStore((s) => s.selectScene);
  const addScene = useProjectStore((s) => s.addScene);
  const updateScene = useProjectStore((s) => s.updateScene);
  const updateProject = useProjectStore((s) => s.updateProject);
  const save = useProjectStore((s) => s.save);
  const load = useProjectStore((s) => s.load);
  const replaceProject = useProjectStore((s) => s.replaceProject);
  const importRef = useRef<HTMLInputElement>(null);
  const panoramaRef = useRef<HTMLInputElement>(null);
  const hotspotImageInputRef = useRef<HTMLInputElement>(null);
  const hotspotImageTargetRef = useRef<string | null>(null);
  const spatialMediaInputRef = useRef<HTMLInputElement>(null);
  const spatialMediaTargetRef = useRef<string | null>(null);
  const [notice, setNotice] = useState('');
  const [showPublish, setShowPublish] = useState(false);
  const [placingHotspot, setPlacingHotspot] = useState(false);
  const [movingHotspotId, setMovingHotspotId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedHotspot, setSelectedHotspot] = useState<TourHotspot | null>(null);
  const [tileManifestUrl, setTileManifestUrl] = useState('');
  const [loadingTileManifest, setLoadingTileManifest] = useState(false);
  const [exportingArchive, setExportingArchive] = useState(false);
  const [exportStatus, setExportStatus] = useState('Preparing project ZIP…');
  const [buildingProduction, setBuildingProduction] = useState(false);
  const [productionStatus, setProductionStatus] = useState('Building tour…');
  const activeScene = project.scenes.find((scene) => scene.id === activeSceneId) ?? project.scenes[0];

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (saveState !== 'unsaved') return;
    const timer = window.setTimeout(() => save(), 900);
    return () => window.clearTimeout(timer);
  }, [project, saveState, save]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => { setPlacingHotspot(false); setMovingHotspotId(null); }, [activeSceneId]);
  useEffect(() => { setTileManifestUrl(activeScene?.tiledPanorama?.manifestUrl ?? ''); }, [activeSceneId, activeScene?.tiledPanorama?.manifestUrl]);

  async function addPanorama(file?: File) {
    if (!file || !activeScene) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setNotice('Please choose a JPG, PNG, or WEBP panorama.');
      return;
    }
    const assetId = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    let persisted = true;
    try { await persistUploadedAsset(assetId, file); }
    catch { persisted = false; }

    const newAsset = { id: assetId, name: file.name, kind: 'panorama' as const, mimeType: file.type, source: 'uploaded' as const, originalFileName: file.name, url };
    const current = useProjectStore.getState().project;
    updateProject({ ...current, assets: [...current.assets, newAsset], scenes: current.scenes.map((scene) => scene.id === activeScene.id ? { ...scene, panoramaAssetId: assetId, panoramaUrl: url, tiledPanorama: undefined } : scene) });
    setNotice(persisted
      ? `Panorama loaded: ${file.name}. Original file stored in this browser for resume.`
      : `Panorama loaded for this session, but browser media storage failed. It may not survive a refresh.`);
    if (panoramaRef.current) panoramaRef.current.value = '';
  }

  async function uploadHotspotImage(file?: File) {
    const hotspotId = hotspotImageTargetRef.current;
    if (!file || !hotspotId) return;
    if (!file.type.startsWith('image/')) { setNotice('Choose an image, PNG, WEBP, SVG, or animated GIF.'); return; }
    if (file.size > 15 * 1024 * 1024) { setNotice('Hotspot images and GIFs must be 15 MB or smaller.'); return; }
    const current = useProjectStore.getState().project;
    const currentHotspot = current.scenes.flatMap((scene) => scene.hotspots).find((hotspot) => hotspot.id === hotspotId);
    if (!currentHotspot) { setNotice('This hotspot no longer exists.'); return; }
    const assetId = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    let persisted = true;
    try { await persistUploadedAsset(assetId, file); } catch { persisted = false; }
    const newAsset = { id: assetId, name: file.name, kind: 'image' as const, mimeType: file.type || 'application/octet-stream', source: 'uploaded' as const, originalFileName: file.name, url };
    updateProject({ ...useProjectStore.getState().project, assets: [...useProjectStore.getState().project.assets, newAsset] });
    updateHotspot(hotspotId, { appearance: { ...(currentHotspot.appearance ?? {}), mode: 'image', imageAssetId: assetId, imageUrl: undefined } });
    setNotice(persisted ? 'Hotspot image saved. Animated GIFs keep their animation in the editor and exported tour.' : 'Image added for this session, but browser storage failed, so it may not survive refresh.');
    if (hotspotImageInputRef.current) hotspotImageInputRef.current.value = '';
  }

  async function uploadSpatialMedia(file?: File) {
    const hotspotId = spatialMediaTargetRef.current;
    if (!file || !hotspotId) return;
    const kind = (file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : undefined) as 'video' | 'image' | undefined;
    if (!kind) { setNotice('Choose an image or a supported video file.'); return; }
    const maxBytes = kind === 'video' ? 250 * 1024 * 1024 : 40 * 1024 * 1024;
    if (file.size > maxBytes) { setNotice(kind === 'video' ? 'Video files must be 250 MB or smaller.' : 'Image files must be 40 MB or smaller.'); return; }
    const current = useProjectStore.getState().project;
    const currentHotspot = current.scenes.flatMap((scene) => scene.hotspots).find((hotspot) => hotspot.id === hotspotId);
    if (!currentHotspot) { setNotice('This hotspot no longer exists.'); return; }
    const assetId = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    let persisted = true;
    try { await persistUploadedAsset(assetId, file); } catch { persisted = false; }
    const newAsset = { id: assetId, name: file.name, kind, mimeType: file.type || 'application/octet-stream', source: 'uploaded' as const, originalFileName: file.name, url };
    updateProject({ ...useProjectStore.getState().project, assets: [...useProjectStore.getState().project.assets, newAsset] });
    updateHotspot(hotspotId, { assetId, url: undefined, spatialMedia: { ...(currentHotspot.spatialMedia ?? {}), enabled: true } });
    setNotice(persisted ? 'Spatial media saved to this project.' : 'Media added for this session, but browser storage failed, so it may not survive refresh.');
    if (spatialMediaInputRef.current) spatialMediaInputRef.current.value = '';
  }

  function handleImport(file?: File) {
    if (!file) return;
    if (!window.confirm('Import file ' + file.name + ' and replace the current editor project? Uploaded files in the archive will be restored into this browser.')) return;
    void importProjectFile(file).then(async (result) => {
      const restored = await restoreUploadedAssetUrls(result.project);
      replaceProject(restored);
      const missingUploads = restored.assets.filter((asset) => asset.source === 'uploaded' && !asset.url).length;
      const dependencyMessage = result.externalDependencies.length
        ? ' ' + result.externalDependencies.length + ' external media URL(s) still require an internet connection or may be blocked by CORS.'
        : '';
      setNotice(result.isArchive
        ? 'Portable project restored with ' + result.importedAssetCount + ' media file(s). Save to keep it in this browser.' + dependencyMessage
        : missingUploads
          ? 'JSON imported, but ' + missingUploads + ' uploaded file(s) were not included in JSON. Import a portable ZIP to restore them.'
          : 'Project JSON imported. Save to keep it in this browser.');
    }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Could not import project.'));
    if (importRef.current) importRef.current.value = '';
  }

  async function attachTiledPanorama() {
    if (!activeScene || !tileManifestUrl.trim()) {
      setNotice('Paste the URL to a generated manifest.json first.');
      return;
    }
    setLoadingTileManifest(true);
    try {
      const source = await loadTiledPanoramaManifest(tileManifestUrl);
      updateScene(activeScene.id, { tiledPanorama: source });
      setNotice(`High-resolution streaming enabled with ${source.levels.length} tile level${source.levels.length === 1 ? '' : 's'}. The original upload is preserved.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load the tiled panorama manifest.');
    } finally {
      setLoadingTileManifest(false);
    }
  }

  function useSinglePanorama() {
    if (!activeScene) return;
    updateScene(activeScene.id, { tiledPanorama: undefined });
    setNotice('Tiled source disconnected. The single-image panorama will be used when available.');
  }

  async function handleExport() {
    if (exportingArchive) return;
    setExportingArchive(true);
    setExportStatus('Collecting project media…');
    try {
      const result = await exportProjectArchive(project, (progress) => {
        if (progress.phase === 'downloading' && (progress.completed % 8 === 0 || progress.completed === progress.total)) {
          setExportStatus(progress.detail);
        } else if (progress.phase === 'packaging' && (progress.completed === 0 || progress.completed === progress.total || progress.completed % 25 === 0)) {
          setExportStatus('Packaging ZIP ' + progress.completed + '/' + progress.total);
        }
      });
      setNotice('Portable project ZIP downloaded with ' + result.fileCount + ' files (' + (result.totalBytes / (1024 * 1024)).toFixed(1) + ' MB).' + (result.externalDependencies.length ? ' ' + result.externalDependencies.length + ' external URL(s) could not be bundled and remain linked.' : ' Project assets are bundled.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not export the portable project.');
    } finally {
      setExportingArchive(false);
      setExportStatus('Preparing project ZIP…');
    }
  }

  async function handleBuildProductionTour() {
    if (buildingProduction) return;
    setBuildingProduction(true);
    setProductionStatus('Preparing standalone player…');
    setShowPublish(false);
    try {
      const result = await exportProductionTourBundle(project, (progress) => {
        if (progress.phase === 'downloading') setProductionStatus(progress.detail);
        else if (progress.phase === 'packaging') setProductionStatus('Packaging production ZIP ' + progress.completed + '/' + progress.total);
        else if (progress.phase === 'collecting') setProductionStatus(progress.detail);
      });
      setShowPublish(false);
      setNotice('Standalone production tour downloaded (' + (result.totalBytes / (1024 * 1024)).toFixed(1) + ' MB).' + (result.externalDependencies.length ? ' ' + result.externalDependencies.length + ' external media URL(s) remain linked; see archive-manifest.json.' : ' Media that was accessible has been bundled.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not build the standalone tour.');
    } finally {
      setBuildingProduction(false);
      setProductionStatus('Building tour…');
    }
  }

  function updateSceneAudio(patch: Partial<NonNullable<TourScene['audio']>>) {
    if (!activeScene) return;
    const audio = { autoplayAfterGesture: true, loop: false, volume: 0.7, ...(activeScene.audio ?? {}), ...patch };
    updateScene(activeScene.id, { audio });
  }

  function updateSceneName(name: string) { if (activeScene) updateScene(activeScene.id, { name }); }
  function changeTransition(kind: TourScene['transition']['kind']) { if (activeScene) updateScene(activeScene.id, { transition: { ...activeScene.transition, kind } }); }

  function placeHotspot(yaw: number, pitch: number) {
    if (!activeScene) return;
    const target = project.scenes.find((scene) => scene.id !== activeScene.id);
    const hotspot: TourHotspot = {
      id: crypto.randomUUID(),
      kind: target ? 'navigation' : 'info',
      title: target ? `Go to ${target.name}` : 'New information hotspot',
      yaw: Math.round(yaw * 10) / 10,
      pitch: Math.round(pitch * 10) / 10,
      ...(target ? { targetSceneId: target.id } : {}),
    };
    updateScene(activeScene.id, { hotspots: [...activeScene.hotspots, hotspot] });
    setPlacingHotspot(false);
    setNotice(`Hotspot placed at yaw ${hotspot.yaw}°, pitch ${hotspot.pitch}°. Configure it in the Inspector.`);
  }

  function updateHotspot(hotspotId: string, patch: Partial<TourHotspot>) {
    if (!activeScene) return;
    updateScene(activeScene.id, { hotspots: activeScene.hotspots.map((hotspot) => hotspot.id === hotspotId ? { ...hotspot, ...patch } : hotspot) });
  }

  function updateHotspotPosition(hotspotId: string, axis: 'yaw' | 'pitch', raw: number) {
    if (!Number.isFinite(raw)) return;
    if (axis === 'yaw') updateHotspot(hotspotId, { yaw: Math.round((((raw % 360) + 360) % 360) * 10) / 10 });
    else updateHotspot(hotspotId, { pitch: Math.round(Math.max(-89.9, Math.min(89.9, raw)) * 10) / 10 });
  }

  function moveHotspot(hotspotId: string, yaw: number, pitch: number) {
    updateHotspot(hotspotId, { yaw: Math.round(yaw * 10) / 10, pitch: Math.round(pitch * 10) / 10 });
    setNotice('Hotspot position saved. Keep dragging, or switch off Move in panorama when you are done.');
  }

  function deleteHotspot(hotspotId: string) {
    if (!activeScene) return;
    updateScene(activeScene.id, { hotspots: activeScene.hotspots.filter((hotspot) => hotspot.id !== hotspotId) });
  }

  function activateHotspot(hotspot: TourHotspot) {
    if (hotspot.kind === 'link') {
      try {
        const destination = new URL(hotspot.url ?? '');
        if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Unsupported URL scheme');
        window.open(destination.href, '_blank', 'noopener,noreferrer');
      } catch { setNotice('Add a valid http:// or https:// destination URL for this hotspot.'); }
      return;
    }
    if (hotspot.kind === 'navigation' && previewMode && hotspot.targetSceneId) {
      selectScene(hotspot.targetSceneId);
      return;
    }
    if (hotspot.kind === 'navigation' && !previewMode) {
      setNotice(`Navigation hotspot selected: ${hotspot.title}. Turn on Preview to follow it.`);
      return;
    }
    setSelectedHotspot(hotspot);
  }

  const selectedAsset = selectedHotspot?.assetId ? project.assets.find((asset) => asset.id === selectedHotspot.assetId) : undefined;
  const selectedMediaUrl = selectedHotspot?.url ?? selectedAsset?.url;
  const selectedExternalUrl = safeHttpUrl(selectedMediaUrl);
  const selectedPageUrl = selectedHotspot?.kind === 'page' ? selectedExternalUrl : undefined;

  return <div className="studio-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><Aperture size={21} /></div><div><div className="brand-title">360 <span>STUDIO</span></div><div className="brand-subtitle">EXPERIENCE BUILDER</div></div></div>
      <div className="project-heading"><input aria-label="Project name" value={project.name} onChange={(e) => setProjectName(e.target.value)} /><span className="saved-state"><span className={`status-dot ${saveState}`} />{statusText[saveState]}</span></div>
      <div className="top-actions">
        <button className="button button-quiet" onClick={() => importRef.current?.click()}><FolderOpen size={16} /> Open</button>
        <button className="button button-quiet" onClick={() => { save(); setNotice('Project draft saved in this browser.'); }}><Save size={16} /> Save</button>
        <button className="button button-outline" onClick={() => void handleExport()} disabled={exportingArchive}><ArrowDownToLine size={16} /> {exportingArchive ? exportStatus : 'Export project ZIP'}</button>
        <button className="button button-primary" onClick={() => setShowPublish(true)}><Globe2 size={16} /> Build for web <ChevronDown size={14} /></button>
      </div>
      <input ref={importRef} className="visually-hidden" type="file" accept=".zip,.360studio.json,.json,application/zip,application/json" onChange={(e) => handleImport(e.target.files?.[0])} />
    </header>

    <div className="workspace">
      <aside className="left-rail">
        <button className="rail-item active"><Layers3 size={19} /><span>Scenes</span></button>
        <button className="rail-item" onClick={() => setNotice('The media library will be the next major feature; panorama binaries are already stored locally for this project.') }><Image size={19} /><span>Media</span></button>
        <button className="rail-item" onClick={() => setNotice('Theme controls are planned for a later phase.')}><Sparkles size={19} /><span>Theme</span></button>
        <button className="rail-item" onClick={() => setNotice('Project settings are planned for a later phase.')}><Settings2 size={19} /><span>Settings</span></button>
        <div className="rail-spacer" /><button className="rail-item" onClick={() => setNotice('Help and documentation will be added as the editor grows.')}><CircleHelp size={19} /><span>Help</span></button>
        <div className="avatar">YS</div>
      </aside>

      <aside className="scene-panel">
        <div className="panel-title-row"><div><div className="eyebrow">YOUR EXPERIENCE</div><h2>Scenes <span className="count-pill">{project.scenes.length}</span></h2></div><button className="icon-button" aria-label="Add scene" onClick={addScene}><Plus size={18} /></button></div>
        <div className="scene-list">{project.scenes.map((scene, index) => <button key={scene.id} className={`scene-card ${scene.id === activeSceneId ? 'selected' : ''}`} onClick={() => selectScene(scene.id)}>
          <div className={`scene-thumb thumb-${index % 3}`}>{(scene.tiledPanorama?.baseUrl ?? scene.panoramaUrl) ? <img src={(scene.tiledPanorama?.baseUrl ?? scene.panoramaUrl)!} alt="" /> : <><div className="thumb-sun" /><div className="thumb-horizon" /><div className="thumb-shape shape-a" /><div className="thumb-shape shape-b" /><div className="thumb-floor" /></>}<span className="scene-index">{String(index + 1).padStart(2, '0')}</span></div>
          <div className="scene-card-meta"><strong>{scene.name}</strong><span>{scene.hotspots.length} hotspots <span className="meta-dot">·</span> {scene.tiledPanorama ? 'High-res tiles' : scene.panoramaUrl ? 'Panorama loaded' : 'No panorama yet'}</span></div><MoreHorizontal size={17} className="scene-more" />
        </button>)}</div>
        <button className="add-scene-button" onClick={addScene}><Plus size={16} /> Add new scene</button>
        <div className="storage-card"><div className="storage-icon"><Cloud size={17} /></div><div><strong>Local draft</strong><p>Config + uploaded files autosave here</p><span className="storage-meter"><i /></span></div></div>
      </aside>

      <main className="editor-main">
        <div className="editor-toolbar"><div className="breadcrumb">Experience <span>/</span> <strong>{activeScene?.name ?? 'No scene selected'}</strong></div><div className="toolbar-right"><span className="draft-chip"><span /> {previewMode ? 'PREVIEW' : 'DRAFT'}</span><button className={`button button-quiet small ${previewMode ? 'preview-active' : ''}`} onClick={() => { setPreviewMode((value) => !value); setPlacingHotspot(false); }}><MonitorPlay size={15} /> {previewMode ? 'Exit preview' : 'Preview'}</button></div></div>
        <div className="canvas-area"><div className={`canvas-frame ${placingHotspot ? 'hotspot-placement' : ''} ${movingHotspotId && !previewMode ? 'hotspot-moving' : ''}`}>
          {activeScene ? <PanoramaCanvas scene={activeScene} assets={project.assets} placementMode={placingHotspot && !previewMode} previewMode={previewMode} moveHotspotId={previewMode ? null : movingHotspotId} onMoveHotspot={moveHotspot} onPlaceHotspot={placeHotspot} onHotspotAction={activateHotspot} /> : null}
          {!activeScene?.panoramaUrl && !activeScene?.tiledPanorama && <div className="empty-panorama"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-center"><Aperture size={38} strokeWidth={1.2} /></div><div className="empty-copy"><span className="eyebrow">SCENE CANVAS</span><h2>Your world starts here.</h2><p>Add an equirectangular panorama to explore the scene in full 360°.</p><button className="button button-primary" onClick={() => panoramaRef.current?.click()}><Plus size={16} /> Add panorama</button><div className="file-hint">JPG, PNG, WEBP · Original file retained in browser storage</div></div></div>}
          <input ref={panoramaRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void addPanorama(e.target.files?.[0])} /><input ref={hotspotImageInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(e) => void uploadHotspotImage(e.target.files?.[0])} /><input ref={spatialMediaInputRef} className="visually-hidden" type="file" accept="image/*,video/mp4,video/webm,video/ogg" onChange={(e) => void uploadSpatialMedia(e.target.files?.[0])} />
          <div className="canvas-corner top-left"><span className="live-dot" /> {previewMode ? 'TOUR PREVIEW' : placingHotspot ? 'CLICK TO PLACE HOTSPOT' : '360° EDITOR CANVAS'}</div><div className="canvas-corner top-right"><span>360°</span><span className="corner-divider" /> <span>{activeScene?.tiledPanorama ? 'TILE STREAMING' : 'SPHERICAL VIEW'}</span></div>
          <div className="canvas-bottom-tools"><button className={placingHotspot ? 'tool-active' : ''} disabled={(!activeScene?.panoramaUrl && !activeScene?.tiledPanorama) || previewMode} onClick={() => { if (!activeScene?.panoramaUrl && !activeScene?.tiledPanorama) { setNotice('Upload a panorama or connect a tile manifest first.'); return; } setPlacingHotspot((value) => !value); }}><Plus size={14} /> {placingHotspot ? 'Cancel placement' : 'Add hotspot'}</button><span className="tool-divider"/><button onClick={() => setNotice('Drag to look around. Use the mouse wheel or trackpad to zoom. The saved camera starting position is configured in the Inspector phase.') }><Aperture size={14} /> Camera</button><span className="tool-divider"/><button onClick={() => { setNotice('Choose a hotspot type in the Inspector after placing it. Image, video and audio viewers use direct URLs or assets linked in the project.'); setPlacingHotspot(false); }}><Video size={14} /> Place media</button></div>
        </div><div className="canvas-caption"><span><span className="keycap">Drag</span> look around <span className="caption-divider" /> Scroll to zoom <span className="caption-divider" /> {placingHotspot ? 'Click anywhere to place a hotspot' : 'Click a hotspot to interact'}</span><span>{previewMode ? 'TOUR PREVIEW' : 'EDITOR PREVIEW'} <span className="preview-dot" /></span></div></div>
        <div className="timeline"><div className="timeline-heading"><div><span className="eyebrow">EXPERIENCE FLOW</span><h3>Scene sequence</h3></div><button className="button button-quiet small" onClick={addScene}><Plus size={15} /> Add scene</button></div><div className="timeline-track">{project.scenes.map((scene, index) => <div className={`timeline-node ${scene.id === activeSceneId ? 'active' : ''}`} key={scene.id} onClick={() => selectScene(scene.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') selectScene(scene.id); }}><div className="timeline-thumb">{(scene.tiledPanorama?.baseUrl ?? scene.panoramaUrl) ? <img src={(scene.tiledPanorama?.baseUrl ?? scene.panoramaUrl)!} alt="" /> : <Aperture size={19} />}</div><div className="timeline-label"><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong></div>{index < project.scenes.length - 1 && <div className="flow-connector"><span /></div>}</div>)}</div></div>
      </main>

      <aside className="inspector"><div className="inspector-heading"><div><div className="eyebrow">SCENE CONFIGURATION</div><h2>Inspector</h2></div><button className="icon-button" aria-label="Inspector help" onClick={() => setNotice('Configure this scene and its hotspots here. Changes autosave in this browser.')}><X size={17} /></button></div>
        {activeScene ? <><section className="inspector-section"><label className="field-label" htmlFor="scene-name">Scene name</label><input id="scene-name" className="text-field" value={activeScene.name} onChange={(e) => updateSceneName(e.target.value)} /><div className="field-help">Shown in your scene navigator and tour menu.</div></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Panorama source</label><span className="mini-status">{activeScene.tiledPanorama ? 'TILED' : activeScene.panoramaUrl ? 'LOADED' : 'EMPTY'}</span></div><div className="asset-drop" onClick={() => panoramaRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') panoramaRef.current?.click(); }}><div className="asset-drop-icon"><Image size={18} /></div><div><strong>{activeScene.panoramaUrl ? 'Replace panorama' : 'Choose panorama'}</strong><p>Equirectangular JPG, PNG or WEBP</p></div><Plus size={16} /></div><div className="tile-manifest-form"><label className="field-label" htmlFor="tile-manifest-url">High-resolution tile manifest</label><input id="tile-manifest-url" className="text-field compact" type="url" placeholder="https://your-host/tour/manifest.json" value={tileManifestUrl} onChange={(e) => setTileManifestUrl(e.target.value)} /><button className="mini-button tile-manifest-button" type="button" onClick={() => void attachTiledPanorama()} disabled={loadingTileManifest}>{loadingTileManifest ? 'Loading manifest…' : 'Enable multi-resolution tiles'}</button>{activeScene.tiledPanorama ? <div className="tile-manifest-active"><strong>{activeScene.tiledPanorama.levels.length} resolution level(s)</strong><span>{activeScene.tiledPanorama.sourceWidth ? `${activeScene.tiledPanorama.sourceWidth.toLocaleString()} × ${(activeScene.tiledPanorama.sourceHeight ?? activeScene.tiledPanorama.sourceWidth / 2).toLocaleString()} source` : 'Tiled panorama connected'}</span><button type="button" onClick={useSinglePanorama}>Use single image instead</button></div> : <div className="field-help">Generate tiles with <code>npm run prepare:panorama -- input.jpg public/tours/lobby</code>, host the output folder, then paste its manifest URL. The tile files load progressively as you zoom.</div>}</div></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Scene transition</label><span className="subtle-label">ON ENTER</span></div><div className="transition-options">{(['fade', 'fade-through-black', 'zoom', 'none'] as const).map((kind) => <button key={kind} className={`transition-option ${activeScene.transition.kind === kind ? 'chosen' : ''}`} onClick={() => changeTransition(kind)}><span className={`transition-preview ${kind}`} />{kind === 'fade-through-black' ? 'Fade black' : kind === 'none' ? 'None' : kind[0].toUpperCase() + kind.slice(1)}{activeScene.transition.kind === kind && <Check size={13} />}</button>)}</div><label className="field-label duration-label" htmlFor="duration">Duration <strong>{(activeScene.transition.durationMs / 1000).toFixed(1)}s</strong></label><input id="duration" className="range-input" type="range" min="0" max="2000" step="100" value={activeScene.transition.durationMs} onChange={(e) => updateScene(activeScene.id, { transition: { ...activeScene.transition, durationMs: Number(e.target.value) } })} /><div className="field-help">Transitions run when moving between scenes with panorama images.</div></section>
        <section className="inspector-section audio-timing-section"><div className="section-heading"><label className="field-label">Audio timeline</label><AudioLines size={16} className="muted-icon" /></div><label className="field-label" htmlFor="scene-audio-url">Audio URL</label><input id="scene-audio-url" className="text-field compact" type="url" placeholder="https://.../ambience.mp3" value={activeScene.audio?.url ?? ''} onChange={(e) => updateSceneAudio({ url: e.target.value || undefined, assetId: undefined })} /><label className="field-label" htmlFor="scene-audio-asset">Project audio asset</label><select id="scene-audio-asset" className="text-field compact" value={activeScene.audio?.assetId ?? ''} onChange={(e) => updateSceneAudio({ assetId: e.target.value || undefined, url: e.target.value ? undefined : activeScene.audio?.url })}><option value="">Use audio URL above</option>{project.assets.filter((asset) => asset.kind === 'audio').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><label className="field-label duration-label" htmlFor="scene-audio-volume">Volume <strong>{Math.round((activeScene.audio?.volume ?? 0.7) * 100)}%</strong></label><input id="scene-audio-volume" className="range-input" type="range" min="0" max="1" step="0.05" value={activeScene.audio?.volume ?? 0.7} onChange={(e) => updateSceneAudio({ volume: Number(e.target.value) })} /><div className="audio-timing-grid"><div><label className="field-label" htmlFor="audio-offset">Track offset (sec)</label><input id="audio-offset" className="text-field compact" type="number" min="0" step="0.5" value={activeScene.audio?.startOffsetSeconds ?? 0} onChange={(e) => updateSceneAudio({ startOffsetSeconds: Math.max(0, Number(e.target.value) || 0) })} /></div><div><label className="field-label" htmlFor="audio-delay">Start delay (sec)</label><input id="audio-delay" className="text-field compact" type="number" min="0" step="0.5" value={activeScene.audio?.delaySeconds ?? 0} onChange={(e) => updateSceneAudio({ delaySeconds: Math.max(0, Number(e.target.value) || 0) })} /></div><div><label className="field-label" htmlFor="audio-stop">Stop after (sec)</label><input id="audio-stop" className="text-field compact" type="number" min="0" step="1" value={activeScene.audio?.stopAfterSeconds ?? 0} onChange={(e) => updateSceneAudio({ stopAfterSeconds: Math.max(0, Number(e.target.value) || 0) })} /></div><div><label className="field-label" htmlFor="audio-fade-in">Fade in (sec)</label><input id="audio-fade-in" className="text-field compact" type="number" min="0" step="0.5" value={activeScene.audio?.fadeInSeconds ?? 0} onChange={(e) => updateSceneAudio({ fadeInSeconds: Math.max(0, Number(e.target.value) || 0) })} /></div><div><label className="field-label" htmlFor="audio-fade-out">Fade out (sec)</label><input id="audio-fade-out" className="text-field compact" type="number" min="0" step="0.5" value={activeScene.audio?.fadeOutSeconds ?? 0} onChange={(e) => updateSceneAudio({ fadeOutSeconds: Math.max(0, Number(e.target.value) || 0) })} /></div></div><label className="hotspot-check-label"><input type="checkbox" checked={Boolean(activeScene.audio?.loop)} onChange={(e) => updateSceneAudio({ loop: e.target.checked })} /> Loop ambience</label><label className="hotspot-check-label"><input type="checkbox" checked={activeScene.audio?.autoplayAfterGesture ?? true} onChange={(e) => updateSceneAudio({ autoplayAfterGesture: e.target.checked })} /> Start on scene entry after sound is enabled</label><div className="field-help">Stop after 0 means play to the end. Browsers may require the visitor to enable Sound once before scheduled audio can play.</div></section>
        <section className="inspector-section hotspots-section"><div className="section-heading"><label className="field-label">Hotspots</label><span className="count-pill">{activeScene.hotspots.length}</span></div>{activeScene.hotspots.length ? activeScene.hotspots.map((hotspot) => <div className="hotspot-editor" key={hotspot.id}><div className="hotspot-editor-heading"><span className="hotspot-pin"><Globe2 size={14} /></span><span className="hotspot-kind-label">{hotspot.kind}</span><button className="mini-icon-button" title="Delete hotspot" aria-label={`Delete ${hotspot.title}`} onClick={() => deleteHotspot(hotspot.id)}><Trash2 size={13} /></button></div><label className="field-label" htmlFor={`hotspot-name-${hotspot.id}`}>Label</label><input id={`hotspot-name-${hotspot.id}`} className="text-field compact" value={hotspot.title} onChange={(e) => updateHotspot(hotspot.id, { title: e.target.value })} /><div className="hotspot-coordinate">Yaw {hotspot.yaw.toFixed(1)}° <span>·</span> Pitch {hotspot.pitch.toFixed(1)}°</div><label className="field-label" htmlFor={`hotspot-kind-${hotspot.id}`}>Action</label><select id={`hotspot-kind-${hotspot.id}`} className="text-field compact" value={hotspot.kind} onChange={(e) => updateHotspot(hotspot.id, { kind: e.target.value as HotspotKind, targetSceneId: e.target.value === 'navigation' ? project.scenes.find((scene) => scene.id !== activeScene.id)?.id : undefined })}>{hotspotKinds.map((kind) => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}</select>{hotspot.kind === 'navigation' && <><label className="field-label" htmlFor={`hotspot-target-${hotspot.id}`}>Target scene</label><select id={`hotspot-target-${hotspot.id}`} className="text-field compact" value={hotspot.targetSceneId ?? ''} onChange={(e) => updateHotspot(hotspot.id, { targetSceneId: e.target.value || undefined })}><option value="">Choose scene...</option>{project.scenes.filter((scene) => scene.id !== activeScene.id).map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></>}{['link', 'page', 'image', 'video', 'audio'].includes(hotspot.kind) && <><label className="field-label" htmlFor={`hotspot-url-${hotspot.id}`}>{hotspot.kind === 'link' ? 'Destination URL' : hotspot.kind === 'page' ? 'Web page / document URL' : 'Media URL'}</label><input id={`hotspot-url-${hotspot.id}`} className="text-field compact" placeholder="https://..." value={hotspot.url ?? ''} onChange={(e) => updateHotspot(hotspot.id, { url: e.target.value || undefined, assetId: undefined })} /><div className="field-help">{hotspot.kind === 'link' ? 'Opens in a new tab in Preview and the published tour.' : hotspot.kind === 'page' ? 'Embeds an HTML page or browser-supported document in an overlay. If embedding is blocked, use Open page in a new tab.' : 'URL for the media shown when this hotspot is clicked.'}</div></>}{(() => { const appearance = hotspot.appearance ?? {}; const chosenImage = project.assets.find((asset) => asset.id === appearance.imageAssetId); return <div className="hotspot-appearance"><div className="field-label">Appearance</div><label className="field-label" htmlFor={`hotspot-mode-${hotspot.id}`}>Marker visibility</label><select id={`hotspot-mode-${hotspot.id}`} className="text-field compact" value={appearance.mode ?? 'default'} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, mode: e.target.value as NonNullable<TourHotspot['appearance']>['mode'] } })}><option value="default">Styled marker</option><option value="image">My image or GIF</option><option value="invisible">Invisible clickable area</option></select><label className="field-label duration-label" htmlFor={`hotspot-size-${hotspot.id}`}>Size / clickable area <strong>{appearance.size ?? 36}px</strong></label><input id={`hotspot-size-${hotspot.id}`} className="range-input" type="range" min="24" max="96" step="4" value={appearance.size ?? 36} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, size: Number(e.target.value) } })} />{appearance.mode !== 'invisible' && <><label className="field-label" htmlFor={`hotspot-shape-${hotspot.id}`}>Shape</label><select id={`hotspot-shape-${hotspot.id}`} className="text-field compact" value={appearance.shape ?? 'pill'} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, shape: e.target.value as NonNullable<TourHotspot['appearance']>['shape'] } })}><option value="pill">Pill</option><option value="circle">Circle</option><option value="square">Square</option></select><label className="field-label" htmlFor={`hotspot-color-${hotspot.id}`}>Color</label><input id={`hotspot-color-${hotspot.id}`} className="text-field compact hotspot-color-field" type="color" value={appearance.color ?? '#a3e635'} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, color: e.target.value } })} /><label className="field-label" htmlFor={`hotspot-animation-${hotspot.id}`}>Animation</label><select id={`hotspot-animation-${hotspot.id}`} className="text-field compact" value={appearance.animation ?? 'none'} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, animation: e.target.value as NonNullable<TourHotspot['appearance']>['animation'] } })}><option value="none">None</option><option value="pulse">Pulse</option><option value="bounce">Bounce</option><option value="rotate">Rotate</option></select><label className="hotspot-check-label"><input type="checkbox" checked={appearance.showLabel !== false} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, showLabel: e.target.checked } })} /> Show hotspot label</label></>}{appearance.mode === 'image' && <div className="hotspot-image-settings"><button className="mini-button" type="button" onClick={() => { hotspotImageTargetRef.current = hotspot.id; hotspotImageInputRef.current?.click(); }}>{chosenImage ? 'Replace image / GIF' : 'Upload image / GIF'}</button>{chosenImage && <div className="field-help">Using {chosenImage.name}</div>}<label className="field-label" htmlFor={`hotspot-image-asset-${hotspot.id}`}>Project image</label><select id={`hotspot-image-asset-${hotspot.id}`} className="text-field compact" value={appearance.imageAssetId ?? ''} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, mode: 'image', imageAssetId: e.target.value || undefined, imageUrl: undefined } })}><option value="">Choose uploaded image…</option>{project.assets.filter((asset) => asset.kind === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><label className="field-label" htmlFor={`hotspot-image-url-${hotspot.id}`}>Or image URL</label><input id={`hotspot-image-url-${hotspot.id}`} className="text-field compact" type="url" placeholder="https://example.com/icon.gif" value={appearance.imageUrl ?? ''} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...appearance, mode: 'image', imageAssetId: undefined, imageUrl: e.target.value || undefined } })} /><div className="field-help">PNG, transparent WebP, SVG and animated GIF are supported without a forced background. Use a file that already has transparency; JPG cannot store transparency.</div></div>}{appearance.mode === 'invisible' && <div className="field-help">The visitor sees no marker or tooltip. The selected area remains clickable. In the editor, a locator identifies the hidden hotspot.</div>}</div>; })()}{['image', 'video'].includes(hotspot.kind) && <div className="hotspot-spatial-settings"><div className="field-label">Media placement</div><label className="field-label" htmlFor={`spatial-mode-${hotspot.id}`}>Display mode</label><select id={`spatial-mode-${hotspot.id}`} className="text-field compact" value={hotspot.spatialMedia?.enabled ? 'spatial' : 'popup'} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: e.target.value === 'spatial' } })}><option value="popup">Open in popup</option><option value="spatial">Show inside Panorama</option></select>{hotspot.spatialMedia?.enabled && <><label className="field-label" htmlFor={`spatial-asset-${hotspot.id}`}>Project media asset</label><button className="mini-button" type="button" onClick={() => { spatialMediaTargetRef.current = hotspot.id; spatialMediaInputRef.current?.click(); }}>Upload image / video</button><select id={`spatial-asset-${hotspot.id}`} className="text-field compact" value={hotspot.assetId ?? ''} onChange={(e) => updateHotspot(hotspot.id, { assetId: e.target.value || undefined, url: e.target.value ? undefined : hotspot.url })}><option value="">Use media URL below</option>{project.assets.filter((asset) => asset.kind === hotspot.kind).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><label className="field-label duration-label" htmlFor={`spatial-width-${hotspot.id}`}>Width <strong>{hotspot.spatialMedia?.width ?? 320}px</strong></label><input id={`spatial-width-${hotspot.id}`} className="range-input" type="range" min="96" max="960" step="16" value={hotspot.spatialMedia?.width ?? 320} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, width: Number(e.target.value) } })} /><label className="field-label duration-label" htmlFor={`spatial-height-${hotspot.id}`}>Height <strong>{hotspot.spatialMedia?.height ?? 180}px</strong></label><input id={`spatial-height-${hotspot.id}`} className="range-input" type="range" min="64" max="720" step="16" value={hotspot.spatialMedia?.height ?? 180} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, height: Number(e.target.value) } })} />{hotspot.kind === 'video' && <><label className="hotspot-check-label"><input type="checkbox" checked={Boolean(hotspot.spatialMedia?.autoplay)} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, autoplay: e.target.checked, muted: e.target.checked ? true : (hotspot.spatialMedia?.muted ?? true) } })} /> Autoplay video (muted)</label><label className="hotspot-check-label"><input type="checkbox" checked={Boolean(hotspot.spatialMedia?.loop)} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, loop: e.target.checked } })} /> Loop video</label><label className="hotspot-check-label"><input type="checkbox" checked={hotspot.spatialMedia?.muted ?? true} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, muted: e.target.checked } })} /> Mute video</label></>}</>}</div>}
        <div className="hotspot-transform-controls">
          <div className="field-label">Position inside panorama</div>
          <div className="hotspot-transform-grid">
            <div><label className="field-label" htmlFor={`hotspot-yaw-${hotspot.id}`}>Yaw (°)</label><input id={`hotspot-yaw-${hotspot.id}`} className="text-field compact" type="number" min="0" max="360" step="0.1" value={hotspot.yaw} onChange={(e) => updateHotspotPosition(hotspot.id, 'yaw', Number(e.target.value))} /></div>
            <div><label className="field-label" htmlFor={`hotspot-pitch-${hotspot.id}`}>Pitch (°)</label><input id={`hotspot-pitch-${hotspot.id}`} className="text-field compact" type="number" min="-89.9" max="89.9" step="0.1" value={hotspot.pitch} onChange={(e) => updateHotspotPosition(hotspot.id, 'pitch', Number(e.target.value))} /></div>
          </div>
          <button className={`mini-button hotspot-move-button ${movingHotspotId === hotspot.id ? 'active' : ''}`} type="button" onClick={() => { setMovingHotspotId((current) => current === hotspot.id ? null : hotspot.id); setNotice(movingHotspotId === hotspot.id ? 'Move mode disabled.' : 'Drag this hotspot or media surface inside the panorama to reposition it.'); }}>
            {movingHotspotId === hotspot.id ? 'Done moving' : 'Move in panorama'}
          </button>
          <div className="field-help">Turn on Move in panorama, then drag this marker or media surface. The new spherical position is saved when you release it.</div>
          <div className="hotspot-scale-controls">
            <label className="field-label duration-label" htmlFor={`hotspot-scale-x-${hotspot.id}`}>Scale X <strong>{(hotspot.scaleX ?? 1).toFixed(2)}×</strong></label>
            <input id={`hotspot-scale-x-${hotspot.id}`} className="range-input" type="range" min="0.1" max="4" step="0.05" value={hotspot.scaleX ?? 1} onChange={(e) => updateHotspot(hotspot.id, { scaleX: Number(e.target.value) })} />
            <label className="field-label duration-label" htmlFor={`hotspot-scale-y-${hotspot.id}`}>Scale Y <strong>{(hotspot.scaleY ?? 1).toFixed(2)}×</strong></label>
            <input id={`hotspot-scale-y-${hotspot.id}`} className="range-input" type="range" min="0.1" max="4" step="0.05" value={hotspot.scaleY ?? 1} onChange={(e) => updateHotspot(hotspot.id, { scaleY: Number(e.target.value) })} />
            <div className="field-help">Move the sliders left to shrink and right to enlarge. X adjusts width; Y adjusts height. These values apply to the hotspot and its image/GIF/video media.</div>
          </div>
          {!hotspot.spatialMedia?.enabled && <><label className="field-label duration-label" htmlFor={`hotspot-roll-${hotspot.id}`}>Hotspot roll <strong>{hotspot.appearance?.rotationDeg ?? 0}°</strong></label>
          <input id={`hotspot-roll-${hotspot.id}`} className="range-input" type="range" min="-180" max="180" step="1" value={hotspot.appearance?.rotationDeg ?? 0} onChange={(e) => updateHotspot(hotspot.id, { appearance: { ...(hotspot.appearance ?? {}), rotationDeg: Number(e.target.value) } })} /></>}
          {hotspot.spatialMedia?.enabled && <div className="hotspot-spatial-orientation">
            <div className="field-label">3D media orientation</div>
            <div className="hotspot-transform-grid three-columns">
              <div><label className="field-label" htmlFor={`spatial-yaw-${hotspot.id}`}>Yaw</label><input id={`spatial-yaw-${hotspot.id}`} className="text-field compact" type="number" min="-180" max="180" step="1" value={hotspot.spatialMedia.rotationYawDeg ?? 0} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, rotationYawDeg: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) } })} /></div>
              <div><label className="field-label" htmlFor={`spatial-pitch-${hotspot.id}`}>Pitch</label><input id={`spatial-pitch-${hotspot.id}`} className="text-field compact" type="number" min="-180" max="180" step="1" value={hotspot.spatialMedia.rotationPitchDeg ?? 0} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, rotationPitchDeg: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) } })} /></div>
              <div><label className="field-label" htmlFor={`spatial-roll-${hotspot.id}`}>Roll</label><input id={`spatial-roll-${hotspot.id}`} className="text-field compact" type="number" min="-180" max="180" step="1" value={hotspot.spatialMedia.rotationRollDeg ?? 0} onChange={(e) => updateHotspot(hotspot.id, { spatialMedia: { ...(hotspot.spatialMedia ?? {}), enabled: true, rotationRollDeg: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) } })} /></div>
            </div>
            <div className="field-help">Yaw and pitch tilt the media surface in 3D. Roll rotates it around its own centre.</div>
          </div>}
        </div></div>) : <div className="empty-hotspots">No hotspots yet.<button onClick={() => { if (!activeScene.panoramaUrl && !activeScene.tiledPanorama) { setNotice('Upload a panorama or connect a tile manifest before placing hotspots.'); return; } setPlacingHotspot(true); }}>Click to place your first hotspot</button></div>}</section></> : <p className="field-help">Add a scene to start configuring it.</p>}
        <div className="inspector-footer"><span><Settings2 size={14} /> Project settings</span><button onClick={() => setNotice('Global settings will be implemented after core scene editing.')}><ChevronDown size={15} /></button></div>
      </aside>
    </div>
    {notice && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {selectedHotspot && <div className="modal-backdrop" onClick={() => setSelectedHotspot(null)}><div className={`hotspot-modal ${selectedHotspot.kind === 'page' ? 'hotspot-page-modal' : ''}`} onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setSelectedHotspot(null)} aria-label="Close hotspot"><X size={17} /></button><div className="eyebrow">{selectedHotspot.kind.toUpperCase()} HOTSPOT</div><h2>{selectedHotspot.title}</h2>{selectedHotspot.kind === 'image' && selectedMediaUrl && <img className="hotspot-media-image" src={selectedMediaUrl} alt={selectedHotspot.title} />}{selectedHotspot.kind === 'video' && selectedMediaUrl && <video className="hotspot-media-video" src={selectedMediaUrl} controls playsInline />}{selectedHotspot.kind === 'audio' && selectedMediaUrl && <audio className="hotspot-media-audio" src={selectedMediaUrl} controls />}{selectedHotspot.kind === 'page' && selectedPageUrl && <iframe className="hotspot-media-page" src={selectedPageUrl} title={selectedHotspot.title} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="fullscreen; autoplay" />}{selectedHotspot.kind === 'page' && !selectedPageUrl && <p className="hotspot-modal-copy">Add a valid HTTP(S) page URL. Some websites block embedded viewing; use the new-tab option if that happens.</p>}{selectedHotspot.kind === 'info' && <p className="hotspot-modal-copy">This information hotspot is ready to be expanded with rich text and branded content in a later phase.</p>}{['image', 'video', 'audio'].includes(selectedHotspot.kind) && !selectedMediaUrl && <p className="hotspot-modal-copy">Add a direct media URL in the Inspector to preview this hotspot. Uploaded asset linking will follow in the Media Library phase.</p>}{selectedExternalUrl && <a className="hotspot-external-link" href={selectedExternalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> {selectedHotspot.kind === 'page' ? 'Open page in new tab' : 'Open source in new tab'}</a>}</div></div>}
    {showPublish && <div className="modal-backdrop" onClick={() => setShowPublish(false)}><div className="publish-modal" onClick={(e) => e.stopPropagation()}><div className="modal-icon"><Globe2 size={22} /></div><button className="modal-close" onClick={() => setShowPublish(false)} aria-label="Close"><X size={17} /></button><div className="eyebrow">PRODUCTION WORKFLOW</div><h2>Build for the web</h2><p>Build a standalone tour bundle with its own viewer runtime, project configuration, panoramas, hotspots, and included media. Extract the ZIP into an Nginx directory and share that URL; visitors will not see the Studio editor.</p><div className="build-checklist"><span><Check size={15} /> Save / resume draft with local media</span><span><Check size={15} /> Export / import project configuration</span><span><Check size={15} /> Interactive 360° viewer and scene navigation</span><span><Check size={15} /> Multi-resolution tile manifest + viewer support</span><span><Check size={15} /> Standalone player runtime + Nginx deployment ZIP</span></div><button className="button button-primary full-width" onClick={() => void handleBuildProductionTour()} disabled={buildingProduction}>{buildingProduction ? productionStatus : 'Build standalone tour (.zip)'}</button></div></div>}
    <footer className="bottom-status"><span><span className={`status-dot ${saveState}`} /> Workspace ready</span><span>360 Studio Demo <span className="footer-divider">/</span> v0.9.1</span><span>Project schema v1</span></footer>
  </div>;
}

/* 360-STUDIO-HOTSPOTS-V0.6.1 */

/* 360-STUDIO-SPATIAL-MEDIA-AUDIO-V0.7.0 */

/* 360-STUDIO-HOTSPOT-SPATIAL-TRANSFORMS-V0.8.0 */

/* 360-STUDIO-SCALE-CONTROLS-V0.9.1 */
