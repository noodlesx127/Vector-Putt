# TODO — Vector Putt (Working Title)

A practical checklist to start and deliver the MVP based on `Design_Doc.md`.

## Recommended Target Stack (Simple, Java-era spirit)

- HTML5 Canvas 2D + TypeScript (no heavy engine)
  - Rationale: closest to classic Java applets in simplicity; deterministic 2D; tiny runtime; easy web distribution.
- Build tooling: Vite (fast dev server + bundling) with NPM scripts
- Audio: Web Audio API (custom); Howler.js optional later
- Testing: Vitest (unit), Playwright (optional smoke)
- Level format: Tiled (TMX/JSON) or simple custom JSON for walls/terrains
- Packaging: Static web build (GitHub Pages/Netlify); optional Electron wrapper later for desktop

Notes:
- Avoid large game engines (Unity/Godot) to keep footprint and complexity low.
- Use minimal dependencies; write simple physics/collision in-house.

## Project Foundations
- [x] Adopt recommended stack above and scaffold project
- [ ] Validate features and tuning against the reference videos (see section below); default to matching observed behavior
- [ ] Initialize repo structure
  - [x] `src/` game code
  - [ ] `assets/` art and audio
  - [x] `levels/` level JSON/Tiled scenes
  - [ ] `docs/` design, tech notes
  - [ ] `tools/` level pipeline scripts (if needed)
- [x] Add project README with run/build instructions
- [ ] Add license and CONTRIBUTING
- [ ] Configure version control (Git LFS for binary assets)
- [x] Setup CI for builds (per target platform)
- [ ] Add code style/linting and pre-commit hooks
- [ ] Define build targets (desktop/web/mobile) and packaging

## Core Gameplay Loop
- [x] Implement game states: Main Menu → Gameplay → Post-Hole → Course Summary
- [x] Implement one-button shot mechanic
  - [x] Click-and-hold on ball to aim
  - [x] Draw aiming arrow (direction + power via length/color)
  - [x] Release to shoot
  - [x] Disable input while ball in motion
- [ ] Ball lifecycle
  - [x] Ball spawns at tee
  - [x] Detect “ball stopped” threshold
  - [x] Detect “ball in hole” and transition to Post-Hole

## Physics & Interactions
- [x] Ball motion with friction (tunable)
- [x] Wall collisions with proper reflection (angle in = angle out)
- [x] Terrain types with per-surface physics
  - [x] Fairway (medium friction)
  - [x] Sand (high friction; hard to exit)
  - [x] Water (OOB): +1 stroke, reset to pre-shot position
- [ ] Velocity affects terrain (e.g., hard shot may skim sand)
- [x] Velocity affects terrain (e.g., hard shot may skim sand)
- [ ] Ramps/Hills (slope affects speed/direction; phase 2)
  - Overlay Screenshot (tracing aid)
    - [x] Phase 1: Tools → "Overlay Screenshot…" picker; View options (Show/Hide, Opacity +/-, Z‑Order Above/Below, Lock, Snap to Grid, Fit to Fairway, Reset Transform, Transform Mode → Move); render pass below/above geometry; keyboard controls for opacity/nudge/scale/rotate (`,`/`.`/`=`/`-`).
    - [ ] Phase 2 (in progress): Transform handles (Resize/Rotate) with aspect lock and Flip H/V; Fit to Canvas; Calibrate Scale; Through‑click option when overlay is above; tests for enable/disable and transform math.
      - [x] Transform handles → Resize/Rotate with on‑canvas handles (BR resize; top‑mid rotate with Shift=15°)
      - [x] Fit to Canvas
      - [x] Preserve Aspect toggle
      - [x] Flip Horizontal / Flip Vertical
      - [x] Through‑click option (when Overlay is Above)
      - [ ] Tests for enable/disable states and transform math
      - [x] Bugfix: overlay drag release continued after mouseup — finalize in `handleMouseUp()` and add `e.buttons===0` safety in `handleMouseMove()` (2025‑09‑20)
    - [x] Refactor: Remove dedicated Overlay Transform Modes; Select Tool moves/resizes/rotates the overlay when unlocked (2025‑09‑21)
  - [x] Hills (prototype): directional acceleration zones with visual gradient
- [ ] Moving obstacles (timed collisions; phase 2)
- [ ] Boosters/Accelerators (apply impulse; phase 2)
- [ ] Tunnels/Teleporters (enter/exit mapping; phase 2)

## Scoring & Rules
- [x] Stroke count per hole (+1 per shot)
- [x] Par per hole (data-driven)
- [x] Score evaluation at end of hole (Birdie/Par/Bogey, etc.)
- [x] Running total across course
  - [x] Show running total (HUD) and record per-hole strokes when advancing
  - [x] Course summary overlay with per-hole strokes and total
  - [x] Final-hole UX: require click/N from sunk banner; prevent accidental auto-close
- [x] Water penalty and reset logic

## Level System
- [x] Level data format decision (Custom JSON)
- [x] Level loader/validator
- [ ] Placeable components
  - [x] Tee start, hole cup
  - [x] Walls/boundaries
  - [x] Terrain tiles (fairway, sand, water)
  - [ ] Optional: slopes, moving blocks, boosters, tunnels
  - [ ] Cup placement heuristics (avoid trivial layouts)
    - [ ] Define constraints for logical cup placement: minimum distance from tee; not directly visible by straight shot when obstacles intend a path; not hugging walls/edges; inside intended gated region
    - [ ] Path validation: grid/navmesh A* over fairway (excluding walls/water) to ensure a non-trivial route length and at least one corridor/bank interaction
    - [ ] Editor assist: auto-suggest 3–5 candidate cup positions ranked by difficulty; highlight invalid/too-easy placements
    - [ ] Add lint rule in level validator to flag cups that can be bypassed around obstacles
 - [x] Course definition (ordered list of holes + par values)
 - [x] Author 3–5 MVP holes to validate mechanics (added level4, level5)
- [x] Adjust L1 decorations to sit outside playfield
- [x] L2: add doorway into box and place cup inside; reachable sand

- [ ] Level Editor & Browser (authoring and discovery)
  - [x] In-app (or web) level editor to place walls/terrain/hills/decorations
  - [ ] Grid snapping, keyboard nudges, and alignment helpers
    - [ ] Smart Alignment Guides during drag-move/resize/vertex drag/polygon drafting
      - Snap to nearby object edges/centers (left/center/right, top/middle/bottom) within ~6px; show cyan guide lines and spacing labels; Alt disables guides; Ctrl forces grid-only snap
    - [ ] Rulers (top/left) with tick marks and live cursor indicator; View toggle “Rulers”
    - [ ] Measure Tool (Tools → Measure): click-drag to measure distance/angle (Δx/Δy); snaps to grid/vertices/edges; ESC cancels; Enter pins; double-click clears
    - [ ] Axis lock for drag-move (Shift constrains to dominant axis)
    - [ ] Align/Distribute commands for multi-select (Align Left/Right/Top/Bottom/Center H/V; Distribute H/V spacing)
    - [ ] Numeric readout on polygon drafting (length + angle near the next-segment guide)
    - [ ] Ruler guide lines (drag out from rulers; double-click ruler to clear)
  - [x] Load/Save `levels/*.json` with schema-aware validation
  - [ ] Dev/Admin-only Course Creator (Editor → Editor Tools → "Course Creator")
    - [ ] Dedicated UI listing all levels with thumbnail and metadata (name, author, par)
    - [x] Build "Bundled" courses or arbitrary series of levels forming a full Course
    - [x] Create/edit courses: rename course, reorder levels, add/remove levels
    - [x] Drag-and-drop reordering in overlay (Course Creator)
    - [ ] Save flow prompts for Course Name; upon save, add new button in "Select Course" chooser
    - [x] Manage courses: edit existing course(s) and delete course entirely
    - [x] Visibility: feature gated to Dev/Admin only
    - [ ] Persistence: course definition format consumed by runtime Course Select
  - [ ] Level browser: scan `levels/` and list levels; searchable and filterable
  - [ ] Preview thumbnails and quick-play from the browser
  - [x] Open/edit existing `levels/*.json` (load, modify, validate) and Save/Save As
  - [x] Create new level workflow (canvas size, par, initial metadata)
  - [x] Metadata editor: Level title and author name (persisted in JSON)
  - [x] Tool palette UI (initial): render tool buttons, hover pointer, click to select (`selectedEditorTool`)
  - [x] Tee & Cup placement (editor): 20px grid snapping, clamped to fairway bounds, updates editor level data
  - [x] Editor persistence (multi-level): Save, Save As, Load, New, Delete using `localStorage` key `vp.levels.v1`; track current saved ID for overwrite semantics
  - [x] Replace temporary prompt-based Save/Save As/Load with in-game overlay dialogs (List/Prompt) for naming and selection
  - [x] Migrate persistence off localStorage to filesystem per policy (`User_Levels/<Username>/*.json`) and provide Import/Export for browser-only builds
    - [x] File System Access API implementation for direct file read/write
    - [x] User_Levels/<Username>/ directory structure with automatic creation
    - [x] Export functionality (download JSON) for browser-only builds
    - [x] Import level from file upload when no saved levels found
    - [x] Load bundled levels from levels/ directory for editing
    - [x] Combined level picker with source labels [bundled], [user], [localStorage]
    - [x] Level validation and automatic metadata (author, lastModified) on save/export
  - [x] Permissions (editor): owner/admin-only overwrite and delete; non-owners are prompted and routed to "Save As"
  - [x] Migration: on first editor entry, migrate legacy single-slot `vp.editor.level` into `vp.levels.v1` with ownership/timestamps
  - [x] CRUD UI wiring: action buttons live in `editorUiHotspots`; handled in Level Editor `mousedown`; hotspots rebuilt each frame
  - [x] Editor preview rendering: fairway panel + outline, grid overlay, and Tee/Cup markers
  - [x] Menu UI layering: render menu panel/buttons after fairway/grid so they appear on top; add semi-transparent panel background and border for readability
  - [x] Toolbar refactor: compact horizontal top toolbar (tools row + actions row with Back on right); unify hover/click via `editorUiHotspots`
  - [x] Editor preview: render existing geometry (water, sand, bridges, hills, decorations, walls, polygon walls, posts) using play-mode visuals
  - [x] Bugfix: Level Editor duplicate shadows during rotation — removed legacy shadow drawing outside rotation transforms for walls/polygon walls/posts; shadows now drawn only within rotation-aware renders
  - [x] Level Editor filesystem integration — comprehensive filesystem support for level persistence:
    - [x] Scan and load levels from `levels/` directory alongside localStorage levels
    - [x] Combined level picker showing [LS]/[FS] source labels and ownership badges
    - [x] Three save options: LocalStorage, Filesystem (File System Access API/download), User Directory structure
    - Note: Per policy, LocalStorage Save As is disabled in dev/admin builds; use Filesystem or `User_Levels/<Username>/`. Browser-only builds should use explicit Import/Export instead of LocalStorage persistence.
    - [x] Schema validation with detailed error reporting for level files
  - [x] Undo/Redo in Level Editor: toolbar buttons and shortcuts (Ctrl+Z/Ctrl+Y); snapshot editor state on placements and actions (Save/Load/New/Delete)
  - [x] Tool palette: Tee, Cup, Walls, WallsPoly, Posts, Bridges, Water, WaterPoly, Sand, SandPoly, Hill, decorations
 - [x] Selection tools: select/move/duplicate/delete; vertex edit for polygons; rotate/scale where applicable
  - Done: select, multi-select, move, delete; scale (resize) for rect items with grid snap and bounds clamp; rotate for rect items including multi-select group rotation (Shift = 15° snap)
  - Done: duplicate (Ctrl+D and Tools → Duplicate) pastes at cursor with snapping/clamping
  - Done (polygons, minimum viable): selection + move + delete + vertex edit (grid-snapped vertex drag; polygons remain translate-only; rotate/resize disabled with handles hidden)
    - Implemented: included poly variants in `findObjectAtPoint()` and `getObjectBounds()`; `moveSelectedObjects()` translates polygon `points`; Delete key removes from poly arrays and `editorLevelData`; removed duplicate/incorrect implementations in `src/main.ts`.
    - Defer: precise point-in-polygon/edge proximity hit-test; rotate/resize for polys (polygons are translate-only for now); vertex edit mode
 - [x] Select Tool: move, resize, and rotate items (MS Paint/Photoshop-style); multi-select with bounding outline
  - Grid snapping and fairway-bounds clamping on move/resize/rotate; min size = 1 grid step; no negative sizes
  - Applies to rect items (walls/bridges/water/sand/hills); Posts: resize radius; Tee/Cup: move-only; multi-select transforms apply to all selected; rotation restricted to rect-like items; polygons are translate-only and hide rotation handles when selected
  - Progress: selection + multi-select + move complete; 8-point resize implemented for rectangles; rotation complete for rect-like items, including multi-select group rotation with 15° snapping (Shift)
 - [x] Delete selected item(s) via existing Delete button in the toolbar UI
 - [x] Grid snapping and nudge controls (arrow keys); configurable grid size
 - [x] Main Menu: add "Level Editor" entry to launch editor mode
  - [x] Course Select: add "User Made Levels" category; list by Level Title — Author; load+play selected

  - **Diagonal Geometry Tools (from reference screenshots in `level_screenshots/`)**
    - [x] 45°-constrained polygon drawing mode
      - Implemented `Walls45`, `Water45`, and `Sand45` tools. Segments constrained to 0/45/90°; Enter closes; Esc cancels; Ctrl toggles free angle; Shift constrains normal poly tools to 45° when needed.
      - Produces `wallsPoly` / `sandPoly` / `waterPoly` with correct outlines and preview styling; persisted to existing arrays.
    - [ ] Chamfer/Bevel rectangle action
      - Convert selected axis-aligned rectangles (wall/water/sand) into octagonal or beveled polygons; adjustable bevel amount
    - [ ] Angled Corridor stamp
      - Generate two parallel 45° boundaries at a given lane width; supports inside/outside fill for sand/water variants
    - [ ] Snapping & UX polish
      - Shift = lock to 45°, Ctrl = free angle, Alt = miter vs bevel join toggle; snap-to-vertex/edge with guide visuals
    - [ ] Rendering/Collision parity
      - Ensure preview and runtime collision use the same polygon edge set; align wall outline thickness to references
    - [ ] Menu/Shortcut wiring
      - [x] Objects: add `Walls45`, `Water45`, `Sand45`
      - [x] Tools: `Chamfer Bevel…`
      - [ ] Tools: `Angled Corridor…`
    - [ ] Tests
      - Polygon winding/closure, 45° segment enforcement, and collision against diagonal edges; snapshot tests for render

{{ ... }}
  - [x] Create/select active user; store display name and role (admin/user)
{{ ... }}
  - [x] Admin (Super User): edit/delete any level; manage users
  - [x] Normal user: edit/delete own levels; duplicate existing levels to create user-owned copies
{{ ... }}
 - [x] Level ownership
  - [x] Persist `meta.authorId` and `meta.authorName` in level JSON
  - [x] Show Title — Author in lists (Course Select "User Made Levels")
  - [x] Editor: restrict Save/Delete to owner or admin; allow "Save a Copy" for non-owners
- [x] Scores per user
  - [x] Track per-level and per-course scores keyed by user
  - [x] Course summary: show best scores for the active user; optional all-users leaderboard
- [ ] UI integration
  - [x] Main Menu: username input field between the graphic and the Start button; Start disabled until a non-empty username is entered; persist and prefill last user

  - [ ] Allow placement overlapping fairway/water edges; draw above water; no collision mask
- [x] Land bridge over water (static, no slope)
  - [x] Support narrow fairway rectangles spanning water with correct priority (fairway collision only on bridge)
  - [x] Ensure off-bridge positions fall into water penalty
  - [x] Visual polish: optional subtle edge highlight to read as a thin bridge
- [ ] Sand wedge/trapezoid pits (yellow trapezoids in refs)
  - [x] Support triangular/trapezoid sand shapes (via polygons or typed shapes)
  - [ ] Tune friction and visuals for these shapes
- [ ] Wall thickness and outline tuning
  - [ ] Match reference thickness for main border and inner lanes
  - [ ] Ensure collision shapes match visuals (no visual/physics mismatch)

### New obstacles/features inferred from screenshots
- [x] Polygon water (`waterPoly`): support non-rectangular water shapes (octagons, rivers, bays)
  - [x] Rendering and OOB detection via `pointInPolygon`
  - [x] Bridges spanning polygon water (priority draw and collision override)
- [ ] Hills as polygons (`hillsPoly`): slope zones that are triangular/chevron/irregular, not only rectangles
  - [ ] Visual gradient with directional arrows style to match references
  - [ ] Tune strength per zone for arrow-lane “fast” and “slow” strips
- [ ] Chevron/arrow bumpers: concave/convex wedge pairs used as deflectors near cups and corridors (polygon wall presets)
- [ ] Sawtooth edges: repeated small triangles forming a toothed boundary (wall generator/preset)
- [ ] Octagonal islands and rings: inner courtyards around the cup, thin ring walkways (polygon wall presets)
- [ ] Post arrays: dense fields of round posts (billiards board); editor stamp to place grids/rows; optional decorative caps
- [ ] Multi-lane corridors with gates: narrow 1-ball lanes separated by thin walls; ensure min corridor width setting
- [ ] Water canals/rivers cutting diagonally through the course (polygon water + bridges/landings)
- [ ] Funnel entries and notches: 45° wedge funnels into passages (preset shapes)
- [ ] Optional “rough” terrain (medium-high friction distinct from sand) for variety lanes; visuals as darker strip
- [ ] Multiple cups per level (optional variant seen in references); record best capture path

### Clarifications needed (please confirm):
- [ ] Do flower borders act as solid walls, or are they decoration on top of a solid wall, or decoration only?
- [ ] The yellow trapezoid “bowls” in the third screenshot — should these be sand (high friction) or bumpers/ramps?
- [ ] The green rectangular band bridging water — confirm this is a slope/accelerator (not a moving platform).

## UI/UX
- [x] Minimalist HUD (top of screen)
  - [x] Hole: current index and total (e.g., 3/9)
  - [x] Par for current hole
  - [x] Strokes for current hole
  - [x] Align HUD across the very top (left/center/right)
  - [x] Show Birdie helper (strokes remaining for birdie)
  - [x] HUD: Best score display (course mode only; async from Firebase; updates after save)
- [x] Aiming arrow visual design (power feedback via length/color)
  - [x] Post-Hole scorecard screen with performance label
  - [x] Main Menu (Start, Options placeholder) → Course Select (Dev Levels)
- [ ] Options: audio volumes (SFX/Music), accessibility toggles
  - [x] SFX volume and mute controls in Options/Pause
  - [x] Slope arrows visibility toggle (show/hide hill arrows during play)
- [x] Pause menu overlay with info/shortcuts/version (P/Escape)
  - [x] Buttons: Replay, Close, Back to Main Menu
  - [x] Add Options to Pause menu (open in-game Options; Back/Esc returns to Pause/Game)
- [x] Restart hole (R) and Next level (N)
  - [x] Robust transitions (no double-advance); cached/preloaded next level for snappier switches
  - [x] Loading state before first play; prefetch first two levels
  - [x] Fixed-canvas layout tuned to 960×600 with letterbox scaling
- [x] HUD: optional hole title display (per-level `course.title`)
- [x] HUD: Menu button toggles Pause (replaces HUD Replay)
- [x] Main Menu: simple vector graphic (flag, hole, ball, putter)

 - [x] Overlay consistency per `UI_Design.md`
   - [x] Prompt primary button shows “Save” for Save/Save As/Metadata
   - [x] Delete confirmation uses danger styling with red “Delete” button
   - [x] Save As: title validation (non-empty, ≤120 chars) and spacing
   - [x] Metadata dialog: Title/Author validation; persists immediately

## Audio
- [ ] SFX list and placeholders
  - [x] Ball hit (putt)
  - [x] Wall bounce (knock)
  - [x] Water splash (plop)
  - [ ] Sand roll (grit)
  - [x] Hole sink + short jingle
- [ ] Background music (light, cheerful, loopable)
- [x] Audio mixer with volume controls

## Visuals
- [x] Minimalist vector style palette (retro pass applied)
- [x] Distinct colors per terrain for instant readability (green/sand/water)
- [ ] Simple, legible UI fonts and icons
- [ ] Reusable shapes for walls/terrain (rects, circles, polygons)
- [x] Flower decorations pass (non-colliding), positioned outside playfield
- [x] Auto-snap decorations near outer walls to table area (avoid playfield overlap)
- [ ] Per-level palette overrides (wall/fairway/decor variations)
- [x] Diagonal/chamfered walls support in schema + rendering

## Reference Videos — Consolidated Findings
Sources:
- Layout & Graphics: https://www.youtube.com/watch?v=Lp4iL9WKpV4
- Hole-in-One Compilation: https://www.youtube.com/watch?v=4_I6pN-SNiQ
- Full Playthrough: https://www.youtube.com/watch?v=kMB2YdKYy7c

Important: These three videos are canonical reference points. Use them extensively to guide decisions across Gameplay, Level Design & Environment, Look & Feel, UI/UX, and Physics & Interactions. Prefer matching the observed behavior/visuals unless there is a deliberate, documented reason to deviate.

Additional assets:
- Reference screenshots folder: `level_screenshots/` — curated captures of original-game levels. Use these for new level ideas, obstacle shapes, chamfers, bridges, posts, and overall layout patterns.

Observation tasks (verify and document in `docs/VIDEO_NOTES.md`):
- [ ] Camera/layout: top-down orthographic; bordered fairways; sharp-corner walls
- [ ] Visual style: flat solid colors; strong outlines; minimal effects
- [ ] Terrain color mapping: green (fairway), tan (sand), blue (water), dark walls; extract exact hexes → `docs/PALETTE.md`
- [ ] Hole cup: dark circle with rim; short sink animation; confirm suction radius (if any)
- [ ] Ball: simple white with small shadow; size vs. tile width ratio
- [ ] HUD: top placement; labels “Hole x/y”, “Par n”, “Strokes m”; retro/simple font
- [ ] Resolution/aspect: fixed canvas (e.g., 800×600 or 1024×768); letterbox scaling
- [ ] Geometry patterns: rectilinear corridors, 90° banks, zig-zags, open greens; occasional arcs
- [ ] Obstacles: simple blocks/moving bars; verify moving elements present/absent per video
- [ ] Terrain usage frequency and effect on shots (sand slows; water OOB)
- [ ] Aiming UI: arrow style, power by length/color; max length; power curve feel; minimum drag threshold
- [ ] Physics feel: friction/drag (time-to-stop), bounce elasticity (angle in = angle out), bank counts
- [ ] OOB handling: splash SFX, delay, +1 stroke, reset to pre-shot position; confirm order/timing
- [ ] UI feedback timing: stroke counter updates, sink banner cadence
- [ ] Score terms: Birdie/Par/Bogey; colors/format of scorecard
- [ ] Flow: Main Menu → Course/Level Select → Hole intro → Gameplay → Post-Hole → Next Hole; course length (9/18)
- [ ] Input scope: mouse-only; confirm restart keys (R/Esc)
- [ ] Performance target: smooth 60 FPS (assumed; verify)

Implementation follow-ups:
- [ ] Create 5–10 prototype holes for observed archetypes in `levels/`
- [x] Bank-shot dev harness: visualize predicted reflection paths (dev-only) — toggle with `B` (dev builds only)
- [ ] Dev cleanup: temporary diagnostics and input helpers
  - [ ] Decide whether to keep/remove the small "DEV" watermark
  - [ ] Decide whether to keep/remove verbose dev key-event logs
  - [ ] Confirm aiming drag threshold (2px vs 4px)
  - [ ] Reduce extra keyboard listeners now that canvas focus is reliable
- [ ] Collision tuning: restitution/friction, and wall tolerance to avoid tunneling; deterministic reflections
- [ ] Config surfaces: friction per terrain; restitution; stop-epsilon; suction radius
- [ ] Aiming: clamp min/max drag, configurable power curve; arrow visuals per reference
- [ ] OOB pipeline: splash → +1 stroke → reset → resume (match timing)
- [ ] HUD/layout: match positions/labels; timing of updates and sink banner
- [ ] Post-Hole screen: classic golf terms; stroke delta vs. par; next/quit
- [ ] Course/Level select: 9/18 presets; course summary totals
- [ ] Sound manager: map events (hit, bounce, sand, water, sink) with balanced volumes
- [ ] Fixed-canvas preset (exact px after measurement) + letterbox scaling
- [ ] Docs: `docs/STYLE_GUIDE.md`, `docs/PALETTE.md`, `docs/VIDEO_NOTES.md`, `docs/ARCHETYPES.md`

## Game Feel & Tuning
- [ ] Define physics constants (mass, friction, damping, restitution)
- [ ] Define aiming sensitivity and clamping
- [x] Define stop-threshold (speed epsilon)
- [ ] Iteration sessions with telemetry of strokes per hole

## Persistence
- [x] Save best scores per hole/course (local storage or file)
- [ ] Config persistence (audio volumes, last course)

## Testing & QA
- [x] UsersStore invariants unit tests (roles/admin safeguards, enable/disable, promote/demote, import/export, init fallbacks)
- [ ] Unit tests for physics integration/energy loss
- [ ] Deterministic collision tests (angle in/out)
- [ ] Terrain friction table tests
- [ ] Water penalty/reset tests
- [ ] UI snapshot or scene tests (where supported)
- [ ] Level loader validation tests (schema)
- [ ] Automated playthrough of a short course in CI (smoke)

## Build & Release
- [ ] Dev build pipeline (fast iterate)
- [ ] Release build pipeline (minify/strip symbols)
- [ ] Platform packaging (Web: itch.io/Pages; Desktop: Win/macOS installers)
- [x] Versioning and changelog

## Documentation
- [ ] Update `docs/Design_Doc.md` with any scope changes
- [ ] Add `docs/TECH_DESIGN.md` covering architecture and data formats
- [ ] Add `docs/LEVEL_GUIDE.md` for creators
- [x] Add `docs/PALETTE.md` and consolidate water/sand colors + outlines in `src/main.ts`

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

## Stretch (post-MVP)
- [ ] Moving obstacles, boosters, teleporters
- [ ] Sloped terrain system and editor tools
- [ ] Course editor in-app
- [ ] Cosmetics/unlocks (non-pay)
- [ ] Mobile touch optimization
- [ ] Advanced camera work (cinematic replays)
