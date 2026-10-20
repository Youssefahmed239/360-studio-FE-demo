import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFile(path.join(projectRoot, relativePath), 'utf8');

test('project schema exposes persisted toolbar and welcome layout configuration', async () => {
  const types = await read('src/types/project.ts');
  assert.match(types, /export interface TourLayoutSettings/);
  assert.match(types, /export interface TourToolbarLayout/);
  assert.match(types, /export interface TourWelcomeLayout/);
  assert.match(types, /layout\?: TourLayoutSettings/);
  assert.match(types, /showOnce: boolean/);
  assert.match(types, /panelOpacity: number/);
  assert.match(types, /backdropOpacity: number/);
});

test('editor includes grouped/free layout editing, draggable elements and scene assignments', async () => {
  const app = await read('src/app/App.tsx');
  assert.match(app, /Tour Layout & Welcome Screen/);
  assert.match(app, /Group buttons together/);
  assert.match(app, /Free placement/);
  assert.match(app, /onPointerDown=\{beginDrag\}/);
  assert.match(app, /Hidden hotspot/);
  assert.match(app, /Show welcome on these scenes/);
  assert.match(app, /Upload image from this device/);
  assert.match(app, /Toggle sound/);
  assert.match(app, /Open Map \(URL\)/);
});

test('standalone player wires layout controls and scene-scoped welcome overlays', async () => {
  const runtime = await read('src/player/runtime.ts');
  const css = await read('src/player/runtime.css');
  assert.match(runtime, /tour-layout-root/);
  assert.match(runtime, /tour-welcome-root/);
  assert.match(runtime, /private renderLayout\(/);
  assert.match(runtime, /private maybeShowWelcome\(/);
  assert.match(runtime, /private async activateLayoutElement\(/);
  assert.match(runtime, /Open page in a new tab/);
  assert.match(css, /\.tour-layout-toolbar/);
  assert.match(css, /\.tour-welcome-panel/);
});
