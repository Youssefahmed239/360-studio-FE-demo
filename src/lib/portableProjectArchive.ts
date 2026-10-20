import type { TourAsset, TourProject } from '../types/project';
import { getUploadedAssetRecord, persistImportedAssets, stripTransientAssetUrls } from '../features/assets/assetStorage';

const ARCHIVE_FORMAT = '360studio-project-archive';
const ARCHIVE_SCHEMA_VERSION = 1;
const PROJECT_FILE = 'project.json';
const ARCHIVE_MANIFEST_FILE = 'archive-manifest.json';
const README_FILE = 'README.txt';
const MAX_ZIP_ENTRIES = 60_000;
const UINT32_MAX = 0xffff_ffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 128 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface ArchiveProgress {
  phase: 'collecting' | 'downloading' | 'packaging' | 'importing';
  completed: number;
  total: number;
  detail: string;
}

export interface ExternalDependency {
  url: string;
  label: string;
  reason: string;
}

export interface PortableArchiveResult {
  project: TourProject;
  isArchive: boolean;
  importedAssetCount: number;
  externalDependencies: ExternalDependency[];
}

interface ArchiveFileRecord {
  path: string;
  assetId: string;
  name: string;
  mimeType: string;
  kind: TourAsset['kind'];
  size: number;
}

interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  projectSchemaVersion: 1;
  exportedAt: string;
  projectId: string;
  projectName: string;
  files: ArchiveFileRecord[];
  externalDependencies: ExternalDependency[];
}

interface ZipEntryInput {
  path: string;
  blob: Blob;
}

export interface ProjectArchiveExtraEntry { path: string; blob: Blob }

export interface ProjectArchiveExportOptions {
  download?: boolean;
  filename?: string;
  extraEntries?: ProjectArchiveExtraEntry[];
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let current = crc;
  for (let i = 0; i < bytes.length; i += 1) current = crcTable[(current ^ bytes[i]) & 0xff] ^ (current >>> 8);
  return current >>> 0;
}

async function crc32Blob(blob: Blob): Promise<number> {
  let crc = 0xffff_ffff;
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        crc = updateCrc32(crc, value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    crc = updateCrc32(crc, new Uint8Array(await blob.arrayBuffer()));
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function cleanZipPath(input: string): string {
  const path = input.replaceAll('\\', '/');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path)) throw new Error(`Unsafe archive path: ${input}`);
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) throw new Error(`Unsafe archive path: ${input}`);
  return path;
}

function safeFilename(input: string): string {
  const value = input.replace(/[\\/\0-\x1f\x7f]/g, '_').replace(/^\.+$/, '_').trim();
  return value.slice(0, 180) || 'asset.bin';
}

function safeId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'asset';
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function guessExtension(mimeType: string, url: string): string {
  const known: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
    'audio/wav': '.wav', 'audio/ogg': '.ogg', 'application/pdf': '.pdf',
  };
  if (known[mimeType]) return known[mimeType];
  try {
    const ext = new URL(url).pathname.match(/\.[a-z0-9]{1,8}$/i)?.[0];
    return ext ?? '.bin';
  } catch { return '.bin'; }
}

function kindForMime(mimeType: string, fallback: TourAsset['kind'] = 'document'): TourAsset['kind'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return fallback;
}

async function mapWithConcurrency<T>(items: T[], workerCount: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, workerCount), items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

async function fetchMedia(url: string): Promise<Blob> {
  if (!isHttpUrl(url)) throw new Error('Only HTTP(S) media URLs can be collected into a portable archive.');
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} while downloading media.`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('The media response was empty.');
  return blob;
}

function makeFileName(asset: TourAsset): string {
  return safeFilename(asset.originalFileName || asset.name || `${asset.id}${guessExtension(asset.mimeType, asset.url ?? '')}`);
}

function validateProject(value: unknown): TourProject {
  if (!value || typeof value !== 'object') throw new Error('This file does not contain a valid 360 Studio project.');
  const project = value as Partial<TourProject>;
  if (project.schemaVersion !== 1 || typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.scenes) || !Array.isArray(project.assets) || !project.settings) {
    throw new Error('Unsupported project format. Expected schema version 1.');
  }
  if (project.scenes.some((scene) => !scene || typeof scene.id !== 'string' || !Array.isArray(scene.hotspots))) {
    throw new Error('The project contains an invalid scene.');
  }
  if (project.assets.some((asset) => !asset || typeof asset.id !== 'string' || typeof asset.name !== 'string')) {
    throw new Error('The project contains an invalid asset record.');
  }
  return project as TourProject;
}

async function downloadToBlob(url: string, label: string): Promise<Blob> {
  try { return await fetchMedia(url); }
  catch (error) {
    throw new Error(`Could not include ${label}. ${error instanceof Error ? error.message : String(error)} Check that the media URL is publicly reachable and CORS permits this Studio origin.`);
  }
}

function crcAndHeader(path: string, crc: number, size: number, offset: number, dateTime: { time: number; date: number }) {
  const name = encoder.encode(path);
  if (name.length > 0xffff) throw new Error(`Archive filename is too long: ${path}`);
  if (size > UINT32_MAX || offset > UINT32_MAX) throw new Error('This archive would exceed the classic ZIP 4 GiB limit. Export the tour without large tiled assets or use a future ZIP64 export path.');

  const local = new Uint8Array(30 + name.length);
  const localView = new DataView(local.buffer);
  u32(localView, 0, 0x04034b50); u16(localView, 4, 20); u16(localView, 6, 0x0800); u16(localView, 8, 0);
  u16(localView, 10, dateTime.time); u16(localView, 12, dateTime.date); u32(localView, 14, crc);
  u32(localView, 18, size); u32(localView, 22, size); u16(localView, 26, name.length); u16(localView, 28, 0);
  local.set(name, 30);

  const central = new Uint8Array(46 + name.length);
  const centralView = new DataView(central.buffer);
  u32(centralView, 0, 0x02014b50); u16(centralView, 4, 0x0314); u16(centralView, 6, 20); u16(centralView, 8, 0x0800); u16(centralView, 10, 0);
  u16(centralView, 12, dateTime.time); u16(centralView, 14, dateTime.date); u32(centralView, 16, crc);
  u32(centralView, 20, size); u32(centralView, 24, size); u16(centralView, 28, name.length); u16(centralView, 30, 0); u16(centralView, 32, 0);
  u16(centralView, 34, 0); u16(centralView, 36, 0); u32(centralView, 38, 0); u32(centralView, 42, offset);
  central.set(name, 46);
  return { local, central };
}

/** Build a standard ZIP using the STORE method. Photos, videos and audio are already compressed;
 * keeping them as Blob parts avoids allocating a second giant byte array for the entire archive.
 */
async function createStoredZip(entries: ZipEntryInput[], onProgress?: (value: ArchiveProgress) => void): Promise<Blob> {
  if (entries.length > MAX_ZIP_ENTRIES - 2) throw new Error('This project contains too many files for a classic ZIP archive.');
  const uniquePaths = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    entry.path = cleanZipPath(entry.path);
    if (uniquePaths.has(entry.path)) throw new Error(`Duplicate path in archive: ${entry.path}`);
    uniquePaths.add(entry.path);
    totalBytes += entry.blob.size;
    if (entry.blob.size > UINT32_MAX || totalBytes > UINT32_MAX) throw new Error('This archive would exceed the classic ZIP 4 GiB limit.');
  }

  const localParts: BlobPart[] = [];
  const centralParts: Uint8Array[] = [];
  const dateTime = dosDateTime();
  let localOffset = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const crc = await crc32Blob(entry.blob);
    const headers = crcAndHeader(entry.path, crc, entry.blob.size, localOffset, dateTime);
    localParts.push(headers.local, entry.blob);
    centralParts.push(headers.central);
    localOffset += headers.local.length + entry.blob.size;
    if (localOffset > UINT32_MAX) throw new Error('This archive would exceed the classic ZIP 4 GiB limit.');
    onProgress?.({ phase: 'packaging', completed: index + 1, total: entries.length, detail: `Packaging ${entry.path}` });
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  u32(eocdView, 0, 0x06054b50); u16(eocdView, 4, 0); u16(eocdView, 6, 0);
  u16(eocdView, 8, entries.length); u16(eocdView, 10, entries.length);
  u32(eocdView, 12, centralSize); u32(eocdView, 16, localOffset); u16(eocdView, 20, 0);
  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function readU16(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8); }
function readU32(bytes: Uint8Array, offset: number) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }

async function parseStoredZip(file: File): Promise<Map<string, Blob>> {
  if (file.size < 22) throw new Error('This ZIP file is too small to be a 360 Studio project archive.');
  const tailLength = Math.min(file.size, 65_557);
  const tail = new Uint8Array(await file.slice(file.size - tailLength).arrayBuffer());
  let eocdIndex = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (readU32(tail, i) === 0x06054b50) { eocdIndex = i; break; }
  }
  if (eocdIndex < 0) throw new Error('Could not find the ZIP directory. This may not be a valid ZIP archive.');
  const eocdEntries = readU16(tail, eocdIndex + 10);
  const centralSize = readU32(tail, eocdIndex + 12);
  const centralOffset = readU32(tail, eocdIndex + 16);
  if (eocdEntries === 0xffff || centralSize === UINT32_MAX || centralOffset === UINT32_MAX) throw new Error('ZIP64 archives are not supported by this version.');
  if (eocdEntries > MAX_ZIP_ENTRIES || centralSize > MAX_CENTRAL_DIRECTORY_BYTES || centralOffset + centralSize > file.size) throw new Error('The ZIP directory is oversized or invalid.');

  const central = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const files = new Map<string, Blob>();
  let cursor = 0;
  for (let index = 0; index < eocdEntries; index += 1) {
    if (cursor + 46 > central.length || readU32(central, cursor) !== 0x02014b50) throw new Error('The ZIP central directory is malformed.');
    const flags = readU16(central, cursor + 8);
    const method = readU16(central, cursor + 10);
    const crc = readU32(central, cursor + 16);
    const compressedSize = readU32(central, cursor + 20);
    const size = readU32(central, cursor + 24);
    const nameLength = readU16(central, cursor + 28);
    const extraLength = readU16(central, cursor + 30);
    const commentLength = readU16(central, cursor + 32);
    const localOffset = readU32(central, cursor + 42);
    const nameBytes = central.slice(cursor + 46, cursor + 46 + nameLength);
    const decodedName = decoder.decode(nameBytes);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (decodedName.endsWith('/')) continue;
    const path = cleanZipPath(decodedName);
    if (files.has(path)) throw new Error(`The archive contains duplicate path ${path}.`);
    if ((flags & 0x1) !== 0) throw new Error('Encrypted ZIP archives are not supported.');
    if (method !== 0) throw new Error('This version imports 360 Studio STORE-method ZIP archives. Re-export this project from 360 Studio or use the provided archive format.');
    if (compressedSize !== size) throw new Error(`Invalid uncompressed entry size for ${path}.`);
    if (localOffset + 30 > file.size) throw new Error(`Invalid local ZIP header for ${path}.`);
    const localBytes = new Uint8Array(await file.slice(localOffset, localOffset + 30).arrayBuffer());
    if (readU32(localBytes, 0) !== 0x04034b50) throw new Error(`Invalid local ZIP signature for ${path}.`);
    const localNameLength = readU16(localBytes, 26);
    const localExtraLength = readU16(localBytes, 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > file.size) throw new Error(`Truncated ZIP entry ${path}.`);
    const blob = file.slice(dataStart, dataEnd);
    const actualCrc = await crc32Blob(blob);
    if (actualCrc !== crc || blob.size !== size) throw new Error(`Integrity check failed for ${path}. The archive may be damaged.`);
    files.set(path, blob);
  }
  return files;
}

function parseJsonBlob(blob: Blob, label: string): Promise<unknown> {
  return blob.text().then((value) => {
    try { return JSON.parse(value) as unknown; }
    catch { throw new Error(`${label} is not valid JSON.`); }
  });
}

function triggerEntriesFromRemoteUrl(url: string, label: string): Promise<Blob> {
  return downloadToBlob(url, label);
}

export async function exportProjectArchive(
  inputProject: TourProject,
  onProgress?: (value: ArchiveProgress) => void,
  options: ProjectArchiveExportOptions = {},
): Promise<{ fileCount: number; totalBytes: number; externalDependencies: ExternalDependency[]; blob: Blob }> {
  const project = JSON.parse(JSON.stringify(stripTransientAssetUrls(inputProject))) as TourProject;
  const entries: ZipEntryInput[] = [];
  const fileRecords: ArchiveFileRecord[] = [];
  const externalDependencies: ExternalDependency[] = [];
  const assetIdsWritten = new Set<string>();
  const remoteUrlAssetIds = new Map<string, string>();
  let completed = 0;

  async function addAsset(asset: TourAsset, blob: Blob, pathOverride?: string) {
    if (assetIdsWritten.has(asset.id)) return;
    const archivePath = cleanZipPath(pathOverride ?? `assets/${safeId(asset.id)}/${makeFileName(asset)}`);
    entries.push({ path: archivePath, blob });
    fileRecords.push({ path: archivePath, assetId: asset.id, name: asset.name, mimeType: asset.mimeType || blob.type || 'application/octet-stream', kind: asset.kind, size: blob.size });
    assetIdsWritten.add(asset.id);
  }

  async function addRemoteAsAsset(url: string, nameHint: string, kindHint: TourAsset['kind'], preferredId?: string): Promise<string | undefined> {
    if (remoteUrlAssetIds.has(url) && !preferredId) return remoteUrlAssetIds.get(url);
    try {
      const blob = await triggerEntriesFromRemoteUrl(url, nameHint);
      const mimeType = blob.type || 'application/octet-stream';
      const id = preferredId ?? `remote-${hashString(url)}`;
      const asset: TourAsset = { id, name: nameHint, kind: kindForMime(mimeType, kindHint), mimeType, source: 'uploaded', originalFileName: `${safeId(nameHint)}${guessExtension(mimeType, url)}` };
      project.assets = project.assets.filter((candidate) => candidate.id !== id);
      project.assets.push(asset);
      await addAsset(asset, blob);
      remoteUrlAssetIds.set(url, id);
      completed += 1;
      onProgress?.({ phase: 'downloading', completed, total: Math.max(completed, 1), detail: `Included ${nameHint}` });
      return id;
    } catch (error) {
      externalDependencies.push({ url, label: nameHint, reason: error instanceof Error ? error.message : 'The resource could not be downloaded in this browser.' });
      remoteUrlAssetIds.set(url, '');
      return undefined;
    }
  }

  // Preserve original uploaded assets first. A missing IndexedDB record is a hard error,
  // because silently omitting a source file would make a supposedly portable archive incomplete.
  const initialAssets = [...project.assets];
  for (const asset of initialAssets) {
    if (asset.source === 'uploaded') {
      const record = await getUploadedAssetRecord(asset.id);
      if (!record) throw new Error(`Cannot export “${asset.name}”: its uploaded binary is missing from this browser's storage. Re-upload it before exporting.`);
      await addAsset(asset, record.blob);
    } else if (asset.source === 'url' && asset.url && isHttpUrl(asset.url)) {
      const id = await addRemoteAsAsset(asset.url, asset.name, asset.kind, asset.id);
      if (id) {
        const index = project.assets.findIndex((candidate) => candidate.id === asset.id);
        if (index >= 0) project.assets[index] = { ...asset, source: 'uploaded', url: undefined };
      }
    }
  }

  // Bundle directly linked panorama URLs too, when the browser is permitted to fetch them.
  for (const scene of project.scenes) {
    if (scene.panoramaUrl && isHttpUrl(scene.panoramaUrl)) {
      const linkedAsset = scene.panoramaAssetId ? project.assets.find((asset) => asset.id === scene.panoramaAssetId) : undefined;
      const id = await addRemoteAsAsset(scene.panoramaUrl, scene.name + ' panorama', 'panorama', linkedAsset?.id);
      if (id) {
        scene.panoramaAssetId = id;
        scene.panoramaUrl = undefined;
      }
    }
  }

  // Collect direct image/video/audio links referenced by interactions where the host permits CORS.
  for (const scene of project.scenes) {
    if (scene.audio?.url && isHttpUrl(scene.audio.url) && !scene.audio.assetId) {
      const id = await addRemoteAsAsset(scene.audio.url, `${scene.name} audio`, 'audio');
      if (id) scene.audio = { ...scene.audio, assetId: id, url: undefined };
    }
    for (const hotspot of scene.hotspots) {
      if (hotspot.url && isHttpUrl(hotspot.url) && !hotspot.assetId) {
        const id = await addRemoteAsAsset(hotspot.url, hotspot.title || `${hotspot.kind} media`, kindForMime('', hotspot.kind === 'navigation' ? 'image' : hotspot.kind === 'info' ? 'document' : hotspot.kind));
        if (id) { hotspot.assetId = id; hotspot.url = undefined; }
      }
    }
  }

  // Download each externally hosted tiled panorama into archive-managed assets. The live
  // project isn't changed: only this exported copy is rewritten to use embedded asset IDs.
  for (const scene of project.scenes) {
    const source = scene.tiledPanorama;
    if (!source) continue;
    const expectedTileCount = source.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
    const hasEmbeddedTiles = Boolean(
      source.embeddedFiles
      && Object.keys(source.embeddedFiles).length >= expectedTileCount
      && source.baseAssetId
      && assetIdsWritten.has(source.baseAssetId)
      && source.levels.every((level) => {
        for (let row = 0; row < level.rows; row += 1) for (let col = 0; col < level.cols; col += 1) {
          const key = `tiles/${level.width}/${col}_${row}.jpg`;
          const embeddedAssetId = source.embeddedFiles?.[key];
          if (!embeddedAssetId || !assetIdsWritten.has(embeddedAssetId)) return false;
        }
        return true;
      }),
    );
    if (hasEmbeddedTiles) continue;

    if (!source.baseUrl) throw new Error(`Scene “${scene.name}” uses tiled panoramas but has no preview URL. Reconnect its tile manifest before exporting.`);
    const sceneSlug = safeId(scene.id);
    const embeddedFiles: Record<string, string> = {};
    const baseAssetId = `tile-${hashString(`${scene.id}/preview.jpg`)}`;
    const baseBlob = await downloadToBlob(source.baseUrl, `${scene.name} preview`);
    const baseAsset: TourAsset = { id: baseAssetId, name: `${scene.name} preview`, kind: 'image', mimeType: baseBlob.type || 'image/jpeg', source: 'uploaded', originalFileName: 'preview.jpg' };
    await addAsset(baseAsset, baseBlob, `tours/${sceneSlug}/preview.jpg`);
    project.assets.push(baseAsset);

    const linkedSceneAsset = scene.panoramaAssetId ? project.assets.find((asset) => asset.id === scene.panoramaAssetId) : undefined;
    let originalAssetId = source.originalAssetId ?? (linkedSceneAsset?.source === 'uploaded' ? linkedSceneAsset.id : undefined);
    if (source.originalUrl && !originalAssetId) {
      const originalBlob = await downloadToBlob(source.originalUrl, `${scene.name} original panorama`);
      originalAssetId = `tile-${hashString(`${scene.id}/original`)}`;
      const originalAsset: TourAsset = { id: originalAssetId, name: `${scene.name} original panorama`, kind: 'panorama', mimeType: originalBlob.type || 'image/jpeg', source: 'uploaded', originalFileName: safeFilename(`${scene.name}-original${guessExtension(originalBlob.type, source.originalUrl)}`) };
      await addAsset(originalAsset, originalBlob, `tours/${sceneSlug}/originals/${originalAsset.originalFileName}`);
      project.assets.push(originalAsset);
    }

    const tileTasks = source.levels.flatMap((level, levelIndex) => {
      const tasks: Array<{ levelWidth: number; levelIndex: number; col: number; row: number; relativePath: string; resolvedUrl: string }> = [];
      for (let row = 0; row < level.rows; row += 1) {
        for (let col = 0; col < level.cols; col += 1) {
          const relativePath = `tiles/${level.width}/${col}_${row}.jpg`;
          const resolvedUrl = source.tileUrlTemplate
            .replaceAll('{width}', String(level.width))
            .replaceAll('{level}', String(levelIndex))
            .replaceAll('{col}', String(col))
            .replaceAll('{row}', String(row));
          tasks.push({ levelWidth: level.width, levelIndex, col, row, relativePath, resolvedUrl });
        }
      }
      return tasks;
    });
    let downloadedTiles = 0;
    // Bound parallel network work so a large panorama does not saturate the browser or host.
    await mapWithConcurrency(tileTasks, 6, async (task) => {
      const blob = await downloadToBlob(task.resolvedUrl, `${scene.name} tile ${task.levelWidth}/${task.col}_${task.row}`);
      const assetId = `tile-${hashString(`${scene.id}/${task.relativePath}`)}`;
      const asset: TourAsset = { id: assetId, name: `${scene.name} ${task.relativePath}`, kind: 'image', mimeType: blob.type || 'image/jpeg', source: 'uploaded', originalFileName: `${task.col}_${task.row}.jpg` };
      await addAsset(asset, blob, `tours/${sceneSlug}/${task.relativePath}`);
      project.assets.push(asset);
      embeddedFiles[task.relativePath] = assetId;
      downloadedTiles += 1;
      completed += 1;
      onProgress?.({ phase: 'downloading', completed, total: Math.max(completed, tileTasks.length), detail: `Collecting ${scene.name} tiles (${downloadedTiles}/${tileTasks.length})` });
    });

    const portableSource = {
      ...source,
      manifestUrl: `archive://${sceneSlug}/manifest.json`,
      baseUrl: undefined,
      originalUrl: undefined,
      tileUrlTemplate: 'tiles/{width}/{col}_{row}.jpg',
      baseAssetId,
      ...(originalAssetId ? { originalAssetId } : {}),
      embeddedFiles,
    };
    scene.tiledPanorama = portableSource;
    const relativeManifest = {
      schemaVersion: 1,
      baseUrl: 'preview.jpg',
      tileUrlTemplate: 'tiles/{width}/{col}_{row}.jpg',
      levels: source.levels,
      source: { width: source.sourceWidth, height: source.sourceHeight, originalFileName: source.originalUrl ? new URL(source.originalUrl).pathname.split('/').pop() : undefined },
      archive: { originalAssetId, baseAssetId },
    };
    entries.push({ path: cleanZipPath(`tours/${sceneSlug}/manifest.json`), blob: new Blob([JSON.stringify(relativeManifest, null, 2)], { type: 'application/json' }) });
  }

  const portableProject = stripTransientAssetUrls(project);
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    projectSchemaVersion: 1,
    exportedAt: new Date().toISOString(),
    projectId: portableProject.id,
    projectName: portableProject.name,
    files: fileRecords,
    externalDependencies,
  };

  entries.push({ path: PROJECT_FILE, blob: new Blob([JSON.stringify(portableProject, null, 2)], { type: 'application/json' }) });
  entries.push({ path: ARCHIVE_MANIFEST_FILE, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) });
  const readme = [
    `360 Studio portable project archive`,
    `Project: ${portableProject.name}`,
    `Project ID: ${portableProject.id}`,
    `Exported: ${manifest.exportedAt}`,
    '',
    'project.json contains the editable tour configuration.',
    'assets/ contains uploaded files referenced by stable asset IDs.',
    'tours/ contains bundled tiled panorama previews, originals when available, and image tiles.',
    'archive-manifest.json maps archive paths to project asset IDs and lists remote dependencies that could not be downloaded.',
    '',
    externalDependencies.length ? `External dependencies still require their original URLs (${externalDependencies.length}):` : 'All collected media is bundled or already embedded in this archive.',
    ...externalDependencies.map((dependency) => `- ${dependency.label}: ${dependency.url} (${dependency.reason})`),
    '',
    'The original source files are preserved as stored. Tiled display images are derived assets.',
  ].join('\n');
  entries.push({ path: cleanZipPath(README_FILE), blob: new Blob([readme], { type: 'text/plain' }) });

  for (const extraEntry of options.extraEntries ?? []) {
    const safePath = cleanZipPath(extraEntry.path);
    if (entries.some((entry) => entry.path === safePath)) throw new Error(`Production bundle contains a duplicate ZIP path: ${safePath}`);
    entries.push({ path: safePath, blob: extraEntry.blob });
  }

  onProgress?.({ phase: 'packaging', completed: 0, total: entries.length, detail: `Creating ZIP with ${entries.length} files` });
  const zipBlob = await createStoredZip(entries, onProgress);
  if (options.download !== false) downloadBlob(zipBlob, options.filename ?? `${slugify(portableProject.name)}.360studio.zip`);
  return { fileCount: entries.length, totalBytes: zipBlob.size, externalDependencies, blob: zipBlob };
}

export async function importProjectArchive(file: File, onProgress?: (value: ArchiveProgress) => void): Promise<PortableArchiveResult> {
  const files = await parseStoredZip(file);
  const manifestBlob = files.get(ARCHIVE_MANIFEST_FILE);
  const projectBlob = files.get(PROJECT_FILE);
  if (!manifestBlob || !projectBlob) throw new Error('This ZIP is missing project.json or archive-manifest.json. It is not a 360 Studio portable project archive.');
  const rawManifest = await parseJsonBlob(manifestBlob, ARCHIVE_MANIFEST_FILE);
  if (!rawManifest || typeof rawManifest !== 'object') throw new Error('Invalid archive manifest.');
  const manifest = rawManifest as Partial<ArchiveManifest>;
  if (manifest.format !== ARCHIVE_FORMAT || manifest.schemaVersion !== ARCHIVE_SCHEMA_VERSION || manifest.projectSchemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Unsupported archive format or schema version.');
  }
  const project = validateProject(await parseJsonBlob(projectBlob, PROJECT_FILE));
  const knownAssetIds = new Set(project.assets.map((asset) => asset.id));
  for (const scene of project.scenes) {
    const source = scene.tiledPanorama;
    if (!source?.embeddedFiles) continue;
    if (!source.baseAssetId || !knownAssetIds.has(source.baseAssetId)) {
      throw new Error(`The tiled panorama for scene “${scene.name}” is missing its embedded preview asset reference.`);
    }
    for (const level of source.levels) {
      for (let row = 0; row < level.rows; row += 1) {
        for (let col = 0; col < level.cols; col += 1) {
          const path = `tiles/${level.width}/${col}_${row}.jpg`;
          const assetId = source.embeddedFiles[path];
          if (!assetId || !knownAssetIds.has(assetId)) {
            throw new Error(`The tiled panorama for scene “${scene.name}” is missing embedded tile ${path}.`);
          }
        }
      }
    }
  }
  const restorePlan: Array<{ descriptor: ArchiveFileRecord; blob: Blob }> = [];
  const archiveAssetIds = new Set(manifest.files.filter((descriptor) => descriptor && typeof descriptor.assetId === 'string').map((descriptor) => descriptor.assetId));
  const missingAssetIds = project.assets.filter((asset) => asset.source === 'uploaded' && !archiveAssetIds.has(asset.id)).map((asset) => asset.name);
  if (missingAssetIds.length) throw new Error('This archive is incomplete. It does not contain binary files for: ' + missingAssetIds.slice(0, 5).join(', ') + (missingAssetIds.length > 5 ? ', …' : '') + '.');
  for (const descriptor of manifest.files) {
    if (!descriptor || typeof descriptor.path !== 'string' || typeof descriptor.assetId !== 'string' || typeof descriptor.name !== 'string' || typeof descriptor.mimeType !== 'string') {
      throw new Error('The archive manifest contains an invalid file record.');
    }
    const safePath = cleanZipPath(descriptor.path);
    const blob = files.get(safePath);
    if (!blob || blob.size !== descriptor.size) throw new Error(`The archive is missing ${safePath} or its size does not match the manifest.`);
    if (!knownAssetIds.has(descriptor.assetId)) throw new Error(`The archive refers to unknown project asset ${descriptor.assetId}.`);
    restorePlan.push({ descriptor, blob });
  }
  onProgress?.({ phase: 'importing', completed: 0, total: restorePlan.length, detail: `Restoring ${restorePlan.length} asset files` });
  await persistImportedAssets(restorePlan.map(({ descriptor, blob }) => ({ id: descriptor.assetId, blob, name: descriptor.name, mimeType: descriptor.mimeType })));
  const restoredCount = restorePlan.length;
  return {
    project,
    isArchive: true,
    importedAssetCount: restoredCount,
    externalDependencies: Array.isArray(manifest.externalDependencies) ? manifest.externalDependencies : [],
  };
}

export async function importProjectFile(file: File): Promise<PortableArchiveResult> {
  if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip') return importProjectArchive(file);
  const parsed: unknown = JSON.parse(await file.text());
  return { project: validateProject(parsed), isArchive: false, importedAssetCount: 0, externalDependencies: [] };
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '360-studio-project';
}
