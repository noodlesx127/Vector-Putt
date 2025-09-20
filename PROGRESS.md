# Project Progress — Vector Putt


This file tracks current focus, next steps, decisions, and done items. Keep it short and living.


- **Physics & Interactions**
  - [x] Velocity affects terrain (e.g., hard shot may skim sand)
    - Implemented velocity-based sand skimming: at higher ball speeds the effective sand friction multiplier eases toward 1.0 (config: `sandSkimEnabled`, `sandSkimStart`, `sandSkimFull`). Keeps bridges exempt. (`src/main.ts`)
  - [x] Tuning: Sand slows more and hills push harder — increased sand friction multiplier from 4.2× to 6.0× of `frictionK`, and increased hill base acceleration `SLOPE_ACCEL` from 520 to 720 px/s². (`src/main.ts`)
  - [x] Admin Game Settings (runtime): Added admin-only Game Settings panel under Admin Menu to tune global physics (Hill Accel, Ball Friction K, Sand Multiplier) on the fly; values persist in Firebase `/gameSettings`. Applied at startup and on Save. (`src/main.ts`, `src/firebase/database.ts`)
  - [x] Better hill direction visibility (add clear visual indicators of slope direction/strength in play and editor)
    - Implemented subtle arrow overlays inside hill regions indicating downhill direction; density and alpha scale with `strength`. Applied in both play render and editor preview. (`src/main.ts`, `src/editor/levelEditor.ts`)
  - [x] Change hitting the ball mechanic from pulling back to pulling forward
    - Updated shot input so dragging forward shoots forward (was pull-back to shoot). Updated aim arrow and dev debug preview to match. (`src/main.ts`)
  - Optional polish — Hills/Shot UX:
    - [x] Add an Options toggle (or Admin Game Settings) to show/hide slope arrows during play
      - Added Options panel toggle `showSlopeArrows` with hover/click and standard button visuals; arrows render only when enabled. (`src/main.ts`)
    - [x] Colorize slope arrows subtly to match palette (e.g., faint green per `UI_Design.md`)
      - Tinted arrows toward green with a darker under-stroke for contrast. (`src/main.ts`)
    - [x] Scale arrow size or edge emphasis using hill `falloff` to better convey flow intensity
      - Arrow size subtly scales with hill `falloff`; alpha still scales with `strength`. (`src/main.ts`)
 
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
         - [x] File menu parity: New, Load, Save, Save As, Delete, Back/Exit — labels, ordering, and shortcuts verified. (`src/editor/levelEditor.ts` EDITOR_MENUS)
         - [x] Load Level dialog: standard panel layout with scrollable list, filters, confirm/cancel buttons
          - Uses standard 800×600 panel, blue-themed background/border, centered title, 40px row height, and 28px buttons per `UI_Design.md`. (`src/main.ts`)
          - Active/inactive filter styling aligned to design; click handling fixed via capture-phase input for overlays.
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
  - [ ] Unit tests for heuristic sanity
    - Add tests to ensure suggested par increases with obstacle density/path length and that removal of blockers lowers par accordingly.

- **Level Editor & Browser**
  - [x] Selection tools: select/move/duplicate/delete; vertex edit for polygons; rotate/scale where applicable
  - Done: select, multi-select, move, delete; scale (resize) for rect items with grid snap and bounds clamp; rotate for rect items including multi-select group rotation (Shift = 15° snap)
  - Done (polygons, minimum viable): selection + move + delete + vertex edit (grid-snapped drag of individual vertices; rotation/resize disabled and handles hidden for polys)
  - [x] Posts: Snapping Does not work the same as the rest of the editor. IE doesnt work the same as walls, ect.
    - Implemented radius-aware edge-aligned snapping so post edges line up with grid lines like wall edges. Applied on initial placement, on drag-move finalize, and when changing radius in the picker. Keeps clamping to fairway bounds. (`src/editor/levelEditor.ts`)
  - [x] Grid toggle in Tools menu not working; removed grid size +/- controls
    - Fixed `Grid Toggle` action to call `env.setShowGrid(!env.getShowGrid())` and sync local `showGrid`. Removed `Grid -` and `Grid +` menu items and their keyboard shortcuts. (`src/editor/levelEditor.ts`)
  - [x] Hill Direction Picker: support diagonals NE/NW/SE/SW in addition to N/S/E/W; clickable markers and rendering updated. (`src/editor/levelEditor.ts`)

  - **Diagonal Geometry Tools — Plan (from reference screenshots in `level_screenshots/`):**
    - [x] Add a 45°-constrained polygon drawing mode usable for Walls, Sand, and Water
      - Implemented `Walls45`, `Water45`, `Sand45` tools. Segments are constrained to 0/45/90°; Enter closes; Escape cancels. Ctrl temporarily disables constraint (free angle). Shift constrains normal poly tools to 45° when desired. Creates `wallsPoly`/`sandPoly`/`waterPoly` arrays. (`src/editor/levelEditor.ts`)
    - [x] Bevel/Chamfer action for selected rectangles (walls/water/sand)
      - Implemented Tools → “Chamfer Bevel…”: converts selected rect-like walls/water/sand to beveled octagonal polygons, respecting rotation; prompts for bevel amount (px), snaps to grid when enabled, inserts into `wallsPoly`/`waterPoly`/`sandPoly` and removes originals; selection updates to new polys. (`src/editor/levelEditor.ts`)
    - [x] Angled Corridor stamp
      - Implemented Tools → “Angled Corridor…”: prompts for direction (NE/NW/SE/SW), corridor width, length, and wall thickness; creates two parallel 45° wall polygons centered at the cursor, snapped to grid and clamped to the fairway; adds to `wallsPoly` and selects the new polys. (`src/editor/levelEditor.ts` → `placeAngledCorridorStamp()`)
    - [x] Snapping/UX
      - Implemented: Shift locks to 45° increments on normal polys; Ctrl enables free angle on 45° tools; Alt toggles preview lineJoin (miter/bevel) while drawing; snap-to-vertex and snap-to-edge across existing polygons with on-canvas guide visuals and preview segment. (`src/editor/levelEditor.ts`: `computePolygonSnap()`, `findNearestPolySnap()`, polygon preview render)
      - Preview polish: Placed edges render as solid lines during drafting; the closing edge is not drawn until the polygon is closed; only the next-segment preview to the cursor is shown as a dashed yellow guide. (`src/editor/levelEditor.ts`)
    - [x] Rendering/Collision parity
      - Runtime now renders polygon water/sand with the same outline thickness as their rect counterparts (1.5px) and continues using the same fill/stroke colors. Polygon walls render with beveled rim matching rect walls.
      - Collision already treated each `wallsPoly` edge as a segment; water OOB and sand friction checks include polygon variants. Verified parity and adjusted only visuals for outline thickness. (`src/main.ts`)
    - [ ] Menu wiring and shortcuts
      - [x] Objects menu: add `Walls45`, `Water45`, `Sand45`
      - [x] Tools menu: `Chamfer Bevel…` and `Angled Corridor…` wired
    - [ ] Tests
      - Unit tests for polygon winding, closure, and collision against 45° edges; snapshot tests for render

  - **Alignment Aids — Plan**
    - [x] Smart Alignment Guides (drag-move/resize/vertex drag/polygon drafting)
      - Snap to nearby object edges and centers (left/center/right, top/middle/bottom) within ~6px; show cyan guide lines and spacing labels; Alt disables guides; Ctrl forces grid-only snap. Implemented in `handleMouseMove()` and rendered in `renderLevelEditor()` using transient `liveGuides` and `liveGuideBubbles`. Applied to drag-move, single/group resize, vertex drag, and polygon drafting (preview + clicks). Includes snapping to persistent ruler guides.
    - [ ] Rulers (top/left) with tick marks and cursor indicators
      - View toggle “Rulers”. Draw after background and before content overlays; minor=20px, mid=50px, major=100px; labels at majors (coordinate readout); live cursor line.
      - [in progress] Ruler strips render with refined tick density/labels and typography; further polish to match UI_Design.md exactly.
    - [x] Measure Tool
      - Tools → “Measure Tool”: click-drag to measure length/angle (Δx/Δy); snaps to grid/vertices/edges; ESC cancels; Enter pins; double-click clears.
      - [x] Bugfix: Mouse up now auto-pins the measurement; right‑click reliably clears both in‑progress and pinned measurements and does not resume measuring on mouse move. (`src/editor/levelEditor.ts`)
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

## Screenshot → Level Importer — Plan (2025-09-16)
A new Level Editor feature to rapidly bootstrap a level from a screenshot. Users can upload a level screenshot; the editor analyzes it to extract fairway/walls/sand/water and the cup, generates geometry, and opens the result for editing.

- **Feasibility**
  - Yes. Our levels already support rect and polygon variants (`walls`, `wallsPoly`, `water`, `waterPoly`, `sand`, `sandPoly`). We can map screenshot contours directly to polygon arrays and optionally fit rectangles for simple shapes. Cup detection is circle-based; tee will be a manual confirmation step.

- **UI Flow**
  - File → `Import from Screenshot…`
  - Choose image → preview and optional crop/perspective correction → run analysis → Review overlay shows detected shapes with handles → Accept commits to `editorLevelData` and opens for full editing.

- **MVP Scope**
  - Detect fairway outer boundary, interior walls/barriers (light gray), sand (tan), water (blue), and cup (black circle). Tee: ask user to click a tee location after import.
  - Use Canvas-based HSV segmentation and contour tracing (no heavy dependencies). Use `PALETTE.md` to seed color thresholds; allow user to tweak thresholds in the review overlay when needed.

- **Pipeline**
  - Load image to an offscreen `<canvas>`; auto-detect playfield crop (largest interior non-black area); allow manual crop if needed.
  - Convert to HSV, threshold masks for: fairway, wall/barrier, sand, water, cup candidates.
  - Trace contours per mask; simplify with RDP; snap vertices to grid; clamp into bounds.
  - Classify: large outer fairway polygon; interior wall contours to `wallsPoly`; sand/water to their `*Poly` arrays.
  - Cup: Hough-like circle scan within fairway; if ambiguous, prompt user to click.
  - Compose `LevelData` with detected geometry; set `meta.title = "Imported Level"` and `meta.authorName` per current user; set `par` default 3 (editable).

- **Editor Integration**
  - New module `src/editor/importScreenshot.ts`:
    - `importScreenshot(file: File, env): Promise<LevelData>`
    - Helpers: `segmentByColor()`, `traceContours()`, `simplifyPolygon()`, `findCupCircle()`, `composeLevelFromMasks()`
  - Add review overlay (`uiOverlay.kind === 'importReview'`) with toggleable layer visibility and per-shape accept/delete.
  - Keep importer isolated: only lightweight wiring (menu action + overlay invocation) remains in `src/editor/levelEditor.ts` to avoid growing that file’s complexity; all analysis and composition logic stays in `src/editor/importScreenshot.ts`.

- **Tasks**
  - [x] Editor UI: add File → `Import from Screenshot…` and file input flow (`src/editor/levelEditor.ts`)
    - Implemented menu item and handler `importFromScreenshot()` that opens a file picker, calls the importer, applies fixups, sets metadata, and loads the draft into the editor.
  - [x] Implement Canvas-based analyzer for HSV segmentation and contour tracing (no external deps) (`src/editor/importScreenshot.ts`)
  - [x] Polygon simplification (RDP) and grid snapping utilities (reuse existing grid size) (`src/editor/importScreenshot.ts`)
  - [x] Cup detection (circle scan) with click-to-confirm fallback — basic tee/cup click confirmation wired post-import; review overlay variant pending
  - [x] Convert extracted geometry to `LevelData`, open as editable draft; run `applyLevelDataFixups()` and `validateLevelData()`
  - [x] Review overlay: show masks/contours, allow threshold tweaks, accept/cancel before commit
    - Implemented `uiOverlay.kind === 'importReview'` rendering and interaction.
    - Added `showImportReview` to `EditorEnv` via `src/main.ts` (wired to `showUiImportReview`).
    - Overlay interactions: layer toggles (Walls/Sand/Water), threshold nudges (Looser/Stricter), Recompute preview, Accept/Cancel.
    - On Accept, returns `{ thresholds, polys }` to editor and applies to `wallsPoly/sandPoly/waterPoly`.
  - [x] Importer bugfixes (2025-09-18): preserve wall thickness; robust cup detection with blob circularity scoring.
  - [ ] Unit tests with `level_screenshots/*` samples: segmentation thresholds, contour→geometry mapping, cup detection edge cases
  - [ ] Optional: hills/slope/specials detection pass; evaluate OpenCV.js only if Canvas approach proves insufficient
- [x] Performance: crop processing to fairway sub-image; run cup detection on cropped data; expanded wall region by a margin to preserve thickness near fairway borders. (`src/editor/importScreenshot.ts`)
   - [x] Correctness: filter perimeter-hugging wall polygon that would flood-fill the fairway on Accept; relax wall hue gating for very low saturation to avoid missing gray walls; light mask dilation and finer wall snapping to keep wall bands thick. (`src/editor/importScreenshot.ts`)
   - [x] Import Review UX: Accept now honors layer toggles (Walls/Sand/Water). If Sand is off in the preview, it will not be applied. (`src/main.ts`)
   - [x] **2025-09-19**: Fixed wall detection failure by relaxing thresholds (saturation ≤30%, brightness ≥50%), reducing minimum pixel threshold, and relaxing green interior filter (≥80% vs ≥50%). (`src/editor/importScreenshot.ts`)
   - [x] **2025-09-19**: Major performance optimizations to prevent browser crashes: intelligent image size limits (max 2048px, ~3MP), progressive processing with requestAnimationFrame yielding, async contour tracing with periodic UI yielding, and console progress logging. (`src/editor/importScreenshot.ts`, `src/main.ts`)
   - [x] **2025-09-19**: Fixed large filled wall polygons by adding area-based filter to remove wall polygons covering >25% of fairway area, preventing misclassified regions from being imported as walls. (`src/editor/importScreenshot.ts`)
   - [x] **2025-09-19**: Completed enhanced manual annotation system for Screenshot Importer. Full interactive overlay with 9 tools (including Select/Edit), real-time visual feedback with selection highlights, individual item deletion, complex wall support for inner/outer boundaries, keyboard shortcuts (Delete key), and contextual instructions. Eliminates browser performance issues while providing superior accuracy and full editing control. (`src/editor/importScreenshot.ts`, `src/editor/levelEditor.ts`, `src/main.ts`)
   - [ ] Further guardrails: Debounce Recompute for rapid threshold adjustments.
  - [x] Selection robustness in overlay: boundary-first hit-test with inside-area fallback for all polygons (Walls/Water/Sand/Hills/Fairway); iterate arrays in reverse to prioritize most-recent items; increased tolerance to 14px. (`src/editor/importScreenshot.ts`)
  - [x] Import-time shaping: if the user draws a large outer Water/Wall fill (covering canvas corners), convert it on Accept into four border strips around the fairway bounding box; preserve all interior fills (no more disappearing inner features). Thickness configurable via `AnnotationOptions` (`waterBorderThickness`, `wallBorderThickness`, defaults enabled by `enableAutoWaterBorder`/`enableAutoWallBorder`). (`src/editor/importScreenshot.ts`)
  - [x] BUG: Annotated walls not rendered after Accept — Fixed 2025-09-20. Root cause: `importLevelFromAnnotations()` pushed raw `number[]` arrays instead of `{ points:number[] }` objects. Now `wallsPoly`/`waterPoly`/`sandPoly` use the correct shape consistently, so polygons render in the editor after Accept. (`src/editor/importScreenshot.ts`)
  - [x] BUG: Large fills suppress inner annotations (posts/cup/walls) — Fixed 2025-09-20 (importer-side). Importer detects large outer Water/Wall fills and converts them into four border strips around the fairway; all interior fills (and posts/cup) are preserved and no longer occluded/dropped. Overlay remains simple-polygons (no holes) for now; composite ring editing is a separate enhancement. (`src/editor/importScreenshot.ts`)
  - [x] Scale normalization: annotations are scaled from source overlay canvas size to target dimensions; coordinates scale by X/Y, radii by average scale. Wired `sourceWidth`/`sourceHeight` from overlay canvas in `showAnnotateScreenshot()` so it is automatic. (`src/editor/importScreenshot.ts`, `src/main.ts`)
  - [x] Annotate flow: safer auto-border generation — only create Water/Wall border strips if a Fairway polygon is annotated, and require ≥2 canvas corners inside an outer fill to qualify. Prevents misaligned long bands and corner artifacts when no fairway was drawn. (`src/editor/importScreenshot.ts`)

  Status: Phase 2 implemented in `src/editor/importScreenshot.ts`
  - Offscreen draw + green fairway bbox; HSV segmentation to masks (fairway, walls, sand, water); Moore-neighbor contour tracing; RDP polygon simplification; grid snapping; clamp to canvas; classification to `wallsPoly`/`sandPoly`/`waterPoly`; compose `LevelData` and open in editor with fixups applied. Post-import guidance prompts user to click Tee; Cup click is requested only if not confidently detected (metadata flag). Next: build review overlay with threshold sliders and layer toggles; add unit tests using `level_screenshots/*`.
  - Recent fixes (2025-09-18): perimeter polygon filter; cropped processing; wall thickness preservation (expanded region + dilation + finer snap); Accept respects toggles; green-interior sampling filter removes misclassified giant wall fills.

- **Risks & Mitigations**
  - Varying palettes and compression: expose threshold sliders in review overlay; seed from `PALETTE.md` presets.
  - Perspective/skew: allow manual crop/rectify step or accept slight skew and rely on polygon editing.
  - Runtime complexity: start with polygons; add rectangle fitting later for nicer authoring when helpful.

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
 - [x] UI Consistency — Users Admin inline search typing TypeScript errors (resolved 2025-09-15)
  - Resolution: Repaired `mousedown` Users Admin block structure; added `usersSearchActive` flag, inline key handler for typing (printables, Backspace, Enter/Esc), caret rendering in search box; removed invalid hotspot cases and aligned to `UsersHotspot.kind`. Type-check is clean.
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
