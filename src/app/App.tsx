import { useEffect, useRef, useState } from 'react';
import { Aperture, ArrowDownToLine, AudioLines, Check, ChevronDown, CircleHelp, Cloud, ExternalLink, FolderOpen, Globe2, Image, Layers3, MonitorPlay, MoreHorizontal, Plus, Save, Settings2, Sparkles, Trash2, Video, X } from 'lucide-react';
import { useProjectStore } from '../features/projects/projectStore';
import { persistUploadedAsset, restoreUploadedAssetUrls } from '../features/assets/assetStorage';
import PanoramaCanvas from '../features/panorama/PanoramaCanvas';
import { loadTiledPanoramaManifest } from '../features/panorama/panoramaManifest';
import { exportProjectJson, importProjectJson } from '../lib/projectFiles';
import type { HotspotKind, TourHotspot, TourScene } from '../types/project';

const statusText = { saved: 'All changes saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' } as const;
const hotspotKinds: HotspotKind[] = ['navigation', 'image', 'video', 'audio', 'info'];

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
  const [notice, setNotice] = useState('');
  const [showPublish, setShowPublish] = useState(false);
  const [placingHotspot, setPlacingHotspot] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedHotspot, setSelectedHotspot] = useState<TourHotspot | null>(null);
  const [tileManifestUrl, setTileManifestUrl] = useState('');
  const [loadingTileManifest, setLoadingTileManifest] = useState(false);
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
  useEffect(() => { setPlacingHotspot(false); }, [activeSceneId]);
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

  function handleImport(file?: File) {
    if (!file) return;
    void importProjectJson(file).then(async (incoming) => {
      if (!window.confirm(`Open “${incoming.name}”? This replaces the current editor project.`)) return;
      const restored = await restoreUploadedAssetUrls(incoming);
      replaceProject(restored);
      const missingUploads = restored.assets.filter((asset) => asset.source === 'uploaded' && !asset.url).length;
      setNotice(missingUploads
        ? `Project imported, but ${missingUploads} uploaded file(s) were not in the JSON export. Use the original project browser or re-upload those files.`
        : 'Project imported. Save to keep it in this browser.');
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

  function handleExport() {
    const omittedUploads = exportProjectJson(project);
    setNotice(omittedUploads
      ? `Project JSON exported. Note: ${omittedUploads} uploaded media file(s) are not included in JSON exports yet.`
      : 'Project JSON exported.');
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

  function deleteHotspot(hotspotId: string) {
    if (!activeScene) return;
    updateScene(activeScene.id, { hotspots: activeScene.hotspots.filter((hotspot) => hotspot.id !== hotspotId) });
  }

  function activateHotspot(hotspot: TourHotspot) {
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

  return <div className="studio-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><Aperture size={21} /></div><div><div className="brand-title">360 <span>STUDIO</span></div><div className="brand-subtitle">EXPERIENCE BUILDER</div></div></div>
      <div className="project-heading"><input aria-label="Project name" value={project.name} onChange={(e) => setProjectName(e.target.value)} /><span className="saved-state"><span className={`status-dot ${saveState}`} />{statusText[saveState]}</span></div>
      <div className="top-actions">
        <button className="button button-quiet" onClick={() => importRef.current?.click()}><FolderOpen size={16} /> Open</button>
        <button className="button button-quiet" onClick={() => { save(); setNotice('Project draft saved in this browser.'); }}><Save size={16} /> Save</button>
        <button className="button button-outline" onClick={handleExport}><ArrowDownToLine size={16} /> Export project</button>
        <button className="button button-primary" onClick={() => setShowPublish(true)}><Globe2 size={16} /> Build for web <ChevronDown size={14} /></button>
      </div>
      <input ref={importRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={(e) => handleImport(e.target.files?.[0])} />
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
        <div className="canvas-area"><div className={`canvas-frame ${placingHotspot ? 'hotspot-placement' : ''}`}>
          {activeScene ? <PanoramaCanvas scene={activeScene} placementMode={placingHotspot && !previewMode} onPlaceHotspot={placeHotspot} onHotspotAction={activateHotspot} /> : null}
          {!activeScene?.panoramaUrl && !activeScene?.tiledPanorama && <div className="empty-panorama"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-center"><Aperture size={38} strokeWidth={1.2} /></div><div className="empty-copy"><span className="eyebrow">SCENE CANVAS</span><h2>Your world starts here.</h2><p>Add an equirectangular panorama to explore the scene in full 360°.</p><button className="button button-primary" onClick={() => panoramaRef.current?.click()}><Plus size={16} /> Add panorama</button><div className="file-hint">JPG, PNG, WEBP · Original file retained in browser storage</div></div></div>}
          <input ref={panoramaRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void addPanorama(e.target.files?.[0])} />
          <div className="canvas-corner top-left"><span className="live-dot" /> {previewMode ? 'TOUR PREVIEW' : placingHotspot ? 'CLICK TO PLACE HOTSPOT' : '360° EDITOR CANVAS'}</div><div className="canvas-corner top-right"><span>360°</span><span className="corner-divider" /> <span>{activeScene?.tiledPanorama ? 'TILE STREAMING' : 'SPHERICAL VIEW'}</span></div>
          <div className="canvas-bottom-tools"><button className={placingHotspot ? 'tool-active' : ''} disabled={(!activeScene?.panoramaUrl && !activeScene?.tiledPanorama) || previewMode} onClick={() => { if (!activeScene?.panoramaUrl && !activeScene?.tiledPanorama) { setNotice('Upload a panorama or connect a tile manifest first.'); return; } setPlacingHotspot((value) => !value); }}><Plus size={14} /> {placingHotspot ? 'Cancel placement' : 'Add hotspot'}</button><span className="tool-divider"/><button onClick={() => setNotice('Drag to look around. Use the mouse wheel or trackpad to zoom. The saved camera starting position is configured in the Inspector phase.') }><Aperture size={14} /> Camera</button><span className="tool-divider"/><button onClick={() => { setNotice('Choose a hotspot type in the Inspector after placing it. Image, video and audio viewers use direct URLs or assets linked in the project.'); setPlacingHotspot(false); }}><Video size={14} /> Place media</button></div>
        </div><div className="canvas-caption"><span><span className="keycap">Drag</span> look around <span className="caption-divider" /> Scroll to zoom <span className="caption-divider" /> {placingHotspot ? 'Click anywhere to place a hotspot' : 'Click a hotspot to interact'}</span><span>{previewMode ? 'TOUR PREVIEW' : 'EDITOR PREVIEW'} <span className="preview-dot" /></span></div></div>
        <div className="timeline"><div className="timeline-heading"><div><span className="eyebrow">EXPERIENCE FLOW</span><h3>Scene sequence</h3></div><button className="button button-quiet small" onClick={addScene}><Plus size={15} /> Add scene</button></div><div className="timeline-track">{project.scenes.map((scene, index) => <div className={`timeline-node ${scene.id === activeSceneId ? 'active' : ''}`} key={scene.id} onClick={() => selectScene(scene.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') selectScene(scene.id); }}><div className="timeline-thumb">{(scene.tiledPanorama?.baseUrl ?? scene.panoramaUrl) ? <img src={(scene.tiledPanorama?.baseUrl ?? scene.panoramaUrl)!} alt="" /> : <Aperture size={19} />}</div><div className="timeline-label"><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong></div>{index < project.scenes.length - 1 && <div className="flow-connector"><span /></div>}</div>)}</div></div>
      </main>

      <aside className="inspector"><div className="inspector-heading"><div><div className="eyebrow">SCENE CONFIGURATION</div><h2>Inspector</h2></div><button className="icon-button" aria-label="Inspector help" onClick={() => setNotice('Configure this scene and its hotspots here. Changes autosave in this browser.')}><X size={17} /></button></div>
        {activeScene ? <><section className="inspector-section"><label className="field-label" htmlFor="scene-name">Scene name</label><input id="scene-name" className="text-field" value={activeScene.name} onChange={(e) => updateSceneName(e.target.value)} /><div className="field-help">Shown in your scene navigator and tour menu.</div></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Panorama source</label><span className="mini-status">{activeScene.tiledPanorama ? 'TILED' : activeScene.panoramaUrl ? 'LOADED' : 'EMPTY'}</span></div><div className="asset-drop" onClick={() => panoramaRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') panoramaRef.current?.click(); }}><div className="asset-drop-icon"><Image size={18} /></div><div><strong>{activeScene.panoramaUrl ? 'Replace panorama' : 'Choose panorama'}</strong><p>Equirectangular JPG, PNG or WEBP</p></div><Plus size={16} /></div><div className="tile-manifest-form"><label className="field-label" htmlFor="tile-manifest-url">High-resolution tile manifest</label><input id="tile-manifest-url" className="text-field compact" type="url" placeholder="https://your-host/tour/manifest.json" value={tileManifestUrl} onChange={(e) => setTileManifestUrl(e.target.value)} /><button className="mini-button tile-manifest-button" type="button" onClick={() => void attachTiledPanorama()} disabled={loadingTileManifest}>{loadingTileManifest ? 'Loading manifest…' : 'Enable multi-resolution tiles'}</button>{activeScene.tiledPanorama ? <div className="tile-manifest-active"><strong>{activeScene.tiledPanorama.levels.length} resolution level(s)</strong><span>{activeScene.tiledPanorama.sourceWidth ? `${activeScene.tiledPanorama.sourceWidth.toLocaleString()} × ${(activeScene.tiledPanorama.sourceHeight ?? activeScene.tiledPanorama.sourceWidth / 2).toLocaleString()} source` : 'Tiled panorama connected'}</span><button type="button" onClick={useSinglePanorama}>Use single image instead</button></div> : <div className="field-help">Generate tiles with <code>npm run prepare:panorama -- input.jpg public/tours/lobby</code>, host the output folder, then paste its manifest URL. The tile files load progressively as you zoom.</div>}</div></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Scene transition</label><span className="subtle-label">ON ENTER</span></div><div className="transition-options">{(['fade', 'fade-through-black', 'zoom', 'none'] as const).map((kind) => <button key={kind} className={`transition-option ${activeScene.transition.kind === kind ? 'chosen' : ''}`} onClick={() => changeTransition(kind)}><span className={`transition-preview ${kind}`} />{kind === 'fade-through-black' ? 'Fade black' : kind === 'none' ? 'None' : kind[0].toUpperCase() + kind.slice(1)}{activeScene.transition.kind === kind && <Check size={13} />}</button>)}</div><label className="field-label duration-label" htmlFor="duration">Duration <strong>{(activeScene.transition.durationMs / 1000).toFixed(1)}s</strong></label><input id="duration" className="range-input" type="range" min="0" max="2000" step="100" value={activeScene.transition.durationMs} onChange={(e) => updateScene(activeScene.id, { transition: { ...activeScene.transition, durationMs: Number(e.target.value) } })} /><div className="field-help">Transitions run when moving between scenes with panorama images.</div></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Audio ambience</label><AudioLines size={16} className="muted-icon" /></div><div className="audio-placeholder"><div className="audio-icon"><AudioLines size={17} /></div><div><strong>{activeScene.audio?.url ? 'Audio linked' : 'No audio assigned'}</strong><p>Scene-specific soundscape</p></div><button className="mini-button" onClick={() => setNotice('Audio uploads, start/stop rules and fades are the next media milestone.')}>Configure</button></div><div className="field-help">Audio playback is subject to browser gesture requirements.</div></section>
        <section className="inspector-section hotspots-section"><div className="section-heading"><label className="field-label">Hotspots</label><span className="count-pill">{activeScene.hotspots.length}</span></div>{activeScene.hotspots.length ? activeScene.hotspots.map((hotspot) => <div className="hotspot-editor" key={hotspot.id}><div className="hotspot-editor-heading"><span className="hotspot-pin"><Globe2 size={14} /></span><span className="hotspot-kind-label">{hotspot.kind}</span><button className="mini-icon-button" title="Delete hotspot" aria-label={`Delete ${hotspot.title}`} onClick={() => deleteHotspot(hotspot.id)}><Trash2 size={13} /></button></div><label className="field-label" htmlFor={`hotspot-name-${hotspot.id}`}>Label</label><input id={`hotspot-name-${hotspot.id}`} className="text-field compact" value={hotspot.title} onChange={(e) => updateHotspot(hotspot.id, { title: e.target.value })} /><div className="hotspot-coordinate">Yaw {hotspot.yaw.toFixed(1)}° <span>·</span> Pitch {hotspot.pitch.toFixed(1)}°</div><label className="field-label" htmlFor={`hotspot-kind-${hotspot.id}`}>Action</label><select id={`hotspot-kind-${hotspot.id}`} className="text-field compact" value={hotspot.kind} onChange={(e) => updateHotspot(hotspot.id, { kind: e.target.value as HotspotKind, targetSceneId: e.target.value === 'navigation' ? project.scenes.find((scene) => scene.id !== activeScene.id)?.id : undefined })}>{hotspotKinds.map((kind) => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}</select>{hotspot.kind === 'navigation' && <><label className="field-label" htmlFor={`hotspot-target-${hotspot.id}`}>Target scene</label><select id={`hotspot-target-${hotspot.id}`} className="text-field compact" value={hotspot.targetSceneId ?? ''} onChange={(e) => updateHotspot(hotspot.id, { targetSceneId: e.target.value || undefined })}><option value="">Choose scene...</option>{project.scenes.filter((scene) => scene.id !== activeScene.id).map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></>}{['image', 'video', 'audio'].includes(hotspot.kind) && <><label className="field-label" htmlFor={`hotspot-url-${hotspot.id}`}>Media URL</label><input id={`hotspot-url-${hotspot.id}`} className="text-field compact" placeholder="https://..." value={hotspot.url ?? ''} onChange={(e) => updateHotspot(hotspot.id, { url: e.target.value || undefined })} /><div className="field-help">Direct media URL for preview. Upload-based asset selection is coming later.</div></>}</div>) : <div className="empty-hotspots">No hotspots yet.<button onClick={() => { if (!activeScene.panoramaUrl && !activeScene.tiledPanorama) { setNotice('Upload a panorama or connect a tile manifest before placing hotspots.'); return; } setPlacingHotspot(true); }}>Click to place your first hotspot</button></div>}</section></> : <p className="field-help">Add a scene to start configuring it.</p>}
        <div className="inspector-footer"><span><Settings2 size={14} /> Project settings</span><button onClick={() => setNotice('Global settings will be implemented after core scene editing.')}><ChevronDown size={15} /></button></div>
      </aside>
    </div>
    {notice && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {selectedHotspot && <div className="modal-backdrop" onClick={() => setSelectedHotspot(null)}><div className="hotspot-modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setSelectedHotspot(null)} aria-label="Close hotspot"><X size={17} /></button><div className="eyebrow">{selectedHotspot.kind.toUpperCase()} HOTSPOT</div><h2>{selectedHotspot.title}</h2>{selectedHotspot.kind === 'image' && selectedMediaUrl && <img className="hotspot-media-image" src={selectedMediaUrl} alt={selectedHotspot.title} />}{selectedHotspot.kind === 'video' && selectedMediaUrl && <video className="hotspot-media-video" src={selectedMediaUrl} controls playsInline />}{selectedHotspot.kind === 'audio' && selectedMediaUrl && <audio className="hotspot-media-audio" src={selectedMediaUrl} controls />}{selectedHotspot.kind === 'info' && <p className="hotspot-modal-copy">This information hotspot is ready to be expanded with rich text and branded content in a later phase.</p>}{['image', 'video', 'audio'].includes(selectedHotspot.kind) && !selectedMediaUrl && <p className="hotspot-modal-copy">Add a direct media URL in the Inspector to preview this hotspot. Uploaded asset linking will follow in the Media Library phase.</p>}{selectedMediaUrl?.startsWith('http') && <a className="hotspot-external-link" href={selectedMediaUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open source in new tab</a>}</div></div>}
    {showPublish && <div className="modal-backdrop" onClick={() => setShowPublish(false)}><div className="publish-modal" onClick={(e) => e.stopPropagation()}><div className="modal-icon"><Globe2 size={22} /></div><button className="modal-close" onClick={() => setShowPublish(false)} aria-label="Close"><X size={17} /></button><div className="eyebrow">PRODUCTION WORKFLOW</div><h2>Build for the web</h2><p>The editor now supports hosted multi-resolution equirectangular tile manifests. The local processing script preserves your original image and creates preview and tile levels. A standalone public player bundle is still being built.</p><div className="build-checklist"><span><Check size={15} /> Save / resume draft with local media</span><span><Check size={15} /> Export / import project configuration</span><span><Check size={15} /> Interactive 360° viewer and scene navigation</span><span><Check size={15} /> Multi-resolution tile manifest + viewer support</span><span className="pending"><span className="pending-dot" /> Standalone Nginx deployment bundle</span></div><button className="button button-primary full-width" onClick={() => { setShowPublish(false); setNotice('Production export is the next milestone after the viewer and asset pipeline.'); }}>Got it</button></div></div>}
    <footer className="bottom-status"><span><span className={`status-dot ${saveState}`} /> Workspace ready</span><span>360 Studio Demo <span className="footer-divider">/</span> v0.3.0</span><span>Project schema v1</span></footer>
  </div>;
}
