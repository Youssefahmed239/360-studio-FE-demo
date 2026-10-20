import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSafeRelativePath, resolveInsideRoot, validateProjectManifest, parseJson } from './production-qa-lib.mjs';

const directoryArg = process.argv[2];
if (!directoryArg) {
  console.error('Usage: npm run qa:bundle -- /path/to/extracted-production-tour');
  process.exit(2);
}
const root = path.resolve(directoryArg);
const errors = [];
const warnings = [];
const passed = [];

async function readRequired(relativePath) {
  try {
    if (!isSafeRelativePath(relativePath)) throw new Error('unsafe path');
    const full = resolveInsideRoot(root, relativePath);
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size === 0) throw new Error('not a non-empty file');
    passed.push(`PASS ${relativePath} (${stat.size.toLocaleString()} bytes)`);
    return await fs.readFile(full, 'utf8');
  } catch (error) {
    errors.push(`Required file missing or invalid: ${relativePath} (${error instanceof Error ? error.message : String(error)})`);
    return '';
  }
}

async function main() {
  const required = ['index.html', 'tour-player.js', 'tour-player.css', 'project.json', 'archive-manifest.json', 'DEPLOYMENT.txt'];
  for (const file of required) await readRequired(file);

  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8').catch(() => '');
  if (html) {
    if (!/href=["']\.\/tour-player\.css["']/.test(html)) errors.push('index.html does not link to ./tour-player.css.');
    if (!/src=["']\.\/tour-player\.js["']/.test(html)) errors.push('index.html does not load ./tour-player.js.');
    if (/\b(?:src|href)=["']\/(?!\/)/i.test(html)) errors.push('index.html has root-absolute paths; tour may fail when served from an Nginx subdirectory.');
    if (!html.includes('tour-root')) errors.push('index.html is missing the tour-root container.');
    else passed.push('PASS standalone entry page uses relative player paths');
  }

  let project;
  let manifest;
  try { project = parseJson(await fs.readFile(path.join(root, 'project.json'), 'utf8'), 'project.json'); }
  catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  try { manifest = parseJson(await fs.readFile(path.join(root, 'archive-manifest.json'), 'utf8'), 'archive-manifest.json'); }
  catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }

  const available = new Set();
  const actualSizes = new Map();
  if (manifest && Array.isArray(manifest.files)) {
    for (const record of manifest.files) {
      if (!record || typeof record.path !== 'string' || !isSafeRelativePath(record.path)) continue;
      try {
        const stat = await fs.stat(resolveInsideRoot(root, record.path));
        if (!stat.isFile()) throw new Error('not a file');
        available.add(record.path);
        actualSizes.set(record.path, stat.size);
        if (typeof record.size === 'number' && record.size !== stat.size) errors.push(`Size mismatch for ${record.path}: manifest=${record.size}, extracted=${stat.size}.`);
      } catch {
        errors.push(`Manifest points to a missing or inaccessible file: ${record.path}`);
      }
    }
    if (available.size === manifest.files.length) passed.push(`PASS all ${available.size} manifest file(s) exist and match declared sizes`);
    else warnings.push(`Only ${available.size} of ${manifest.files.length} manifest file(s) were validated. Review previous errors.`);
  }

  if (project && manifest) {
    const report = validateProjectManifest(project, manifest, available);
    errors.push(...report.errors);
    warnings.push(...report.warnings);
    if (!report.errors.length) passed.push(`PASS project references (${Array.isArray(project.scenes) ? project.scenes.length : 0} scene(s)) are internally consistent`);
  }

  console.log(`\n360 Studio standalone bundle QA\nBundle: ${root}\n`);
  passed.forEach((item) => console.log(item));
  warnings.forEach((item) => console.warn(`WARN ${item}`));
  if (errors.length) {
    console.error(`\nFAIL: ${errors.length} issue(s) found:`);
    errors.forEach((item) => console.error(`- ${item}`));
    process.exitCode = 1;
  } else {
    console.log(`\nPASS: no structural errors found${warnings.length ? `, with ${warnings.length} warning(s)` : ''}. This check cannot prove browser playback, iframe permissions, audio autoplay, or Nginx configuration.`);
  }
}

await main();
