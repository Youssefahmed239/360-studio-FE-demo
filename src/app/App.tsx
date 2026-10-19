import { useEffect, useRef, useState } from 'react';
import { Aperture, ArrowDownToLine, AudioLines, Check, ChevronDown, CircleHelp, Cloud, FolderOpen, Globe2, Image, Layers3, MonitorPlay, MoreHorizontal, Plus, Save, Settings2, Sparkles, Video, X } from 'lucide-react';
import { useProjectStore } from '../features/projects/projectStore';
import { exportProjectJson, importProjectJson } from '../lib/projectFiles';
import type { TourScene } from '../types/project';

const statusText = { saved: 'All changes saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' } as const;

export default function App() {
  const project = useProjectStore((s) => s.project);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const saveState = useProjectStore((s) => s.saveState);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const selectScene = useProjectStore((s) => s.selectScene);
  const addScene = useProjectStore((s) => s.addScene);
  const updateScene = useProjectStore((s) => s.updateScene);
  const save = useProjectStore((s) => s.save);
  const load = useProjectStore((s) => s.load);
  const replaceProject = useProjectStore((s) => s.replaceProject);
  const importRef = useRef<HTMLInputElement>(null);
  const panoramaRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const [showPublish, setShowPublish] = useState(false);
  const activeScene = project.scenes.find((scene) => scene.id === activeSceneId) ?? project.scenes[0];

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (saveState !== 'unsaved') return;
    const timer = window.setTimeout(() => save(), 900);
    return () => window.clearTimeout(timer);
  }, [project, saveState, save]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function addPanorama(file?: File) {
    if (!file || !activeScene) return;
    const url = URL.createObjectURL(file);
    const assetId = crypto.randomUUID();
    const newAsset = { id: assetId, name: file.name, kind: 'panorama' as const, mimeType: file.type, source: 'uploaded' as const, originalFileName: file.name, url };
    // Object URLs are session-local previews; binary media will move to managed asset storage in the media pipeline.
    const current = useProjectStore.getState().project;
    replaceProject({ ...current, assets: [...current.assets, newAsset], scenes: current.scenes.map((scene) => scene.id === activeScene.id ? { ...scene, panoramaAssetId: assetId, panoramaUrl: url } : scene), updatedAt: new Date().toISOString() });
    setNotice('Panorama added to this scene. Save the project to keep the configuration.');
  }

  function handleImport(file?: File) {
    if (!file) return;
    void importProjectJson(file).then((incoming) => {
      if (window.confirm(`Open “${incoming.name}”? This replaces the current editor project.`)) {
        replaceProject(incoming);
        setNotice('Project imported. Save to keep it in this browser.');
      }
    }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Could not import project.'));
    if (importRef.current) importRef.current.value = '';
  }

  function updateSceneName(name: string) { if (activeScene) updateScene(activeScene.id, { name }); }
  function changeTransition(kind: TourScene['transition']['kind']) { if (activeScene) updateScene(activeScene.id, { transition: { ...activeScene.transition, kind } }); }

  return <div className="studio-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><Aperture size={21} /></div><div><div className="brand-title">360 <span>STUDIO</span></div><div className="brand-subtitle">EXPERIENCE BUILDER</div></div></div>
      <div className="project-heading"><input aria-label="Project name" value={project.name} onChange={(e) => setProjectName(e.target.value)} /><span className="saved-state"><span className={`status-dot ${saveState}`} />{statusText[saveState]}</span></div>
      <div className="top-actions">
        <button className="button button-quiet" onClick={() => importRef.current?.click()}><FolderOpen size={16} /> Open</button>
        <button className="button button-quiet" onClick={() => { save(); setNotice('Project saved in this browser.'); }}><Save size={16} /> Save</button>
        <button className="button button-outline" onClick={() => exportProjectJson(project)}><ArrowDownToLine size={16} /> Export project</button>
        <button className="button button-primary" onClick={() => setShowPublish(true)}><Globe2 size={16} /> Build for web <ChevronDown size={14} /></button>
      </div>
      <input ref={importRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={(e) => handleImport(e.target.files?.[0])} />
    </header>

    <div className="workspace">
      <aside className="left-rail">
        <button className="rail-item active"><Layers3 size={19} /><span>Scenes</span></button>
        <button className="rail-item" onClick={() => setNotice('Media library is planned for the next build phase.')}><Image size={19} /><span>Media</span></button>
        <button className="rail-item" onClick={() => setNotice('Theme controls are planned for the next build phase.')}><Sparkles size={19} /><span>Theme</span></button>
        <button className="rail-item" onClick={() => setNotice('Project settings are planned for the next build phase.')}><Settings2 size={19} /><span>Settings</span></button>
        <div className="rail-spacer" /><button className="rail-item" onClick={() => setNotice('Help and documentation will be added as the editor grows.')}><CircleHelp size={19} /><span>Help</span></button>
        <div className="avatar">YS</div>
      </aside>

      <aside className="scene-panel">
        <div className="panel-title-row"><div><div className="eyebrow">YOUR EXPERIENCE</div><h2>Scenes <span className="count-pill">{project.scenes.length}</span></h2></div><button className="icon-button" aria-label="Add scene" onClick={addScene}><Plus size={18} /></button></div>
        <div className="scene-list">{project.scenes.map((scene, index) => <button key={scene.id} className={`scene-card ${scene.id === activeSceneId ? 'selected' : ''}`} onClick={() => selectScene(scene.id)}>
          <div className={`scene-thumb thumb-${index % 3}`}>{scene.panoramaUrl ? <img src={scene.panoramaUrl} alt="" /> : <><div className="thumb-sun" /><div className="thumb-horizon" /><div className="thumb-shape shape-a" /><div className="thumb-shape shape-b" /><div className="thumb-floor" /></>}<span className="scene-index">{String(index + 1).padStart(2, '0')}</span></div>
          <div className="scene-card-meta"><strong>{scene.name}</strong><span>{scene.hotspots.length} hotspots <span className="meta-dot">·</span> {scene.panoramaUrl ? 'Panorama loaded' : 'No panorama yet'}</span></div><MoreHorizontal size={17} className="scene-more" />
        </button>)}</div>
        <button className="add-scene-button" onClick={addScene}><Plus size={16} /> Add new scene</button>
        <div className="storage-card"><div className="storage-icon"><Cloud size={17} /></div><div><strong>Local draft</strong><p>Autosaves in this browser</p><span className="storage-meter"><i /></span></div></div>
      </aside>

      <main className="editor-main">
        <div className="editor-toolbar"><div className="breadcrumb">Experience <span>/</span> <strong>{activeScene?.name ?? 'No scene selected'}</strong></div><div className="toolbar-right"><span className="draft-chip"><span /> DRAFT</span><button className="button button-quiet small" onClick={() => setNotice('Preview mode is coming next.')}><MonitorPlay size={15} /> Preview</button></div></div>
        <div className="canvas-area"><div className="canvas-frame">
          {activeScene?.panoramaUrl ? <div className="loaded-panorama"><img src={activeScene.panoramaUrl} alt="Selected panorama" /><div className="panorama-notice">Panorama source loaded <span>•</span> 360° viewer integration is next</div></div> : <div className="empty-panorama"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-center"><Aperture size={38} strokeWidth={1.2} /></div><div className="empty-copy"><span className="eyebrow">SCENE CANVAS</span><h2>Your world starts here.</h2><p>Add a high-resolution equirectangular panorama to begin building this scene.</p><button className="button button-primary" onClick={() => panoramaRef.current?.click()}><Plus size={16} /> Add panorama</button><div className="file-hint">JPG, PNG, WEBP · Keep your original resolution</div></div></div>}
          <input ref={panoramaRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => addPanorama(e.target.files?.[0])} />
          <div className="canvas-corner top-left"><span className="live-dot" /> EDITOR CANVAS</div><div className="canvas-corner top-right"><span>360°</span><span className="corner-divider" /> <span>2:1 PANORAMA</span></div>
          <div className="canvas-bottom-tools"><button onClick={() => setNotice('Hotspot placement tools are next in the implementation plan.')}><Plus size={14} /> Add hotspot</button><span className="tool-divider"/><button onClick={() => setNotice('Camera controls will be connected to the panorama viewer next.')}><Aperture size={14} /> Camera</button><span className="tool-divider"/><button onClick={() => setNotice('Media placement tools are next in the implementation plan.')}><Video size={14} /> Place media</button></div>
        </div><div className="canvas-caption"><span><span className="keycap">⌘</span> + scroll to zoom <span className="caption-divider" /> Drag to look around</span><span>EDITOR PREVIEW <span className="preview-dot" /></span></div></div>
        <div className="timeline"><div className="timeline-heading"><div><span className="eyebrow">EXPERIENCE FLOW</span><h3>Scene sequence</h3></div><button className="button button-quiet small" onClick={addScene}><Plus size={15} /> Add scene</button></div><div className="timeline-track">{project.scenes.map((scene, index) => <div className={`timeline-node ${scene.id === activeSceneId ? 'active' : ''}`} key={scene.id} onClick={() => selectScene(scene.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') selectScene(scene.id); }}><div className="timeline-thumb">{scene.panoramaUrl ? <img src={scene.panoramaUrl} alt="" /> : <Aperture size={19} />}</div><div className="timeline-label"><span>{String(index + 1).padStart(2, '0')}</span><strong>{scene.name}</strong></div>{index < project.scenes.length - 1 && <div className="flow-connector"><span /></div>}</div>)}</div></div>
      </main>

      <aside className="inspector"><div className="inspector-heading"><div><div className="eyebrow">SCENE CONFIGURATION</div><h2>Inspector</h2></div><button className="icon-button" aria-label="Close inspector" onClick={() => setNotice('Inspector stays open in this demo.')}><X size={17} /></button></div>
        {activeScene ? <><section className="inspector-section"><label className="field-label" htmlFor="scene-name">Scene name</label><input id="scene-name" className="text-field" value={activeScene.name} onChange={(e) => updateSceneName(e.target.value)} /><div className="field-help">Shown in your scene navigator and tour menu.</div></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Panorama source</label><span className="mini-status">{activeScene.panoramaUrl ? 'LOADED' : 'EMPTY'}</span></div><div className="asset-drop" onClick={() => panoramaRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') panoramaRef.current?.click(); }}><div className="asset-drop-icon"><Image size={18} /></div><div><strong>{activeScene.panoramaUrl ? 'Replace panorama' : 'Choose panorama'}</strong><p>Upload an equirectangular image</p></div><Plus size={16} /></div></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Scene transition</label><span className="subtle-label">ON ENTER</span></div><div className="transition-options">{(['fade', 'fade-through-black', 'zoom', 'none'] as const).map((kind) => <button key={kind} className={`transition-option ${activeScene.transition.kind === kind ? 'chosen' : ''}`} onClick={() => changeTransition(kind)}><span className={`transition-preview ${kind}`} />{kind === 'fade-through-black' ? 'Fade black' : kind === 'none' ? 'None' : kind[0].toUpperCase() + kind.slice(1)}{activeScene.transition.kind === kind && <Check size={13} />}</button>)}</div><label className="field-label duration-label" htmlFor="duration">Duration <strong>{(activeScene.transition.durationMs / 1000).toFixed(1)}s</strong></label><input id="duration" className="range-input" type="range" min="0" max="2000" step="100" value={activeScene.transition.durationMs} onChange={(e) => updateScene(activeScene.id, { transition: { ...activeScene.transition, durationMs: Number(e.target.value) } })} /></section>
        <section className="inspector-section"><div className="section-heading"><label className="field-label">Audio ambience</label><AudioLines size={16} className="muted-icon" /></div><div className="audio-placeholder"><div className="audio-icon"><AudioLines size={17} /></div><div><strong>{activeScene.audio?.url ? 'Audio linked' : 'No audio assigned'}</strong><p>Scene-specific soundscape</p></div><button className="mini-button" onClick={() => setNotice('Audio uploads, start/stop rules and fades are planned for the media phase.')}>Configure</button></div><div className="field-help">Browser audio starts after a user gesture.</div></section>
        <section className="inspector-section hotspots-section"><div className="section-heading"><label className="field-label">Hotspots</label><span className="count-pill">{activeScene.hotspots.length}</span></div>{activeScene.hotspots.length ? activeScene.hotspots.map((hotspot) => <div className="hotspot-row" key={hotspot.id}><span className="hotspot-pin"><Globe2 size={14} /></span><div><strong>{hotspot.title}</strong><p>{hotspot.kind} hotspot</p></div></div>) : <div className="empty-hotspots">No hotspots yet.<button onClick={() => setNotice('Hotspot editing is the next feature after the viewer foundation.')}>Add your first hotspot</button></div>}</section></> : <p className="field-help">Add a scene to start configuring it.</p>}
        <div className="inspector-footer"><span><Settings2 size={14} /> Project settings</span><button onClick={() => setNotice('Global settings will be implemented after core scene editing.')}><ChevronDown size={15} /></button></div>
      </aside>
    </div>
    {notice && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {showPublish && <div className="modal-backdrop" onClick={() => setShowPublish(false)}><div className="publish-modal" onClick={(e) => e.stopPropagation()}><div className="modal-icon"><Globe2 size={22} /></div><button className="modal-close" onClick={() => setShowPublish(false)} aria-label="Close"><X size={17} /></button><div className="eyebrow">PRODUCTION WORKFLOW</div><h2>Build for the web</h2><p>This starter includes the editor shell and project JSON export. A deployable player build will be enabled after the panorama runtime and asset pipeline are implemented.</p><div className="build-checklist"><span><Check size={15} /> Save and resume project draft</span><span><Check size={15} /> Export / import editable project JSON</span><span className="pending"><span className="pending-dot" /> Panorama viewer and tiled assets</span><span className="pending"><span className="pending-dot" /> Standalone Nginx deployment bundle</span></div><button className="button button-primary full-width" onClick={() => { setShowPublish(false); setNotice('Build for web is queued for a later implementation phase.'); }}>Got it</button></div></div>}
    <footer className="bottom-status"><span><span className="status-dot saved" /> Workspace ready</span><span>360 Studio Demo <span className="footer-divider">/</span> v0.1.0</span><span>Project schema v1</span></footer>
  </div>;
}
