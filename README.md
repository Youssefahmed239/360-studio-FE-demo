# 360 Studio FE Demo

A new, independent frontend starter for a customizable 360° tour authoring studio. This is not the existing `360-studio-FE` repository.

## Current foundation (v0.2.0)

- Responsive dark editor shell with scene list, canvas, sequence timeline, and scene inspector.
- Editable project name and scene names.
- Add scenes and configure transition type/duration.
- Local browser draft persistence with autosave and a visible save state.
- Export/import versioned editable project JSON.
- Interactive WebGL 360° viewer for uploaded equirectangular panoramas, with drag-to-look, wheel/pinch zoom, scene changes, and configurable fade / fade-through-black / zoom / instant transitions.
- Click-to-place spherical hotspots with yaw/pitch coordinates, labels, action types, navigation targets, and direct image/video/audio URL previews.
- Uploaded panorama binaries stored in IndexedDB, while project metadata and the last-open scene are saved in localStorage for resume in the same browser.
- Typed project schema for scenes, hotspots, assets, transition settings, audio settings, and project branding.
- Relative Vite build paths (`base: './'`) for static hosting under an Nginx subpath.

## Not implemented yet

The remaining major capabilities are multiresolution panorama tiling, complete uploaded-media archive export/import, rich media surfaces inside the sphere, configurable audio lifecycle controls, project branding tools, and a standalone production player build.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
npm install
npm run dev
```

## Check and build

```bash
npm run typecheck
npm run build
npm run preview
```

## Project save/export behavior

- **Save / autosave:** stores project configuration and last-open scene in `localStorage`, plus uploaded panorama binaries in IndexedDB. This is a local draft, not cloud storage. Clearing browser storage/site data or changing browsers can remove it.
- **Export project:** downloads a versioned `.360studio.json` with editable project configuration. The export currently excludes uploaded media binaries; a portable ZIP archive that bundles source assets is the next export milestone.
- **Import project:** imports a compatible schema-v1 JSON file and asks before replacing the open project.

## Deployment

The Vite output in `dist/` is static and can be hosted by Nginx. This editor starter is not yet the end-user tour player; do not publish it as a finished tour product yet. The deployment bundle flow will be implemented separately so a published tour can run independently of this editor.

## Architecture direction

- `src/types/project.ts`: engine-independent project schema.
- `src/features/projects/projectStore.ts`: project state, autosave, and last-open scene restoration.
- `src/features/assets/assetStorage.ts`: IndexedDB persistence for uploaded originals and transient preview URL restoration.
- `src/features/panorama/PanoramaCanvas.tsx`: Photo Sphere Viewer runtime and spherical hotspot markers.
- `src/lib/projectFiles.ts`: schema-versioned JSON project import/export.
- `src/app/`: editor application and visual shell.

The schema uses stable IDs so the project archive and published player can refer to the same scenes and assets later. Original panorama files should be preserved separately from generated preview/tiles in the future media pipeline.
