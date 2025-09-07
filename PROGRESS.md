  /**
   * This file tracks current focus, next steps, decisions, and open questions. Keep it short and living. Completed items have been moved to `COMPLETED.md`. Always follow the format of this file.
   */

# Project Progress — Vector Putt


This file tracks current focus, next steps, decisions, and done items. Keep it short and living.

## Now (Current Focus)
As of 2025-09-03, focus these open items migrated from `TODO.md`:

- **Physics & Interactions**
  - [ ] Velocity affects terrain (e.g., hard shot may skim sand)
  - [x] Tuning: Sand slows more and hills push harder — increased sand friction multiplier from 4.2× to 6.0× of `frictionK`, and increased hill base acceleration `SLOPE_ACCEL` from 520 to 720 px/s². (`src/main.ts`)
  - [x] Admin Game Settings (runtime): Added admin-only Game Settings panel under Admin Menu to tune global physics (Hill Accel, Ball Friction K, Sand Multiplier) on the fly; values persist in Firebase `/gameSettings`. Applied at startup and on Save. (`src/main.ts`, `src/firebase/database.ts`)
  - [x] Better hill direction visibility (add clear visual indicators of slope direction/strength in play and editor)
    - Implemented subtle arrow overlays inside hill regions indicating downhill direction; density and alpha scale with `strength`. Applied in both play render and editor preview. (`src/main.ts`, `src/editor/levelEditor.ts`)
  - [x] Change hitting the ball mechanic from pulling back to pulling forward
    - Updated shot input so dragging forward shoots forward (was pull-back to shoot). Updated aim arrow and dev debug preview to match. (`src/main.ts`)
  - Optional polish — Hills/Shot UX:
    - [ ] Add an Options toggle (or Admin Game Settings) to show/hide slope arrows during play
    - [ ] Colorize slope arrows subtly to match palette (e.g., faint green per `UI_Design.md`)
    - [ ] Scale arrow size or edge emphasis using hill `falloff` to better convey flow intensity
 
 - **Course Creator — Follow-ups**
   - [x] Unit tests for `src/firebase/FirebaseCourseStore.ts`
   - [x] Overlay flow edge cases and error handling
     - [x] Fix: fully swallow keyboard events while modal overlays are active (stopPropagation in `handleOverlayKey()`, plus capture-phase keyup/keypress listeners). Underlying UI no longer reacts during modals.
   - [x] Usability polish: drag-and-drop reordering implemented in Course Creator overlay
   - [x] Course Editor UI redesign: single-screen layout with levels listed in the center for easy inline reorder/add/remove. Mirror the provided screenshot: central editable rows for levels, controls for Rename Course, Add Level, Remove Level, Delete Course, and bottom-aligned Save/Cancel.
   - [x] Fix: duplicate `getUserId` property in `editorEnv` object literal in `src/main.ts` removed (kept shorthand reference); TypeScript lint/build clean.
   - [x] Course Creator UI parity with Edit Course UI (800x600 panel, scrollable list, keyboard + mouse, bottom action buttons)
   - [x] Level Editor integration: `openCourseCreator()` now uses new overlay via `EditorEnv.showUiCourseCreator()`; Cancel returns to the editor
   - [x] Rendering/TS cleanup: guarded `item.data` when rendering list items in `src/main.ts` (strict null checks)
   - [x] Course Editor drag-and-drop: Added missing level reordering with drag state, visual feedback, and proper array manipulation
   - [x] Course Select UI redesign: Redesigned to match Course Editor visual design (centered panel, scrollable list, mouse wheel support)
   - [x] Course Select integration: Firebase course loading, Course Creator button for admins, User Made Levels separation
   - [x] Firebase course playback fixes: Level progression, UI display, optimized loading
  - [ ] Test pass: end-to-end Course Creator UI interactions (mouse/keyboard, scrolling, buttons, cancel)
  
 - **UI Consistency — Refresh to match `UI_Design.md`**
  - Findings: Recent panels (Course Select, Course Editor/Creator overlays) adhere to the new centered 800x600 panel style with `rgba(0,0,0,0.85)` backgrounds and `#cfd2cf` borders. The following screens diverge and need refresh:
    - User Made Levels (`gameState === 'userLevels'` in `src/main.ts`): currently uses `rgba(20,30,40,0.95)` and blue accent borders; align to standard panel background, border, typography, and button styles.
    - Options (`gameState === 'options'`): classic freeform screen; convert to centered 800x600 panel with standard header, controls layout, and Back button styling.
    - Users admin (`gameState === 'users'`): freeform cards and buttons; convert to panelized layout with standard button fills/borders and header.
    - Changelog (`gameState === 'changelog'`): dimmed background with ad-hoc content area; migrate to standard centered panel with header and consistent scrollbar visuals.
    - Main Menu: inputs and buttons mostly aligned, but audit borders/fills/hover to ensure parity with standard button spec.
  - New Requirement: User Made Levels browser and Course Select should mirror the Users Admin panel layout:
    - Left panel: scrollable list of levels/courses.
    - Right panel: large preview thumbnail/screenshot and metadata (Title, Author, Creator, Date Created, Last Edited, Description, etc.).
    - Maintain standard panel, header, borders (`#cfd2cf`), and button styles.
  - Tasks:
     - [x] Refresh User Levels UI to match `UI_Design.md` (colors, borders, title, buttons). Implemented standard centered 800x600 panel with responsive fallback, background rgba(0,0,0,0.85), border #cfd2cf. (`src/main.ts`)
     - [x] Refresh Options screen to centered 800x600 panel with standard header, controls layout, and Back button styling. Implemented dark overlay, responsive panel sizing, background rgba(0,0,0,0.85), border #cfd2cf; reflowed Controls/Audio sections within panel. (`src/main.ts`)
     - [x] Refresh Users admin screen to panelized layout and standard button styles; added search, scroll, and keyboard support. (`src/main.ts`)
     - [x] Refresh Changelog screen to use standard panel, header, and scrollbar visuals. (`src/main.ts`)
     - [x] Audit Main Menu input/buttons for style parity (borders, fills, fonts). Updated default fill to rgba(255,255,255,0.10), hover rgba(255,255,255,0.15), borders #cfd2cf, and aligned username input styling. (`src/main.ts`)
    - [x] Redesign User Made Levels to Users-like left-list/right-preview layout with metadata panel and thumbnail preview; added Play/Edit/Duplicate/Delete actions on the right pane. (`src/main.ts`)
    - [x] Redesign Course Select to Users-like left-list/right-preview layout with metadata pane and Play Course action on the right pane. (`src/main.ts`)
     - Level Editor — Menus & Dialogs (must follow standard panel/button styles and typography; see `UI_Design.md`):
       - Findings: Menubar and dialogs exist but styling/spacing varies from standard panel spec. Ensure 800x600 overlay panels for modal flows, consistent header, borders `#cfd2cf`, background `rgba(0,0,0,0.85)`, padding/margins, and button hover states.
       - Tasks:
         - [ ] File menu parity: New, Load, Save, Save As, Delete, Back/Exit — confirm labels, ordering, and keyboard shortcuts
         - [ ] Load Level dialog: standard panel layout with scrollable list, search/filter, confirm/cancel buttons
         - [ ] Save flow: inline Save feedback (toast) and error handling per overlay guidelines
         - [ ] Save As dialog: name input, validation messages, confirm/cancel, consistent spacing
         - [ ] Metadata editor dialog: Title and Author fields with validation and standard form styling
         - [ ] Suggest Par overlay: description text and action buttons styled to spec
         - [ ] Delete confirmation dialog: warning color accents, explicit level name, confirm/cancel alignment
  
- **Level System**
  - [x] Suggest Par: integrate grid/A* path-based heuristic
    - Implemented coarse grid build over fairway, 8-connected A* with octile heuristic, terrain costs (sand higher), diagonal corner-cut prevention, turns and sand penalties, and hill complexity bump. Falls back to distance/obstacles if no path. Wired to File → Suggest Par with a detailed confirm message. (`src/editor/levelHeuristics.ts`, `src/editor/levelEditor.ts`)
  - [ ] Cup placement heuristics
    - [x] Path validation (A* over fairway) reused from `levelHeuristics` grid
    - [x] Editor assist: auto-suggest 3–5 candidate cup positions ranked by difficulty
      - Menu: File → "Suggest Cup Positions"; renders numbered markers you can click to apply. Press Esc to cancel overlay.
      - Constraints (initial): min distance from tee (25% of max axis), avoid edges (≥ 2× grid), reject trivial straight paths (length ≥ 1.06× straight-line), optional min turns.
    - [x] Define additional constraints (inside intended region mask, corridor/bank scoring) and tune ranking
      - Implemented optional `regionPoly` constraint and added corridor/bank scoring via blocked-neighbor weighting during path traversal in `src/editor/levelHeuristics.ts::suggestCupPositions()`. Bank weight is tunable; editor currently uses a sensible default tied to grid size.
    - [x] Validator lint: flag cups bypassing intended obstacles
      - Added `lintCupPath()` in `src/editor/levelHeuristics.ts` and integrated into the editor flow so after choosing a suggested cup, up to two warnings are surfaced via toasts if the path is nearly straight and avoids obstacles or the cup is too close to edges. (`src/editor/levelEditor.ts`)
    [ ] Optional: slopes, moving blocks, boosters, tunnels
  
  Recommended next steps
  - [ ] Visual Path Preview overlay
    - Temporary toggle to render the computed A* path, turns, and terrain cells (sand/hill) in the editor after Suggest Par. Helps tune and validate heuristics quickly.
  - [ ] Coefficient tuning via Admin/Game Settings
    - Expose D baseline (px per stroke), sand multiplier, turn penalty, and hill bump as adjustable settings to calibrate par estimates on sample levels.
  - [ ] Cup position suggestions integration
    - Wire `suggestCupPositions()` from `src/editor/levelHeuristics.ts` to propose 3–5 non-destructive candidate cup pins, enforce constraints, and rank by difficulty.
  - [ ] Unit tests for heuristic sanity
    - Add tests to ensure suggested par increases with obstacle density/path length and that removal of blockers lowers par accordingly.

- **Level Editor & Browser**
  - [ ] Selection tools: duplicate; polygon vertex edit (polygons are translate-only currently)
  - [x] Posts: Snapping Does not work the same as the rest of the editor. IE doesnt work the same as walls, ect.
    - Implemented radius-aware edge-aligned snapping so post edges line up with grid lines like wall edges. Applied on initial placement, on drag-move finalize, and when changing radius in the picker. Keeps clamping to fairway bounds. (`src/editor/levelEditor.ts`)
  - [x] Grid toggle in Tools menu not working; removed grid size +/- controls
    - Fixed `Grid Toggle` action to call `env.setShowGrid(!env.getShowGrid())` and sync local `showGrid`. Removed `Grid -` and `Grid +` menu items and their keyboard shortcuts. (`src/editor/levelEditor.ts`)
  - [x] Hill Direction Picker: support diagonals NE/NW/SE/SW in addition to N/S/E/W; clickable markers and rendering updated. (`src/editor/levelEditor.ts`)

## Next Up (Short Horizon)
- Seeded from `TODO.md` backlog:

- **Physics & Interactions (Phase 2 features)**
  - [x] Hills: bidirectional push — hills now apply constant downhill acceleration so going uphill resists and slows the ball; going downhill accelerates as expected. (`src/main.ts`)
  - [x] Bridges over sand: sand friction disabled when ball is on a bridge; underlying sand no longer affects speed on bridge surface. (`src/main.ts`)
  - [x] Hills visual arrows: render as an overlay above geometry and add dark outline + white pass for strong contrast, matching editor display. (`src/main.ts`)
  - [ ] Ramps/Hills (beyond current prototype zones)
  - [ ] Moving obstacles (timed collisions)
  - [ ] Boosters/Accelerators (impulse)
  - [ ] Tunnels/Teleporters (enter/exit mapping)

- **Level System / Editor**
  - [ ] Course Creator: finalize remaining pieces
    - [ ] Tests for `FirebaseCourseStore` and overlay logic
    - [ ] Drag-and-drop reordering in overlay (optional)
    - [ ] Course Select: load/play courses from Firebase `courses`
  - [ ] Course Select: "Level of the Day" button that picks 1 level per day for best-score competition

## Audit — Firebase.md Compliance (2025-09-05)

Findings vs `firebase.md` (Schema Version 1.0):

- __Public/User levels pathing__: Compliant. Public dev levels are stored under `levels/` with `isPublic: true`; user levels under `userLevels/{userId}/`.
- __Timestamps__: Partially compliant. All Firebase entities use Unix timestamps (`createdAt`, `lastModified`). Level editor metadata currently uses ISO strings (`meta.created`, `meta.modified`) but also sets `meta.lastModified` in some cases.
- __Author fields__: Partially compliant. We persist `authorId` correctly. `authorName` may be missing/`Unknown` on user saves because the editor doesn’t supply it.
- __LevelData shape__: Partially compliant. Editor uses polygon `points: number[]` and posts with `r`. `src/firebase/FirebaseLevelStore.ts` types still reflect an older `{ points: {x,y}[] }` shape in its local `Level` interface; runtime saves the editor’s actual shape, so types are inconsistent.
- __Validation before save__: Partially compliant. Editor calls `applyLevelDataFixups()` before save, but does not run `validateLevelData()` to enforce constraints (bounds, positive par, non-negative sizes) per guidance.
- __Course schema__: Compliant. `courses` use `title`, `levelIds[]`, `createdAt`, `lastModified`, `isPublic`.
- __Scores__: Mostly compliant. We store `{ userId, levelId, strokes, timestamp }`. Guidance suggests standardized `levelId` formats (e.g., `dev:{levelId}`, `course:{courseId}:{index}`); current code accepts arbitrary strings without enforcing format.
- __Settings__: Compliant with `userId`, `volume`, `muted`, optional `lastUsername`.

Actions taken in this pass:

- __Fix: Safe updates for levels__ (`src/firebase/FirebaseLevelStore.ts`): avoid overwriting `createdAt`, `isPublic`, or `authorId` when updating existing levels; only update mutable fields (`title`, `data`, optional `authorName`). Lets `FirebaseDatabase.updateLevel()` stamp `lastModified`.
- __Fix: Correct path detection on update__ (`src/firebase/database.ts`): `updateLevel()` now detects whether a level lives under `levels/` (public) or `userLevels/{userId}/` (private) and updates the correct path. Addresses admin edits to dev levels not persisting.
 - __Fix: Course Editor reorder save__: `openCourseCreator()` now uses the `courseData` returned by the overlay on Save, ensuring reordered `levelIds` persist. Added debug logs around the save call ("CourseEditor: Saving course" and "CourseEditor: Save complete...") to verify the path. (`src/editor/levelEditor.ts`)

Planned follow-ups (to fully align with `firebase.md`):

- [x] __Editor metadata timestamps__: On save/saveAs, set `level.meta.lastModified = Date.now()` in addition to ISO `created/modified`. Implemented in `src/editor/levelEditor.ts` (`save()` and `saveAs()`).
- [x] __Author name on user saves__: Populate `level.meta.authorName` using the active username (fallback to `userId`). Implemented in `src/editor/levelEditor.ts` (`saveAs()`; also filled on `save()` if missing).
- [x] __Run schema validation before save__: Call `validateLevelData(level)` and abort with a toast if invalid. Implemented in `src/editor/levelEditor.ts` for both `save()` and `saveAs()`.
- [x] __Unify LevelData types__: Updated `src/firebase/FirebaseLevelStore.ts` local `Level` interface to match the canonical editor `LevelData` (polygons use `number[]` points; posts use `r`; rects use `rot`; include `course`, `par`, and `meta` timestamps).
- [x] __Score levelId formats__: Verified existing gameplay paths use standardized IDs (`dev:*` for dev, `course:{courseId}:{index}` for Firebase courses), and legacy `/levels/*.json` is supported per guidance. No code changes required.
 - [x] __Author name propagation__: New levels and saves now populate `meta.authorName` from `EditorEnv.getUserName()` (trimmed) with fallback to `getUserId()`. Implemented in `src/editor/levelEditor.ts` (`newLevel()`, `save()`, `saveAs()`) and wired via `getUserName()` in all editor env constructions in `src/main.ts`.
 - [x] __Metadata editor enhancements__: `File → Metadata` now edits Title, Author Name, and Par (1–20). It updates `meta.modified` and `meta.lastModified`, persists immediately by calling `save()`, and reflects changes in lists. Implemented in `src/editor/levelEditor.ts::editMetadata()`.

- [x] __Automatic clamping fixups__: Added clamping and defaults in `src/editor/filesystem.ts::applyLevelDataFixups()`:
  - Clamp tee/cup, rect-like objects, posts, and polygon points into canvas bounds; default tee/cup radii.
  - Clamp canvas to 400–1920 x 300–1080; ensure `par` is 1–20 integer.
  - Hills: enforce valid `dir`, clamp `strength`/`falloff` to 0–1 with sensible defaults.
- [x] __Editor env getUserName()__: Wired `getUserName()` into all editor environment constructions in `src/main.ts` so the editor can propagate a friendly `authorName` (fallback to `getUserId()` if absent).
- [x] __Extended validation rules__: Strengthened `validateLevelData()` in `src/editor/filesystem.ts` to include geometry count limits, polygon point count caps, and an overall serialized size check (<= 1MB) with actionable error messages.

Notes:

- These changes are incremental and maintain backward compatibility with existing data. No destructive migrations are required.

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
