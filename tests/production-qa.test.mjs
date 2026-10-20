import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeRelativePath, resolveInsideRoot, validateProjectManifest, parseJson } from '../scripts/production-qa-lib.mjs';

test('accepts normal relative asset paths', () => {
  assert.equal(isSafeRelativePath('assets/scene/photo.png'), true);
  assert.equal(isSafeRelativePath('tours/lobby/tiles/3000/0_0.jpg'), true);
});

test('rejects unsafe archive paths', () => {
  for (const value of ['', '../secret', 'assets/../../secret', '/etc/passwd', 'C:\\tour\\file.mp4', 'assets\\file.mp4', 'assets/./file']) {
    assert.equal(isSafeRelativePath(value), false, `expected to reject ${value}`);
  }
});

test('resolveInsideRoot refuses traversal', () => {
  assert.throws(() => resolveInsideRoot('/tmp/tour', '../outside.txt'), /Unsafe relative path/);
  assert.equal(resolveInsideRoot('/tmp/tour', 'assets/video.mp4'), '/tmp/tour/assets/video.mp4');
});

test('parses valid JSON and labels invalid JSON errors', () => {
  assert.deepEqual(parseJson('{"schemaVersion":1}', 'project.json'), { schemaVersion: 1 });
  assert.throws(() => parseJson('{bad', 'project.json'), /project\.json is not valid JSON/);
});

test('passes a project whose scene and asset references exist', () => {
  const project = {
    schemaVersion: 1, id: 'p1', name: 'Test tour', settings: { startSceneId: 'lobby' }, assets: [],
    scenes: [{ id: 'lobby', name: 'Lobby', panoramaAssetId: 'pano', hotspots: [
      { id: 'go', kind: 'navigation', targetSceneId: 'room', yaw: 0, pitch: 0 },
      { id: 'poster', kind: 'image', assetId: 'poster', yaw: 3, pitch: 4 },
    ] }, { id: 'room', name: 'Room', panoramaUrl: 'https://media.example/room.jpg', hotspots: [] }],
  };
  const manifest = { files: [
    { path: 'assets/pano.jpg', assetId: 'pano', size: 10 },
    { path: 'assets/poster.png', assetId: 'poster', size: 20 },
  ] };
  const result = validateProjectManifest(project, manifest, new Set(['assets/pano.jpg', 'assets/poster.png']));
  assert.deepEqual(result.errors, []);
});

test('detects missing navigation targets and unbundled asset references', () => {
  const project = {
    schemaVersion: 1, id: 'p1', name: 'Broken tour', settings: { startSceneId: 'unknown' }, assets: [],
    scenes: [{ id: 'lobby', name: 'Lobby', hotspots: [
      { id: 'go', title: 'Go somewhere', kind: 'navigation', targetSceneId: 'nope' },
      { id: 'poster', title: 'Poster', kind: 'image', assetId: 'missing' },
    ] }],
  };
  const result = validateProjectManifest(project, { files: [] });
  assert.ok(result.errors.some((item) => item.includes('missing scene nope')));
  assert.ok(result.errors.some((item) => item.includes('missing asset missing')));
  assert.ok(result.errors.some((item) => item.includes('settings.startSceneId')));
});

test('detects unsafe paths and duplicate ids in archive manifest', () => {
  const project = { schemaVersion: 1, id: 'p1', name: 'Tour', settings: {}, assets: [], scenes: [] };
  const manifest = { files: [
    { path: '../escape.png', assetId: 'a' },
    { path: 'assets/a.png', assetId: 'same' },
    { path: 'assets/b.png', assetId: 'same' },
  ] };
  const result = validateProjectManifest(project, manifest);
  assert.ok(result.errors.some((item) => item.includes('Unsafe path')));
  assert.ok(result.errors.some((item) => item.includes('Duplicate bundled assetId')));
});
