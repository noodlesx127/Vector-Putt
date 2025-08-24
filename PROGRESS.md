  /**
   * This file tracks current focus, next steps, decisions, and done items. Keep it short and living.
   */

# Project Progress — Vector Putt

Updated: 2025-08-24 (local) — Fixed Level Editor load bug: canvas dimensions now update when loading saved levels; CHANGELOG updated; build is clean. Version bumped to 0.3.24; package.json and APP_VERSION synced with CHANGELOG. Hotkey: changed Test Overlay from `T` to `Shift+T` to avoid typing conflicts. Clipboard: implemented and documented Copy/Cut/Paste for Level Editor.

This file tracks current focus, next steps, decisions, and done items. Keep it short and living.

## Now (Current Focus)
- [x] Firebase Realtime Database Migration (completed)
  - Complete migration from localStorage to Firebase Realtime Database
  - User management, level persistence, settings, and scores in Firebase
  - Real-time data synchronization across sessions and devices
  - Automatic migration from existing localStorage data
  - Firebase configuration with vector-putt project credentials
- [x] Course Select "User Made Levels" category (completed)
  - Listing: Title + Author from Firebase and localStorage, sorted by modified desc
  - Actions: Play; Edit/Delete only for owner/admin; confirm delete
  - Permissions: non-owners see disabled Edit/Delete with hint
  - Controls: Up/Down navigate, Enter Play, E Edit, Del Delete, Esc Back
  - No regressions to bundled Course Select
  - Integration: Seamless with Level Editor Firebase persistence
- [x] Editor: Polygon objects selectable/movable/deletable (`wallsPoly`/`waterPoly`/`sandPoly`)
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

- [ ]### Level Editor & Browser
- [x] **Level Editor UI**: Menubar with File/Objects/Editor Tools menus (2025-01-10)
- [x] **Level Editor Tool Palette**: Initial tool palette UI (render buttons, hover cursor, click-to-select) (2025-01-10)
- [x] **Level Editor Select Tool**: Moved Select tool from Objects to Editor Tools and renamed to 'Select Tool' (2025-01-10)
- [x] **Level Editor Migration**: Completed migration of all editor code from main.ts to modular levelEditor.ts structure (2025-01-10); configurable grid size
  - [x] Refactor: delegated all Level Editor keyboard handling from `src/main.ts` to `levelEditor.handleKeyDown(editorEnv)`; removed legacy unreachable code referencing old globals in `main.ts`.
  - [x] Follow-up: run TypeScript check and do a manual smoke test of editor shortcuts, grid +/-/toggle, menu mnemonics, and Delete/nudge behaviors. (2025-08-22)
  - [x] Main Menu: add "Level Editor" entry to launch editor mode
  - [x] Multi-level persistence: Save, Save As, Load, New, Delete using `localStorage` key `vp.levels.v1`; track current saved ID for overwrite semantics
  - [x] Preview rendering: fairway panel + outline, grid overlay, Tee/Cup markers
  - [x] Permissions: owner/admin-only overwrite and delete; non-owners are alerted and routed to "Save As"
  - [x] Migration: migrate legacy single-slot (`vp.editor.level`) into `vp.levels.v1` on first entry to the editor
  - [x] CRUD UI wiring: action buttons are part of `editorUiHotspots` and handled in Level Editor `mousedown`; hotspots rebuilt each frame
  - [x] Menu UI layering: draw menu panel/buttons last so they render above the grid; add semi-transparent panel background and border for readability
  - [x] Toolbar refactor: compact horizontal top toolbar (tools row + actions row incl. Back on right); hover/click unified via `editorUiHotspots`; editor preview renders beneath toolbar
  - [x] Editor preview: render existing geometry (water, sand, bridges, hills, decorations, walls, polygon walls, posts) using play-mode visuals
  - [x] Interactive placement: Posts (click); Walls/Bridges/Water/Sand/Hills (click-drag rectangles) with grid snapping, fairway clamping, and minimum drag threshold; crosshair cursor and drag state until mouseup
  - [x] Drag outline preview while dragging rectangle tools (grid-snapped, clamped to fairway bounds)
  - Level Editor UI Selections Audit (2025-08-19 local)
    - Tools working: Tee, Cup, Post, Wall, Bridge, Water, Sand, Hill (rectangles), Select Tool
    - Tools present but not yet implemented: WallsPoly, WaterPoly, SandPoly (no placement/vertex-edit UI)
    - Actions working: Grid toggle, Grid -/+, Back/Exit, New, Save, Save As, Level Load, Delete — Back/Exit via in-game overlay confirm; Save/Save As/Load currently use temporary prompt-based UI for naming/selection (to be replaced with overlay dialogs)
    - Back/Exit fix: File menu Back/Exit now prompts for confirmation and returns to Main Menu; Escape key path uses the same confirm-and-exit flow and is blocked while overlays/menus are open
    - Persistence: Filesystem integration complete - File System Access API for User_Levels/<Username>/ directories, Export/Import for browser-only builds, bundled levels/ loading, localStorage fallback for compatibility
      - Gaps:
        - [x] Polygon tools: implemented create/vertex-edit UI with click-to-add-vertex, Enter/Escape to finish/cancel, click-near-start to close (2025-08-22)
        - [x] Hill direction control: implemented direction picker UI with N/S/E/W arrows (2025-08-22)
        - [x] Post radius control: implemented radius picker UI with 6/8/10/12/16/20 options (2025-08-22)
      - Rotation: implemented for rectangular items with 15° snapping; shadow duplication fixed by removing legacy non-rotated shadows
      - Group rotation: multi-select rotates about the group bounds center; hold Shift to snap to 15°; snapshot original states at rotation start for accurate transforms
      - Polygon guards: polygons (wallsPoly/waterPoly/sandPoly) are translate-only; rotation/resize disabled; rotation handles hidden when any polygons are selected
      - Visual/UX: selection bounds cached each frame; multi-select bounds follow drag offset while moving; rotation state cleared on commit
      - Diagnosis resolved: Included polygon variants in `findObjectAtPoint()` and `getObjectBounds()`; `moveSelectedObjects()` now translates polygon `points`; Delete key removes from poly arrays and `editorLevelData`; removed duplicate/incorrect implementations.
      - Consistency: Defined local `COLORS` and `SelectableObject` in `src/editor/levelEditor.ts` and standardized naming to `wallsPoly` in `getObjectBounds()`.
      - Code refs (`src/main.ts`): `saveEditorLevel()`, `saveEditorLevelAs()`, `openLoadPicker()`, `openDeletePicker()`, `newEditorLevel()`, `assembleEditorLevel()`, Level Editor `mousedown`/`mousemove`/`mouseup`
  - [x] Editor UI: Menubar with pull-down menus (replace compact toolbar)
    - File menu: New, Save, Save As, Level Load, Delete, Back/Exit
    - Objects menu: Tee, Cup, Post, Wall, WallsPoly, Bridge, Water, WaterPoly, Sand, SandPoly, Hill
    - Decorations menu: Flowers
    - Editor Tools menu: Select Tool, Grid -, Grid +, Grid On/Off
    - Hotspots & rendering: build dropdowns into `editorUiHotspots`; manage open/close state, hover, and click routing; keyboard navigation for menus/items
    - Layout: top menubar with pull-down panels; render above preview; ensure readability and spacing; maintain current preview layering
    - Shortcuts: preserve existing shortcuts (G, -, +); mnemonics (Alt+F/O/D/E) and arrow navigation
    - Docs: update `PROGRESS.md` and `CHANGELOG.md` upon implementing
    - Tests: hover/click open-close behavior; action dispatch correctness
  - [x] Menubar tweak: move 'Select' tool from Objects to 'Editor Tools' menu and rename label to 'Select Tool' in code/UI
  - [x] Select Tool implementation:
    - Hit-testing and object bounds detection for all level objects (tee, cup, posts, walls, water, sand, bridges, decorations, hills)
    - Single-click selection with visual bounding outlines and handles
    - Multi-select with Ctrl/Shift + click to add/remove from selection
    - Selection box drag to select multiple objects within rectangular area
    - Move selected objects with mouse drag (grid-snapped, bounds-clamped)
    - Arrow key movement for selected objects (respects grid size)
    - Delete key to remove selected objects (preserves tee/cup as required elements)
    - 8-point resize handles for rectangular objects (walls, water, sand, bridges, hills)
    - Grid-snapped resize with minimum size constraints and fairway bounds clamping
    - 4-point rotation handles for rectangular objects with 15-degree angle snapping
    - Visual feedback: blue dashed outlines, blue resize handles, orange rotation handles, selection box with translucent fill
    - Cursor changes: appropriate resize cursors (nw-resize, e-resize, etc.), move cursor, and crosshair for rotation
  - [x] Select Tool: move, resize, and rotate items (MS Paint/Photoshop-style); multi-select with bounding outline
    - Drag inside selection to move; 8 corner/side handles to resize; rotate via rotation handles around object/group bounds; bounding outline drawn around selection
    - Grid snapping and fairway-bounds clamping on move/resize/rotate; min size = 1 grid step; no negative sizes
    - Applies to rect items (walls/bridges/water/sand/hills); Posts: resize radius; Tee/Cup: move-only; multi-select transforms apply to all selected; rotation restricted to rect-like items; polygons translate-only and hide rotation handles when included in selection
  - [x] Undo/Redo in Level Editor: toolbar buttons and shortcuts (Ctrl+Z/Ctrl+Y); snapshot editor state on placements and actions (Save/Load/New/Delete)
    - Placement: Editor Tools menu with dynamic labels showing availability
    - Shortcuts: Ctrl+Z (Undo), Ctrl+Y (Redo), Shift+Ctrl+Z (alternative Redo)
    - State management: 50-step undo stack with automatic snapshots on all placement, deletion, movement, resize, and rotation operations
    - UI feedback: toast messages showing undo/redo descriptions; menu labels update dynamically
  - [ ] Clipboard: Copy/Cut/Paste selected objects in Level Editor
    - Shortcuts: Ctrl+C (Copy), Ctrl+X (Cut), Ctrl+V (Paste)
    - Supports: rects (walls/water/sand/bridges/hills), posts (radius preserved), polygons (translate-only)
    - Paste behavior: place at mouse cursor with grid snapping and fairway clamping; maintain relative offsets for group selections
    - Cross-level: allow pasting into another level within the same editor session
  - [ ] Import: Proper Import flow to complement Export
    - UI: in-game overlay with file picker and list (supports multi-select); clear source labels [FS]/[User]
    - Validation: full schema validation with readable error reporting; automatic fix-ups where safe
    - Metadata: set/confirm authorName/authorId and lastModified; title prompt with conflict resolution (rename/overwrite/cancel)
    - Sources: filesystem (File System Access API) and browser builds (file upload)
  - [ ] Course Select: add "User Made Levels" category; list Title — Author; Play; owner/admin Edit/Delete; permissions gating; no regression
  - [x] Level Editor file system integration:
    - [x] Load any level from existing `levels/*.json` directory for editing
    - [x] Save levels to filesystem via File System Access API or download fallback
    - [x] User_Levels/<Username>/ directory structure with automatic subdirectory creation
    - [x] Export functionality for browser-only builds (download JSON)
    - [x] Import level from file upload when no saved levels found
    - [x] Combined level picker showing [bundled], [user], [localStorage] source labels
    - [x] Level validation and automatic metadata (author, lastModified) on save/export
    - [x] Combined level listing: shows both localStorage and filesystem levels with [LS]/[FS] labels
    - [x] Directory structure: `User_Levels/Username/Level.json` option for user-created levels
    - [x] Load existing `levels/*.json` files for editing and re-saving
    - [x] Schema validation on load/save operations with detailed error reporting
    - [x] Fixed "No saved levels found" by scanning both localStorage and filesystem levels
    - [x] Three save options: LocalStorage, Filesystem (direct), User Directory (User_Levels/Username/)
    - [x] Filesystem cache with invalidation for performance
    - [x] Comprehensive level schema validation (canvas, tee, cup, walls, posts, arrays, etc.)
  - [x] Replace browser dialogs with in-game UI (menus/popups) for a smoother experience
    - Completed: Level Editor (Save, Save As, Load, New, Delete) and Users Admin UI now use in-game overlays (`showUiToast`, `showUiConfirm`, `showUiPrompt`, `showUiList`), fully async with keyboard (Enter/Esc/Arrows)
    - Removed LocalStorage option from Save As; only Filesystem and `User_Levels/<Username>/` supported per policy
    - All previous `alert()/prompt()/confirm()` call sites in `src/main.ts` migrated to overlays
    - Rendering integration: Overlays and toasts are now drawn at the end of `draw()` so they appear above all UI layers; `overlayHotspots` rebuilt each frame while overlays are active; overlay mouse clicks are swallowed to prevent click-through; toasts render as a top-right stack with auto-expire.
    - Fix: Added inline `renderGlobalOverlays()` calls in `draw()` for `course`, `options`, and `changelog` states (previously returned early), so overlays render on these screens too.
  - [ ] Tool palette: Tee, Cup, Walls/WallsPoly, Posts, Bridges, Water/WaterPoly, Sand/SandPoly, Hills, decorations (full authoring behaviors)
  - [ ] Metadata editor: Level title and Author (persist in JSON)
  - [ ] Par/Birdie suggestion engine based on path analysis and bank heuristics

- [ ] User System
  - [x] Local profiles: create/select active user; persist name and role (admin/user)
  - [ ] Roles & permissions: Admin can edit/delete any level; Normal users can edit/delete their own and duplicate others
    - [x] Verify current enforcement across Save/Delete flows and any editor entry points
    - [ ] Add clear UI messaging when an action is blocked due to permissions
    - [x] Add unit tests for permission rules (UsersStore invariants: last-admin safeguards, enable/disable, promote/demote, import/export, init fallbacks)
  - [x] Admin-only role management UI (no toggle on Main Menu)
    - Access: Press Shift+F after clicking Start (from Select Course and onward). Options button removed.
    - Admin-only Role Management UI:
      - Add/Remove Users
      - Promote/Demote Users (toggle role user ⇄ admin)
      - Safeguards: cannot remove the last remaining admin; confirm destructive actions; prevent self-demotion when last admin.
    - Default Admin bootstrap (first run): seed a built-in `admin` account with role `admin` so an admin can create another user and promote them. After another admin exists, the built-in `admin` can be disabled.
    - Persistence: JSON-backed store for users and roles
      - Source of truth file: `data/users.json` (editable outside the game UI).
      - Browser build: read `data/users.json` at load; persist runtime changes to `localStorage`; provide Import/Export JSON in Admin Menu.
      - Desktop build (future): write changes directly to `data/users.json`.
      - No passwords/auth yet (MVP): "login" = selecting an existing user as active profile.
    - [optional] Better UI feedback: Replace alert/prompt/confirm with inline messages/snackbar for a smoother admin experience.
  - [x] Level ownership: store `meta.authorId`/`meta.authorName` in level JSON; enforce Save/Delete permissions; enable Save a Copy for non-owners
  - [x] Scores by user: record per-level and per-course scores keyed by active user; show best for current user (optional all-users view)
  - [x] Main Menu: username input field placed above Start and below the graphic; Start disabled until a non-empty username is entered; persist/prefill last user
  - [x] Start is blocked when the entered username matches a disabled user (disabled users cannot proceed past Main Menu)
  - [x] Disabled-user hint under username input (“User is disabled. Ask an admin to re-enable or select a new name.”)

## Soon (After MVP Slice Works)
- [x] Water tiles: splash SFX → +1 stroke → reset to pre-shot location
  - [x] Visual ripple and SFX on water contact
- [x] Post-Hole banner with classic golf terms
  - [x] Basic label (Eagle/Birdie/Par/Bogey/Over) with color tint
  - [x] Extended mapping: Condor (-4), Albatross (-3), Eagle (-2), Birdie (-1), Par (0), Bogey (+1), Double Bogey (+2), Triple Bogey (+3); 4+ over shows numeric "n Over"
- [x] Bank-shot dev harness (dev-only path preview) — toggle with `B` (dev builds only)
- [x] Palette extraction to `docs/PALETTE.md`; applied flat fills + clear outlines for water/sand (rects: 1.5px inset; polys: 2px stroke)
 - [x] Options: basic SFX volume and mute controls
- [x] **2025-08-24**: Fixed cross-browser level access issue by implementing automatic level migration when user ID changes during Firebase synchronization

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
- [x] Fix: Resolved TypeScript errors in `src/main.ts` — verified `loadLevel`, `loadLevelByIndex`, `preloadLevelByIndex` implementations near file end; added explicit `unknown` type to a caught error parameter to satisfy strict TS.
  - [x] Closed missing closing brace in `draw()` (TS1005 `'}` expected` at EOF); `npx tsc --noEmit` is clean.
- [x] Fix: Converted `scripts/cleanup-db.js` to ESM `import` to match `package.json` ("type": "module"). This resolves the Node v22 `require()` error when running `npm run cleanup:db`.
- [x] Fix: Updated all Firebase TypeScript modules with `.js` extensions for Node.js ESM compatibility; created store instances in `index.ts`; fixed import/export conflicts.
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

- [x] User System: removed Main Menu role toggle; roles will be managed by Admin-only controls (upcoming). Role still persists to localStorage for permissions.

- [x] User System: level ownership metadata (authorId/authorName) added to Level schema; per-user score tracking with best scores shown in HUD.

- [x] Docs: CHANGELOG structure restored (Unreleased on top); version 0.3.23 recorded

- [x] Fix (2025-08-24): Level Editor loading did not apply saved canvas dimensions. Updated `loadEditorLevelIntoGlobals()` in `src/editor/levelEditor.ts` to set `levelCanvas.width/height` from level data. Verified via build; recorded in `CHANGELOG.md`.

- [x] Fix: TypeScript config — removed invalid `"vitest/globals"` type from `tsconfig.json` to clear IDE TS error; tests import Vitest APIs directly. Optionally restore typings later via `"types": ["vitest"]` after installing deps.

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
