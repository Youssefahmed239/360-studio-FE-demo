# 360 Studio FE Demo

An independent frontend starter for a customizable 360° tour authoring studio. This repository is intentionally separate from `360-studio-FE`.

## Current foundation (v0.5.0)

- Responsive editor shell with scene list, canvas, timeline, and inspector.
- Interactive Photo Sphere Viewer canvas for uploaded equirectangular panoramas.
- Scene navigation, transitions, editable spherical hotspots, and basic image/video/audio hotspot previews.
- Local draft persistence and browser IndexedDB storage for uploaded panorama originals.
- Portable editable project ZIP import/export, including uploaded assets and tiled panoramas where the browser can collect them.
- Standalone production tour ZIP containing the player runtime, project configuration, included media, and Nginx deployment notes.
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

`dist/` contains the Studio editor and the generated `player-runtime/` bundle. **Build for web** downloads a separate production ZIP containing `index.html`, `tour-player.js`, `tour-player.css`, `project.json`, `archive-manifest.json`, and the assets that could be included. Extract that ZIP into a dedicated Nginx directory and serve over HTTP/HTTPS. The public tour is independent of the Studio editor; edits require generating and deploying a new ZIP. Versioned directories and CDN/media caching policy should be used for safe production updates.

## Architecture direction

- `src/types/project.ts`: engine-independent project and tile metadata.
- `src/features/projects/projectStore.ts`: project state, autosave, and resume.
- `src/features/assets/assetStorage.ts`: browser IndexedDB persistence for uploaded originals.
- `src/features/panorama/PanoramaCanvas.tsx`: Photo Sphere Viewer runtime, single-image and tiled adapters, plus hotspot markers.
- `src/features/panorama/panoramaManifest.ts`: manifest validation and URL resolution.
- `scripts/prepare-panorama.mjs`: local multiresolution tile generation.

The project schema uses stable IDs so a future portable archive and standalone player can refer to the same scenes and assets.


## Portable project ZIP archive (v0.4.0)

- Use **Export project ZIP** to download an archive containing project.json, an archive manifest, uploaded assets, and tiled panorama previews/tiles/originals where the browser can fetch them. The ZIP STORE method packages already-compressed media without recompressing it.
- Use **Open** and select a .360studio.zip file to restore the project and media into this browser. The importer validates archive paths, sizes, and CRC checksums.
- Direct URL media is fetched into the archive if the browser has CORS access. Unfetchable URL media stays linked and is listed as an external dependency in archive-manifest.json.
- ZIP64 is not implemented yet; archives larger than 4 GiB are rejected. Exporting remote high-resolution tiles requires every tile URL to be reachable from the Studio origin.
- Asset binaries are written to IndexedDB in a single transaction on import. Project configuration and the active scene continue to use browser-local saving.


## Standalone production tour (v0.5.0)

1. Run `npm install` once. `npm run dev` first builds the standalone player runtime into ignored `public/player-runtime/`.
2. Use the Studio editor and choose **Build for web → Build standalone tour (.zip)**. The exporter collects project media using the same CORS-aware archive pipeline as project ZIP export, then includes the prebuilt player JS/CSS and a deployment guide.
3. Extract the downloaded `*-production.zip` into a dedicated server folder. Serve its `index.html` over HTTP or HTTPS; do not open it with `file://` because the player fetches JSON manifests.
4. The bundle includes `project.json`, `archive-manifest.json`, `assets/`, and `tours/` with tiled previews and tile images when available. Its viewer resolves media by stable asset IDs.
5. Assets blocked by CORS/authentication remain as external URLs and are listed in `archive-manifest.json`. Review these before sharing.

Build commands:

```bash
npm run build:player
npm run typecheck
npm run build
```

The build script bundles the player runtime into the static editor output. ZIP64 is not supported; archives over the classic ZIP 4 GiB limit are rejected.

## Customizable hotspots (v0.6.1)

- Hotspots now support configurable shape, color, size, label visibility, and pulse/bounce/rotate animation.
- Upload PNG, SVG, WebP or animated GIF marker art. Transparent pixels remain transparent, and marker CSS adds no chip background, border, or shadow. Use an image with alpha transparency; JPEG cannot store transparency. Uploaded icons are included in project archives and standalone tours when available to the archive collector.
- Choose **Invisible clickable area** to hide a hotspot in Preview and the published tour while keeping a configurable click target. The editor displays a locator so hidden targets can still be found and adjusted.
- Choose **Link** to open an HTTP(S) destination in a new tab, or **Web page / document** to display an HTTP(S) HTML page or browser-supported document (such as PDF) in an iframe overlay. A new-tab fallback is provided because some websites block iframe embedding with their own security headers.
- The project schema stays at v1; all new appearance fields are optional so older projects continue to load.
