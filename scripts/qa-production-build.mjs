import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const errors = [];
const checks = [];

async function requireFile(relativePath, label = relativePath) {
  const full = path.join(dist, relativePath);
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size === 0) throw new Error('not a non-empty file');
    checks.push(`PASS ${label} (${stat.size.toLocaleString()} bytes)`);
    return await fs.readFile(full, 'utf8');
  } catch {
    errors.push(`Missing or empty build output: dist/${relativePath}`);
    return '';
  }
}

async function main() {
  const html = await requireFile('index.html', 'editor entry page');
  const js = await requireFile('player-runtime/tour-player.js', 'standalone player JS');
  const css = await requireFile('player-runtime/tour-player.css', 'standalone player CSS');
  if (html) {
    if (/\b(?:src|href)=["']\/(?!\/)/i.test(html)) errors.push('dist/index.html contains a root-absolute src/href. The editor must support hosting from an Nginx subpath.');
    if (/\/(?:src\/main\.tsx|@vite\/client)/i.test(html)) errors.push('dist/index.html still references a Vite development entry.');
    const referencedAssets = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]);
    for (const asset of referencedAssets) {
      if (/^(?:https?:|data:|#|javascript:)/i.test(asset)) continue;
      const relative = asset.replace(/^\.\//, '');
      if (relative.startsWith('/')) { errors.push(`Root-absolute asset reference in index.html: ${asset}`); continue; }
      try {
        const assetPath = path.resolve(dist, relative);
        if (!assetPath.startsWith(dist + path.sep) || !(await fs.stat(assetPath)).isFile()) errors.push(`HTML asset reference does not resolve inside dist: ${asset}`);
      } catch { errors.push(`HTML asset reference is missing: ${asset}`); }
    }
    checks.push('PASS editor HTML uses relative deployment paths where required');
  }
  if (js) {
    for (const phrase of ['tour-root', 'project.json', 'archive-manifest.json']) {
      if (!js.includes(phrase)) errors.push(`Standalone player bundle is missing expected runtime marker: ${phrase}`);
    }
    checks.push('PASS standalone JS contains the player boot/configuration markers');
  }
  if (css) {
    for (const phrase of ['.tour-app', '.tour-canvas']) if (!css.includes(phrase)) errors.push(`Standalone player CSS is missing expected selector: ${phrase}`);
    checks.push('PASS standalone CSS contains expected layout selectors');
  }

  console.log('\n360 Studio production build QA\n');
  checks.forEach((item) => console.log(item));
  if (errors.length) {
    console.error(`\nFAIL: ${errors.length} issue(s) found:`);
    errors.forEach((error) => console.error(`- ${error}`));
    console.error('\nDo not deploy this build until the failed checks are fixed.');
    process.exitCode = 1;
  } else {
    console.log('\nPASS: build output structure looks deployable. This does not replace browser/device or Nginx testing.');
  }
}

await main();
