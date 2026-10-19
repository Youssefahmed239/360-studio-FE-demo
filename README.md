# 360 Studio FE Demo

A new, independent frontend starter for a customizable 360° tour authoring studio. This is not the existing `360-studio-FE` repository.

## Current foundation (v0.1.0)

- Responsive dark editor shell with scene list, canvas, sequence timeline, and scene inspector.
- Editable project name and scene names.
- Add scenes and configure transition type/duration.
- Local browser draft persistence with autosave and a visible save state.
- Export/import versioned editable project JSON.
- Upload a panorama into the current scene as a local browser preview (the full 360° viewer integration is a next step).
- Typed project schema for scenes, hotspots, assets, transition settings, audio settings, and project branding.
- Relative Vite build paths (`base: './'`) for static hosting under an Nginx subpath.

## Not implemented yet

The UI intentionally marks future capabilities rather than pretending they already work: a real 360° renderer, tiled/multiresolution panorama generation, robust asset archive export, full hotspot authoring, media surfaces, audio lifecycle controls, and production player build.

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

- **Save / autosave:** stores project configuration in the current browser's `localStorage`. This is a local draft, not cloud storage. Clearing browser storage or changing browsers can remove it.
- **Export project:** downloads a versioned `.360studio.json` file containing editable project configuration. The current export does not bundle uploaded media binaries; that is a planned archive-export phase.
- **Import project:** imports a compatible schema-v1 JSON file and asks before replacing the open project.

## Deployment

The Vite output in `dist/` is static and can be hosted by Nginx. This editor starter is not yet the end-user tour player; do not publish it as a finished tour product yet. The deployment bundle flow will be implemented separately so a published tour can run independently of this editor.

## Architecture direction

- `src/types/project.ts`: engine-independent project schema.
- `src/features/projects/projectStore.ts`: project state and local persistence.
- `src/lib/projectFiles.ts`: JSON project import/export.
- `src/app/`: editor application and visual shell.

The schema uses stable IDs so the project archive and published player can refer to the same scenes and assets later. Original panorama files should be preserved separately from generated preview/tiles in the future media pipeline.
