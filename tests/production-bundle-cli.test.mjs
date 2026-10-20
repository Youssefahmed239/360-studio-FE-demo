import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const payloadRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(payloadRoot, 'scripts/qa-standalone-bundle.mjs');

async function makeBundle() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '360-studio-bundle-qa-'));
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="./tour-player.css"></head><body><div id="tour-root"></div><script defer src="./tour-player.js"></script></body></html>');
  await fs.writeFile(path.join(root, 'tour-player.js'), '/* tour-root project.json archive-manifest.json */');
  await fs.writeFile(path.join(root, 'tour-player.css'), '.tour-app{} .tour-canvas{}');
  await fs.writeFile(path.join(root, 'DEPLOYMENT.txt'), 'serve from a web server');
  await fs.writeFile(path.join(root, 'assets/panorama.jpg'), 'image');
  const size = (await fs.stat(path.join(root, 'assets/panorama.jpg'))).size;
  await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({
    schemaVersion: 1, id: 'qa-project', name: 'QA Tour', settings: { startSceneId: 'lobby' }, assets: [],
    scenes: [{ id: 'lobby', name: 'Lobby', panoramaAssetId: 'panorama', hotspots: [] }],
  }));
  await fs.writeFile(path.join(root, 'archive-manifest.json'), JSON.stringify({
    format: '360studio-project-archive', schemaVersion: 1,
    files: [{ path: 'assets/panorama.jpg', assetId: 'panorama', name: 'panorama.jpg', mimeType: 'image/jpeg', size }],
    externalDependencies: [],
  }));
  return root;
}

test('standalone bundle CLI accepts a valid extracted tour', async () => {
  const root = await makeBundle();
  try {
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS: no structural errors found/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('standalone bundle CLI rejects a missing local asset', async () => {
  const root = await makeBundle();
  try {
    await fs.rm(path.join(root, 'assets/panorama.jpg'));
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /missing or inaccessible file/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
