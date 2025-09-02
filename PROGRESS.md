  /**
   * This file tracks current focus, next steps, decisions, and open questions. Keep it short and living. Completed items have been moved to `COMPLETED.md`.
   */

# Project Progress — Vector Putt

Updated: 2025-09-02 — Fixed Level Editor load failure: normalized list selection to use `chosen.value` from `showList()`, added robust fallback fetch (`loadLevel(id, userId)` then `loadLevel(id)`) and debug logs with `id`/`userId`/source in `src/editor/levelEditor.ts`.
Updated: 2025-09-02 — Dev Levels loading now uses Firebase only. Replaced static `/levels/*.json` paths with `startDevCourseFromFirebase()` and gated `scanFilesystemLevels()` behind `isDevBuild()` to prevent 404s in production. Updated `CHANGELOG.md`.
Updated: 2025-09-02 — Added one-time Levels Migration script `scripts/migrate-levels.js` and npm scripts `migrate:levels` / `migrate:levels:dry-run` to import JSON files from `levels/` into Firebase public dev levels.
Updated: 2025-09-02 — Removed automatic runtime level migrations from `src/firebase/index.ts`; migrations are now CLI-only via `scripts/migrate-levels.js`.
Updated: 2025-09-01 — Fixed User Made Levels delete bug: `src/main.ts` now deletes by Firebase level ID (key) instead of title. Added `id` to `UserLevelEntry` and mapped it from `FirebaseLevelStore.getAllLevels()`.
Updated: 2025-09-01 — Level Editor Save/Load bug fixed: editor now saves, loads, and deletes levels via Firebase (no browser file dialogs). Wired `src/editor/levelEditor.ts` to `FirebaseLevelStore` for persistence; Import/Export remain as explicit file ops.

Updated: 2025-08-31 (local) — Fixed level loading/rendering and ball disappearance by normalizing polygon property names (`sandsPoly`/`watersPoly` fallbacks to `sandPoly`/`waterPoly`) in `loadLevel()`, `applyLevelToGlobals()`, and `loadLevelFromData()`. Also previously: Level Editor TS fixes (closed missing brace in `handleMouseUp()` and added `renderWithRotation()`); Level Browser previews & quick-play; Editor grid snapping; Thumbnails naming fixes; HUD best score restored.

This file tracks current focus, next steps, decisions, and done items. Keep it short and living.

## Now (Current Focus)
As of 2025-08-25, focus these open items migrated from `TODO.md`:

- **Physics & Interactions**
  - [ ] Velocity affects terrain (e.g., hard shot may skim sand)
  
- **Level System**
  - [ ] Cup placement heuristics
    - [ ] Define constraints (min tee distance, not trivially straight, not hugging edges, inside intended region)
    - [ ] Path validation (grid/navmesh A* over fairway) to ensure non-trivial route with at least one corridor/bank
    - [ ] Editor assist: auto-suggest 3–5 candidate cup positions ranked by difficulty
    - [ ] Validator lint: flag cups bypassing intended obstacles
    [ ] Optional: slopes, moving blocks, boosters, tunnels

- **Level Editor & Browser**
  - [ ] Selection tools: duplicate; polygon vertex edit (polygons are translate-only currently)

## Next Up (Short Horizon)
- Seeded from `TODO.md` backlog:

- **Physics & Interactions (Phase 2 features)**
  - [ ] Ramps/Hills (beyond current prototype zones)
  - [ ] Moving obstacles (timed collisions)
  - [ ] Boosters/Accelerators (impulse)
  - [ ] Tunnels/Teleporters (enter/exit mapping)

- **Level System / Editor**
  - [ ] Dev/Admin-only Course Creator (in Editor → Editor Tools → "Course Creator")
    - [ ] Dedicated UI listing all levels with thumbnail and metadata (name, author, par)
    - [ ] Build "Bundled" courses or arbitrary series of levels that form a full Course
    - [ ] Create/edit courses: rename course, reorder levels, add/remove levels
    - [ ] Save flow asks for Course Name; upon save, add a new button in "Select Course" chooser
    - [ ] Manage courses: edit existing course(s) and delete course entirely
    - [ ] Visibility: only available to Dev/Admin profiles
    - [ ] Persist a course definition format compatible with runtime Course Select
  - [ ] Course Select: "Level of the Day" button that picks 1 level per day for best-score competition

## Editor & User System
All completed; see `COMPLETED.md` for the full list of milestones and details.

## Soon (After MVP Slice Works)
- [ ] Track upcoming MVP-adjacent tasks here (seed from `TODO.md`).

## Blockers / Open Questions
- [ ] Confirm hole capture radius vs. exact entry (measure from videos)
- [ ] Decide Tiled (TMX/JSON) vs. simple custom level JSON for MVP

## Decisions (Architecture / Approach)
- Stack: TypeScript + HTML5 Canvas, Vite, Web Audio API (custom), Vitest (per `TODO.md`)
- References: Treat the three YouTube videos as canonical for gameplay, level design, look & feel, UI/UX, physics
 - Level schema: Keep both rectangular and polygon variants for walls/water/sand as first-class. Do not migrate legacy levels. Update the Editor to support selection/move/delete for polygon variants; defer rotate/resize/vertex-edit to a later pass.

## Refactor Plan — Level Editor Module Split

 - Phase 1 (minimal risk, single module):
   - Create `src/editor/levelEditor.ts` and move editor-only code:
     - State: `editorLevelData`, selection (`selectedObjects`), `editorUiHotspots`, menu open state
     - Logic: `enterLevelEditor()`, `assembleEditorLevel()`, `saveEditorLevel*()`, `open*Picker()`, `newEditorLevel()`
     - Input: editor branches of `mousedown`/`mousemove`/`mouseup`, and keyboard handling
     - Selection helpers: `findObjectAtPoint()`, `getObjectBounds()`, `moveSelectedObjects()`, `clearSelection()`
     - Rendering: menubar + editor preview routines
   - Keep shared overlay helpers (`showUiToast`/`showUiConfirm`/etc.) in shared scope to avoid cycles.
   - In `src/main.ts`, route only when `gameState === 'levelEditor'` via a small API: `enterLevelEditor()`, `handleEditorMouseDown/Move/Up()`, `handleEditorKeyDown()`, `renderLevelEditor()`.
 - Phase 2 (optional split by concern):
   - `src/editor/types.ts` (editor types like `SelectableObject`)
   - `src/editor/select.ts` (hit-testing/selection/bounds)
   - `src/editor/render.ts` (menubar + preview)
   - `src/editor/persist.ts` (load/save/delete flows)
 - Guardrails:
   - No behavior changes; only relocation and imports
   - Avoid circular imports; gameplay stays in `main.ts`, editor depends on shared types/constants
   - Clear data boundaries: ensure `editorLevelData` updates reflect in preview
   - Docs updated post-refactor; run type-checks, build, tests; manual smoke (selection/move/delete incl. polys)

## Done
All completed milestones have been moved to `COMPLETED.md`.

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
