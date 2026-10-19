import type { TourAsset, TourProject } from '../../types/project';

const DATABASE_NAME = '360-studio-demo-assets';
const DATABASE_VERSION = 1;
const STORE_NAME = 'uploaded-assets';

type StoredAsset = { id: string; blob: Blob; name: string; mimeType: string; size: number };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local media storage.'));
  });
}

export async function persistUploadedAsset(id: string, file: File): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, blob: file, name: file.name, mimeType: file.type, size: file.size } satisfies StoredAsset);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the uploaded file.'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving the uploaded file was aborted.'));
    });
  } finally {
    db.close();
  }
}

async function readUploadedAsset(id: string): Promise<StoredAsset | null> {
  const db = await openDatabase();
  try {
    return await new Promise<StoredAsset | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as StoredAsset | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not restore the uploaded file.'));
    });
  } finally {
    db.close();
  }
}

/** Persist only stable project metadata. Browser blob: URLs are valid for a session only. */
export function stripTransientAssetUrls(project: TourProject): TourProject {
  const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const assets: TourAsset[] = project.assets.map((asset) => {
    if (asset.source === 'uploaded') {
      const { url: _sessionUrl, ...stableAsset } = asset;
      return stableAsset;
    }
    return asset;
  });
  const scenes = project.scenes.map((scene) => {
    const linkedAsset = scene.panoramaAssetId ? assetById.get(scene.panoramaAssetId) : undefined;
    if (linkedAsset?.source === 'uploaded' || scene.panoramaUrl?.startsWith('blob:')) {
      const { panoramaUrl: _sessionUrl, ...stableScene } = scene;
      return stableScene;
    }
    return scene;
  });
  return { ...project, assets, scenes };
}

/** Re-create browser URLs from IndexedDB after a draft is reopened. */
export async function restoreUploadedAssetUrls(project: TourProject): Promise<TourProject> {
  const restoredAssetUrls = new Map<string, string>();
  const assets = await Promise.all(project.assets.map(async (asset) => {
    if (asset.source !== 'uploaded') return asset;
    try {
      const stored = await readUploadedAsset(asset.id);
      if (!stored) return { ...asset, url: undefined };
      const url = URL.createObjectURL(stored.blob);
      restoredAssetUrls.set(asset.id, url);
      return { ...asset, url };
    } catch {
      return { ...asset, url: undefined };
    }
  }));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const scenes = project.scenes.map((scene) => {
    const asset = scene.panoramaAssetId ? assetById.get(scene.panoramaAssetId) : undefined;
    if (asset?.source === 'uploaded') return { ...scene, panoramaUrl: restoredAssetUrls.get(asset.id) };
    if (scene.panoramaUrl?.startsWith('blob:')) {
      const { panoramaUrl: _sessionUrl, ...stableScene } = scene;
      return stableScene;
    }
    return scene;
  });
  return { ...project, assets, scenes };
}
