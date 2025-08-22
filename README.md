# Vector Putt (Prototype)

Vector Putt is a retro‑styled mini golf game built with TypeScript and HTML5 Canvas, focused on crisp physics, clean vector art, and classic course design.

## Description

A classic mini golf recreation using TypeScript + Canvas with data‑driven levels, polished friction/bounce physics, and a minimalist retro look inspired by early 2000s web games. Levels are plain JSON (tee, cup, walls, terrains, decorations) for quick iteration.

## Features

- TypeScript + Canvas 2D, Vite dev server
- Tuned physics: friction, restitution, stop thresholds
- Terrain zones: sand (higher friction), water (OOB penalty/reset)
- Data‑driven levels: tee, cup, walls, decorations
- Minimal HUD, pause overlay, keyboard shortcuts (R/N/Space/P/Esc)
- Retro vector palette and clean course framing
- In-game overlay dialogs (Confirm, Prompt, List) and Toast notifications replace browser alerts/prompts; overlays render above all UI, rebuild hotspots every frame, swallow input while active, and support Enter/Esc/Arrow keys.
- Level Editor: top menubar with pull-down menus (File, Objects, Decorations, Editor Tools); tool palette and selection; Tee/Cup placement with 20px grid snapping; multi-level persistence (Save, Save As, Load, New, Delete) via in-game overlays; ownership metadata (authorId/authorName) with owner/admin overwrite/delete permissions; legacy single-slot data auto-migrated on first editor entry; in-editor grid preview; editor preview renders existing geometry (water, sand, bridges, hills, decorations, walls, polygon walls, posts) using play-mode visuals; interactive placement for Posts (click) and Walls/Bridges/Water/Sand/Hills (click-drag rectangles) with grid snapping and fairway clamping. Select Tool supports selection, movement, and deletion for polygon objects (`wallsPoly`, `waterPoly`, `sandPoly`). Policy: in dev/admin builds, Save As targets the filesystem or `User_Levels/<Username>/` (no LocalStorage Save As); browser-only builds should use explicit Import/Export.

## Stack

- TypeScript, HTML5 Canvas 2D
- Vite (dev/build)
- Web Audio API (custom) for SFX; Howler.js optional later, Vitest (tests)

## Run locally

1. Install dependencies
   - `npm install`
2. Start dev server
   - `npm run dev`
3. Open the URL shown by Vite.

See `TODO.md` for roadmap, `PROGRESS.md` for current focus, and `docs/PALETTE.md` for the canonical color palette.

## Testing

- Run unit tests (Vitest):

```bash
npm run test
```

- Watch mode:

```bash
npm run test:watch
```

- Coverage report:

```bash
npm run coverage
```

## Suggested GitHub Topics

`typescript`, `html5-canvas`, `game-dev`, `physics`, `mini-golf`, `retro`, `vite`, `howler`, `vitest`
