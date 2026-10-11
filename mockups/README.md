# Design mockups

Screenshots of Legolas's real screens in headless Chrome, for design work. Nothing here ships in the app.

- `shoot.mjs <out> [theme ...]`: the sample screen (`src/ui/testing/glass-mockup.tsx`) in four views. `current` is the app as it is; a theme is a CSS file in `themes/` layered on top (`a-native+b-full` stacks two).
- `tour.mjs <out>`: the first screen of every UI fixture, plus groups, routines, full screen and an open document.
- `themes/`: the glass directions from 11 Oct 2026. A (`a-native`) was picked; step 1 shipped its font, colours and corners. Its glass rules are the reference for steps 2 and 3.

Run either with `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron mockups/<script> ...` from the repo root.
