#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const TILE_SIZE_LIMIT = 1024;
const MAX_TILE_COLUMNS = 64;

function usage() {
  console.error('Usage: npm run prepare:panorama -- <input-image> <output-folder>');
  console.error('Example: npm run prepare:panorama -- ./lobby-12000x6000.jpg ./public/tours/lobby');
  process.exit(1);
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'panorama';
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function createLevel(targetWidth) {
  const cols = Math.max(4, nextPowerOfTwo(Math.ceil(targetWidth / TILE_SIZE_LIMIT)));
  if (cols > MAX_TILE_COLUMNS) {
    throw new Error(`The processed panorama width (${targetWidth}) requires more than ${MAX_TILE_COLUMNS} columns. Keep the source copy, but use a smaller processed width for this adapter.`);
  }
  // Use a tile-aligned width for the derived level. The original file is copied byte-for-byte.
  const width = Math.floor(targetWidth / cols) * cols;
  if (width < cols * 64) throw new Error('The image is too small to produce a useful tiled level.');
  return { width, cols, rows: cols / 2 };
}

async function main() {
  const [inputArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !outputArg) usage();

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);
  const inputName = path.basename(inputPath);
  const inputExtension = path.extname(inputName).toLowerCase();
  const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
  if (!supportedExtensions.has(inputExtension)) throw new Error(`Unsupported source extension ${inputExtension || '(none)'}. Use JPG, PNG, WEBP, or TIFF.`);

  const metadata = await sharp(inputPath, { limitInputPixels: false }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Could not read image dimensions.');
  if (metadata.width < 1024) throw new Error('This source is under 1,024 pixels wide. Use it directly in the editor; tiling is intended for high-resolution panoramas.');
  if (metadata.width > 65536) throw new Error('Source width exceeds 65,536 pixels. The original remains untouched on disk, but this tile adapter supports at most 64 columns.');
  const ratio = metadata.width / metadata.height;
  if (Math.abs(ratio - 2) > 0.025) {
    throw new Error(`Expected a 2:1 equirectangular panorama, but this image is ${metadata.width} × ${metadata.height} (ratio ${ratio.toFixed(3)}).`);
  }

  await fs.mkdir(outputPath, { recursive: true });
  const originalsPath = path.join(outputPath, 'originals');
  const tilesPath = path.join(outputPath, 'tiles');
  await fs.mkdir(originalsPath, { recursive: true });
  await fs.mkdir(tilesPath, { recursive: true });

  const originalCopy = path.join(originalsPath, inputName);
  await fs.copyFile(inputPath, originalCopy);

  const previewWidth = Math.min(2048, Math.floor(metadata.width / 2) * 2);
  await sharp(inputPath, { limitInputPixels: false })
    .rotate()
    .resize({ width: previewWidth, height: Math.floor(previewWidth / 2), fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(outputPath, 'preview.jpg'));

  const candidateWidths = metadata.width > 8192
    ? [Math.floor(metadata.width / 4), Math.floor(metadata.width / 2), metadata.width]
    : metadata.width > 4096
      ? [Math.floor(metadata.width / 2), metadata.width]
      : [metadata.width];
  const uniqueTargets = [...new Set(candidateWidths.map((width) => Math.min(metadata.width, width)))];
  const levelMap = new Map();
  for (const targetWidth of uniqueTargets) {
    const level = createLevel(targetWidth);
    if (!levelMap.has(level.width)) levelMap.set(level.width, level);
  }
  const levels = [...levelMap.values()].sort((a, b) => a.width - b.width);
  if (levels.length > 8) throw new Error('The generated pyramid exceeds 8 levels.');

  for (const [levelIndex, level] of levels.entries()) {
    const levelFolder = path.join(tilesPath, String(level.width));
    await fs.mkdir(levelFolder, { recursive: true });
    const tempLevelPath = path.join(outputPath, `.level-${level.width}.tmp.jpg`);
    const tileWidth = level.width / level.cols;
    const tileHeight = (level.width / 2) / level.rows;

    console.log(`Preparing level ${levelIndex + 1}/${levels.length}: ${level.width} × ${level.width / 2} (${level.cols} × ${level.rows} tiles)`);
    await sharp(inputPath, { limitInputPixels: false })
      .rotate()
      .resize({ width: level.width, height: level.width / 2, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(tempLevelPath);

    for (let row = 0; row < level.rows; row += 1) {
      for (let col = 0; col < level.cols; col += 1) {
        await sharp(tempLevelPath)
          .extract({ left: col * tileWidth, top: row * tileHeight, width: tileWidth, height: tileHeight })
          .jpeg({ quality: 90, mozjpeg: true })
          .toFile(path.join(levelFolder, `${col}_${row}.jpg`));
      }
    }
    await fs.rm(tempLevelPath, { force: true });
  }

  const zoomStep = 100 / levels.length;
  const manifestLevels = levels.map((level, index) => ({
    ...level,
    zoomRange: [Math.round(index * zoomStep), index === levels.length - 1 ? 100 : Math.round((index + 1) * zoomStep)],
  }));
  const manifest = {
    schemaVersion: 1,
    source: {
      originalFileName: inputName,
      width: metadata.width,
      height: metadata.height,
      originalUrl: `originals/${encodeURIComponent(inputName)}`,
    },
    baseUrl: 'preview.jpg',
    tileUrlTemplate: 'tiles/{width}/{col}_{row}.jpg',
    levels: manifestLevels,
    generatedAt: new Date().toISOString(),
    notes: 'Original file is preserved in originals/. Tiles are derived, JPEG-compressed display assets.'
  };
  await fs.writeFile(path.join(outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputPath, 'README.md'), `# Tiled panorama output\n\n- \`manifest.json\`: point the 360 Studio inspector to this URL after hosting the folder.\n- \`preview.jpg\`: low-resolution base image displayed while high-resolution tiles load.\n- \`tiles/\`: derived image tiles loaded according to viewer zoom.\n- \`originals/${inputName}\`: untouched source file copied from the input.\n\nHost the entire folder over HTTP(S). If the studio is hosted on another origin, configure CORS on this folder's server/CDN for the studio origin. Keep relative paths intact.\n\nGenerated tiles use JPEG quality 90; the untouched original remains available under originals/.\n`, 'utf8');

  console.log(`\nDone. Original preserved at: ${originalCopy}`);
  console.log(`Manifest: ${path.join(outputPath, 'manifest.json')}`);
  console.log(`Levels: ${manifestLevels.map((level) => `${level.width}px (${level.cols}×${level.rows})`).join(' → ')}`);
  console.log('Next: host the output folder, then paste the manifest.json URL into the scene inspector.');
}

main().catch((error) => {
  console.error(`Panorama preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
