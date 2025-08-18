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
