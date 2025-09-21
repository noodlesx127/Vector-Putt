# Completed Milestones — Vector Putt

Moved from `PROGRESS.md` on 2025-09-20.

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

- **Editor Integration**
  - New module `src/editor/importScreenshot.ts`:
    - `importScreenshot(file: File, env): Promise<LevelData>`
    - Helpers: `segmentByColor()`, `traceContours()`, `simplifyPolygon()`, `findCupCircle()`, `composeLevelFromMasks()`
  - Add review overlay (`uiOverlay.kind === 'importReview'`) with toggleable layer visibility and per-shape accept/delete.
  - Keep importer isolated: only lightweight wiring (menu action + overlay invocation) remains in `src/editor/levelEditor.ts` to avoid growing that file’s complexity; all analysis and composition logic stays in `src/editor/importScreenshot.ts`.

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
  
Moved from `PROGRESS.md` on 2025-08-25.

## 2025-08-26 — Level Browser & Editor
- [x] Level Browser: preview thumbnails and quick-play
  - Generated canvas-based thumbnails from level data; caching by source/name/author
  - List UI updated to render 48×48 thumbs, badges, and selection hint; loading/error placeholders
  - Keyboard/mouse handling updated for new item heights; double-click and Enter quick-play
  - Searchable/filterable across sources (bundled/user/filesystem/firebase)
- [x] Editor: grid snapping helpers
  - Keyboard nudges respect grid; alignment helpers for move/resize/rotate

## Now (Former Current Focus)
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

## Next Up (Former Short Horizon)
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

## Level Editor & Browser — Completed
- [x] Level Editor UI: Menubar with File/Objects/Editor Tools menus (2025-01-10)
- [x] Level Editor Tool Palette: Initial tool palette UI (render buttons, hover cursor, click-to-select) (2025-01-10)
- [x] Level Editor Select Tool: moved from Objects to Editor Tools and renamed to 'Select Tool' (2025-01-10)
- [x] Level Editor Migration: completed migration of all editor code from `main.ts` to modular `levelEditor.ts` structure (2025-01-10); configurable grid size
  - [x] Refactor: delegated all Level Editor keyboard handling from `src/main.ts` to `levelEditor.handleKeyDown(editorEnv)`; removed legacy unreachable code referencing old globals in `main.ts`.
  - [x] Follow-up: run TypeScript check and do a manual smoke test of editor shortcuts, grid +/-/toggle, menu mnemonics, and Delete/nudge behaviors. (2025-08-22)
  - [x] Main Menu: add "Level Editor" entry to launch editor mode
  - [x] Multi-level persistence: Save, Save As, Load, New, Delete using local storage key `vp.levels.v1`; track current saved ID for overwrite semantics
  - [x] Preview rendering: fairway panel + outline, grid overlay, Tee/Cup markers
  - [x] Permissions: owner/admin-only overwrite and delete; non-owners are alerted and routed to "Save As"
  - [x] Migration: migrate legacy single-slot (`vp.editor.level`) into `vp.levels.v1` on first entry to the editor
  - [x] CRUD UI wiring: action buttons are part of `editorUiHotspots` and handled in Level Editor `mousedown`; hotspots rebuilt each frame
  - [x] Menu UI layering: draw menu panel/buttons last so they render above the grid; add semi-transparent panel background and border for readability
  - [x] Toolbar refactor: compact horizontal top toolbar (tools row + actions row incl. Back on right); hover/click unified via `editorUiHotspots`; editor preview renders beneath toolbar
  - [x] Editor preview: render existing geometry (water, sand, bridges, hills, decorations, walls, polygon walls, posts) using play-mode visuals
  - [x] Interactive placement: Posts (click); Walls/Bridges/Water/Sand/Hills (click-drag rectangles) with grid snapping, fairway clamping, and minimum drag threshold; crosshair cursor and drag state until mouseup
  - [x] Drag outline preview while dragging rectangle tools (grid-snapped, clamped to fairway bounds)
- [x] Polygon tools: implemented create/vertex-edit UI with click-to-add-vertex, Enter/Escape to finish/cancel, click-near-start to close (2025-08-22)
- [x] Hill direction control: implemented direction picker UI with N/S/E/W arrows (2025-08-22)
- [x] Post radius control: implemented radius picker UI with 6/8/10/12/16/20 options (2025-08-22)
- [x] Rotation: implemented for rectangular items with 15° snapping; shadow duplication fixed by removing legacy non-rotated shadows
- [x] Group rotation: multi-select rotates about the group bounds center; hold Shift to snap to 15°; snapshot original states at rotation start for accurate transforms
- [x] Polygon guards: polygons (wallsPoly/waterPoly/sandPoly) are translate-only; rotation/resize disabled; rotation handles hidden when any polygons are selected
- [x] Visual/UX: selection bounds cached each frame; multi-select bounds follow drag offset while moving; rotation state cleared on commit
- [x] Diagnosis resolved: included polygon variants in `findObjectAtPoint()` and `getObjectBounds()`; `moveSelectedObjects()` now translates polygon `points`; Delete key removes from poly arrays and `editorLevelData`; removed duplicate/incorrect implementations.
- [x] Consistency: defined local `COLORS` and `SelectableObject` in `src/editor/levelEditor.ts` and standardized naming to `wallsPoly` in `getObjectBounds()`.
- [x] Code refs (`src/main.ts`): `saveEditorLevel()`, `saveEditorLevelAs()`, `openLoadPicker()`, `openDeletePicker()`, `newEditorLevel()`, `assembleEditorLevel()`, Level Editor `mousedown`/`mousemove`/`mouseup`
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
- [x] Select Tool implementation
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
- [x] Select Tool: move, resize, and rotate items; multi-select with bounding outline
  - Drag inside selection to move; 8 corner/side handles to resize; rotate via rotation handles around object/group bounds; bounding outline drawn around selection
  - Grid snapping and fairway-bounds clamping on move/resize/rotate; min size = 1 grid step; no negative sizes
  - Applies to rect items (walls/bridges/water/sand/hills); Posts: resize radius; Tee/Cup: move-only; multi-select transforms apply to all selected; rotation restricted to rect-like items; polygons translate-only and hide rotation handles when included in selection
- [x] Undo/Redo in Level Editor
  - Placement: Editor Tools menu with dynamic labels showing availability
  - Shortcuts: Ctrl+Z (Undo), Ctrl+Y (Redo), Shift+Ctrl+Z (alternative Redo)
  - State management: 50-step undo stack with automatic snapshots on all placement, deletion, movement, resize, and rotation operations
  - UI feedback: toast messages showing undo/redo descriptions; menu labels update dynamically
- [x] Clipboard: Copy/Cut/Paste selected objects in Level Editor
  - Shortcuts: Ctrl+C (Copy), Ctrl+X (Cut), Ctrl+V (Paste)
  - Supports: rects (walls/water/sand/bridges/hills), posts (radius preserved), polygons (translate-only)
  - Paste behavior: place at mouse cursor with grid snapping and fairway clamping; maintain relative offsets for group selections
  - Cross-level: allow pasting into another level within the same editor session
- [x] Import: Proper Import flow to complement Export
  - UI: in-game overlay with file picker and list (supports multi-select); clear source labels [FS]/[User]
  - Validation: full schema validation with readable error reporting; automatic fix-ups where safe
  - Metadata: set/confirm authorName/authorId and lastModified; title prompt with conflict resolution (rename/overwrite/cancel)
  - Sources: filesystem (File System Access API) and browser builds (file upload)
- [x] Course Select: add "User Made Levels" category; list Title — Author; Play; owner/admin Edit/Delete; permissions gating; no regression
- [x] Level Editor file system integration
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
  - Fix: Added inline `renderGlobalOverlays()` calls in `draw()` for `course`, `options`, and `changelog` states, so overlays render on these screens too.
- [x] Tool palette: Tee, Cup, Walls/WallsPoly, Posts, Bridges, Water/WaterPoly, Sand/SandPoly, Hills, decorations (full authoring behaviors)
- [x] Metadata editor for level title and author (persist in JSON)
- [x] Par/Birdie suggestion engine based on path analysis and bank heuristics

## User System — Completed
- [x] Local profiles: create/select active user; persist name and role (admin/user)
- [x] Roles & permissions: Admin can edit/delete any level; Normal users can edit/delete their own and duplicate others
  - [x] Verify current enforcement across Save/Delete flows and any editor entry points
  - [x] Add clear UI messaging when an action is blocked due to permissions
  - [x] Add unit tests for permission rules (UsersStore invariants: last-admin safeguards, enable/disable, promote/demote, import/export, init fallbacks)
- [x] Admin-only role management UI (no toggle on Main Menu)
  - Access: Press Shift+F after clicking Start (from Select Course and onward). Options button removed.
  - Admin-only Role Management UI:
    - Add/Remove Users
    - Promote/Demote Users (toggle role user ⇄ admin)
    - Safeguards: cannot remove the last remaining admin; confirm destructive actions; prevent self-demotion when last admin.
  - Default Admin bootstrap (first run): seed a built-in `admin` account with role `admin` so an admin can create another user and promote them. After another admin exists, the built-in `admin` can be disabled.
  - Persistence: Firebase Realtime Database for users and roles
    - Source of truth: Firebase Realtime Database with real-time synchronization
    - Admin UI provides Import/Export JSON functionality for backup/restore
    - No passwords/auth yet (MVP): "login" = selecting an existing user as active profile
  - [optional] Better UI feedback: Replace alert/prompt/confirm with inline messages/snackbar for a smoother admin experience.
- [x] Level ownership: store `meta.authorId`/`meta.authorName` in level JSON; enforce Save/Delete permissions; enable Save a Copy for non-owners
- [x] Scores by user: record per-level and per-course scores keyed by active user; show best for current user (optional all-users view)
- [x] Main Menu: username input field placed above Start and below the graphic; Start disabled until a non-empty username is entered; persist/prefill last user
- [x] Start is blocked when the entered username matches a disabled user (disabled users cannot proceed past Main Menu)
- [x] Disabled-user hint under username input (“User is disabled. Ask an admin to re-enable or select a new name.”)

## Soon (Completed items)
- [x] Water tiles: splash SFX → +1 stroke → reset to pre-shot location
  - [x] Visual ripple and SFX on water contact
- [x] Post-Hole banner with classic golf terms
  - [x] Basic label (Eagle/Birdie/Par/Bogey/Over) with color tint
  - [x] Extended mapping: Condor (-4), Albatross (-3), Eagle (-2), Birdie (-1), Par (0), Bogey (+1), Double Bogey (+2), Triple Bogey (+3); 4+ over shows numeric "n Over"
- [x] Bank-shot dev harness (dev-only path preview) — toggle with `B` (dev builds only)
- [x] Palette extraction to `docs/PALETTE.md`; applied flat fills + clear outlines for water/sand (rects: 1.5px inset; polys: 2px stroke)
 - [x] Options: basic SFX volume and mute controls
- [x] 2025-08-24: Fixed cross-browser level access issue by implementing automatic level migration when user ID changes during Firebase synchronization

## Done (Historical)
- [x] 2025-08-25 — User Made Levels UI: mouse click support and redesign
  - Added full mouse click support for list items and action buttons (Play/Edit/Delete/Duplicate)
  - Redesigned entries with card-style layout, color-coded source badges, permission hints, and modern scrollbar
  - Updated hit detection to match new button layout and positions
- [x] 2025-08-25 — Level Editor Decorations fix
  - Corrected placement schema for decorations to use `kind` (not `type`) and include `w`/`h` dimensions
  - Added missing `defaultRadius` variable to resolve TypeScript errors
  - Verified decorations (Flowers/Trees/Rocks/Bushes) place and render correctly
- [x] 2025-08-25 — User level visibility for normal users (discover all user-made levels). Kept edit/delete gated by owner/admin checks. Removed obsolete migrations from `src/main.ts` and `src/firebase/index.ts`.
- [x] 2025-08-25 — Fixed Firebase level deletion using proper Firebase ID
  - `src/editor/levelEditor.ts`: Load picker now stores the true Firebase ID (`entry.name`) separately from the UI label. `openDeletePicker()` uses this ID when calling `firebaseManager.levels.deleteLevel()`.
  - Verified `src/main.ts` delete flow already resolves a `LevelEntry` and passes `levelToDelete.name` (the Firebase ID), so no change was necessary there.
- [x] Fix: Resolved TypeScript errors in `src/main.ts` — verified `loadLevel`, `loadLevelByIndex`, `preloadLevelByIndex` implementations near file end; added explicit `unknown` type to a caught error parameter to satisfy strict TS.
  - [x] Closed missing closing brace in `draw()`; `npx tsc --noEmit` is clean.
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
- [x] Main Menu → Level Editor: await Firebase user synchronization before initializing editor; removed duplicated block and closed missing brace in `src/main.ts`. TypeScript build (`tsconfig.build.json`) is clean.
- [x] Main Menu: username input focus UX — blinking caret, placeholder hides during edit, I-beam cursor while editing; thicker focus border; input nudged down to avoid clipping.
- [x] HUD: show active user's name on the top-left; push `Hole x/y` label right to make room.
- [x] User System: removed Main Menu role toggle; roles will be managed by Admin-only controls (upcoming). Role still persists to localStorage for permissions.
- [x] User System: level ownership metadata (authorId/authorName) added to Level schema; per-user score tracking with best scores shown in HUD.
- [x] Docs: CHANGELOG structure restored (Unreleased on top); version 0.3.23 recorded
- [x] Fix (2025-08-24): Level Editor loading did not apply saved canvas dimensions. Updated `loadEditorLevelIntoGlobals()` in `src/editor/levelEditor.ts` to set `levelCanvas.width/height` from level data. Verified via build; recorded in `CHANGELOG.md`.
- [x] Admin visibility (2025-08-24): Admins can view all users' levels (public + private) across Level Editor and Course Select. Wired in `src/main.ts` to pass `undefined` as `userId` for admins to `firebaseManager.levels.getAllLevels()`.
- [x] Fix: TypeScript config — removed invalid `"vitest/globals"` type from `tsconfig.json` to clear IDE TS error; tests import Vitest APIs directly.

