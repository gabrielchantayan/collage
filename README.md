# Collage

Local, client-only slideshow creator

<img src="_gh_images/main-page.png" width="90%" />

## The Story

The app I used for making my Instagram slides went to a really shit freemium model that limited users to 5 slides per carousel. I didn't like that. Good thing that code is free nowadays.

I decided to make _collage_, a free, open-source slideshow creator. Because fuck paying for stuff lol



## Run

Node 22.12+.

```sh
npm install
npm run dev
```

`npm run build` type-checks and builds `dist/`. `npm run preview` serves the production build. Deploy `dist/` to any static host.

## Controls

- Upload with the file picker or file drag/drop. Photos stay in the bottom tray; uploads never place them automatically.
- Click Insert or drag a tray photo onto a slide. Touch dragging is supported. Sources can be reused in multiple placements; deleting a placement keeps its tray photo.
- Inserted photos are hidden from the tray by default. Toggle Show inserted to reveal them.
- Right-click a tray photo to insert/delete it; right-click a canvas photo or layer for duplicate, layer order, reset crop and delete. Icon menus fit their longest action and support arrow keys and Escape.
- Tray trash buttons also work on touch devices. Deleting an uploaded photo removes its placements after confirmation if in use; one Undo restores the photo and placements.
- Select a photo: drag its edges to crop width/height independently; corners resize proportionally; top handle rotates. Drag the photo to move it.
- Crop width/height fields provide exact dimensions. Reset crop restores the original image without changing its scale.
- Wheel or trackpad pinch zooms around the pointer; touch pinch zooms around its midpoint. Shift-scroll or horizontal trackpad scroll pans. Fit shows the whole strip (minimum 10% zoom).
- Arrow keys nudge selection; Shift moves 10px. Delete removes it. Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z redoes.
- Slides: 1–20. Portrait: 1080×1350; square: 1080×1080. Shrinking the strip hides out-of-bounds artwork; increasing it reveals it again.
- Export numbered PNGs individually or in a ZIP. Native file sharing is offered when supported; saving directly to Photos depends on the device/browser. Downloads save PNG files; preview images also support long-press saving.

## Storage and source

The current project autosaves in IndexedDB on this device and origin. Full-resolution sources are stored once as binary Blobs, separately from lightweight project metadata and thumbnails; edits never rewrite the image library. Browser storage quotas vary by device/browser and available disk space; there is no app-imposed upload count limit. Clearing browser data removes the project. No images leave the browser.

Quota errors identify unsaved changes without discarding the open project. Failed loads or migrations never autosave a blank replacement; legacy migration commits the project and sources atomically. Export current work before closing a tab with a storage error.

Deleted sources remain available for the current tab's Undo history. On the next workspace load, sources no longer referenced by the saved project are removed, reclaiming their storage.

- `src/model.ts`: separate source assets and canvas placements; source-pixel crops.
- `src/crop.ts`: crop geometry; preserves scale and rotated placement.
- `src/assets.ts`: local HEIC conversion, binary source storage, 192px thumbnails and shared 1280px editing previews.
- `src/storage.ts`: atomic migration of earlier projects and unused-source cleanup.
- `src/useProject.ts`: undo/redo and local persistence.
- `src/components/CollageCanvas.tsx`: viewport-sized, offscreen-culled rendering, transforms, snapping and zoom.
- `src/components/CropHandles.tsx`: direct edge cropping with live preview and a single undo step per drag.
- `src/components/PhotoTray.tsx`: windowed upload library, filtering, insertion, deletion and desktop/touch dragging.
- `src/components/ContextMenu.tsx`: shared, viewport-clamped keyboard-accessible photo actions.
- `src/export.ts`: sequential full-resolution slide rendering, bounded decoded-source cache and ZIP generation.
- `src/components/ExportDialog.tsx`: previews, native sharing, individual downloads.

Modern browser required. HEIC/HEIF uploads convert locally to full-resolution PNG with `heic-to/csp`; JPEG, PNG and WebP retain their original source files. Editing uses bounded previews; exports use full-resolution sources and render one slide at a time rather than allocating a full 20-slide bitmap.
