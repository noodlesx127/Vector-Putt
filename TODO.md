# TODO — Vector Putt (Working Title)

A practical checklist to start and deliver the MVP based on `Design_Doc.md`.

## Recommended Target Stack (Simple, Java-era spirit)

- HTML5 Canvas 2D + TypeScript (no heavy engine)
  - Rationale: closest to classic Java applets in simplicity; deterministic 2D; tiny runtime; easy web distribution.
- Build tooling: Vite (fast dev server + bundling) with NPM scripts
- Audio: Howler.js (lightweight, cross-browser)
- Testing: Vitest (unit), Playwright (optional smoke)
- Level format: Tiled (TMX/JSON) or simple custom JSON for walls/terrains
- Packaging: Static web build (GitHub Pages/Netlify); optional Electron wrapper later for desktop

Notes:
- Avoid large game engines (Unity/Godot) to keep footprint and complexity low.
- Use minimal dependencies; write simple physics/collision in-house.

## Project Foundations
- [x] Adopt recommended stack above and scaffold project
- [ ] Validate features and tuning against the reference videos (see section below); default to matching observed behavior
- [ ] Initialize repo structure
  - [x] `src/` game code
  - [ ] `assets/` art and audio
  - [x] `levels/` level JSON/Tiled scenes
  - [ ] `docs/` design, tech notes
  - [ ] `tools/` level pipeline scripts (if needed)
- [x] Add project README with run/build instructions
- [ ] Add license and CONTRIBUTING
- [ ] Configure version control (Git LFS for binary assets)
- [ ] Setup CI for builds (per target platform)
- [ ] Add code style/linting and pre-commit hooks
- [ ] Define build targets (desktop/web/mobile) and packaging

## Core Gameplay Loop
- [x] Implement game states: Main Menu → Gameplay → Post-Hole → Course Summary
- [x] Implement one-button shot mechanic
  - [x] Click-and-hold on ball to aim
  - [x] Draw aiming arrow (direction + power via length/color)
  - [x] Release to shoot
  - [x] Disable input while ball in motion
- [ ] Ball lifecycle
  - [x] Ball spawns at tee
  - [x] Detect “ball stopped” threshold
  - [x] Detect “ball in hole” and transition to Post-Hole

## Physics & Interactions
- [x] Ball motion with friction (tunable)
- [x] Wall collisions with proper reflection (angle in = angle out)
- [x] Terrain types with per-surface physics
  - [x] Fairway (medium friction)
  - [x] Sand (high friction; hard to exit)
  - [x] Water (OOB): +1 stroke, reset to pre-shot position
- [ ] Velocity affects terrain (e.g., hard shot may skim sand)
- [ ] Ramps/Hills (slope affects speed/direction; phase 2)
  - [x] Hills (prototype): directional acceleration zones with visual gradient
- [ ] Moving obstacles (timed collisions; phase 2)
- [ ] Boosters/Accelerators (apply impulse; phase 2)
- [ ] Tunnels/Teleporters (enter/exit mapping; phase 2)

## Scoring & Rules
- [x] Stroke count per hole (+1 per shot)
- [x] Par per hole (data-driven)
- [x] Score evaluation at end of hole (Birdie/Par/Bogey, etc.)
- [x] Running total across course
  - [x] Show running total (HUD) and record per-hole strokes when advancing
  - [x] Course summary overlay with per-hole strokes and total
  - [x] Final-hole UX: require click/N from sunk banner; prevent accidental auto-close
- [x] Water penalty and reset logic

## Level System
- [x] Level data format decision (Custom JSON)
- [x] Level loader/validator
- [ ] Placeable components
  - [x] Tee start, hole cup
  - [x] Walls/boundaries
  - [x] Terrain tiles (fairway, sand, water)
  - [ ] Optional: slopes, moving blocks, boosters, tunnels
 - [ ] Course definition (ordered list of holes + par values)
 - [x] Author 3–5 MVP holes to validate mechanics (added level4, level5)
- [x] Adjust L1 decorations to sit outside playfield
- [x] L2: add doorway into box and place cup inside; reachable sand

## UI/UX
- [x] Minimalist HUD (top of screen)
  - [x] Hole: current index and total (e.g., 3/9)
  - [x] Par for current hole
  - [x] Strokes for current hole
  - [x] Align HUD across the very top (left/center/right)
  - [x] Show Birdie helper (strokes remaining for birdie)
- [x] Aiming arrow visual design (power feedback via length/color)
  - [x] Post-Hole scorecard screen with performance label
  - [x] Main Menu (Start, Options placeholder) → Course Select (Dev Levels)
- [ ] Options: audio volumes (SFX/Music), accessibility toggles
- [x] Pause menu overlay with info/shortcuts/version (P/Escape)
  - [x] Buttons: Replay, Close, Back to Main Menu
- [x] Restart hole (R) and Next level (N)
  - [x] Robust transitions (no double-advance); cached/preloaded next level for snappier switches
  - [x] Loading state before first play; prefetch first two levels
  - [x] Fixed-canvas layout tuned to 960×600 with letterbox scaling
- [x] HUD: optional hole title display (per-level `course.title`)
- [x] HUD: Menu button toggles Pause (replaces HUD Replay)
- [x] Main Menu: simple vector graphic (flag, hole, ball, putter)

## Audio
- [ ] SFX list and placeholders
  - [ ] Ball hit (putt)
  - [ ] Wall bounce (knock)
  - [ ] Water splash (plop)
  - [ ] Sand roll (grit)
  - [ ] Hole sink + short jingle
- [ ] Background music (light, cheerful, loopable)
- [ ] Audio mixer with volume controls

## Visuals
- [x] Minimalist vector style palette (retro pass applied)
- [x] Distinct colors per terrain for instant readability (green/sand/water)
- [ ] Simple, legible UI fonts and icons
- [ ] Reusable shapes for walls/terrain (rects, circles, polygons)
- [x] Flower decorations pass (non-colliding), positioned outside playfield
- [x] Auto-snap decorations near outer walls to table area (avoid playfield overlap)
- [ ] Per-level palette overrides (wall/fairway/decor variations)
- [ ] Diagonal/chamfered walls support in schema + rendering

## Reference Videos — Consolidated Findings
Sources:
- Layout & Graphics: https://www.youtube.com/watch?v=Lp4iL9WKpV4
- Hole-in-One Compilation: https://www.youtube.com/watch?v=4_I6pN-SNiQ
- Full Playthrough: https://www.youtube.com/watch?v=kMB2YdKYy7c

Important: These three videos are canonical reference points. Use them extensively to guide decisions across Gameplay, Level Design & Environment, Look & Feel, UI/UX, and Physics & Interactions. Prefer matching the observed behavior/visuals unless there is a deliberate, documented reason to deviate.

Observation tasks (verify and document in `docs/VIDEO_NOTES.md`):
- [ ] Camera/layout: top-down orthographic; bordered fairways; sharp-corner walls
- [ ] Visual style: flat solid colors; strong outlines; minimal effects
- [ ] Terrain color mapping: green (fairway), tan (sand), blue (water), dark walls; extract exact hexes → `docs/PALETTE.md`
- [ ] Hole cup: dark circle with rim; short sink animation; confirm suction radius (if any)
- [ ] Ball: simple white with small shadow; size vs. tile width ratio
- [ ] HUD: top placement; labels “Hole x/y”, “Par n”, “Strokes m”; retro/simple font
- [ ] Resolution/aspect: fixed canvas (e.g., 800×600 or 1024×768); letterbox scaling
- [ ] Geometry patterns: rectilinear corridors, 90° banks, zig-zags, open greens; occasional arcs
- [ ] Obstacles: simple blocks/moving bars; verify moving elements present/absent per video
- [ ] Terrain usage frequency and effect on shots (sand slows; water OOB)
- [ ] Aiming UI: arrow style, power by length/color; max length; power curve feel; minimum drag threshold
- [ ] Physics feel: friction/drag (time-to-stop), bounce elasticity (angle in = angle out), bank counts
- [ ] OOB handling: splash SFX, delay, +1 stroke, reset to pre-shot position; confirm order/timing
- [ ] UI feedback timing: stroke counter updates, sink banner cadence
- [ ] Score terms: Birdie/Par/Bogey; colors/format of scorecard
- [ ] Flow: Main Menu → Course/Level Select → Hole intro → Gameplay → Post-Hole → Next Hole; course length (9/18)
- [ ] Input scope: mouse-only; confirm restart keys (R/Esc)
- [ ] Performance target: smooth 60 FPS (assumed; verify)

Implementation follow-ups:
- [ ] Create 5–10 prototype holes for observed archetypes in `levels/`
- [ ] Bank-shot dev harness: visualize predicted reflection paths (dev-only)
- [ ] Collision tuning: restitution/friction, and wall tolerance to avoid tunneling; deterministic reflections
- [ ] Config surfaces: friction per terrain; restitution; stop-epsilon; suction radius
- [ ] Aiming: clamp min/max drag, configurable power curve; arrow visuals per reference
- [ ] OOB pipeline: splash → +1 stroke → reset → resume (match timing)
- [ ] HUD/layout: match positions/labels; timing of updates and sink banner
- [ ] Post-Hole screen: classic golf terms; stroke delta vs. par; next/quit
- [ ] Course/Level select: 9/18 presets; course summary totals
- [ ] Sound manager: map events (hit, bounce, sand, water, sink) with balanced volumes
- [ ] Fixed-canvas preset (exact px after measurement) + letterbox scaling
- [ ] Docs: `docs/STYLE_GUIDE.md`, `docs/PALETTE.md`, `docs/VIDEO_NOTES.md`, `docs/ARCHETYPES.md`

## Game Feel & Tuning
- [ ] Define physics constants (mass, friction, damping, restitution)
- [ ] Define aiming sensitivity and clamping
- [x] Define stop-threshold (speed epsilon)
- [ ] Iteration sessions with telemetry of strokes per hole

## Persistence
- [ ] Save best scores per hole/course (local storage or file)
- [ ] Config persistence (audio volumes, last course)

## Testing & QA
- [ ] Unit tests for physics integration/energy loss
- [ ] Deterministic collision tests (angle in/out)
- [ ] Terrain friction table tests
- [ ] Water penalty/reset tests
- [ ] UI snapshot or scene tests (where supported)
- [ ] Level loader validation tests (schema)
- [ ] Automated playthrough of a short course in CI (smoke)

## Build & Release
- [ ] Dev build pipeline (fast iterate)
- [ ] Release build pipeline (minify/strip symbols)
- [ ] Platform packaging (Web: itch.io/Pages; Desktop: Win/macOS installers)
- [ ] Versioning and changelog

## Documentation
- [ ] Update `docs/Design_Doc.md` with any scope changes
- [ ] Add `docs/TECH_DESIGN.md` covering architecture and data formats
- [ ] Add `docs/LEVEL_GUIDE.md` for creators

## Stretch (post-MVP)
- [ ] Moving obstacles, boosters, teleporters
- [ ] Sloped terrain system and editor tools
- [ ] Course editor in-app
- [ ] Cosmetics/unlocks (non-pay)
- [ ] Mobile touch optimization
- [ ] Advanced camera work (cinematic replays)
