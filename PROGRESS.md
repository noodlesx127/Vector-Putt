  /**
   * This file tracks current focus, next steps, decisions, and done items. Keep it short and living.
   */

# Project Progress — Vector Putt

Updated: 2025-08-16 (local)

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
- [x] Tune hill strength and boundaries to match reference feel (added falloff; updated Level 3)
- [x] Course definition file and running total across course
 - [x] Course Summary overlay with per-hole list and total
 - [x] Final-hole UX: banner first, manual continue to Summary; robust click/N handling
 - [x] Faster level switch: cached level data + preloading next
 - [x] Main Menu with Start/Options and Course Select (Dev Levels)
 - [x] Pause menu improvements: Replay, Close, Back to Main Menu; version bottom-left
  - [x] Loading state on first launch into Dev Levels; prefetch level 2
  - [x] Changelog screen (scrollable) and Main Menu Changelog button

## Soon (After MVP Slice Works)
- [ ] Water tiles: splash SFX → +1 stroke → reset to pre-shot location
- [ ] Post-Hole banner with classic golf terms
- [ ] Bank-shot dev harness (dev-only path preview)
- [ ] Palette extraction to `docs/PALETTE.md`; apply flat colors + outlines
 - [x] Options: basic SFX volume and mute controls

## Blockers / Open Questions
- [ ] Finalize exact canvas resolution (800×600 vs. 1024×768) based on references
- [ ] Confirm hole capture radius vs. exact entry (measure from videos)
- [ ] Decide Tiled (TMX/JSON) vs. simple custom level JSON for MVP

## Decisions (Architecture / Approach)
- Stack: TypeScript + HTML5 Canvas, Vite, Howler.js, Vitest (per `TODO.md`)
- References: Treat the three YouTube videos as canonical for gameplay, level design, look & feel, UI/UX, physics

## Done
- [x] Create `TODO.md` with phase-structured checklist
- [x] Consolidate video findings into a single section
- [x] Record stack recommendation matching early-2000s simplicity
- [x] Scaffold project (TS + Vite + Canvas)
- [x] Fixed canvas 960×600 + letterbox (visual proportions closer to reference)
- [x] Aim–drag–release loop; friction; input lock while moving
 - [x] Polygon walls: rendering + collision via segment edges (diagonals/triangles)

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
