# Changelog

All notable changes to this project will be documented in this file.

## v0.3.5 — 2025-08-16

- Polygon walls: added render and segment-based collision (diagonals/chamfers/triangles).
- Schema: new `wallsPoly: [{ points: [x,y,...] }]` supported in level JSON.
- Content: added a small triangular wedge example to `levels/level5.json`.
- Version: in-game version set to `0.3.5`.

## v0.3.6 — 2025-08-16

- Polygon sand: added `sandPoly` support with rendering via existing sand style and friction detection.
- Level 5: replaced rectangular sand with a trapezoid pit using `sandPoly`; tweaked layout for logical play.
- Version: in-game version updated to `0.3.6`.

## v0.3.7 — 2025-08-16

- Course Summary: shows per-hole par and delta (E/+/-) and course totals with delta vs par.
- Version: in-game version updated to `0.3.7`.

## v0.3.8 — 2025-08-16

- Hills: tuned base acceleration and added optional `falloff` parameter for edge-weighted push.
- Level 3: updated hill to use tuned values (`strength: 0.65`, `falloff: 1.2`).

## v0.3.9 — 2025-08-16

- Options screen: added basic SFX controls (volume +/-, mute). Simple Web Audio SFX for putt, bounce, splash, sink.
- Version: in-game version updated to `0.3.9`.

## v0.3.10 — 2025-08-16

- Water splash visual: ripple effect drawn on water where the ball lands before reset.
- Version: in-game version updated to `0.3.10`.

## v0.3.11 — 2025-08-16

- Impact feedback: brief bounce flash drawn along the collision normal; tied to bounce intensity.
- Version: in-game version updated to `0.3.11`.

## v0.3.4 — 2025-08-11

- New obstacles (prototype):
  - Round posts (circular colliders) with beveled render and physics.
  - Bridges: fairway rectangles that span water and override the water penalty.
- Level: added sample posts and a narrow bridge to `levels/level4.json`.
- Docs: updated TODO with clarified obstacle behaviors from references.

## v0.3.3 — 2025-08-11

- Visuals: beveled wall rendering (shadow + face + highlight) for closer retro look.
- Visuals: fairway rendering refined with multiple horizontal bands.
- Version bumped in-game to match.
- Content: added two prototype holes (`levels/level4.json`, `levels/level5.json`) and updated course order.

## v0.3.2 — 2025-08-11

- Visuals/layout tuned closer to reference screenshots:
  - Canvas logical size set to 960x600; letterboxed scaling preserved.
  - HUD text is now rendered directly on the mustard table background; removed dark HUD strip.
  - HUD text color adjusted to dark for contrast on mustard.
  - Cleaned canvas CSS outline so outer mustard frame reads correctly.
  - Centered legacy 800×600 levels within the 960×600 canvas while keeping HUD anchored.
  - Respected per-level `canvas` size for fairway/band/outline and decoration clipping to remove unintended extra area.
- Bugfixes:
  - Mapped input coordinates to the centered playfield so aiming and shots work correctly after centering (strength arrow visible again).
- Docs: version bump synced in-game and here.

## v0.3.1 — 2025-08-11

- Changelog screen: added scrollable viewer (wheel, drag, keyboard) with clipping and scrollbar. Bundles `CHANGELOG.md` via raw import fallback.
- Main Menu: restored Changelog button and bottom-left version text. Fixed various menu state/hover bugs.
- Bugfixes: stabilized sunk/summary transitions and input swallowing.
- Decorations: auto-snap near the fairway edges to the table area to avoid overlapping the playfield.
- Summary: added a Main Menu button and Esc/ M key shortcut to return to the main menu after finishing a course.
- Fix: Summary "Main Menu" button now correctly returns to main menu; prevented mousedown from triggering restart, click uses correct event position.

## v0.3.0 — 2025-08-11

- Synced docs with current implementation:
  - Marked friction/exponential damping tuning complete in `PROGRESS.md`.
  - Marked HUD hole title and Replay button complete in `PROGRESS.md`.
  - Ticked off "ball in hole" detection, water penalty/reset, and post-hole score label in `TODO.md`.
  - Noted terrain tiles coverage as complete (fairway, sand, water).
  - Moved HUD Replay button below the top strip to avoid overlapping right-side HUD text.
  - Repositioned Replay to left side of HUD and shifted left HUD text right of the button to ensure no overlap.
  - Added hills (slope) prototype: new `hills` array in level JSON with directional acceleration; rendered as subtle gradient; updated `level3.json` with a sample SE slope.
  - Added `levels/course.json` and HUD running total; records strokes on Next.
  - Added Course Summary overlay at end of course with per-hole strokes and total; Enter restarts course.
  - Fix: auto-show Course Summary ~1.2s after sinking the last hole; updated sink banner hint.
  - UX: Added click-to-continue — clicking after sinking the last hole opens Summary; clicking on Summary restarts course. Updated summary text to “Click or Press Enter to Restart Game”.
  - Level 3: moved cup inside boxed area for sensible play path.
  - Fix: sunk banner always shown before summary on final hole; summary requires click/N.
  - Fix: correct final-hole detection by using `courseInfo.index/total` for banner hints and transitions.
  - Fix: prevent double-advance and accidental Total increments using `transitioning` guard.
  - Fix: swallow trailing click after mousedown to avoid instant summary close.
  - Perf: cache loaded levels and preload the next one to speed level switches; preload after summary restart too.
  - Controls: Click or N from sunk banner to continue; Space to replay current hole; Enter on Summary to restart course; P/Esc to Pause/Resume; Replay button in HUD.
  - UI: Added Main Menu and Course Select (Dev Levels); version shown bottom-left on menus; HUD has Menu button instead of Replay; Pause menu refined with Replay and Close buttons.

## v0.1.0 — 2025-08-10

- Added level loading with custom JSON schema (`levels/level1.json`).
- Implemented axis-aligned walls rendering and circle–rect collision with restitution in `src/main.ts`.
- Switched to exponential damping (frame-rate independent) and added displacement-based stop epsilon.
- Added minimalist HUD showing Hole/Par/Strokes.
- Fixed bug where ball could not move due to tee overlapping a wall; adjusted tee position and added post-load overlap nudge.
- Updated `PROGRESS.md` and `TODO.md` to reflect current state.

### Later on 2025-08-10

- Added two prototype levels: `levels/level2.json`, `levels/level3.json` and set `course.total` to 3 in level 1.
- Added keyboard shortcuts in `src/main.ts`:
  - `R` = restart current level
  - `N` = load next level (wraps around)
  - `Space` = restart after sink (post-hole banner flow)
- Implemented post-hole banner showing Birdie/Par/Bogey label and prompt.

### Even later on 2025-08-10

- Realigned HUD to a single row across the top: left (Hole x/y), center (Par + Strokes), right (To Birdie + Speed).
- Added Pause menu overlay (P/Escape) showing player info, shortcuts, and version; HUD includes "To Birdie" helper.
- Applied retro visual palette and playfield framing:
  - Mustard table background, darker green fairway with subtle shading band and outline.
  - Light gray walls with outlines, darker hole rim.
 - Added terrain zones:
   - Water (blue): out-of-bounds with +1 stroke penalty and reset to pre-shot position.
   - Sand (tan): high-friction zones slow the ball significantly.
 - Tuned physics:
   - Removed duplicate damping; fairway base friction lowered; sand multiplier now 4.2x.
 - Decorations:
   - Added non-colliding flower border decorations; enabled on Level 1.
  - Level fixes:
    - Level 1: Flower borders repositioned to table area (outside playfield).
    - Level 2: Added doorway into inner box and moved cup inside; sand now reachable.
 - HUD/UI:
   - Added Replay button in top HUD with hover and click to restart current hole.
   - Optional hole title shown next to hole index when provided by level JSON.
