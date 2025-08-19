  /**
   * This file tracks current focus, next steps, decisions, and done items. Keep it short and living.
   */

# Project Progress — Vector Putt

 Updated: 2025-08-19 (local) — Next: Option A selected — Course Select "User Made Levels" category; planning and criteria captured below

This file tracks current focus, next steps, decisions, and done items. Keep it short and living.

## Now (Current Focus)
- [ ] Option A: Course Select "User Made Levels" category (in progress)
  - Listing: Title + Author from localStorage `vp.levels.v1`, sorted by modified desc
  - Actions: Play; Edit/Delete only for owner/admin; confirm delete
  - Permissions: non-owners see disabled Edit/Delete with hint
  - Controls: Up/Down navigate, Enter Play, E Edit, Del Delete, Esc Back
  - No regressions to bundled Course Select
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
  - [x] Editor selectable from Main Menu (launch editor mode) — placeholder screen with Back
  - [x] Tool palette UI (initial): render tool buttons, hover pointer, click to select (`selectedEditorTool`)
  - [x] Tee & Cup placement: 20px grid snapping and nudge controls (arrow keys); configurable grid size
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
    - Tools present but not yet implemented: WallsPoly, WaterPoly, SandPoly (no placement/edit UI)
    - Actions working: Grid toggle, Grid -/+, Back/Exit
    - Actions not working: New, Save, Save As, Level Load, Delete (functions called but dialogs blocked/failing)
    - Architecture issue: Level Editor only uses localStorage, cannot access actual `levels/` directory files
    - Gaps:
      - Polygon tools: render-only if present in data; no create/vertex-edit UI
      - Hill direction control: missing; Post radius is fixed
      - Rotation handles: resize implemented but rotation not yet implemented
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
  - [ ] Select Tool: move, resize, and rotate items (MS Paint/Photoshop-style); multi-select with bounding outline
    - Drag inside selection to move; 8 corner/side handles to resize; rotate via corner handles/outer arc; bounding outline drawn around selection
    - Grid snapping and fairway-bounds clamping on move/resize; min size = 1 grid step; no negative sizes
    - Applies to rect items (walls/bridges/water/sand/hills); Posts: resize radius; Tee/Cup: move-only; multi-select transforms apply to all selected
  - [ ] Undo/Redo in Level Editor: toolbar buttons and shortcuts (Ctrl+Z/Ctrl+Y); snapshot editor state on placements and actions (Save/Load/New/Delete)
    - Placement: Main toolbar, immediately next to the Editor Tools section
    - Size: small icon buttons (compact footprint)
    - Icons: conventional Undo/Redo arrow icons consistent with common editors
    - Shortcuts: Ctrl+Z (Undo), Ctrl+Y (Redo); consider Shift+Ctrl+Z alternative on some platforms
  - [ ] Course Select: add "User Made Levels" category; list Title — Author; Play; owner/admin Edit/Delete; permissions gating; no regression
  - [ ] Level Editor file system integration:
    - Dev mode/Admin: load any level from existing `levels/Courses/Level.json` diretory for editing
    - Save levels to actual file system instead of localStorage only
    - Policy: Never use localStorage for level persistence. In non-dev sessions and/or when an admin is editing, only filesystem-backed storage is allowed. For browser-only builds, provide Import/Export, but do not persist levels to localStorage.
    - Directory structure: `User_Levels/Username/Level.json` for user-created levels
    - Load existing `levels/*.json` files for editing and re-saving
    - Schema validation on load/save operations
    - Current issue: "No saved levels found" because only checking localStorage, not actual level files
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

## Blockers / Open Questions
- [ ] Confirm hole capture radius vs. exact entry (measure from videos)
- [ ] Decide Tiled (TMX/JSON) vs. simple custom level JSON for MVP

## Decisions (Architecture / Approach)
- Stack: TypeScript + HTML5 Canvas, Vite, Web Audio API (custom), Vitest (per `TODO.md`)
- References: Treat the three YouTube videos as canonical for gameplay, level design, look & feel, UI/UX, physics

## Done
- [x] Fix: Resolved TypeScript errors in `src/main.ts` — verified `loadLevel`, `loadLevelByIndex`, `preloadLevelByIndex` implementations near file end; added explicit `unknown` type to a caught error parameter to satisfy strict TS.
  - [x] Closed missing closing brace in `draw()` (TS1005 `'}` expected` at EOF); `npx tsc --noEmit` is clean.
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
