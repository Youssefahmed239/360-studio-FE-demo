# 360 Studio FE Demo

An independent frontend starter for a customizable 360° tour authoring studio. This repository is intentionally separate from `360-studio-FE`.

## Current foundation (v0.3.0)

- Responsive editor shell with scene list, canvas, timeline, and inspector.
- Interactive Photo Sphere Viewer canvas for uploaded equirectangular panoramas.
- Scene navigation, transitions, editable spherical hotspots, and basic image/video/audio hotspot previews.
- Local draft persistence and browser IndexedDB storage for uploaded panorama originals.
- Import/export of versioned editable project JSON (configuration only; not yet a portable media archive).
- Multi-resolution equirectangular tile adapter support with an initial low-resolution preview and resolution levels selected as the viewer zooms.
- A local Node/Sharp CLI that preserves the input original and generates a base preview plus JPEG tile levels.
- Relative Vite build paths (`base: './'`) for static hosting under an Nginx subpath.

## High-resolution panorama workflow

### 1. Install dependencies

```bash
npm install
```

Requirements: Node.js 20.19+ or 22.12+ and npm. The local panorama processor uses `sharp`, which requires a supported Node.js runtime and its matching platform package.

### 2. Generate a tile pyramid

```bash
npm run prepare:panorama -- ./lobby-12000x6000.jpg ./public/tours/lobby
```

The input must be a 2:1 equirectangular image at least 1,024 pixels wide. The output contains:

```text
public/tours/lobby/
├── manifest.json
├── preview.jpg
├── README.md
├── originals/
│   └── lobby-12000x6000.jpg
└── tiles/
    ├── 3000/
    ├── 6000/
    └── 12000/
```

Exact level widths depend on the source image. The original is copied without recompression. The preview is a smaller JPEG; the tile images are derived display assets at quality 90. Tiles are at most approximately 1,024 pixels per side, and the tool supports up to 64 columns / 32 rows per level.

### 3. Connect the generated manifest

Start the studio with `npm run dev`. In the selected scene's **Panorama source** inspector, paste a URL to the generated `manifest.json` and choose **Enable multi-resolution tiles**. For example, if the generated output is under Vite's `public/tours/lobby`, use:

```text
http://localhost:5173/tours/lobby/manifest.json
```

The manifest and its preview/tile files must be accessible over HTTP(S). If they are hosted on a different origin from the Studio, enable CORS for the Studio origin on the media host/CDN. Keep the relative output paths intact. Loading a manifest from a URL requires the browser to be allowed to fetch that URL.

### Why tiles?

The viewer first loads `preview.jpg`, then asks for tiles that match the current view/zoom using Photo Sphere Viewer's tiled adapter. It does not download the complete high-resolution source as one large WebGL texture. The original remains preserved separately for future reprocessing. Network speed, cache headers, server/CDN latency, image dimensions, and device GPU memory still affect the user experience.

## Save and export

- **Save/autosave:** project configuration and the last-open scene are stored in `localStorage`; uploaded image binaries are stored in IndexedDB. This is browser-local storage, not cloud backup.
- **Export project:** downloads `.360studio.json` with the editable project configuration. It does not yet package local upload binaries or the files referenced by tile manifests.
- **Import project:** imports a compatible schema-v1 JSON file.

A portable ZIP archive that bundles originals and generated files is still a separate milestone. Keep a copy of the tiled output folder alongside your project JSON until that archive flow lands.

## Check/build

```bash
npm run typecheck
npm run build
npm run preview
```

`dist/` is the Studio editor build. It is not yet the final standalone public tour player. The self-contained production tour export, asset validation, versioned deployment, and rollback flow remain future work.

## Architecture direction

- `src/types/project.ts`: engine-independent project and tile metadata.
- `src/features/projects/projectStore.ts`: project state, autosave, and resume.
- `src/features/assets/assetStorage.ts`: browser IndexedDB persistence for uploaded originals.
- `src/features/panorama/PanoramaCanvas.tsx`: Photo Sphere Viewer runtime, single-image and tiled adapters, plus hotspot markers.
- `src/features/panorama/panoramaManifest.ts`: manifest validation and URL resolution.
- `scripts/prepare-panorama.mjs`: local multiresolution tile generation.

The project schema uses stable IDs so a future portable archive and standalone player can refer to the same scenes and assets.
