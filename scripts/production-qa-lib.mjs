import path from 'node:path';

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\\') || value.startsWith('/') || /^[a-z]:/i.test(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.includes('\0'));
}

export function resolveInsideRoot(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw new Error(`Unsafe relative path: ${String(relativePath)}`);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path escapes bundle root: ${relativePath}`);
  }
  return resolvedPath;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates project references against the exported archive manifest. */
export function validateProjectManifest(project, manifest, availablePaths = new Set()) {
  const errors = [];
  const warnings = [];
  const bundledAssetIds = new Set();
  const manifestPaths = new Set();

  if (!isObject(project)) return { errors: ['project.json must contain a JSON object.'], warnings };
  if (project.schemaVersion !== 1) errors.push(`Unsupported project schemaVersion: ${String(project.schemaVersion)} (expected 1).`);
  if (typeof project.id !== 'string' || !project.id) errors.push('Project id is missing.');
  if (typeof project.name !== 'string' || !project.name) errors.push('Project name is missing.');
  if (!Array.isArray(project.scenes)) errors.push('Project scenes must be an array.');
  if (!Array.isArray(project.assets)) errors.push('Project assets must be an array.');
  if (!isObject(project.settings)) errors.push('Project settings must be an object.');
  if (!isObject(manifest) || !Array.isArray(manifest.files)) {
    errors.push('archive-manifest.json must contain a files array.');
    return { errors, warnings };
  }

  for (const [index, record] of manifest.files.entries()) {
    if (!isObject(record)) {
      errors.push(`archive-manifest.json files[${index}] is not an object.`);
      continue;
    }
    if (!isSafeRelativePath(record.path)) {
      errors.push(`Unsafe path in archive manifest: ${String(record.path)}`);
      continue;
    }
    if (manifestPaths.has(record.path)) errors.push(`Duplicate archive path: ${record.path}`);
    manifestPaths.add(record.path);
    if (typeof record.assetId !== 'string' || !record.assetId) {
      errors.push(`Missing assetId for manifest path ${record.path}.`);
      continue;
    }
    if (bundledAssetIds.has(record.assetId)) errors.push(`Duplicate bundled assetId: ${record.assetId}`);
    bundledAssetIds.add(record.assetId);
    if (availablePaths.size && !availablePaths.has(record.path)) errors.push(`Bundled file is missing: ${record.path}`);
    if (typeof record.size === 'number' && availablePaths.has(record.path) && record.actualSize !== undefined && record.actualSize !== record.size) {
      errors.push(`Size mismatch for ${record.path}: manifest says ${record.size}, disk says ${record.actualSize}.`);
    }
  }

  if (Array.isArray(project.scenes)) {
    const sceneIds = new Set();
    for (const [index, scene] of project.scenes.entries()) {
      if (!isObject(scene)) {
        errors.push(`Scene at index ${index} is not an object.`);
        continue;
      }
      if (typeof scene.id !== 'string' || !scene.id) errors.push(`Scene at index ${index} has no id.`);
      else if (sceneIds.has(scene.id)) errors.push(`Duplicate scene id: ${scene.id}`);
      else sceneIds.add(scene.id);
      if (!Array.isArray(scene.hotspots)) {
        errors.push(`Scene ${scene.name ?? scene.id ?? index} has no hotspots array.`);
        continue;
      }
      for (const hotspot of scene.hotspots) {
        if (!isObject(hotspot)) {
          errors.push(`Scene ${scene.name ?? scene.id} contains an invalid hotspot record.`);
          continue;
        }
        if (hotspot.kind === 'navigation' && hotspot.targetSceneId && !project.scenes.some((candidate) => candidate?.id === hotspot.targetSceneId)) {
          errors.push(`Hotspot "${hotspot.title ?? hotspot.id}" points to missing scene ${hotspot.targetSceneId}.`);
        }
        if (hotspot.assetId && !bundledAssetIds.has(hotspot.assetId) && !hotspot.url) {
          errors.push(`Hotspot "${hotspot.title ?? hotspot.id}" references missing asset ${hotspot.assetId} with no fallback URL.`);
        }
      }
      if (scene.panoramaAssetId && !bundledAssetIds.has(scene.panoramaAssetId) && !scene.panoramaUrl && !scene.tiledPanorama) {
        errors.push(`Scene ${scene.name ?? scene.id} references missing panorama asset ${scene.panoramaAssetId}.`);
      }
      if (scene.audio?.assetId && !bundledAssetIds.has(scene.audio.assetId) && !scene.audio.url) {
        errors.push(`Scene ${scene.name ?? scene.id} references missing audio asset ${scene.audio.assetId}.`);
      }
      const tiled = scene.tiledPanorama;
      if (isObject(tiled)) {
        if (tiled.baseAssetId && !bundledAssetIds.has(tiled.baseAssetId) && !tiled.baseUrl) warnings.push(`Scene ${scene.name ?? scene.id}: tiled panorama baseAssetId ${tiled.baseAssetId} is not bundled and has no baseUrl.`);
        if (tiled.originalAssetId && !bundledAssetIds.has(tiled.originalAssetId) && !tiled.originalUrl) warnings.push(`Scene ${scene.name ?? scene.id}: original panorama asset ${tiled.originalAssetId} is not bundled.`);
        if (isObject(tiled.embeddedFiles)) {
          for (const [tilePath, assetId] of Object.entries(tiled.embeddedFiles)) {
            if (!isSafeRelativePath(tilePath)) errors.push(`Scene ${scene.name ?? scene.id} has an unsafe embedded tile path: ${tilePath}`);
            if (typeof assetId !== 'string' || !bundledAssetIds.has(assetId)) errors.push(`Scene ${scene.name ?? scene.id} references missing tile asset ${String(assetId)} for ${tilePath}.`);
          }
        } else if (!tiled.tileUrlTemplate) {
          warnings.push(`Scene ${scene.name ?? scene.id}: tiled panorama has no embedded files or tile URL template.`);
        }
      }
    }
    if (project.scenes.length === 0) warnings.push('Project has no scenes.');
    if (project.settings?.startSceneId && !project.scenes.some((scene) => scene?.id === project.settings.startSceneId)) {
      errors.push(`settings.startSceneId references missing scene ${project.settings.startSceneId}.`);
    }
    for (const scene of project.scenes) {
      if (isObject(scene) && !scene.panoramaAssetId && !scene.panoramaUrl && !scene.tiledPanorama) warnings.push(`Scene ${scene.name ?? scene.id} has no panorama source.`);
    }
  }

  if (Array.isArray(manifest.externalDependencies) && manifest.externalDependencies.length) {
    warnings.push(`${manifest.externalDependencies.length} external URL(s) were not bundled. Check connectivity, CORS, authentication, and availability.`);
  }
  return { errors, warnings };
}

export function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
