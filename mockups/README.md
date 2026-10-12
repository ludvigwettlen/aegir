# Design mockups

Screenshots of Legolas's real screens in headless Chrome, for design work. Nothing here ships in the app.

- `shoot.mjs <out> [theme ...]`: the sample screen (`src/ui/testing/glass-mockup.tsx`) in four views. `current` is the app as it is; a theme is a CSS file in `themes/` layered on top (`a-native+b-full` stacks two).
- `tour.mjs <out>`: the first screen of every UI fixture, plus groups, routines, full screen and an open document.
- `themes/`: the glass directions from 11 Oct 2026. A (`a-native`) was picked and shipped in three steps (11 to 12 Oct): font, colours and corners; the desktop through the window; glass on the floating layers.

Run either with `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron mockups/<script> ...` from the repo root.
