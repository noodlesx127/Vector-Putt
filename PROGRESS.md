  /**
   * This file tracks current focus, next steps, decisions, and done items. Keep it short and living.
   */

# Project Progress — Vector Putt

Updated: 2025-08-17 (local)

This file tracks current focus, next steps, decisions, and done items. Keep it short and living.

## Now (Current Focus)
- [x] Axis-aligned walls + deterministic reflections (angle in = angle out)
- [x] Minimal HUD (Hole x/y, Par n, Strokes m); increment strokes on release
- [x] Level JSON: tee, hole cup, rectangular walls; load at startup
- [x] Tune friction model (exponential damping) and stop epsilon
- [x] Post-Hole banner and simple “next hole” flow (single-hole for now)
- [x] Visual pass: retro palette, mustard table, inset fairway frame, light gray walls, subtle shading band
- [x] Terrain zones: water (penalty+reset), sand (higher friction), tuning pass (sand 4.2x)
- [x] Hills prototype: directional acceleration zones (visual gradient) per reference videos
- [x] Level 1: move flower decorations outside play area
- [x] Level 2: add doorway into inner box and move cup inside; reachable sand

## Next Up (Short Horizon)
- [x] HUD: optional hole title and Replay button
- [x] Auto-snap decorations to table when near outer walls
- [x] Prepare 1–2 additional prototype holes using the same JSON schema
  - [x] Level 6: diagonal-wall showcase using `wallsPoly` (crossed banks + wedge)
- [x] Tune hill strength and boundaries to match reference feel (added falloff; updated Level 3)
- [x] Course definition file and running total across course
 - [x] Course Summary overlay with per-hole list and total
 - [x] Final-hole UX: banner first, manual continue to Summary; robust click/N handling
 - [x] Faster level switch: cached level data + preloading next
 - [x] Main Menu with Start/Options and Course Select (Dev Levels)
 - [x] Pause menu improvements: Replay, Close, Back to Main Menu; version bottom-left
  - [x] Loading state on first launch into Dev Levels; prefetch level 2
  - [x] Changelog screen (scrollable) and Main Menu Changelog button
  - [x] Options in Pause menu; in-game volume controls with -/+/Mute and slider
  - [x] Water splash: multi-ring ripple visual
  - [x] Score visuals: color-coded sunk banner and summary deltas

- [ ] Level Editor & Browser
  - [ ] Editor selectable from Main Menu (launch editor mode)
  - [ ] Course Select: add "User Made Levels" category; list entries as Title — Author; load/play
  - [ ] Open/edit existing `levels/*.json` and create new levels (with schema validation)
  - [ ] Tool palette: Tee, Cup, Walls/WallsPoly, Posts, Bridges, Water/WaterPoly, Sand/SandPoly, Hills, decorations
  - [ ] Metadata editor: Level title and Author (persist in JSON)
  - [ ] Par/Birdie suggestion engine based on path analysis and bank heuristics

- [ ] User System
  - [ ] Local profiles: create/select active user; persist name and role (admin/user)
  - [ ] Roles & permissions: Admin can edit/delete any level; Normal users can edit/delete their own and duplicate others
  - [ ] Level ownership: store `meta.authorId`/`meta.authorName` in level JSON; enforce Save/Delete permissions; enable Save a Copy for non-owners
  - [ ] Scores by user: record per-level and per-course scores keyed by active user; show best for current user (optional all-users view)
  - [x] Main Menu: username input field placed above Start and below the graphic; Start disabled until a non-empty username is entered; persist/prefill last user

## Soon (After MVP Slice Works)
- [x] Water tiles: splash SFX → +1 stroke → reset to pre-shot location
  - [x] Visual ripple and SFX on water contact
- [x] Post-Hole banner with classic golf terms
  - [x] Basic label (Eagle/Birdie/Par/Bogey/Over) with color tint
  - [x] Extended mapping: Condor (-4), Albatross (-3), Eagle (-2), Birdie (-1), Par (0), Bogey (+1), Double Bogey (+2), Triple Bogey (+3); 4+ over shows numeric "n Over"
- [x] Bank-shot dev harness (dev-only path preview) — toggle with `B` (dev builds only)
- [x] Palette extraction to `docs/PALETTE.md`; applied flat fills + clear outlines for water/sand (rects: 1.5px inset; polys: 2px stroke)
 - [x] Options: basic SFX volume and mute controls

## Blockers / Open Questions
- [ ] Confirm hole capture radius vs. exact entry (measure from videos)
- [ ] Decide Tiled (TMX/JSON) vs. simple custom level JSON for MVP

## Decisions (Architecture / Approach)
- Stack: TypeScript + HTML5 Canvas, Vite, Web Audio API (custom), Vitest (per `TODO.md`)
- References: Treat the three YouTube videos as canonical for gameplay, level design, look & feel, UI/UX, physics

## Done
- [x] Create `TODO.md` with phase-structured checklist
- [x] Consolidate video findings into a single section
- [x] Record stack recommendation matching early-2000s simplicity
- [x] Scaffold project (TS + Vite + Canvas)
- [x] Fixed canvas 960×600 + letterbox (visual proportions closer to reference)
- [x] Aim–drag–release loop; friction; input lock while moving
 - [x] Polygon walls: rendering + collision via segment edges (diagonals/triangles)
- [x] Level design pass: adjusted `levels/level4.json`–`level6.json` for logical cup/obstacle placement; ensured `level8` polygon water renders visibly.

- [x] Dev-only bank-shot preview toggle fixed: robust dev detection (`isDevBuild()`), canvas focus during drag, broader dev key listeners; DEV watermark/badge and diagnostics for verification.

- [x] Main Menu: username input focus UX — blinking caret, placeholder hides during edit, I-beam cursor while editing; thicker focus border; input nudged down to avoid clipping.

- [x] HUD: show active user's name on the top-left; push `Hole x/y` label right to make room.

## Risks / Mitigations
- **Physics feel mismatch** → Add tunable config (friction, restitution, stop-epsilon, power curve)
- **Collision tunneling** → Implement wall tolerance and clamp max per-frame movement
- **Scope creep** → Keep Ramps/Boosters/Teleporters as post-MVP; focus on core loop

## Links
- `TODO.md`
- Reference videos:
  - Layout & Graphics: https://www.youtube.com/watch?v=Lp4iL9WKpV4
  - Hole-in-One Compilation: https://www.youtube.com/watch?v=4_I6pN-SNiQ
  - Full Playthrough: https://www.youtube.com/watch?v=kMB2YdKYy7c
 - Reference screenshots directory: `level_screenshots/` (captures from original game; use for ideas, layouts, and obstacle styles)
