# Changelog

All notable changes to this project will be documented in this file.

## 2025-08-10

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
