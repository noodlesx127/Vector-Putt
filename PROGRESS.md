# Project Progress — Vector Putt

This file tracks current focus, next steps, decisions, and planned work. Completed/Changed/Fixes are recorded in `CHANGELOG.md`.

## Current Focus (2025-09-24)
- UI consistency and editor info surfaces (Info Bar + Help overlay)
- Play Area Visual Refresh (render-only plan)
- Leaderboards (levels and courses) planning and wiring

## Cross‑cutting — Obstacles Integration Policy (2025-09-22)

- When introducing any new obstacle type, it must be:
  - Added to the Level Editor as a placeable/selectable object (render, hit‑test, transform, save/load).
  - Incorporated into Suggest Par and cup heuristics (A* grid build, directional costs if applicable, lint rules) so estimates and suggestions remain accurate.

- Level System — Editor/Browser (2025-09-22)
  - [x] Editor: Cup lint indicator near the flag to warn on invalid/too‑easy placements; throttled recompute. (`src/editor/levelEditor.ts`)
  - [x] Editor: Level Load picker now uses the richer Load Levels overlay (search/filter list with details) when available. (`src/editor/levelEditor.ts`, `src/main.ts`)
  - [x] TODO alignment: marked Cup placement heuristics subtasks and alignment helpers as completed; ruler guide lines checked. (`TODO.md`)

- Main Menu — Quick Play (Plan, 2025-09-22)
  - Decision: Quick Play lives on the Main Menu.
  - Behavior: Opens the Load Levels overlay in non‑editor browsing mode with Quick Play enabled.
  - UI: Same filters/search and right‑pane thumbnail/metadata as the Editor’s Load overlay.
  - Flow: Does not enter the editor; loads the selected level transiently for immediate play (no persistence changes).
  - Next: Implement the Main Menu button and route it to `showUiLoadLevels()` with Quick Play visible. (`src/main.ts`)

- Suggest Par Heuristics — Improvements (2025-09-21)
  - [x] Account for hills direction and strength in pathfinding by encoding a hill vector field and penalizing uphill segments while easing downhill.
  - [x] Treat bridges as pass-through over blocked cells (e.g., water/wall) for the path estimate.
  - [x] Count sand explicitly via a sand flag to avoid double counting with hill base costs.
  - [x] Apply hill difficulty bump only when the path crosses hill cells, scaled by coverage.
  - [x] Added unit tests covering hill direction effects and bridge pass-through. (`src/__tests__/LevelHeuristics.test.ts`)

## Plans & Epics

## Suggest Par — Hybrid Branching (2025-09-24)

- [x] Posts as blockers in grid with safety clearance
  - Grid build (`buildGrid()` in `src/editor/levelHeuristics.ts`) treats posts as circular blockers with a small clearance radius so A* paths cannot pass through posts.
- [x] K-branch candidate generation (`suggestParK()`)
  - Compute an initial best path, then generate alternates by banning sampled cells (and pairs) and queueing the resulting paths up to a configurable depth.
  - Added `pathOverlapFraction()` plus per-path `cellSet` bookkeeping to skip near-duplicate routes; retain the lower-strokes option when overlap is high.
  - Rank candidates by estimated strokes (physics-aware distance, sand/turn/bank penalties, hill bump) with path length as secondary sort.
  - Exported `CandidatePath` now carries cell metadata (`cellKeys`, `cellSet`) for overlap analysis and future UI use.
- [x] Editor UI integration (hybrid selection + summary panel)
  - `File → Suggest Par` invokes `suggestParK()` (K=4) and renders colored candidate routes on canvas, clipped to the fairway.
  - Added `renderParCandidatesSummary()` in `src/editor/levelEditor.ts` to draw a top-right popup listing each route number, color, strokes, and suggested par.
  - Ambiguity policy: if top routes have equal par or near-equal strokes, prompt via `EditorEnv.showList()` while keeping overlay active; otherwise confirm best route with summary visible.
  - Interactions: click near a colored route or press `1..K` to select; Esc dismisses overlay. Visual Path Preview (`P`) remains available but is hidden while the multi-route overlay is active.

Notes
- Coefficients wired from Admin → Game Settings: Baseline Shot px, Turn Penalty, Hill Bump, Bank Weight, Friction K, Sand Multiplier.
- Candidate ranking uses the same cost model to ensure consistency with runtime tuning.

## Play Area Visual Refresh — Plan (2025-09-22)

Goal: preserve the recognizable retro look while making the playfield more readable and polished. All changes are render-only and fully backward compatible with existing level JSON and Firebase data — no schema or physics changes.

 - Highlights
  - Seam-free terrains: implemented stroke-first-then-fill for water/sand; for polygons, two-pass (stroke all, then fill all). Eliminates seams where like terrains touch.
  - Walls refresh: implemented bevel-joined rim strokes (source-over), plus top/left highlight and soft shadow accents; physics edges unchanged.
  - Hills readability: implemented cleaner arrows (dark outline + white stroke) with sparse spacing; respects View → "Slope Arrows".
  - Cup/ball/bridge polish: implemented inner cup radial shading, subtle ball highlight + shadow, and bridge cast shadow.
  - Canonical render order: will be validated/refined; current order respects terrains before walls and post-polish layers.

 - Canonical render order (target)
  1) Table background → 2) Fairway base + bands → 3) Water/Sand strokes → 4) Water/Sand fills → 5) Walls/Posts fills → 6) Wall/Post strokes + highlights/shadows → 7) Bridges → 8) Hills gradient + arrows → 9) Tee/Cup (rim last) → 10) Ball → 11) UI overlays.

- Acceptance
  - No visible seams between adjacent like terrains at 1×/2× zoom.
  - Wall chains look continuous at joints/chamfers.
  - Hill direction obvious at a glance; arrows legible but subtle.
  - Performance unaffected; keep 60 FPS target.

- Manual QA checklist (tests deferred)
  - Load `levels/level1.json`, `levels/level4.json`, and `User_Levels/demo/Crossing.json`; inspect water/sand seams at 1 and 2 zoom.
  - Traverse wall loops in `levels/level2.json`; verify beveled rim continuity and absence of dark joints.
  - Toggle View  `Slope Arrows` in both runtime and editor hills demo; ensure arrows remain legible without clutter.
  - Enable FPS overlay while running 
unCourse('devCourse'); confirm steady 60 FPS after render updates.
  - Capture before/after screenshots for `levels/level5.json` to document visual delta for stakeholders.


 - Status
  - Implemented in runtime (`src/main.ts`) and editor preview (`src/editor/levelEditor.ts`):
    - Stroke-first-then-fill terrains (rect + poly two-pass) for seam-free edges
    - Bevel-joined wall/post rims, highlights/shadows
    - Runtime wall/post shadows inset to keep rim strokes crisp and match editor lighting parity (`src/main.ts`)
    - Hill arrows redesign with outline + white stroke
    - Cup shading, ball highlight, bridge shadow
    - Optional faint water ripple overlay for large bodies (runtime and editor)
  - Canonical render order implemented across runtime and editor: walls/posts before bridges and hills; editor decorations moved before walls to match runtime. Editor gained View → "Slope Arrows" toggle; arrows skip rendering under walls/posts/water.
  - Docs updated: `Design_Doc.md`, `docs/PALETTE.md`, and `TODO.md` aligned with stroke-first terrains and canonical order.
  - Admin → Game Settings: added Ball Friction (K) control; added Defaults and Previous buttons with confirmation prompts for safe revert.

 - Next
  - Visual snapshot tests (adjacent terrain seams, long wall chains, hills both directions) — deferred for now per request.
  - QA pass on bundled and user levels for back-compat; capture before/after screenshots.

# Leaderboards — Plan (2025-09-22)

- Scope
  - Level leaderboards: best strokes (tie-break by time, optional) per single level.
  - Course leaderboards: best total strokes (tie-break by time, optional) per full course.
  - Automatic board creation: when a user creates a new level or an admin creates a new course, the corresponding leaderboard is initialized.

- Data Model (see `firebase.md` for schema)
  - Levels: `/leaderboards/levels/{levelId}/entries/{userId}` → `{ userId, username, bestStrokes, bestTimeMs?, attempts, lastUpdated }`
  - Courses: `/leaderboards/courses/{courseId}/entries/{userId}` → `{ userId, username, bestTotalStrokes, bestTimeMs?, attempts, lastUpdated }`
  - Settings (admin): `/leaderboards/settings` → `{ resetsEnabled, retentionDays, visibility, allowTies, maxEntriesPerBoard }`

- Admin Settings (Admin Menu → Leaderboards)
  - Reset per-level/per-course/all boards (soft delete/archival option)
  - Retention days and max entries pruning
  - Visibility controls (public/friends/private) and tie behavior

- Integration
  - On hole complete: upsert per-level entry if improved
  - On course complete: upsert per-course entry if improved
  - Offline-safe queue and retry; debounce writes
  - Editor: on Save/New, ensure `/leaderboards/levels/{levelId}` exists; Course Creator ensures `/leaderboards/courses/{courseId}` exists

- Next Steps
  - Implement `FirebaseLeaderboardStore` (CRUD + settings)
  - Wire runtime update hooks and small UI surfaces (Post-Hole, Course Summary, Level Browser/Course Select)
  - Add Admin Menu overlay for Leaderboard settings and resets (role-gated)




- **Physics & Interactions**

  
 - **UI Consistency — Refresh to match `UI_Design.md`**
  - Findings: Recent panels (Course Select, Course Editor/Creator overlays) adhere to the new centered 800x600 panel style with `rgba(0,0,0,0.85)` backgrounds and `#cfd2cf` borders. The following screens diverge and need refresh:
    - User Made Levels (`gameState === 'userLevels'` in `src/main.ts`): currently uses `rgba(20,30,40,0.95)` and blue accent borders; align to standard panel background, border, typography, and button styles.
    - Options (`gameState === 'options'`): classic freeform screen; convert to centered 800x600 panel with standard header, controls layout, and Back button styling.
    - Users admin (`gameState === 'users'`): freeform cards and buttons; convert to panelized layout with standard button fills/borders and header.
    - Changelog (`gameState === 'changelog'`): dimmed background with ad-hoc content area; migrate to standard centered panel with header and consistent scrollbar visuals.
    - Main Menu: inputs and buttons mostly aligned, but audit borders/fills/hover to ensure parity with standard button spec.
    - Main Play Area (in-game UI): align HUD overlays, text, and controls to `UI_Design.md` (typography/colors), and ensure any in-game dialogs/overlays follow the standard panel style.
    - Pause / Esc Menu: convert to a standard 800×600 overlay panel with dim backdrop, header, and standard button styles per `UI_Design.md`.
  - New Requirement: User Made Levels browser and Course Select should mirror the Users Admin panel layout:
    - Left panel: scrollable list of levels/courses.
    - Right panel: large preview thumbnail/screenshot and metadata (Title, Author, Creator, Date Created, Last Edited, Description, etc.).
    - Maintain standard panel, header, borders (`#cfd2cf`), and button styles.

  - Audit update (2025-09-21):
    - [x] Course Select — unified list scrollbar track border and row/preview borders to `#cfd2cf`; confirmed panel background `rgba(0,0,0,0.85)` and border width `1.5`. (`src/main.ts`)
    - [x] User Made Levels — backdrop opacity updated to `rgba(0,0,0,0.85)`; right-pane thumbnail frame switched to `#cfd2cf`. (`src/main.ts`)
    - [x] Admin overlays (Edit Course / Course Creator) — panel border width standardized to `1.5`; list scrollbar track border and list row borders switched to `#cfd2cf`. (`src/main.ts`)
    - [ ] Overlay dialogs — remaining button borders that use semantic colors (e.g., disabled gray `#666`, danger red, action blue/green/orange) intentionally kept. If desired, we can also standardize disabled button borders to a lighter neutral per `UI_Design.md`.
    - [ ] Annotate Screenshot overlay — tool palette item borders still use `#666`; consider switching non-semantic outlines to `#cfd2cf` and ensuring line width `1.5`. (`src/main.ts` near tool palette rendering)
    - [ ] Thumbnail placeholders — some placeholder frames still use `#666`; we can convert remaining non-semantic frames to `#cfd2cf` for full parity.
  - Tasks:
     - [x] Refresh User Levels UI to match `UI_Design.md` (colors, borders, title, buttons). Implemented standard centered 800x600 panel with responsive fallback, background rgba(0,0,0,0.85), border #cfd2cf. (`src/main.ts`)
     - [x] Refresh Options screen to centered 800x600 panel with standard header, controls layout, and Back button styling. Implemented dark overlay, responsive panel sizing, background rgba(0,0,0,0.85), border #cfd2cf; reflowed Controls/Audio sections within panel. (`src/main.ts`)
     - [x] Refresh Users admin screen to panelized layout and standard button styles; added search, scroll, and keyboard support. (`src/main.ts`)
     - [x] Refresh Changelog screen to use standard panel, header, and scrollbar visuals. (`src/main.ts`)
     - [x] Audit Main Menu input/buttons for style parity (borders, fills, fonts). Updated default fill to rgba(255,255,255,0.10), hover rgba(255,255,255,0.15), borders #cfd2cf, and aligned username input styling. (`src/main.ts`)
    - [x] Redesign User Made Levels to Users-like left-list/right-preview layout with metadata panel and thumbnail preview; added Play/Edit/Duplicate/Delete actions on the right pane. (`src/main.ts`)
    - [x] Redesign Course Select to Users-like left-list/right-preview layout with metadata pane and Play Course action on the right pane. (`src/main.ts`)
    - [x] Main Play Area — HUD refresh to standardized strip with border and white text per `UI_Design.md`. (`src/main.ts`)
    - [x] Pause / Esc Menu — redesigned to centered 800×600 panel with dim backdrop, panel border `#cfd2cf`, and standardized button styles/positions. (`src/main.ts`)
     - Level Editor — Menus & Dialogs (must follow standard panel/button styles and typography; see `UI_Design.md`):
       - Findings: Menubar and dialogs exist but styling/spacing varies from standard panel spec. Ensure 800x600 overlay panels for modal flows, consistent header, borders `#cfd2cf`, background `rgba(0,0,0,0.85)`, padding/margins, and button hover states.
       - Tasks:
         - [x] File menu parity: New, Load, Save, Save As, Delete, Back/Exit — labels, ordering, and shortcuts verified. (`src/editor/levelEditor.ts` EDITOR_MENUS)
         - [x] Load Level dialog: standard panel layout with scrollable list, filters, confirm/cancel buttons
          - Uses standard 800×600 panel, blue-themed background/border, centered title, 40px row height, and 28px buttons per `UI_Design.md`. (`src/main.ts`)
          - Active/inactive filter styling aligned to design.
          - Added search box (title/author) with keyboard focus and inline hint; hover visuals for filters, rows, and Load/Cancel. (`src/main.ts`)
         - [x] Save flow: inline Save feedback (toasts) and clear error handling; prompt primary button shows “Save” when context is Save/Save As/Metadata. (`src/main.ts`)
         - [x] Save As dialog: title input with validation (non-empty, ≤120 chars), consistent spacing, Save/Cancel buttons. (`src/editor/levelEditor.ts`)
         - [x] Metadata editor dialog: Title/Author validation and panel form styling; persists immediately via Save. (`src/main.ts`, `src/editor/levelEditor.ts`)
         - [x] Suggest Par overlay: description text and actions use standard confirm panel styling. (`src/main.ts`)
         - [x] Delete confirmation dialog: danger styling (red OK labeled “Delete”), explicit level name, confirm/cancel alignment. (`src/main.ts`)
  - UI Consistency — Audit findings (2025-09-14)
    - Users Admin (`gameState === 'users'` in `src/main.ts`)
      - [x] Right-pane action buttons hover states (Promote/Demote, Enable/Disable, Delete) with standard hover fill and border
      - [x] List row hover brighten (selection remains blue-highlighted)
      - [x] Search box focused typing with inline input and caret; Enter/Esc blurs; Backspace edits; printable keys append. (`src/main.ts`)
    - Admin Menu (`gameState === 'adminMenu'`)
      - [x] Hover highlight for large menu buttons (Level Management, User Management, Game Settings)
      - [x] Align title font size to 28px to match other panels (was bold 32px)
    - Level Management (Admin) (`gameState === 'levelManagement'`)
      - [x] Hover states for list rows and Delete buttons
      - [x] Unify list panel border color to `#cfd2cf` (was `#666`)
    - Course Select (`gameState === 'course'`)
      - [x] Unify Back button styling to standard border color `#cfd2cf` and add hover
      - [x] Add hover states for bottom-row buttons (User Made Levels, Course Creator, Back)
      - [x] Add hover state for right-pane “Play Course” button
    - User Made Levels (`gameState === 'userLevels'`)
      - [x] List row hover visuals (selection remains blue-highlighted)
      - [x] Ensure search/filter bar hover/focus parity with Load Levels overlay (placeholder, hover/focus stroke, opacity) — matches `loadLevels` overlay styling.
    - Overlays — DnD List (`uiOverlay.kind === 'dndList'`)
      - [x] Add grabbed row dashed outline and insertion end caps during drag; hover visuals already present.
    - Global polish
      - [x] Sweep to ensure all panel borders use consistent stroke width (1.5) and color `#cfd2cf` (Main Menu, Admin Menu, Users, Options, Course Select, Changelog, User Levels)
      - [x] Verify all primary/secondary buttons follow the standard sizes (28–32px) with hover fills per `UI_Design.md`
        - Normalized Back and secondary buttons to 32px where previously 36/40 (Admin Menu, Level Management, Users, User Levels). Kept large 36px only for primary CTAs (e.g., Main Menu Start). Course Select “Play Course” set to 32px. Overlays remain within 28–32px standard.

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
    [ ] Optional: slopes, boosters, tunnels
  
  Recommended next steps
  - [x] Visual Path Preview overlay
    - Implemented an editor overlay that renders the A* path as a polyline with per-node markers (sand = sand color, hill = white), and X marks at turns. Automatically computed after File → Suggest Par; press `P` to toggle visibility. (`src/editor/levelHeuristics.ts::computePathDebug()`, `src/editor/levelEditor.ts`)
  - [x] Coefficient tuning via Admin/Game Settings
    - Implemented new sliders under Admin → Game Settings for Baseline Shot (px), Turn Penalty, Hill Bump, and Bank Weight (alongside existing Slope Accel, Friction K, Sand Multiplier). Values persist to Firebase via `FirebaseDatabase.getGameSettings()/updateGameSettings()`. Editor `Suggest Par` consumes these coefficients from `env.getGlobalState()` when calling `estimatePar()`. (`src/main.ts`, `src/firebase/database.ts` `FirebaseGameSettings`, `src/editor/levelEditor.ts`)
  - [x] Cup position suggestions integration
    - Wired `suggestCupPositions()` (File → "Suggest Cup Positions") to propose 3–5 ranked candidate cup pins. Clicking a marker clamps and applies the cup, runs `lintCupPath()` for quick warnings, then computes a Par suggestion using the admin-tuned coefficients (Baseline Shot, Turn Penalty, Hill Bump, Bank Weight, Friction K, Sand Multiplier) and offers to apply it. Markers clear on apply/cancel. (`src/editor/levelHeuristics.ts`, `src/editor/levelEditor.ts`)

  - **Alignment Aids — Plan**
    - [x] Smart Alignment Guides (drag-move/resize/vertex drag/polygon drafting)
      - Snap to nearby object edges and centers (left/center/right, top/middle/bottom) within ~6px; show cyan guide lines and spacing labels; Alt disables guides; Ctrl forces grid-only snap. Implemented in `handleMouseMove()` and rendered in `renderLevelEditor()` using transient `liveGuides` and `liveGuideBubbles`. Applied to drag-move, single/group resize, vertex drag, and polygon drafting (preview + clicks). Includes snapping to persistent ruler guides.
    - [ ] Rulers (top/left) with tick marks and cursor indicators
      - View toggle “Rulers”. Draw after background and before content overlays; minor=20px, mid=50px, major=100px; labels at majors (coordinate readout); live cursor line.
      - [in progress] Ruler strips render with refined tick density/labels and typography; further polish to match UI_Design.md exactly.
    - [x] Measure Tool
      - Tools → “Measure Tool”: click-drag to measure length/angle (Δx/Δy); snaps to grid/vertices/edges; ESC cancels; Enter pins; double-click clears.
      - [x] Ruler-drag live guides: drag out guides from rulers (top/left). Guides persist and render; snapping includes these guides; double-click the ruler band clears guides for that axis.
    - [x] Polygon Drafting alignment
      - Preview segment and placed vertices snap to alignment guides (in addition to 45° and poly vertex/edge snapping). Axis value bubble shown near cursor; spacing bubble shown when snapped. Click placements (first and subsequent points) now match the preview snap. (`src/editor/levelEditor.ts`)
    - [x] Axis lock for drag-move
      - Implemented: Shift while dragging constrains movement to dominant axis; mirrors polygon tool modifiers.
    - [x] Align/Distribute commands (multi-select)
      - Edit → Align Left/Right/Top/Bottom/Center (H/V) and Distribute spacing (H/V) implemented. Uses object bounds centers/edges and even spacing across selection span; dynamic enablement based on selection size. (`src/editor/levelEditor.ts`)
    - [x] Numeric readout on drafting
      - Implemented: Segment length and angle shown near the preview segment midpoint in a subtle pill.
      - [x] Guide Details UX: numeric alignment labels moved to a stacked area at the top‑left inside the fairway so they never overlap the object being placed; added View → “Guide Details” toggle to show/hide these labels. (`src/editor/levelEditor.ts`)
    - [x] Ruler guide lines
      - Implemented: drag out guides from rulers (top/left). Guides persist and render; snapping includes these guides; double-click the ruler band clears guides for that axis.
    - [x] Grid compliance
      - When grid is enabled, alignment snap results and guide line positions are quantized to the grid; ruler‑dragged guides snap to grid during drag and on finalize; rulers adjust tick spacing to the grid and the ruler cursor crosshair snaps to grid. (`src/editor/levelEditor.ts`)

## Overlay Screenshot — Plan (2025-09-20)

A tracing aid for the Level Editor that lets you place a level screenshot over the editor grid (light‑table style) and trace geometry with existing tools.

- **Menu placement**
  - Editor Tools → `Overlay Screenshot…` (choose/replace image, opens options panel on first add)
  - View → `Overlay Screenshot` (options group)

- **Core capabilities**
  - Turn Overlay On/Off at any time (toggle in View → Overlay Screenshot)
  - Opacity control (0–100% slider; fine‑grained +/-)
  - Move/Resize/Rotate the overlay to fit the fairway bounds; preserve aspect ratio by default

- **View → Overlay Screenshot options**
  - Show Overlay [toggle]
  - Opacity [slider 0–100%] (Hotkeys: `[` / `]` ±5%, Shift+`[` / `]` ±10%)
  - Transform Mode: Move / Resize / Rotate; handles on corners/edges; preserve aspect [toggle]
  - Fit / Reset: Fit to Fairway, Fit to Canvas, Reset Transform
  - Lock Overlay (prevents transform changes)
  - Snap to Grid [toggle]; Arrow keys nudge (1 grid unit); Shift=10 units; Ctrl forces 1px nudge when grid is off
  - Z‑Order: Below Geometry (default) / Above Geometry; “Through‑click” [toggle] to pass clicks to editor tools when above
  - Calibrate Scale…: click two points on the overlay and enter distance (grid units) to auto‑scale
  - Flip H / Flip V
  - Optional: Auto‑fade overlay slightly while dragging objects (“x‑ray while dragging”) [toggle]

- **Persistence & scope**
  - Overlay image and its transform are editor‑only and NOT saved to level JSON or Firebase. They reset on reload unless we later add an editor‑session persistence. Excluded from exports, thumbnails, physics, and selection.

- **Performance**
  - Large images are auto‑downscaled/cached (e.g., max dimension ~2048px) to keep UI smooth. Reuse existing overlay rendering pass and input swallowing already integrated in `src/main.ts`.

- **Keyboard**
  - Arrow keys: nudge; Shift=10×; Ctrl=1px when grid off
  - `=` / `-`: scale ±2%; Shift for ±5%
  - `,` / `.`: rotate ±1°; Shift for ±15°
  - Quick toggle via View menu; consider `Alt+O` (TBD to avoid conflicts)

- **UI/UX**
  - Options panel follows `UI_Design.md` (standard 800×600 overlay panel, header, buttons). Cursor/handles match transform affordances used elsewhere. Grid remains visible; Z‑order option controls whether the overlay sits above/below geometry.

- **Tasks**
  - [x] Editor Tools: add `Overlay Screenshot…` action and file picker; store image as an editor session asset
  - [ ] View menu: add `Overlay Screenshot` group — Show/Hide, Opacity slider, Lock, Snap to Grid, Z‑Order (Above/Below), Fit to Fairway, Fit to Canvas, Reset Transform, Calibrate Scale, Flip H/V
    - Phase 1: implemented Show/Hide, Opacity +/- (hotkeys `[`/`]`), Z‑Order (Above/Below), Lock, Snap to Grid, Fit to Fairway, Reset Transform, and Transform Mode → Move.
    - Phase 2: added Fit to Canvas, Preserve Aspect toggle, Flip H/V, Through‑click (when Above), Calibrate Scale…, and Transform Modes → Resize/Rotate.
  - [x] Implement overlay transform handles and keyboard nudge; preserve aspect by default; grid snapping when enabled (`src/editor/levelEditor.ts`)
    - Phase 1: keyboard nudges (Arrows, Shift multiplier), scale (`=`/`-`), rotate (`,`/`.`); handles pending.
    - Phase 2: on‑canvas transform handles implemented — Move via drag inside, Resize via corners and edges (axis constraints; aspect lock option), Rotate via top‑mid rotation handle with Shift=15° snap.
  - [x] Input routing: when Above and Through‑click is off, overlay consumes input; otherwise pass to editor tools; ensure overlays swallow events consistently (`src/main.ts`)
    - Implemented: overlay swallows clicks when Above + Through‑click is OFF; allows interactions with overlay handles/move.
  - [x] Exclude overlay from all saves/exports/thumbnails and gameplay; keep as editor‑session state only
  - [ ] Tests: transform math and hit‑testing; menu enable/disable; performance with large images

Progress (2025-09-20):
- Implemented Phase 1 of Overlay Screenshot in the editor preview (`src/editor/levelEditor.ts`): session state (image + transform), Tools → Overlay Screenshot… file picker, View options (Show/Hide, Opacity +/-, Z‑Order Above/Below, Lock, Snap to Grid, Fit to Fairway, Reset Transform, Transform Mode → Move), render pass below or above geometry, and keyboard controls for opacity/nudge/scale/rotate.

Phase 2 (2025-09-20):
- Added View actions: Fit to Canvas, Preserve Aspect, Flip Horizontal/Vertical, Through‑click (when Above), Calibrate Scale…, and Transform Modes → Resize/Rotate.
- Implemented overlay interactions:
  - Drag‑move inside overlay (Move mode), grid‑snap aware.
  - Resize from all corners and edges with axis constraints and optional Preserve Aspect.
  - Rotate from top‑mid rotation handle with Shift=15° snap.
- ## Level Editor — Bottom Info Toolbar (Plan, 2025-09-21)

Goal: Replace or relocate floating, in-canvas info bubbles (e.g., during `wallsPoly` drafting) with a persistent bottom information toolbar so hints, measurements, and tool details are visible without obstructing drawing.

- Rationale
  - Floating bubbles (e.g., segment length/angle and "Enter: Close, Esc: Cancel") can block geometry while authoring walls, especially near the cursor.
  - A bottom toolbar provides a consistent location for tool details, similar to other editors.

- Placement & Style (per `UI_Design.md`)
  - Anchored to the bottom of the Level Editor canvas area; spans editor width; height ~32–40px.
  - Background `rgba(0,0,0,0.85)`, border `#cfd2cf`, stroke 1.5; text `#ffffff`.
  - Left: tool name/icon and live metrics. Right: context actions/shortcuts.

- Content by Tool (examples)
  - WallsPoly/WaterPoly/SandPoly: `L=xx.x px  θ=xx.x°` • Vertices: N • Snap: Grid/Guides indicators • Actions: Enter=Close, Esc=Cancel, Backspace=Undo, Shift=Angle Snap, Ctrl=Grid‑only, Alt=Disable Guides.
  - Measure Tool: `Δx, Δy, L, θ` with same action hints (Esc cancel, Enter pin).
  - Select/Transform: selection count, bounds W×H, rotation, and nudge size; hints for Shift=axis lock, Alt=disable guides, Ctrl=grid‑only.
  - Posts/Rect tools: position W×H or center (x,y), radius, snap state.

- Behavior
  - When toolbar is ON, suppress obstructive in‑canvas info bubbles for affected tools.
  - Provide a View toggle: `Tool Info Bar` (default ON). Persist setting in editor session.
  - Responsive: wraps or elides long content; keep minimum 12px side padding; never overlaps menus.

- Additional Requirements (2025-09-21)
  - Info Tool Bar should surface comprehensive information for all Level Editor tools: contextual help, key shortcuts, guide details, and any relevant dynamic metrics for the active tool.
  - New top-level menu: Help — opens a window (same style as Pause/Options) that lists all keyboard shortcuts and a short description for each tool and editor capability, including lesser-known features.

- Tasks
  - [x] Add editor state flag and View menu toggle: `Tool Info Bar` (default ON). (`src/editor/levelEditor.ts`)
  - [x] Render toolbar in `renderLevelEditor()`; anchored bottom; theme per `UI_Design.md`. (`src/editor/levelEditor.ts`)
  - [x] Feed dynamic content for polygon drafting (length/angle/vertex count, snap state) and Measure tool (Δx/Δy/L/θ); basic Select info (count and W×H).
  - [x] Suppress obstructive in‑canvas info bubbles for polygon drafting and measure when toolbar is ON.
  - [x] Extend content for additional tools (posts, rect tools, hills, tee/cup, decorations) in `renderToolInfoBar()`.
  - [ ] QA: Verify no overlap with menus/overlays; responsive elision; test small screens.
  - [ ] Update `CHANGELOG.md` with screenshots of the toolbar in use.

  - [x] Add Help menu and initial overlay window (Keyboard Shortcuts & Tool Guide) using existing overlay list UI; wire action in Level Editor. (`src/editor/levelEditor.ts`, `src/main.ts` adapters already support `showList`)

Notes: This addresses the workflow friction shown in the screenshot where `wallsPoly` bubbles sit over the drafting line.

Implementation (2025-09-21):
- Implemented `showToolInfoBar` state (default ON) with View → `Tool Info Bar` toggle and dynamic label. Toolbar renders at the bottom with background `rgba(0,0,0,0.85)`, border `#cfd2cf` at 1.5, left metrics and right action hints. In‑canvas hint/readout bubbles for polygon drafting and measure are suppressed when the bar is ON. Ordering: overlay image/handles → tool info bar → menubar so the bar is always visible.

Help Menu (2025-09-21):
- Added top-level `Help` menu with “Keyboard Shortcuts & Tool Guide…” entry that opens an overlay listing global shortcuts and per‑tool hints. Implemented via `EditorEnv.showList()` using the existing overlay window system (same styling family as Pause/Options). Initial content covers Selection, Grid/Rulers/Guides, Polygons, Measure, Posts, Rect Tools, Overlay Screenshot, and the Tool Info Bar.

Refactor (2025-09-21):
- Overlay Screenshot tools simplified — removed dedicated Overlay Transform Modes (Move/Resize/Rotate) and their menu items.
  - The Select Tool now controls the overlay like any other object when it is unlocked:
  - Single‑selecting the overlay shows its own resize/rotate handles (when no menu is open). Drag inside to move.
  - Arrow keys nudge selection uniformly (including the overlay when selected).
- Updated label logic and menu rendering accordingly. Documented in `CHANGELOG.md`.

## Next Up (Short Horizon)

- **Physics & Interactions (Phase 2 features)**
  - [x] Hills: bidirectional push — hills now apply constant downhill acceleration so going uphill resists and slows the ball; going downhill accelerates as expected. (`src/main.ts`)
  - [x] Hills visual arrows: render as an overlay above geometry and add dark outline + white pass for strong contrast, matching editor display. (`src/main.ts`)
{{ ... }}
  - [ ] Boosters/Accelerators (impulse)
  - [ ] Tunnels/Teleporters (enter/exit mapping)

- **Level System / Editor**
  - [ ] Course Creator: finalize remaining pieces
    - [ ] Tests for `FirebaseCourseStore` and overlay logic
    - [ ] Drag-and-drop reordering in overlay (optional)
    - [ ] Course Select: load/play courses from Firebase `courses`
  - [ ] Course Select: "Level of the Day" button that picks 1 level per day for best-score competition

## From Original Game Screenshots — New Objects to Add (2025-09-16)
Observed in `level_screenshots/` and the three provided screenshots. Add these object types to the editor, runtime, and schema. See `firebase.md` for data model updates and `UI_Design.md` for menu placement.

- [ ] One-way Walls / Gates
  - Wall segments that collide from one side only; ball passes through from the other side. Editor: orientation property (up/right/down/left) and arrow indicator. Runtime: treat as wall only when the collision normal opposes the allowed direction. Add to Objects menu as `OneWayWall` (rect + poly variants later).
- [ ] Breakable Walls (Red fence around cup)
  - Fence/wall segments with hit points (e.g., 2–4). Collisions above a speed threshold decrement HP; on zero, segment disappears with debris/sound. Resets on hole restart/retry. Editor: `hp` field and color style (red). Schema: store `hpMax`, `hp`.
- [ ] Fast Turf / Ice (low‑friction strip)
  - Light‑green strips that reduce friction so the ball carries farther. Editor: `fastTurf` region (rect + poly). Runtime: friction multiplier < 1.0; excluded on bridges. Visual: lighter green fill per `PALETTE.md`.
- [ ] Flowerbed / Garden (no‑play zone)
  - Decorative flowerbed area seen in screenshots. Decide behavior: out‑of‑bounds (reset) vs. heavy‑rough (very high friction). Lean OOB for parity with original look unless videos show roll‑through. Editor: `garden` region (rect + poly) with floral texture.
- [ ] Ball Teleporter Holes
  - Paired enter/exit holes that instantly move the ball. Editor: place Source and Target and link via id; draw a faint line/arrow between linked holes; adjustable radius. Runtime: preserve velocity and direction by default; spawn with a small offset and short cooldown (~200ms) to avoid immediate re‑trigger; play SFX/particles. Schema: `teleporters[]` with `{ id, a:{x,y,r}, b:{x,y,r}, preserveSpeed?: true }`.
- [ ] Preset: Thin Deflector Board
  - The angled white slats inside fairways can be authored with rotated `wall` rectangles today; add a convenience preset in Objects → `Deflector` that drops a thin wall with default dimensions at 45° for faster authoring. No new runtime behavior.

## Editor & User System
All completed; see `COMPLETED.md` for the full list of milestones and details.

## Soon (After MVP Slice Works)
- [ ] Track upcoming MVP-adjacent tasks here (seed from `TODO.md`).

## Blockers / Open Questions
 - [x] UI Consistency — Users Admin inline search typing TypeScript errors (resolved 2025-09-15)
  - Resolution: Repaired `mousedown` Users Admin block structure; added `usersSearchActive` flag, inline key handler for typing (printables, Backspace, Enter/Esc), caret rendering in search box; removed invalid hotspot cases and aligned to `UsersHotspot.kind`. Type-check is clean.
- [ ] Confirm hole capture radius vs. exact entry (measure from videos)
- [ ] Decide Tiled (TMX/JSON) vs. simple custom level JSON for MVP

## Decisions (Architecture / Approach)
- Stack: TypeScript + HTML5 Canvas, Vite, Web Audio API (custom), Vitest (per `TODO.md`)
- References: Treat the three YouTube videos as canonical for gameplay, level design, look & feel, UI/UX, physics
 - Level schema: Keep both rectangular and polygon variants for walls/water/sand as first-class. Do not migrate legacy levels. Update the Editor to support selection/move/delete for polygon variants; defer rotate/resize/vertex-edit to a later pass.

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
