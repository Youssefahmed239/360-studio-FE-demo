import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteSceneFromProject, reorderById } from '../src/lib/sceneEditing.mjs';

const baseProject = () => ({
  schemaVersion: 1,
  id: 'project-1',
  name: 'Test Tour',
  updatedAt: 'before',
  settings: { brandName: 'Test', accentColor: '#a3e635', startSceneId: 'scene-a', allowFullscreen: true },
  scenes: [
    { id: 'scene-a', name: 'Lobby', panoramaAssetId: 'asset-a', initialYaw: 0, initialPitch: 0, initialZoom: 0, transition: { kind: 'fade', durationMs: 500 }, hotspots: [{ id: 'hs-a', kind: 'navigation', title: 'Go to Room', yaw: 0, pitch: 0, targetSceneId: 'scene-b' }] },
    { id: 'scene-b', name: 'Room', panoramaAssetId: 'asset-shared', audio: { assetId: 'audio-b' }, initialYaw: 0, initialPitch: 0, initialZoom: 0, transition: { kind: 'fade', durationMs: 500 }, hotspots: [{ id: 'hs-b', kind: 'image', title: 'Picture', yaw: 1, pitch: 2, assetId: 'asset-image' }] },
    { id: 'scene-c', name: 'Exit', panoramaAssetId: 'asset-shared', initialYaw: 0, initialPitch: 0, initialZoom: 0, transition: { kind: 'fade', durationMs: 500 }, hotspots: [] },
  ],
  assets: [
    { id: 'asset-a', name: 'Lobby', kind: 'panorama', mimeType: 'image/jpeg', source: 'uploaded' },
    { id: 'asset-shared', name: 'Shared pano', kind: 'panorama', mimeType: 'image/jpeg', source: 'uploaded' },
    { id: 'audio-b', name: 'Room audio', kind: 'audio', mimeType: 'audio/mpeg', source: 'uploaded' },
    { id: 'asset-image', name: 'Room image', kind: 'image', mimeType: 'image/png', source: 'uploaded' },
    { id: 'layout-image', name: 'Logo', kind: 'image', mimeType: 'image/png', source: 'uploaded' },
  ],
  layout: {
    toolbar: { enabled: true, mode: 'grouped', edge: 'top', x: 50, y: 8, gap: 8, elements: [{ id: 'toolbar-scene', type: 'button', label: 'Room', action: 'scene', targetSceneId: 'scene-b', x: 0, y: 0, width: 100, height: 40 }, { id: 'toolbar-image', type: 'image', label: 'Logo', action: 'none', imageAssetId: 'layout-image', x: 0, y: 0, width: 80, height: 40 }] },
    welcome: { enabled: true, sceneIds: ['scene-a', 'scene-b'], showOnce: false, title: 'Welcome', body: '', widthPercent: 70, heightPx: 400, panelOpacity: 1, backdropOpacity: 0.2, showCloseButton: true, elements: [{ id: 'welcome-scene', type: 'button', label: 'Go room', action: 'scene', targetSceneId: 'scene-b', x: 50, y: 70, width: 120, height: 40 }] },
  },
});

test('reorders scenes and layout elements before or after the target while preserving IDs', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(reorderById(items, 'a', 'c'), [{ id: 'b' }, { id: 'a' }, { id: 'c' }]);
  assert.deepEqual(reorderById(items, 'a', 'c', true), [{ id: 'b' }, { id: 'c' }, { id: 'a' }]);
  assert.deepEqual(reorderById(items, 'missing', 'c'), items);
});

test('deleting a scene removes its content, cleans stale targets and welcome assignment, and updates start scene', () => {
  const project = baseProject();
  const result = deleteSceneFromProject(project, 'scene-a', 'after');
  assert.deepEqual(result.project.scenes.map((scene) => scene.id), ['scene-b', 'scene-c']);
  assert.equal(result.project.settings.startSceneId, 'scene-b');
  assert.equal(result.project.scenes[0].hotspots.length, 1); // Content on remaining scene is preserved.
  assert.equal(result.project.scenes.some((scene) => scene.hotspots.some((hotspot) => hotspot.targetSceneId === 'scene-a')), false);
  assert.equal(result.project.layout.welcome.sceneIds.includes('scene-a'), false);
  assert.equal(result.project.layout.toolbar.elements[0].targetSceneId, 'scene-b');
  assert.equal(result.project.assets.some((asset) => asset.id === 'asset-shared'), true);
  assert.equal(result.project.assets.some((asset) => asset.id === 'asset-a'), false);
  assert.deepEqual(result.orphanedAssetIds, ['asset-a']);
  assert.equal(result.project.updatedAt, 'after');
});

test('deleting a scene whose actions target another scene resets those actions instead of leaving broken targets', () => {
  const project = baseProject();
  const result = deleteSceneFromProject(project, 'scene-b', 'after');
  assert.equal(result.project.layout.toolbar.elements[0].action, 'none');
  assert.equal(result.project.layout.toolbar.elements[0].targetSceneId, undefined);
  assert.equal(result.project.layout.welcome.elements[0].action, 'none');
  assert.equal(result.project.layout.welcome.elements[0].targetSceneId, undefined);
  assert.equal(result.project.layout.welcome.sceneIds.includes('scene-b'), false);
  assert.equal(result.removedNavigationHotspots, 1);
  assert.equal(result.project.assets.some((asset) => asset.id === 'audio-b'), false);
  assert.equal(result.project.assets.some((asset) => asset.id === 'asset-image'), false);
});

test('refuses to delete the last remaining scene', () => {
  const project = baseProject();
  project.scenes = [project.scenes[0]];
  assert.throws(() => deleteSceneFromProject(project, 'scene-a'), /at least one scene/);
});
