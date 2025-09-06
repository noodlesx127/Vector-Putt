# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v0.3.27 — 2025-09-06

### Changed
- Level Editor • Author display name resolution: editor now derives a friendly `authorName` via a resilient `resolveDisplayName()` that prefers `EditorEnv.getUserName()` (trimmed), then `env.getGlobalState().userProfile.name`, and finally falls back to `getUserId()`. Applies to `newLevel()`, `save()`, and `saveAs()` in `src/editor/levelEditor.ts`.
- UI • User Levels source label: show `cloud` for Firebase-sourced entries (was `local`). (`src/main.ts`)
 - UI • User Made Levels panel: refreshed to the standard centered panel per `UI_Design.md` with responsive sizing (min margins), background `rgba(0,0,0,0.85)`, and border `#cfd2cf`. (`src/main.ts`)
 - UI • Options screen: converted to standard centered panel per `UI_Design.md` with dark overlay, responsive sizing, `rgba(0,0,0,0.85)` background, `#cfd2cf` border, and reflowed Controls/Audio sections into the panel. (`src/main.ts`)

### Fixed
- Level Editor • Overlap selection: selecting when objects overlap now picks the top-most (visually front) object. `findObjectAtPoint()` hit-test order was inverted to mirror render order and iterates arrays in reverse so the most recently drawn object is prioritized. (`src/editor/levelEditor.ts`)
- Level Editor • Metadata/title persistence: `editMetadata()` now sets both `course.title` and `meta.title`, and `save()` ensures `meta.title` mirrors `course.title` if missing. Prevents Firebase updates with `title: undefined`. (`src/editor/levelEditor.ts`)
- Level Editor • Save ownership enforcement: for non-admins, `save()` blocks overwriting when the existing level owner is missing or differs, and routes to Save As with a toast. (`src/editor/levelEditor.ts`)
- Level Editor • Missing getUserName() crash: guarded against environments where `getUserName()` is not provided by the editor env, preventing `TypeError: getUserName is not a function`. (`src/editor/levelEditor.ts`)
- Course Creator • Reorder save: saving after reordering levels now persists the new `levelIds` order by using the updated `courseData` returned from the overlay. Added debug logs around the save path for visibility ("CourseEditor: Saving course" / "Save complete"). (`src/editor/levelEditor.ts`)
 - Level Editor • Session reset on exit: exiting to the main menu now clears editor session state so re-entering starts with a fresh level. Implemented `levelEditor.reset()` and wired all editor `exitToMenu` handlers to call it. (`src/editor/levelEditor.ts`, `src/main.ts`)


## v0.3.26 — 2025-09-05

### Added
- Level Editor • Course Creator: integrated drag-and-drop reorder overlay and matching in-game overlay UI (centered 800x600 panel, keyboard+mouse, scrollable list, Save/Cancel).
- Admin Menu redesign: Shift+F opens Admin Menu with Level Management and User Management sections.
- Firebase guidance documentation (`docs/firebase.md`) with schema and standards.
- Firebase course integration: full Firebase course loading and playback support in Course Select.
- Course Creator integration: admin-only Course Creator button in Course Select.
- Level Editor Load Level: filtering (My Levels, Other Users, Dev Levels, All Levels) with proper permissions.

### Changed
- Level Editor • Save flow aligned to `firebase.md` guidance:
  - Pre-save validation using `validateLevelData()` with clear toast errors.
  - Metadata timestamps: sets `meta.lastModified = Date.now()` alongside ISO `created/modified`.
  - Author propagation: sets `meta.authorName` from active username when available (fallback to userId).
  - Safe updates: existing levels only update `title`, `data`, and optional `authorName` (do not overwrite `createdAt`, `isPublic`, or `authorId`).
- Types: `src/firebase/FirebaseLevelStore.ts` Level interface harmonized with `firebase.md` (polygon points as `number[]`, posts use `r`, rects use `rot`, include `course`, `par`, and meta timestamps).
- Course Select UI redesign: centered panel with `courseSelectState` and `courseSelectHotspots`, mouse wheel scrolling, hover states.
- User Made Levels entry moved to a separate button on Course Select for clarity between levels vs courses.
- Firebase course loading: optimized batch load of course levels vs per-level requests.
- Course Creator reorder overlay: validates duplicates/unknown IDs and skips no-op saves with appropriate toasts.
- Level Editor: `openCourseCreator()` now uses the new Course Creator overlay via `EditorEnv.showUiCourseCreator()`; Cancel returns to the editor.

### Fixed
- Firebase levels update path detection: `updateLevel()` correctly updates public dev levels under `levels/{id}` and user levels under `userLevels/{userId}/{id}`.
- Course Select: arrow key navigation (Up/Down with auto-scroll), Enter to load, Escape to back; confirm dialog before loading to prevent misclicks.
- User Made Levels: arrow key navigation, confirm dialog before loading, mouse wheel scrolling; fixed scroll state sync between `selectedUserLevelIndex` and `userLevelsState.scrollOffset`.
- Level Editor: fixed admin editing dev levels inadvertently creating new userLevels instead of updating existing levels (ensured `editorCurrentSavedId` handling).
- Level Management: fixed delete button freeze, missing confirmation dialog rendering, incorrect delete parameters, and state refresh; preserved `authorId` by loading raw Firebase data.
- Course Editor drag-and-drop: fixed missing level reordering with comprehensive drag state tracking and visual feedback.
- Firebase course playback: fixed loop after 4 levels; courses now play full sequence in correct order.
- Course UI display: fixed "Hole X/Y" to show correct total levels for Firebase courses.
- Overlays: fully swallow keyboard events while a modal is open to prevent underlying UI interactions.

### Technical
- EditorEnv UI wiring: Added `showDnDList` to all editor environment constructions in `src/main.ts` via a type-safe adapter that bridges to `showUiDnDList` (whose `UiListItem.value` is optional). The adapter guarantees `value` on return to satisfy `EditorEnv.showDnDList()` type and resolves prior TS mismatches.
- TypeScript: removed a duplicate `getUserId` property from `editorEnv` in `src/main.ts`; kept shorthand reference.

## v0.3.25 — 2025-09-01

### Added
- HUD: Best score display restored in gameplay HUD (course mode only). Fetches asynchronously from Firebase per level and updates after saving scores.
- Scripts: One-time Levels Migration CLI `scripts/migrate-levels.js` to import JSON files from `levels/` into Firebase public dev levels. Includes `npm run migrate:levels` and `npm run migrate:levels:dry-run`.
- Level Editor: Admin-only "Course Creator" overlay under Editor Tools. Item is visible only to admins, gated via `EditorEnv.getUserRole()`.
  - Lists courses, create/rename/delete, add/remove/reorder levels using in-game overlays (`showList`/`showPrompt`/`showConfirm`).
  - Persists to Firebase via new `courses` path and `FirebaseCourseStore` (CRUD backed by `FirebaseDatabase`).
 - Firebase: Introduced dedicated `courses` path in Firebase Realtime Database with full CRUD in `src/firebase/database.ts`; added `src/firebase/FirebaseCourseStore.ts` providing caching and course operations used by the editor overlay.

### Changed
- User level visibility: Normal users now see all user-created levels (in addition to public levels). Edit/Delete permissions remain restricted to owners and admins via existing checks.
- User Made Levels UI: added full mouse click support for list items and action buttons (Play/Edit/Delete/Duplicate); redesigned entries with card-style layout, color-coded source badges, clearer button layout, and permission hints. Improved scrollbar styling and hit detection to match the new layout.
- Dev Levels loading: Dev/bundled levels are now loaded from Firebase only. Removed default static `'/levels/*.json'` paths from runtime and switched Course Select "Dev Levels" to use `startDevCourseFromFirebase()`.
- Filesystem level scan: Restricted `scanFilesystemLevels()` to dev builds via `isDevBuild()` to avoid production 404s when `/levels/` is not served.
 - Editor gating: Enforced admin-only access for Course Creator at both the menu item and overlay using `EditorEnv.getUserRole()`.
- Level Editor save permissions: Enforced ownership-based overwrite in `src/editor/levelEditor.ts`. Normal users can only overwrite their own levels; admins can overwrite any level. Non-owners attempting Save are redirected to Save As with a toast explaining why.
- Save As ownership: `saveAs()` now always sets `level.meta.authorId` to the current user to ensure new copies are owned by the saver.

### Removed
- Automatic runtime level migrations during Firebase initialization (both legacy localStorage and bundled levels). Migrations are now handled exclusively via the CLI `scripts/migrate-levels.js`.
- Obsolete user data migration flows: removed cross-ID level migration and single-slot migration code paths; removed `migrateUserData()` usage. Startup still performs bundled/public and legacy localStorage level migrations only.

### Fixed
- Level deletion (User Made Levels): Use Firebase level ID (key) instead of title when deleting from `src/main.ts`. Store the ID on `UserLevelEntry.id` and pass it to `FirebaseLevelStore.deleteLevel()`.
- Level loading issues: Fixed level rendering problems and ball disappearing after hitting by correcting property name mapping inconsistencies between `sandPoly`/`waterPoly` and `sandsPoly`/`watersPoly` in level data structures
- Level deletion: Fixed invalid Firebase path during delete by ensuring the Firebase level ID is used everywhere. `src/editor/levelEditor.ts` now stores the real Firebase ID when loading a level (not the UI label), so `openDeletePicker()` passes a valid ID to `FirebaseLevelStore.deleteLevel()`.
 - Level Editor Decorations: fixed decorations placement schema (use `kind` instead of `type`; include `w`/`h` dimensions; added missing `defaultRadius` variable) so Flowers/Trees/Rocks/Bushes place and render correctly.
 - Thumbnails (Level Editor): corrected water/sand naming in `generateLevelThumbnail()` to use editor-level keys `water`, `waterPoly`, `sand`, `sandPoly`, and `wallsPoly` (instead of pluralized or mismatched keys). Prevents missing water/sand/wallsPoly in level preview thumbnails. (`src/main.ts`)
 - Level Editor TypeScript fixes:
   - Fix (Level Editor): Closed a missing brace in `handleMouseUp()` within `src/editor/levelEditor.ts` that caused TS1128 (“Declaration or statement expected”).
   - Fix (Level Editor): Implemented `renderWithRotation()` helper in `src/editor/levelEditor.ts` used by the editor preview to draw rotated rect-like objects. Resolves TS2339 errors and restores correct rendering for rotated Water/Sand/Bridge/Hill/Wall/Decoration.
 - Level Editor Save/Load: Editor now saves, loads, and deletes levels via Firebase instead of local filesystem dialogs. Replaced `saveLevelToFilesystem()`/`loadLevelsFromFilesystem()`/directory access with `FirebaseLevelStore.saveLevel()`, `.getUserLevels()`, and `.deleteLevel()` in `src/editor/levelEditor.ts`. Eliminates browser file pickers during Save/Load.
 - Level Editor Load: Fixed "Failed to load level" in the editor by normalizing list selection handling to use `chosen.value` from `showList()`, falling back to the raw object when needed. Added robust fetch fallback to try user-scoped `loadLevel(id, userId)` and then public `loadLevel(id)` if needed, plus targeted debug logs to trace `id`, `userId`, and fetch source. (`src/editor/levelEditor.ts`)
 - Dev Levels 404s in production: Replaced static `/levels/` fetching with Firebase-backed Dev Levels and gated filesystem scanning behind `isDevBuild()`. Prevents course select and editor from hitting 404s in deployed builds.

## v0.3.24 — 2025-08-24

### Added
- Firebase Realtime Database integration for cloud-based data persistence
- Real-time level synchronization across devices and sessions
- Firebase-powered user management with automatic data migration
- Cloud-based score tracking and leaderboards
- Cross-device level sharing and discovery
- **Level Editor Undo/Redo**: Full undo/redo system with Ctrl+Z/Ctrl+Y shortcuts, 50-step history, automatic snapshots on all operations (place, delete, move, resize, rotate), and dynamic menu labels with toast feedback
 - **Level Editor Clipboard**: Copy, Cut, Paste for selected objects with Ctrl+C / Ctrl+X / Ctrl+V
   - Supports rectangles (walls, water, sand, bridges, hills), posts (radius preserved), and polygons (`wallsPoly`, `waterPoly`, `sandPoly`, translate-only)
   - Paste at mouse cursor with grid snapping and fairway clamping; retains relative offsets for multi-select groups
- **Level Editor Import**: Proper Import flow with file picker and validation
   - Import menu item in File menu with keyboard shortcut support
   - Full schema validation with readable error reporting and automatic fix-ups
   - Metadata prompts for title and author with conflict resolution
   - Unsaved changes confirmation and undo/redo history reset
- **Level Editor Metadata**: Metadata editor for level title, author, and par
   - Metadata menu item in File menu for editing level properties
   - Prompts for title, author name, and par value (1-9) with validation
   - Undo/redo integration and automatic lastModified timestamp updates
- **Level Editor Tool Palette**: Complete tool palette with full authoring behaviors
   - Enhanced decoration tools: Flowers, Trees, Rocks, Bushes with placement system
   - Decoration tool with keyboard shortcut (D key) and menu integration
   - All tools now support full authoring workflow with proper state management
- **Par/Birdie Suggestion Engine**: Intelligent par calculation based on level analysis
   - Analyzes distance, obstacles, bank shot opportunities, and complexity
   - Considers walls, posts, water, sand, hills, and elevation changes
   - Provides detailed analysis summary with suggested par value
   - Accessible via File → Suggest Par menu with confirmation dialog

### Changed
- Migrated from localStorage to Firebase Realtime Database
- Level Editor now saves directly to Firebase cloud storage
- User Made Levels system now loads from Firebase with real-time updates
- Score system updated to use Firebase with async operations
- Level discovery system migrated to Firebase for cross-user sharing
 - Dev/Test: Changed Test Overlay hotkey from `T` to `Shift+T` to avoid conflicts while typing in text inputs

### Fixed
- Fixed duplicate user creation in Firebase user management with existence checks
- Added missing back button to admin users menu (Shift+F) with proper hotspot registration
- Fixed Level Editor level loading issue where canvas dimensions weren't updated after loading saved levels
- Fixed Level Editor Firebase integration to use getAllLevels API (same as User Made Levels picker)
- Fixed level loading issue where no levels were found in Level Editor and Course Select by implementing automatic migration of bundled filesystem levels to Firebase on startup with enhanced logging and fallback migration for production builds
- Fixed level saving to properly set title in metadata for Firebase persistence
- Fixed Level Editor loading crash when level data missing arrays (bridges, decorations, etc.)
- Fixed user ID consistency between Level Editor and User Made Levels picker for Firebase operations
- Made user system case insensitive for username comparisons in level ownership checks
- Fixed cross-browser level access by implementing automatic level migration when user ID changes during Firebase synchronization
- Level Editor entry now awaits Firebase user synchronization before initializing editor; removed a stray duplicated block in `src/main.ts` that caused TypeScript parse errors; closed a missing `isDevBuild()` brace. Build is clean under `tsconfig.build.json`.
- Admin visibility: Admins now see all user levels. Updated `src/main.ts` to call `firebaseManager.levels.getAllLevels(undefined)` for admins in both `readLevelsDoc()` and `getAllLevels()` so the Firebase store aggregates all users' levels for admin mode.
- Fix: Removed deprecated `firebaseUsersStore.migrateFromLocalStorage()` call from `FirebaseManager.init()`; resolves TypeError during tests. Users are Firebase-only now; level migrations remain.
- Compatibility: Added a safe no-op `users.migrateFromLocalStorage()` method in `src/firebase/FirebaseUsersStore.ts` that reads legacy `vp.users` from localStorage and attempts to create users in Firebase, swallowing errors. This keeps existing Firebase tests passing while users remain Firebase-only going forward.

### Technical
- Added type adapters to handle polygon format differences between Firebase and main app
- Implemented automatic localStorage to Firebase data migration
- Updated Level Editor with Firebase persistence fallbacks
- Enhanced User Made Levels with Firebase-based CRUD operations
- Fixed TypeScript nullability errors in Level Editor Firebase integration
- Resolved Firebase test suite issues: mock state bleeding, error handling, and method calls
- Fixed Firebase test isolation to prevent real database connections during testing
- Created comprehensive Firebase database cleanup tool with duplicate removal, orphan cleanup, and data validation
- Fix: Converted `scripts/cleanup-db.js` to ESM `import` to align with `package.json` ("type": "module"); resolves Node v22 require() error when running cleanup scripts
 - Build fix: added `src/firebase.ts` barrel so `import './firebase'` in `src/main.ts` resolves to `./firebase/index` for Vite/Netlify production builds
- Fix: Updated TypeScript build configuration for Node.js compatibility; added `.js` extensions to imports and Node module resolution for cleanup CLI
- Fix: Removed Firebase Analytics import from config to prevent browser module loading failures; analytics now loads conditionally in browser environment only

### Tests
- Fix: Hardened error handling in `src/__tests__/FirebaseConnection.test.ts` for strict TypeScript.
  - Introduced `getErrorMessage(err: unknown)` helper and replaced direct `error.message` access and substring checks.
  - Resolves TS18046 errors under `--strict`/`--noErrorTruncation` by properly narrowing unknown errors.

### Added
- **Firebase Realtime Database Integration**: Complete migration from localStorage to Firebase Realtime Database
  - User management, level persistence, settings, and scores now stored in Firebase
  - Real-time data synchronization across sessions and devices
  - Automatic migration from existing localStorage data
  - Firebase configuration with provided credentials for vector-putt project
  - Centralized Firebase service management through FirebaseManager
- **Level Editor Polygon Tools**: Implemented WallsPoly, WaterPoly, SandPoly with click-to-add-vertex placement, Enter/Escape to finish/cancel, click-near-start to close
- **Level Editor Hill Direction Control**: Interactive picker UI with N/S/E/W directional arrows for hill placement
- **Level Editor Post Radius Control**: Interactive picker UI with radius options (6, 8, 10, 12, 16, 20) for post placement
- **Level Editor Point Placement**: Tee, Cup, and Post tools with proper click placement and grid snapping
- **Course Select User Made Levels**: Complete implementation of User Made Levels category in Course Select screen
  - Lists user-created levels from filesystem (`User_Levels/<Username>/`) and localStorage with title, author, and source labels
  - Play/Edit/Delete actions with owner/admin permission enforcement
  - Keyboard navigation: Up/Down to navigate, Enter to play, E to edit, Delete to delete, Esc to go back
  - Mouse hover support for level selection and action buttons
  - Integrated with Level Editor filesystem persistence for seamless level creation and management
- **Level Editor Test Level**: Added Test Level functionality for quick level testing during creation and editing
  - Test Level menu item in File menu and Ctrl+T keyboard shortcut
  - Validates level has required tee and cup before testing
  - Loads current editor state directly into gameplay without saving
  - Visual test mode indicator in HUD with return instructions
  - Press Esc during test to return to Level Editor
  - Seamless workflow for iterative level design and testing

### Changed
- **Level Editor Migration Completed**: Successfully migrated all level editor code from `src/main.ts` to modular `src/editor/levelEditor.ts` structure
   - Moved editor state management, input handling, rendering, and persistence to dedicated module
   - Updated `main.ts` to use levelEditor module API through EditorEnv interface
   - Removed duplicate/legacy editor code from main.ts while preserving integration layer
   - Fixed console log spam and verified tool palette functionality
   - Verified TypeScript compilation and tested editor functionality
 - UX: Replaced all browser-native dialogs (alert/prompt/confirm) with in-game overlay modals
   - Level Editor: Save, Save As, Load, New, Delete now use `showUiToast`/`showUiConfirm`/`showUiPrompt`/`showUiList` (async, non-blocking, keyboard-friendly)
   - Users Admin UI: add/remove/promote/demote/import/export actions now use overlays; errors reported via toasts
   - Keyboard: Enter/Esc supported; menu Enter handler wraps async actions to avoid unhandled promise rejections
 - Fix: Overlay dialogs were not visibly rendering. Integrated modal overlay drawing and `overlayHotspots` rebuilding into the main `draw()` loop so Confirm/Prompt/List appear and are interactive across all states. Mouse clicks are swallowed while an overlay is active to prevent click-through. Toast notifications now render as a top-right stack and auto-expire.
 - Fix: TypeScript config — removed invalid `"vitest/globals"` type from `tsconfig.json` to resolve TS error. Tests import Vitest APIs directly, so global typings are not required. After installing dependencies, you may optionally restore typings via `"types": ["vitest"]`.
 - Policy: Removed LocalStorage option from Editor "Save As"; only Filesystem and `User_Levels/<Username>/` allowed in dev/admin builds
 - Fix: TypeScript narrowing in Users Admin "remove" confirm flow; captured `hs.id` prior to async
 - Fix: Editor menu and keyboard handlers wrap async calls with `.catch(console.error)` to avoid unhandled rejections
 - Fix: Overlays did not render on Course Select, Options, and Changelog screens due to early returns in `draw()`. Added inline `renderGlobalOverlays()` calls before those returns so overlays render consistently across all UI states. Mouse clicks are swallowed while an overlay is active to prevent click-through. Toast notifications now render as a top-right stack and auto-expire.
 - Fix (Level Editor): Back/Exit now confirms and properly returns to Main Menu from the editor.
   - Implemented File menu Back/Exit action to show in-game confirm, then call `env.exitToMenu()`.
   - Added `exitToMenu` to the keyboard `editorEnv` in `handleLevelEditorKeys()` so Escape uses the same confirm-and-exit flow without runtime/type errors.
   - Escape key path is guarded by overlay/menu state to avoid accidental exits.

### Fixed
- Fix (Level Editor • File menu): Save / Save As / Load behaviors
  - Save now prompts for a level name when none exists; uses a slugged name as the key for persistence.
  - Save As always prompts for a new level name and saves a new copy.
  - Level Load shows a simple prompt-based list to choose which saved level to load (replaces previous behavior that loaded the first entry).
  - Note: This is a temporary prompt-based UI; a proper in-game overlay picker will replace prompts in a follow-up.
- Feature (Level Editor • Filesystem Integration): Complete filesystem persistence implementation
  - File System Access API support for direct file read/write to User_Levels/<Username>/ directories
  - Load levels from bundled levels/ directory, User_Levels/, and localStorage (backward compatibility)
  - Save prioritizes filesystem over localStorage; falls back gracefully when File System Access unavailable
  - Export functionality for browser-only builds (download as JSON)
  - Import level from file upload when no saved levels found
  - Level validation and metadata (author, lastModified) automatically added on save/export
  - Combined level picker shows source labels: [bundled], [user], [localStorage]

 - Fix (Level Editor): Added local `COLORS` constant and `SelectableObject` union in `src/editor/levelEditor.ts` to avoid cross-module type mismatches. Palette values mirror `docs/PALETTE.md` and `src/main.ts`.
 - Fix (Level Editor): Standardized naming to `wallsPoly` in `getObjectBounds()` (removed stray `wallPoly` reference) to match tools and data arrays.
 - Fix (Level Editor): Removed legacy shadow drawing for walls, polygon walls, and posts outside rotation transforms. Shadows now render exclusively within `renderWithRotation()` so they rotate correctly without duplication (`src/main.ts`).
 - Fix (Level Editor): Polygon objects (wallsPoly, waterPoly, sandPoly) are now fully selectable, movable, and deletable in the Level Editor.
   - Selection and hit-testing include polygon variants via updates to `findObjectAtPoint()` and `getObjectBounds()`.
   - Movement translates polygon vertex `points` in `moveSelectedObjects()` (arrow-key nudges and drag move).
   - Delete-key handler removes selected polygon objects from runtime arrays and `editorLevelData`, then calls `clearSelection()`.
   - Removed duplicate/incorrect definitions of `moveSelectedObjects()`, `isPointInObject()`, and `findObjectAtPoint()`; kept the correct implementations (`src/main.ts`).
 - Feature (Level Editor): Filesystem integration for level persistence
   - Load levels from both localStorage and `levels/` directory with [LS]/[FS] labels in picker
   - Save options: LocalStorage, Filesystem (File System Access API/download), User Directory (`User_Levels/Username/`)
   - Comprehensive schema validation for level files with detailed error reporting
   - Filesystem cache with invalidation for performance
   - Support for editing existing `levels/*.json` files from the game
 - Fix: Resolved TypeScript errors in `src/main.ts`
  - Verified and referenced implementations for `loadLevel`, `loadLevelByIndex`, and `preloadLevelByIndex` (present near end of file) to address previously reported "missing function" errors.
  - Added explicit `unknown` type for a caught error parameter (`err`) to satisfy strict TypeScript settings.
  - Closed a missing closing brace in `draw()` that caused TS1005 (`'}' expected`) at EOF; `npx tsc --noEmit` is now clean.

- Refactor (Level Editor): Delegated all editor keyboard handling from `src/main.ts` to `levelEditor.handleKeyDown()` with `editorEnv`.
  - Removed legacy/unreachable code that referenced old globals (`selectedEditorTool`, `openEditorMenu`, `selectedObjects`, `editorLevelData`, `editorGridSize`, `clearSelection()`, `moveSelectedObjects()`).
  - `main.ts` no longer contains editor-specific key logic; the Level Editor module fully owns shortcuts, grid controls, and menu navigation.

- Level Editor: Menubar with pull-down menus (replaces compact toolbar)
  - Four menus: File (New, Save, Save As, Level Load, Delete, Back/Exit), Objects (fairway items: Tee, Cup, Post, Wall, WallsPoly, Bridge, Water, WaterPoly, Sand, SandPoly, Hill), Decorations (Flowers), Editor Tools (Select Tool and Grid controls)
  - Mouse interaction: click headers to open/close menus, click items to execute actions
  - Keyboard navigation: Alt+F/O/D/E for menu mnemonics, Arrow keys for menu navigation, Enter to select, Escape to close
  - Visual: semi-transparent background with proper layering above the level preview
 - Integration: all existing editor actions and tools accessible through menubar
 - Fix: Editor Tools labels updated to reflect new order after moving 'Select Tool' — restores 'Select Tool' label and removes duplicate 'Grid +' entry
  - Known issue: File menu actions may be blocked in some environments; added safePrompt/safeConfirm fallbacks and verbose logging. Persistence is localStorage-only for now; filesystem-backed editor I/O is planned.
  - Level Editor: Select Tool enhancements
    - Single/multi-select (Ctrl/Shift add/remove) + drag-selection rectangle
    - Move selected with mouse (grid snap, bounds clamp) and arrow-key nudges
    - Delete removes selected (tee/cup preserved)
    - 8-point resize handles for rect items (walls/water/sand/bridges/hills) with snapping, min size = 1 grid step, and bounds clamping
    - 4-point rotation handles for rect items with 15-degree angle snapping
    - Visuals: dashed blue outlines, blue resize handles, orange rotation handles, translucent selection box; cursors update for move/resize/rotate
  - Level Editor: Select Tool — Group rotation and polygon guards
    - Multi-select group rotation via rotation handles around group bounds; rotates about the group center
    - Hold Shift to snap rotation to 15° increments; original object states snapshot at rotation start for accurate transforms
    - Polygons (`wallsPoly`, `waterPoly`, `sandPoly`) are translate-only: rotation/resize disabled; rotation handles hidden when any polygons are selected
    - Single-object rotation restricted to rect-like types only (`wall`, `water`, `sand`, `bridge`, `hill`, `decoration`)
    - Selection bounds cache computed each frame; multi-select bounding box follows drag offset during move for accurate visuals
    - Rotation state is cleared on mouse up (group snapshots/angles reset)
 - User System: Main Menu username input added above Start. Start is disabled until a non-empty name is entered. Username persists to `localStorage` and is prefilled on load. Cursor changes to text I-beam on hover, and placeholder shown when empty.
- Fix: removed redundant Main Menu mouse handlers that could blur the username input on mouseup; consolidated focus handling so editing is stable.
 - UX: username input now has a clear focus state — placeholder hides while editing, caret blinks at the end of text, and I-beam cursor remains during edit. Input field nudged down to avoid clipping into the main graphic.
 - HUD: display active user's name on the top-left; `Hole x/y` pushed right to make room.
 - Removed: Main Menu role toggle; roles will be managed via admin-only controls (upcoming). User role still persists to localStorage for permissions.
 - User System: level ownership metadata (authorId/authorName) added to Level schema; per-user score tracking with best scores shown in HUD.
 - Change: Admin Users UI access moved to Shift+F (admin-only) after clicking Start (from Select Course onward). Options "Users" button removed.
 - Change: Start is now blocked if the entered username matches a disabled user in the UsersStore (or local storage fallback). Disabled users cannot proceed past the Main Menu until re-enabled by an admin.
  - UX: When a disabled username is entered, a red hint appears under the input: "User is disabled. Ask an admin to re-enable or select a new name."
 - UX: Increased vertical spacing under the username input and moved Start/Options down slightly to give the disabled-user hint more room.
 - Testing: added Vitest and a UsersStore unit test suite covering add/remove, enable/disable, promote/demote safeguards (cannot remove/disable last admin; prevent self-demotion when last admin), import/export, and init() fallbacks.
 - CI: updated GitHub Actions workflow to run tests before build.

 - Main Menu: added "Level Editor" button between Start and Options. Enabled only when the username passes the same validation as Start (non-empty and not disabled). Hover/cursor states match other buttons.
 - Game State: introduced `levelEditor` state with a placeholder screen and a Back button (reuses `getCourseBackRect()`) to return to Main Menu.
 - Input: updated mousemove/mousedown handlers to manage hover and clicks for the Level Editor entry and the Level Editor Back button. Cursor shows pointer on hover when enabled.
 - Layout: added `getMainLevelEditorRect()` and moved Options down via `getMainOptionsRect()` to accommodate the new entry.
 - Level Editor: Tee and Cup placement tools with 20px grid snapping; placement clamps to fairway bounds and updates in-memory editor level data.
 - Editor Actions: Multi-level persistence with Save, Save As, Load, New, and Delete using `localStorage` key `vp.levels.v1`. Each saved level has a unique ID plus title and ownership metadata; editor tracks the current saved ID to enable overwrite semantics.
 - Draw: Editor preview renders the fairway panel with outline, grid overlay (toggle respected), and Tee/Cup markers (ball + hole with flagstick).
 - Input: cursor shows crosshair when Tee/Cup tools are active over the canvas; clicking Save/Load triggers persistence handlers.

  - Permissions: Overwrite/Delete are restricted to the level owner or admins. Non-owners are shown an alert and automatically routed to "Save As" to create a copy. Enforced via `canModifyLevel()` in `saveEditorLevel()` and `openDeletePicker()`.
  - Migration: On first entry to the Level Editor, `enterLevelEditor()` invokes `migrateSingleSlotIfNeeded()` to migrate legacy single-slot data from `vp.editor.level` into the new `vp.levels.v1` format with ownership/timestamps.
  - UI Wiring: Editor action buttons (Save, Save As, Load, New, and Delete) are part of `editorUiHotspots` and handled in the Level Editor mousedown logic; hotspots are rebuilt each frame for reliable hit testing.

 - Level Editor UI: menu panel now renders above the fairway/grid preview (draw order fixed). Added a semi-transparent panel background and border so controls remain readable.
- Fix: editor buttons were visually obscured by the grid; buttons and hotspots are now drawn last to ensure proper layering (interaction unchanged).

 - Level Editor: Grid controls added
   - Panel actions: Grid On/Off toggle and Grid - / Grid + (labels show current size in px)
   - Shortcuts: G toggles grid; +/- adjust grid size; Arrow keys nudge Tee/Cup by one grid step
   - Hotspots and rendering order preserved; actions integrated into `editorUiHotspots`

- Level Editor UI: compact horizontal top toolbar
  - Replaced the vertical left panel with a compact two-row top toolbar (tools on top; actions below).
  - Integrated Back as an action button on the right side of the toolbar; removed separate Back button/hitbox from the editor.
  - Rebuild `editorUiHotspots` each frame to include tools, actions, and Back; all editor UI hover/click handling is now driven solely by these hotspots.
  - Editor preview (fairway, grid, tee, cup) renders below the toolbar.
- Input: simplified editor hover handling
  - Removed `hoverLevelEditorBack` and editor usage of `getCourseBackRect()`.
  - Mouse hover and clicks in the editor now check only against `editorUiHotspots`; crosshair cursor preserved for Tee/Cup placement over the canvas.
- Level Editor: Editor preview now renders existing geometry (water, sand, bridges, hills, decorations, walls, polygon walls, posts) using the same visuals as play mode; drawn after the grid and before tee/cup markers.
  - Posts: single-click placement with default radius, snapped to grid and clamped to fairway.
  - Rectangles via click-drag: Walls, Bridges, Water, Sand, Hills. Start drag to define a rect; snapped to grid and clamped to fairway; ignored if drag is below one grid step.
  - Input: crosshair cursor over canvas for these tools; drag state tracked until mouseup.
  - Data: editor arrays (`walls`, `posts`, `bridges`, `waters`, `sands`, `hills`) updated on placement and reflected immediately in the preview using play-mode visuals.
 - Level Editor: Drag outline preview while dragging rectangle tools
   - Visual: semi-transparent fill and dashed white outline
   - Behavior: respects grid snapping and fairway bounds clamping; preview is clipped to the fairway
   - Order: rendered after existing geometry and before the toolbar/UI hotspots for proper layering

## v0.3.23 — 2025-08-18

- Level Editor: initial Tool Palette UI
  - Renders a vertical list of tool buttons: Select, Tee, Cup, Wall, WallsPoly, Post, Bridge, Water, WaterPoly, Sand, SandPoly, Hill.
{{ ... }}
 - Input: extended `mousemove` and `mousedown` for `levelEditor`
 - Hover sets pointer cursor over Back and tool buttons.
 - Click on a tool selects it (`selectedEditorTool`).
  - Selected tool is highlighted; palette rebuilt each frame into `editorUiHotspots` for interaction.
- Input: extended `mousemove` and `mousedown` for `levelEditor`
  - Hover sets pointer cursor over Back and tool buttons.
  - Click on a tool selects it (`selectedEditorTool`).
- Draw: renders tool buttons with consistent sizing/spacing; keeps existing Back button behavior.
- Version: in-game and package version bumped to `0.3.23`.
## v0.3.21 — 2025-08-17

- Feature: Admin-only Users management UI
  - Options screen shows a "Users" button only when `userProfile.role === 'admin'`.
  - New `users` game state with an admin UI to manage users.
  - Full CRUD and role management:
    - Add User, Add Admin
    - Promote/Demote (toggle role user ⇄ admin)
    - Enable/Disable user
    - Remove user (with confirmation)
  - Import/Export JSON for user data (prompt-based copy/paste; avoids async clipboard in handlers).
  - Safeguards enforced by `UsersStore`: cannot remove/disable the last enabled admin; prevent self-demotion if you are the last admin.
- Implementation details:
  - Added `getOptionsUsersRect()` and mousedown handling to enter `users` state from Options (admin-only).
  - Rebuild `usersUiHotspots` each frame in Users UI; handle clicks in the main canvas mousedown handler.
  - Fixed syntax error: closed `isDevBuild()` properly and removed a stray brace after `usersUiHotspots` declaration.
  - Moved Users admin action handling into the `mousedown` handler (no invalid `await` in event path).
  - Initialized `UsersStore` asynchronously at boot; gated UI actions on `usersStoreReady`.
- Version: in-game and package version updated to `0.3.21`.

## v0.3.20 — 2025-08-17

- Palette: extracted canonical colors to `docs/PALETTE.md` and consolidated usage in code.
- Rendering: applied consistent flat fills + outlines for terrain:
  - Water and Sand now draw with palette fills and clear outlines (rects: 1.5px inset; polys: 2px path stroke).
- Code: replaced hardcoded water/sand hexes with `COLORS.waterFill`, `COLORS.waterStroke`, `COLORS.sandFill`, `COLORS.sandStroke`.
- Version: in-game and package version updated to `0.3.20`.

## v0.3.19 — 2025-08-17

- Post-hole banner: classic golf terms expanded beyond basics.
  - Added Condor (-4), Albatross (-3), Eagle (-2), Birdie (-1), Par (0), Bogey (+1), Double Bogey (+2), Triple Bogey (+3); 4+ over shows numeric "n Over".
- Version: in-game and package version updated to `0.3.19`.

## v0.3.18 — 2025-08-17

- Dev-only: bank-shot preview during aiming (toggle with `B`). Predicts reflective path across walls, posts, and polygon walls; ignores hills/sand/water for speed.
- Build guard: now uses robust `isDevBuild()` helper. Prefers `import.meta.env.DEV` and falls back to localhost/5173 heuristic to ensure dev-only features work even if env flag is missing.
- Input focus: canvas is focusable and auto-focused on mousedown so key events (e.g., `B`) work while dragging; added broader key listeners on window/document/canvas during dev for reliability.
- Visual aids (dev-only): small "DEV" watermark; in-play "Preview ON (B)" badge when the path preview is active.
- Diagnostics (dev-only): boot-time log of dev detection, key-event logs for toggle, and global error logging to console during development.
- Tuning: lowered aiming drag threshold from 4px → 2px to make enabling preview while dragging easier during testing.
- Version: in-game and package version updated to `0.3.18`.

## v0.3.17 — 2025-08-17

- Rendering: draw polygon water (`waterPoly`) in the main loop so non-rectangular water is visible (fixes Level 8 river not showing).
- Level 4: aligned water band with the bridge across the central corridor; moved sand near the approach; adjusted posts to sit within the corridor.
- Level 5: moved the cup inside the enclosed area for a sensible route.
- Level 6: repositioned sand and water to support intended cross-bank paths without blocking the main diagonal.
- Version: in-game and package version updated to `0.3.17`.

## v0.3.16 — 2025-08-16

- HUD: restored a solid top bar and clipped decorations below the HUD strip to prevent overlap.
- Bugfix: removed a stray `ctx.restore()` in mousedown handler that could hide the HUD; added missing `ctx.restore()` after decoration clipping.
- Rendering: draw the hole after walls so it remains visible.
- UI: adjusted Replay button size/placement within the HUD and refined HUD text alignment.
- Version: in-game and package version updated to `0.3.16`.

## v0.3.15 — 2025-08-16

- Feature: polygon water (`waterPoly`) with rendering and OOB detection (bridge override respected).
- Version: in-game version updated to `0.3.15`.

## v0.3.14 — 2025-08-16

- UI polish: color-coded score text (sunk banner and course summary) — green for under par, red for over.
- Version: in-game version updated to `0.3.14`.
 
### Content
- Added `levels/level7.json` (Triangle Alley): multiple wedge deflectors using `wallsPoly`.
- Updated `levels/course.json` and `course.total` across levels to 7.

## v0.3.13 — 2025-08-16

- Water splash visual refined: multiple staggered ripple rings for a clearer retro splash.
- Version: in-game version updated to `0.3.13`.
 - Options: added in-menu volume slider control (drag to set volume) alongside -/+/Mute.

## v0.3.12 — 2025-08-16

- Content: added `levels/level6.json` — a diagonal-wall showcase hole using `wallsPoly` (crossed 45° banks and wedge near cup).
- Course: updated `levels/course.json` to include level 6; set `course.total` to 6 across levels 1–5.
- Version: in-game and package version updated to `0.3.12`.

## v0.3.11 — 2025-08-16

- Impact feedback: brief bounce flash drawn along the collision normal; tied to bounce intensity.
- Version: in-game version updated to `0.3.11`.

## v0.3.10 — 2025-08-16

- Water splash visual: ripple effect drawn on water where the ball lands before reset.
- Version: in-game version updated to `0.3.10`.

## v0.3.9 — 2025-08-16

- Options screen: added basic SFX controls (volume +/-, mute). Simple Web Audio SFX for putt, bounce, splash, sink.
- Version: in-game version updated to `0.3.9`.

## v0.3.8 — 2025-08-16

- Hills: tuned base acceleration and added optional `falloff` parameter for edge-weighted push.
- Level 3: updated hill to use tuned values (`strength: 0.65`, `falloff: 1.2`).

## v0.3.7 — 2025-08-16

- Course Summary: shows per-hole par and delta (E/+/-) and course totals with delta vs par.
- Version: in-game version updated to `0.3.7`.

## v0.3.6 — 2025-08-16

- Polygon sand: added `sandPoly` support with rendering via existing sand style and friction detection.
- Level 5: replaced rectangular sand with a trapezoid pit using `sandPoly`; tweaked layout for logical play.
- Version: in-game version updated to `0.3.6`.

## v0.3.5 — 2025-08-16

- Polygon walls: added render and segment-based collision (diagonals/chamfers/triangles).
- Schema: new `wallsPoly: [{ points: [x,y,...] }]` supported in level JSON.
- Content: added a small triangular wedge example to `levels/level5.json`.
- Version: in-game version set to `0.3.5`.

## v0.3.4 — 2025-08-11

- New obstacles (prototype):
  - Round posts (circular colliders) with beveled render and physics.
  - Bridges: fairway rectangles that span water and override the water penalty.
- Level: added sample posts and a narrow bridge to `levels/level4.json`.
- Docs: updated TODO with clarified obstacle behaviors from references.

## v0.3.3 — 2025-08-11

- Visuals: beveled wall rendering (shadow + face + highlight) for closer retro look.
- Visuals: fairway rendering refined with multiple horizontal bands.
- Version bumped in-game to match.
- Content: added two prototype holes (`levels/level4.json`, `levels/level5.json`) and updated course order.

## v0.3.2 — 2025-08-11

- Visuals/layout tuned closer to reference screenshots:
  - Canvas logical size set to 960x600; letterboxed scaling preserved.
  - HUD text is now rendered directly on the mustard table background; removed dark HUD strip.
  - HUD text color adjusted to dark for contrast on mustard.
  - Cleaned canvas CSS outline so outer mustard frame reads correctly.
  - Centered legacy 800×600 levels within the 960×600 canvas while keeping HUD anchored.
  - Respected per-level `canvas` size for fairway/band/outline and decoration clipping to remove unintended extra area.
- Bugfixes:
  - Mapped input coordinates to the centered playfield so aiming and shots work correctly after centering (strength arrow visible again).
- Docs: version bump synced in-game and here.

## v0.3.1 — 2025-08-11

- Changelog screen: added scrollable viewer (wheel, drag, keyboard) with clipping and scrollbar. Bundles `CHANGELOG.md` via raw import fallback.
- Main Menu: restored Changelog button and bottom-left version text. Fixed various menu state/hover bugs.
- Bugfixes: stabilized sunk/summary transitions and input swallowing.
- Decorations: auto-snap near the fairway edges to the table area to avoid overlapping the playfield.
- Summary: added a Main Menu button and Esc/ M key shortcut to return to the main menu after finishing a course.
- Fix: Summary "Main Menu" button now correctly returns to main menu; prevented mousedown from triggering restart, click uses correct event position.

## v0.3.0 — 2025-08-11

- Synced docs with current implementation:
  - Marked friction/exponential damping tuning complete in `PROGRESS.md`.
  - Marked HUD hole title and Replay button complete in `PROGRESS.md`.
  - Ticked off "ball in hole" detection, water penalty/reset, and post-hole score label in `TODO.md`.
  - Noted terrain tiles coverage as complete (fairway, sand, water).
  - Moved HUD Replay button below the top strip to avoid overlapping right-side HUD text.
  - Repositioned Replay to left side of HUD and shifted left HUD text right of the button to ensure no overlap.
  - Added hills (slope) prototype: new `hills` array in level JSON with directional acceleration; rendered as subtle gradient; updated `level3.json` with a sample SE slope.
  - Added `levels/course.json` and HUD running total; records strokes on Next.
  - Added Course Summary overlay at end of course with per-hole strokes and total; Enter restarts course.
  - Fix: auto-show Course Summary ~1.2s after sinking the last hole; updated sink banner hint.
  - UX: Added click-to-continue — clicking after sinking the last hole opens Summary; clicking on Summary restarts course. Updated summary text to “Click or Press Enter to Restart Game”.
  - Level 3: moved cup inside boxed area for sensible play path.
  - Fix: sunk banner always shown before summary on final hole; summary requires click/N.
  - Fix: correct final-hole detection by using `courseInfo.index/total` for banner hints and transitions.
  - Fix: prevent double-advance and accidental Total increments using `transitioning` guard.
  - Fix: swallow trailing click after mousedown to avoid instant summary close.
  - Perf: cache loaded levels and preload the next one to speed level switches; preload after summary restart too.
  - Controls: Click or N from sunk banner to continue; Space to replay current hole; Enter on Summary to restart course; P/Esc to Pause/Resume; Replay button in HUD.
  - UI: Added Main Menu and Course Select (Dev Levels); version shown bottom-left on menus; HUD has Menu button instead of Replay; Pause menu refined with Replay and Close buttons.

## v0.1.0 — 2025-08-10

- Added level loading with custom JSON schema (`levels/level1.json`).
- Implemented axis-aligned walls rendering and circle–rect collision with restitution in `src/main.ts`.
- Switched to exponential damping (frame-rate independent) and added displacement-based stop epsilon.
- Added minimalist HUD showing Hole/Par/Strokes.
- Fixed bug where ball could not move due to tee overlapping a wall; adjusted tee position and added post-load overlap nudge.
- Updated `PROGRESS.md` and `TODO.md` to reflect current state.

### Later on 2025-08-10

- Added two prototype levels: `levels/level2.json`, `levels/level3.json` and set `course.total` to 3 in level 1.
- Added keyboard shortcuts in `src/main.ts`:
  - `R` = restart current level
  - `N` = load next level (wraps around)
  - `Space` = restart after sink (post-hole banner flow)
- Implemented post-hole banner showing Birdie/Par/Bogey label and prompt.

### Even later on 2025-08-10

- Realigned HUD to a single row across the top: left (Hole x/y), center (Par + Strokes), right (To Birdie + Speed).
- Added Pause menu overlay (P/Escape) showing player info, shortcuts, and version; HUD includes "To Birdie" helper.
- Applied retro visual palette and playfield framing:
  - Mustard table background, darker green fairway with subtle shading band and outline.
  - Light gray walls with outlines, darker hole rim.
 - Added terrain zones:
   - Water (blue): out-of-bounds with +1 stroke penalty and reset to pre-shot position.
   - Sand (tan): high-friction zones slow the ball significantly.
 - Tuned physics:
   - Removed duplicate damping; fairway base friction lowered; sand multiplier now 4.2x.
 - Decorations:
   - Added non-colliding flower border decorations; enabled on Level 1.
  - Level fixes:
    - Level 1: Flower borders repositioned to table area (outside playfield).
    - Level 2: Added doorway into inner box and moved cup inside; sand now reachable.
 - HUD/UI:
   - Added Replay button in top HUD with hover and click to restart current hole.
   - Optional hole title shown next to hole index when provided by level JSON.
