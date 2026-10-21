/**
 * Safe scene-order and scene-deletion operations shared by the Studio UI.
 * This module intentionally has no browser dependencies so it can be tested by Node.
 */
function sceneAssetIds(scene, assets = []) {
  const ids = new Set();
  if (scene.panoramaAssetId) ids.add(scene.panoramaAssetId);
  if (scene.tiledPanorama) {
    if (scene.tiledPanorama.baseAssetId) ids.add(scene.tiledPanorama.baseAssetId);
    if (scene.tiledPanorama.originalAssetId) ids.add(scene.tiledPanorama.originalAssetId);
    for (const assetId of Object.values(scene.tiledPanorama.embeddedFiles ?? {})) {
      if (assetId) ids.add(assetId);
    }
  }
  if (scene.audio?.assetId) ids.add(scene.audio.assetId);
  const urls = new Set([scene.panoramaUrl, scene.tiledPanorama?.baseUrl, scene.tiledPanorama?.originalUrl, scene.audio?.url].filter(Boolean));
  for (const hotspot of scene.hotspots ?? []) {
    if (hotspot.assetId) ids.add(hotspot.assetId);
    if (hotspot.appearance?.imageAssetId) ids.add(hotspot.appearance.imageAssetId);
    if (hotspot.url) urls.add(hotspot.url);
    if (hotspot.appearance?.imageUrl) urls.add(hotspot.appearance.imageUrl);
  }
  for (const url of urls) {
    for (const asset of assets) if (asset.url && asset.url === url) ids.add(asset.id);
  }
  return ids;
}

function referencedAssetIds(project) {
  const ids = new Set();
  const urls = new Set();
  for (const scene of project.scenes) {
    for (const assetId of sceneAssetIds(scene, project.assets)) ids.add(assetId);
    for (const url of [scene.panoramaUrl, scene.tiledPanorama?.baseUrl, scene.tiledPanorama?.originalUrl, scene.audio?.url]) if (url) urls.add(url);
    for (const hotspot of scene.hotspots ?? []) {
      if (hotspot.url) urls.add(hotspot.url);
      if (hotspot.appearance?.imageUrl) urls.add(hotspot.appearance.imageUrl);
    }
  }
  const layout = project.layout;
  if (layout) {
    for (const area of [layout.toolbar, layout.welcome]) {
      for (const element of area.elements ?? []) {
        if (element.imageAssetId) ids.add(element.imageAssetId);
        if (element.imageUrl) urls.add(element.imageUrl);
      }
    }
  }
  for (const asset of project.assets) if (asset.url && urls.has(asset.url)) ids.add(asset.id);
  return ids;
}

/** Reorder an item before/after another item while preserving stable IDs. */
export function reorderById(items, sourceId, targetId, afterTarget = false) {
  if (!Array.isArray(items) || sourceId === targetId) return [...(items ?? [])];
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetExists = items.some((item) => item.id === targetId);
  if (sourceIndex < 0 || !targetExists) return [...items];
  const next = [...items];
  const [moving] = next.splice(sourceIndex, 1);
  const targetIndex = next.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return [...items];
  next.splice(targetIndex + (afterTarget ? 1 : 0), 0, moving);
  return next;
}

/** Delete a scene and clean all ID-based references without deleting shared assets. */
export function deleteSceneFromProject(project, sceneId, updatedAt = new Date().toISOString()) {
  if (!project || !Array.isArray(project.scenes)) throw new Error('Cannot delete a scene from an invalid project.');
  if (project.scenes.length <= 1) throw new Error('A project must keep at least one scene.');
  const removedIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (removedIndex < 0) throw new Error('The selected scene no longer exists.');

  const removedScene = project.scenes[removedIndex];
  const candidateAssets = sceneAssetIds(removedScene, project.assets);
  const remainingScenes = project.scenes.filter((scene) => scene.id !== sceneId).map((scene) => ({
    ...scene,
    // Navigation shortcuts in other scenes must not become broken links.
    hotspots: (scene.hotspots ?? []).filter((hotspot) => hotspot.targetSceneId !== sceneId),
  }));
  const removedNavigationHotspots = project.scenes
    .filter((scene) => scene.id !== sceneId)
    .reduce((count, scene) => count + (scene.hotspots ?? []).filter((hotspot) => hotspot.targetSceneId === sceneId).length, 0);

  const detachDeletedSceneTarget = (elements = []) => elements.map((element) => element.targetSceneId === sceneId
    ? { ...element, action: 'none', targetSceneId: undefined }
    : element);
  const layout = project.layout ? {
    ...project.layout,
    toolbar: { ...project.layout.toolbar, elements: detachDeletedSceneTarget(project.layout.toolbar.elements) },
    welcome: {
      ...project.layout.welcome,
      sceneIds: project.layout.welcome.sceneIds.filter((id) => id !== sceneId),
      elements: detachDeletedSceneTarget(project.layout.welcome.elements),
    },
  } : undefined;

  const startSceneId = project.settings.startSceneId === sceneId || !remainingScenes.some((scene) => scene.id === project.settings.startSceneId)
    ? remainingScenes[0].id
    : project.settings.startSceneId;
  const baseProject = {
    ...project,
    updatedAt,
    settings: { ...project.settings, startSceneId },
    scenes: remainingScenes,
    ...(layout ? { layout } : {}),
  };
  const referenced = referencedAssetIds(baseProject);
  const orphanedAssetIds = [...candidateAssets].filter((id) => !referenced.has(id) && project.assets.some((asset) => asset.id === id));
  const orphanedAssetIdSet = new Set(orphanedAssetIds);
  const nextProject = {
    ...baseProject,
    assets: project.assets.filter((asset) => !orphanedAssetIdSet.has(asset.id)),
  };
  const nextActiveSceneId = remainingScenes[Math.min(removedIndex, remainingScenes.length - 1)].id;

  return {
    project: nextProject,
    removedScene,
    removedNavigationHotspots,
    orphanedAssetIds,
    orphanedUploadedAssetIds: project.assets.filter((asset) => orphanedAssetIdSet.has(asset.id) && asset.source === 'uploaded').map((asset) => asset.id),
    nextActiveSceneId,
  };
}
