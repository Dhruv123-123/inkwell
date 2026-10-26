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

## Pro features
- Notebook covers (15 colors × 6 patterns), new-notebook dialog with paper, size and subject
- Tabs for open notebooks, grid/list library, light/dark/auto theme
- Pen types (fountain, ballpoint, brush) with customizable color and size presets
- Tape for self-testing, stickers, sticky notes and saved "My Elements"
- Study sets: flashcards from text or lasso selections, spaced repetition review
- Live audio transcription (Web Speech API where available), searchable and tap-to-seek
- Outline from titled bookmarks, presentation mode, horizontal page scrolling

## Run locally
    python3 -m http.server 8000

Third-party: `vendor/` contains pdf.js (Apache-2.0, see vendor/pdfjs-LICENSE).

## Deploy
Live at https://dhruv123-123.github.io/inkwell/ (GitHub Pages serves the `gh-pages` branch).
To ship a change: bump `VERSION` in `sw.js`, commit to `main`, then `git push origin main main:gh-pages`.
