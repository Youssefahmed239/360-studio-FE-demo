# 360 Studio Production QA Checklist

Use this before merging or deploying a tour. Automated checks cover build output and archive structure; the runtime still requires real browser and Nginx checks.

## Automated gates

From the repository root:

```bash
npm ci
npm run test:qa
npm run typecheck
npm run build
npm run qa:build
```

After using Studio's **Build standalone tour (.zip)**, extract the ZIP into a temporary directory and run:

```bash
npm run qa:bundle -- /absolute/path/to/extracted-production-tour
```

Do not deploy while any command exits non-zero. Review each warning from the bundle QA. External URLs are not necessarily a build failure, but they need explicit verification.

## Editor and project persistence

- [ ] Load a project and confirm the correct scene, panorama and uploaded media restore.
- [ ] Change a hotspot label, action, visibility, style, scale and coordinates; wait for autosave, refresh, and confirm values persist.
- [ ] Import a portable project ZIP into a separate browser profile or a clean test browser and check the media is restored.
- [ ] Export a portable project ZIP, import it again, and compare scene, hotspot and theme settings.
- [ ] Confirm legacy schema-v1 projects without newer optional fields use safe defaults.
- [ ] Verify failed storage/import/export paths produce a visible error and do not silently replace the current project.

## Panorama, hotspot and spatial media regressions

- [ ] Drag/rotate the panorama camera. Hotspots and spatial image/video elements remain at their saved world/panorama positions instead of sticking to the screen/camera.
- [ ] Use Unity-style Rotate Gizmo on X, Y and Z; verify the selected element updates immediately and remains correct after switching scenes.
- [ ] Adjust Scale X/Y and any lock-aspect-ratio control. Confirm scale remains independent from position and rotation.
- [ ] Test transparent PNG and GIF/WebP assets. There is no extra editor/player box, tint or background added around the image.
- [ ] Test an invisible hotspot: it is hidden in the published experience while its clickable region performs the configured action.
- [ ] Test each action type: scene navigation, image, video, audio, info and web page/document. A page that blocks iframe embedding should still have a usable open-in-new-tab fallback.
- [ ] Test spatial video controls, mute/autoplay behavior, pause on leaving/removing the media, and no unintended audio overlap.
- [ ] Test scene audio start delay, start offset, stop time, fade-in/fade-out, loop and stopping/restarting on scene changes (as available in the applied version).

## Theme and publishing

- [ ] Change brand name, logo, accent/background/text colors, font and the available UI visibility toggles.
- [ ] Reopen the saved project and confirm theme choices persist.
- [ ] Build a new standalone ZIP; confirm it contains `index.html`, `tour-player.js`, `tour-player.css`, `project.json`, `archive-manifest.json`, media assets and `DEPLOYMENT.txt`.
- [ ] Run `npm run qa:bundle -- <extracted-folder>` and resolve errors; review external dependency warnings.
- [ ] Check every scene and media item in the extracted standalone tour, not only in the editor preview.

## Browser and deployment matrix

- [ ] Chrome desktop and Safari desktop.
- [ ] iOS Safari and Android Chrome on a real device.
- [ ] Portrait and landscape, touch pan/pinch, viewport resize and fullscreen.
- [ ] First visit with audio disabled, then explicit sound enable gesture. Browser autoplay restrictions are expected and should fail gracefully.
- [ ] Serve under an Nginx subpath, not only the site root. Confirm all JS/CSS/JSON/images/video/tile requests are 200 and relative URLs remain correct.
- [ ] Verify HTTPS, correct media/JSON MIME types, video byte-range seeking, and no unexpected CORS/auth failures.
- [ ] Check console/network logs for 404s, CSP/frame-ancestors/X-Frame-Options blocking, mixed content, and failed tile requests.
- [ ] Deploy to a new versioned directory first; verify it before switching the production URL. Keep the previous version for rollback.
- [ ] Ensure `index.html`, `project.json`, and `archive-manifest.json` revalidate or are deployed versioned; avoid stale cached HTML referencing old assets.

## Release decision

A build passing automated checks is **not** an automatic production approval. Mark the release ready only after the manual browser/device checks and the real Nginx deployment pass. Record browser/OS, build commit, bundle name, test date, blockers and rollback path in the release notes.

## Tour layout and welcome screen
- [ ] Grouped toolbar positions as a unit; free-placement controls drag independently.
- [ ] Buttons, uploaded images, URL images and hidden hit areas perform the configured action.
- [ ] Welcome screen opens only on selected scene IDs and obeys Show once / close settings.
- [ ] Panel opacity and backdrop opacity are independently adjustable and the panorama remains visible.
- [ ] Layout is preserved in project ZIP and standalone production ZIP, including uploaded image assets.
- [ ] Page/document actions are tested for iframe-compatible and iframe-blocked URLs.
