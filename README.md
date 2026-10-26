# Inkwell

An original, Notability-style note-taking web app for iPad, installable as a PWA.
No build step: plain HTML, CSS and ES modules. Everything is stored on the device in IndexedDB.

## Features
- Library with subjects, dividers, favorites, recents, sort and full-text search (titles, typed text, PDF text)
- Pen with Apple Pencil pressure, highlighter (straight-line option), whole-stroke and partial eraser
- Lasso: move, resize, cut/copy/paste, duplicate, recolor, reorder, move to another page
- Text boxes with fonts, sizes, colors; shapes tool and draw-and-hold shape snapping; images; laser pointer
- Paper templates (lined, grid, dotted, Cornell, music, planner, checklist) and paper colors, per note or per page
- PDF import and annotation (pdf.js), photos as pages
- Audio recording synced to notes, with replay, tap-ink-to-seek, playback speed
- Page thumbnails, bookmarks, reorder/duplicate/delete pages, pinch zoom, two/three-finger tap undo/redo
- Export to PDF, page as image, print, per-note and full-library backup/restore
- Offline via service worker; Pencil-only drawing with palm rejection

## Run locally
    python3 -m http.server 8000

Third-party: `vendor/` contains pdf.js (Apache-2.0, see vendor/pdfjs-LICENSE).
