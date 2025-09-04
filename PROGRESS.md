  /**
   * This file tracks current focus, next steps, decisions, and open questions. Keep it short and living. Completed items have been moved to `COMPLETED.md`. Always follow the format of this file.
   */

# Project Progress — Vector Putt


This file tracks current focus, next steps, decisions, and done items. Keep it short and living.

## Now (Current Focus)
As of 2025-08-25, focus these open items migrated from `TODO.md`:

- **Physics & Interactions**
  - [ ] Velocity affects terrain (e.g., hard shot may skim sand)
 
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
   - Tasks:
     - [ ] Refresh User Levels UI to match `UI_Design.md` (colors, borders, title, buttons)
     - [ ] Refresh Options screen to centered 800x600 panel with standard controls/buttons
     - [ ] Refresh Users admin screen to panelized layout and standard button styles
     - [ ] Refresh Changelog screen to use standard panel, header, and scrollbar visuals
     - [ ] Audit Main Menu input/buttons for style parity (borders, fills, fonts)
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
  - [ ] Course Creator: finalize remaining pieces
    - [ ] Tests for `FirebaseCourseStore` and overlay logic
    - [ ] Drag-and-drop reordering in overlay (optional)
    - [ ] Course Select: load/play courses from Firebase `courses`
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
