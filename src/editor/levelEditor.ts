/*
  Level Editor module
  -------------------
  This module encapsulates Level Editor state, input handling, rendering, and persistence helpers.
  Migrated from main.ts to modularize the Level Editor code while maintaining existing behavior.

  Note: Per project policy, avoid localStorage for persistence in dev/admin builds. The eventual
  implementation will integrate file-based persistence; for browser-only builds expose Import/Export.
*/

import { 
  loadLevelsFromFilesystem, 
  importLevelFromFile, 
  importMultipleLevelsFromFiles,
  saveLevelToFilesystem, 
  isFileSystemAccessSupported, 
  saveLevelAsDownload,
  applyLevelDataFixups 
} from './filesystem';

// Local palette for the editor module (matches docs/PALETTE.md and main.ts)
const COLORS = {
  table: '#7a7b1e',
  fairway: '#126a23',
  fairwayBand: '#115e20',
  fairwayLine: '#0b3b14',
  wallFill: '#e2e2e2',
  wallStroke: '#bdbdbd',
  holeFill: '#0a1a0b',
  holeRim:  '#0f3f19',
  hudText: '#111111',
  hudBg: '#0d1f10',
  waterFill: '#1f6dff',
  waterStroke: '#1348aa',
  sandFill: '#d4b36a',
  sandStroke: '#a98545'
} as const;

// Minimal shape aliases used by the editor selection system
type Rect = { x: number; y: number; w: number; h: number; rot?: number };
type Circle = { x: number; y: number; r: number };
type Poly = { points: number[] };
type Decoration = { x: number; y: number; w: number; h: number; kind: string };
type Wall = Rect;
type Slope = { x: number; y: number; w: number; h: number; dir: 'N' | 'S' | 'E' | 'W' | string; strength?: number; falloff?: number; rot?: number };

// Discriminated union of selectable objects in the editor
type SelectableObject =
  | { type: 'tee'; object: { x: number; y: number } }
  | { type: 'cup'; object: { x: number; y: number; r: number } }
  | { type: 'wall'; object: Wall; index: number }
  | { type: 'wallsPoly'; object: Poly; index: number }
  | { type: 'post'; object: Circle; index: number }
  | { type: 'decoration'; object: Decoration; index: number }
  | { type: 'water'; object: Rect; index: number }
  | { type: 'waterPoly'; object: Poly; index: number }
  | { type: 'sand'; object: Rect; index: number }
  | { type: 'sandPoly'; object: Poly; index: number }
  | { type: 'bridge'; object: Rect; index: number }
  | { type: 'hill'; object: Slope; index: number };

export type EditorTool =
  | 'select' | 'tee' | 'cup' | 'wall' | 'wallsPoly' | 'post' | 'bridge' | 'water' | 'waterPoly' | 'sand' | 'sandPoly' | 'hill' | 'decoration';

export type EditorAction =
  | 'save' | 'saveAs' | 'load' | 'import' | 'export' | 'new' | 'delete' | 'test' | 'metadata' | 'suggestPar' | 'gridToggle' | 'gridMinus' | 'gridPlus' | 'back' | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'duplicate';

export type EditorMenuId = 'file' | 'objects' | 'decorations' | 'tools';

export type EditorMenuItem =
  | { kind: 'tool'; tool: EditorTool }
  | { kind: 'action'; action: EditorAction }
  | { kind: 'decoration'; decoration: string };

export type EditorHotspot =
  | { kind: 'tool'; tool: EditorTool; x: number; y: number; w: number; h: number }
  | { kind: 'action'; action: EditorAction; x: number; y: number; w: number; h: number }
  | { kind: 'menu'; menu: EditorMenuId; x: number; y: number; w: number; h: number }
  | { kind: 'menuItem'; menu: EditorMenuId; item: EditorMenuItem; x: number; y: number; w: number; h: number };

// Adapter interface to decouple editor module from main globals.
// We will extend this incrementally as we migrate code.
// Level type definition
export type Level = {
  canvas: { width: number; height: number };
  course: { index: number; total: number; title?: string };
  par: number;
  tee: { x: number; y: number };
  cup: { x: number; y: number; r: number };
  walls: Array<{ x: number; y: number; w: number; h: number }>;
  wallsPoly: Array<{ points: number[] }>;
  posts: Array<{ x: number; y: number; r: number }>;
  bridges: Array<{ x: number; y: number; w: number; h: number }>;
  water: Array<{ x: number; y: number; w: number; h: number }>;
  waterPoly: Array<{ points: number[] }>;
  sand: Array<{ x: number; y: number; w: number; h: number }>;
  sandPoly: Array<{ points: number[] }>;
  hills: Array<{ x: number; y: number; w: number; h: number; dir: string; strength?: number; falloff?: number }>;
  decorations: Array<{ x: number; y: number; w: number; h: number; kind: string }>;
  meta?: {
    authorId?: string;
    authorName?: string;
    created?: string;
    modified?: string;
  };
};

export interface EditorEnv {
  // Canvas and drawing surface
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;

  // Coordinate conversion helpers
  worldFromEvent(e: MouseEvent): { x: number; y: number };

  // App/game state
  getGlobalState(): any;
  setGlobalState(state: any): void;

  // Fairway bounds
  fairwayRect(): { x: number; y: number; w: number; h: number };

  // Grid system
  getShowGrid(): boolean;
  getGridSize(): number;
  setShowGrid?(show: boolean): void;
  setGridSize?(size: number): void;

  // UI feedback
  showToast(message: string): void;
  showConfirm(message: string, title?: string): Promise<boolean>;
  showPrompt(message: string, defaultValue?: string, title?: string): Promise<string | null>;
  showList(title: string, items: Array<{label: string; value: any}>, startIndex?: number): Promise<any>;
  renderGlobalOverlays(): void;
  isOverlayActive?(): boolean;
  migrateSingleSlotIfNeeded?(): void;
  exitToMenu(): void;
  getUserId(): string;
  testLevel?(levelData: any): Promise<void>;
}

export interface LevelEditor {
  // Lifecycle
  init(env: EditorEnv): void;

  // Rendering
  render(env: EditorEnv): void;

  // Input
  handleMouseDown(e: MouseEvent, env: EditorEnv): void;
  handleMouseMove(e: MouseEvent, env: EditorEnv): void;
  handleMouseUp(e: MouseEvent, env: EditorEnv): void;
  handleKeyDown(e: KeyboardEvent, env: EditorEnv): void;

  // Commands
  newLevel(): Promise<void>;
  openLoadPicker(): Promise<void>;
  openDeletePicker(): Promise<void>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  testLevel(): Promise<void>;

  // State exposure (minimal, for main UI integration)
  getSelectedTool(): EditorTool;
  setSelectedTool(t: EditorTool): void;
  getUiHotspots(): EditorHotspot[];
}

// Undo/Redo state snapshot
type EditorSnapshot = {
  levelData: any;
  globalState: any;
  timestamp: number;
  description: string;
};

class LevelEditorImpl implements LevelEditor {
  // Editor state
  private selectedTool: EditorTool = 'select';
  private selectedDecoration: string = 'flowers';
  private openEditorMenu: EditorMenuId | null = null;
  private uiHotspots: EditorHotspot[] = [];
  private showGrid: boolean = true;
  private editorLevelData: any = null;
  private editorCurrentSavedId: string | null = null;
  private env: EditorEnv | null = null;
  private gridSize: number = 20;
  private editorMenuActiveItemIndex: number = -1;

  // Undo/Redo system
  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];
  private maxUndoSteps: number = 50;
  private isApplyingUndoRedo: boolean = false;

  // Clipboard system
  private clipboard: SelectableObject[] = [];
  private clipboardOffset: { x: number; y: number } = { x: 0, y: 0 };
  private lastMousePosition: { x: number; y: number } = { x: 400, y: 300 };

  // Drag state for rectangle placements
  private isEditorDragging = false;
  private editorDragTool: EditorTool | null = null;
  private editorDragStart = { x: 0, y: 0 };
  private editorDragCurrent = { x: 0, y: 0 };

  // Selection state (migrated from main.ts selection system)
  private selectedObjects: SelectableObject[] = [];
  private isDragMoving: boolean = false;
  private dragMoveOffset: { x: number; y: number } = { x: 0, y: 0 };
  private isResizing: boolean = false;
  private isGroupResizing: boolean = false;
  private resizeStartBounds: { x: number; y: number; w: number; h: number } | null = null;
  private resizeStartMouse: { x: number; y: number } | null = null;
  private isSelectionDragging: boolean = false;
  private selectionBoxStart: { x: number; y: number } | null = null;
  private isRotating: boolean = false;

  // Polygon creation state
  private polygonInProgress: { tool: EditorTool; points: number[] } | null = null;
  
  // Polygon vertex dragging state
  private isVertexDragging: boolean = false;
  private vertexDrag: { obj: SelectableObject; vertexIndex: number } | null = null;
  
  // Hill direction control state
  private hillDirectionPicker: { x: number; y: number; visible: boolean; selectedDir: string } | null = null;
  
  // Post radius control state
  private postRadiusPicker: { x: number; y: number; visible: boolean; selectedRadius: number; postIndex: number } | null = null;
  private rotationCenter: { x: number; y: number } | null = null;
  private rotationStartAngle: number = 0;
  private rotationStartMouse: { x: number; y: number } | null = null;
  private rotationSensitivity: number = 0.05;

  // Cache selection bounds per frame
  private selectionBoundsCache: { x: number; y: number; w: number; h: number } | null = null;
  private groupResizeOriginals: Array<{ obj: SelectableObject; snap: any }> | null = null;
  private groupRotateOriginals: Array<{ obj: SelectableObject; snap: any }> | null = null;
  private groupRotationStartAngle: number = 0;
  private resizeHandleIndex: number | null = null;
  private dragMoveStart: { x: number; y: number } | null = null;

  // Undo/Redo system methods
  private createSnapshot(description: string): EditorSnapshot {
    if (!this.env) throw new Error('Editor not initialized');
    
    return {
      levelData: this.editorLevelData ? JSON.parse(JSON.stringify(this.editorLevelData)) : null,
      globalState: JSON.parse(JSON.stringify(this.env.getGlobalState())),
      timestamp: Date.now(),
      description
    };
  }

  private pushUndoSnapshot(description: string): void {
    if (this.isApplyingUndoRedo) return; // Don't create snapshots during undo/redo operations
    
    const snapshot = this.createSnapshot(description);
    this.undoStack.push(snapshot);
    
    // Limit undo stack size
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    
    // Clear redo stack when new action is performed
    this.redoStack = [];
  }

  private applySnapshot(snapshot: EditorSnapshot): void {
    if (!this.env) return;
    
    this.isApplyingUndoRedo = true;
    
    try {
      // Restore level data
      this.editorLevelData = snapshot.levelData ? JSON.parse(JSON.stringify(snapshot.levelData)) : null;
      
      // Restore global state
      this.env.setGlobalState(JSON.parse(JSON.stringify(snapshot.globalState)));
      
      // Clear selection since objects may have changed
      this.selectedObjects = [];
      this.clearDragState();
    } finally {
      this.isApplyingUndoRedo = false;
    }
  }

  private clearDragState(): void {
    this.isDragMoving = false;
    this.isResizing = false;
    this.isGroupResizing = false;
    this.isSelectionDragging = false;
    this.isRotating = false;
    this.selectionBoxStart = null;
    this.resizeStartBounds = null;
    this.resizeStartMouse = null;
    this.rotationCenter = null;
    this.rotationStartMouse = null;
    this.groupResizeOriginals = null;
    this.groupRotateOriginals = null;
    this.dragMoveStart = null;
    this.isVertexDragging = false;
    this.vertexDrag = null;
  }

  private canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  private canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private performUndo(): void {
    if (!this.canUndo() || !this.env) return;
    
    // Save current state to redo stack
    const currentSnapshot = this.createSnapshot('Current state before undo');
    this.redoStack.push(currentSnapshot);
    
    // Apply previous state
    const undoSnapshot = this.undoStack.pop()!;
    this.applySnapshot(undoSnapshot);
    
    this.env.showToast(`Undo: ${undoSnapshot.description}`);
  }

  private performRedo(): void {
    if (!this.canRedo() || !this.env) return;
    
    // Save current state to undo stack
    const currentSnapshot = this.createSnapshot('Current state before redo');
    this.undoStack.push(currentSnapshot);
    
    // Apply next state
    const redoSnapshot = this.redoStack.pop()!;
    this.applySnapshot(redoSnapshot);
    
    this.env.showToast(`Redo: ${redoSnapshot.description}`);
  }

  // Clipboard operations
  private copySelectedObjects(): void {
    if (this.selectedObjects.length === 0 || !this.env) return;
    
    // Deep copy selected objects
    this.clipboard = this.selectedObjects.map(obj => ({
      ...obj,
      object: JSON.parse(JSON.stringify(obj.object))
    }));
    
    // Calculate clipboard offset (center of selection bounds)
    const bounds = this.getSelectionBounds();
    this.clipboardOffset = {
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2
    };
    
    this.env.showToast(`Copied ${this.clipboard.length} object(s)`);
  }

  private cutSelectedObjects(): void {
    if (this.selectedObjects.length === 0 || !this.env) return;
    
    this.pushUndoSnapshot(`Cut ${this.selectedObjects.length} object(s)`);
    this.copySelectedObjects();
    this.deleteSelectedObjects();
  }

  private pasteObjects(mouseX: number, mouseY: number): void {
    if (this.clipboard.length === 0 || !this.env) return;
    
    this.pushUndoSnapshot(`Paste ${this.clipboard.length} object(s)`);
    
    const gs = this.env.getGlobalState();
    const { x: fairX, y: fairY, w: fairW, h: fairH } = this.env.fairwayRect();
    const clampX = (x: number) => Math.max(fairX, Math.min(fairX + fairW, x));
    const clampY = (y: number) => Math.max(fairY, Math.min(fairY + fairH, y));
    const snap = (n: number) => {
      try { if (this.showGrid && this.env!.getShowGrid()) { const g = this.env!.getGridSize(); return Math.round(n / g) * g; } } catch {}
      return n;
    };
    
    // Calculate paste offset from clipboard center to mouse position
    const pasteOffsetX = snap(clampX(mouseX)) - this.clipboardOffset.x;
    const pasteOffsetY = snap(clampY(mouseY)) - this.clipboardOffset.y;
    
    const newSelection: SelectableObject[] = [];
    
    for (const clipObj of this.clipboard) {
      const newObj = JSON.parse(JSON.stringify(clipObj.object));
      
      // Apply paste offset
      if ('x' in newObj && 'y' in newObj) {
        newObj.x = clampX(newObj.x + pasteOffsetX);
        newObj.y = clampY(newObj.y + pasteOffsetY);
      }
      
      // Handle polygon points
      if (clipObj.type === 'wallsPoly' || clipObj.type === 'waterPoly' || clipObj.type === 'sandPoly') {
        const points: number[] = newObj.points || [];
        for (let i = 0; i < points.length; i += 2) {
          points[i] = clampX(points[i] + pasteOffsetX);
          points[i + 1] = clampY(points[i + 1] + pasteOffsetY);
        }
      }
      
      // Add to appropriate global arrays and create selection object
      if (clipObj.type === 'wall') {
        gs.walls.push(newObj);
        newSelection.push({ type: 'wall', object: newObj, index: gs.walls.length - 1 });
      } else if (clipObj.type === 'post') {
        gs.posts.push(newObj);
        newSelection.push({ type: 'post', object: newObj, index: gs.posts.length - 1 });
      } else if (clipObj.type === 'water') {
        gs.waters.push(newObj);
        newSelection.push({ type: 'water', object: newObj, index: gs.waters.length - 1 });
      } else if (clipObj.type === 'sand') {
        gs.sands.push(newObj);
        newSelection.push({ type: 'sand', object: newObj, index: gs.sands.length - 1 });
      } else if (clipObj.type === 'bridge') {
        gs.bridges.push(newObj);
        newSelection.push({ type: 'bridge', object: newObj, index: gs.bridges.length - 1 });
      } else if (clipObj.type === 'hill') {
        gs.hills.push(newObj);
        newSelection.push({ type: 'hill', object: newObj, index: gs.hills.length - 1 });
      } else if (clipObj.type === 'decoration') {
        gs.decorations.push(newObj);
        newSelection.push({ type: 'decoration', object: newObj, index: gs.decorations.length - 1 });
      } else if (clipObj.type === 'wallsPoly') {
        gs.polyWalls.push(newObj);
        newSelection.push({ type: 'wallsPoly', object: newObj, index: gs.polyWalls.length - 1 });
      } else if (clipObj.type === 'waterPoly') {
        gs.watersPoly.push(newObj);
        newSelection.push({ type: 'waterPoly', object: newObj, index: gs.watersPoly.length - 1 });
      } else if (clipObj.type === 'sandPoly') {
        gs.sandsPoly.push(newObj);
        newSelection.push({ type: 'sandPoly', object: newObj, index: gs.sandsPoly.length - 1 });
      }
      // Note: Tee and Cup are unique objects, so we don't paste them
    }
    
    this.env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(this.env);
    this.selectedObjects = newSelection;
    
    this.env.showToast(`Pasted ${newSelection.length} object(s)`);
  }

  private duplicateSelectedObjects(): void {
    if (!this.env) return;
    if (this.selectedObjects.length === 0) return;
    // Copy current selection and paste at last mouse position (uses snapping/clamping inside paste)
    this.copySelectedObjects();
    this.pasteObjects(this.lastMousePosition.x, this.lastMousePosition.y);
  }

  private deleteSelectedObjects(): void {
    if (this.selectedObjects.length === 0 || !this.env) return;
    
    const gs = this.env.getGlobalState();
    
    // Sort by index descending to avoid index shifting issues
    const sortedObjects = [...this.selectedObjects].sort((a, b) => {
      const aIndex = 'index' in a ? a.index : 0;
      const bIndex = 'index' in b ? b.index : 0;
      return bIndex - aIndex;
    });
    
    for (const obj of sortedObjects) {
      if (obj.type === 'wall' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.walls.length) gs.walls.splice(idx, 1);
      } else if (obj.type === 'post' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.posts.length) gs.posts.splice(idx, 1);
      } else if (obj.type === 'water' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.waters.length) gs.waters.splice(idx, 1);
      } else if (obj.type === 'sand' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.sands.length) gs.sands.splice(idx, 1);
      } else if (obj.type === 'bridge' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.bridges.length) gs.bridges.splice(idx, 1);
      } else if (obj.type === 'hill' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.hills.length) gs.hills.splice(idx, 1);
      } else if (obj.type === 'decoration' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.decorations.length) gs.decorations.splice(idx, 1);
      } else if (obj.type === 'wallsPoly' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.polyWalls.length) gs.polyWalls.splice(idx, 1);
      } else if (obj.type === 'waterPoly' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.watersPoly.length) gs.watersPoly.splice(idx, 1);
      } else if (obj.type === 'sandPoly' && 'index' in obj) {
        const idx = obj.index;
        if (idx >= 0 && idx < gs.sandsPoly.length) gs.sandsPoly.splice(idx, 1);
      }
    }
    
    this.env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(this.env);
    this.selectedObjects = [];
  }

  // Grid snapping helpers
  private nudgeSelectedObjects(direction: string, largeStep: boolean, env: EditorEnv): void {
    if (this.selectedObjects.length === 0) return;

    this.pushUndoSnapshot(`Nudge ${this.selectedObjects.length} object(s)`);

    const gridSize = this.gridSize;
    const stepSize = largeStep ? gridSize * 5 : gridSize; // Shift = 5x grid steps
    
    let dx = 0, dy = 0;
    switch (direction) {
      case 'ArrowLeft': dx = -stepSize; break;
      case 'ArrowRight': dx = stepSize; break;
      case 'ArrowUp': dy = -stepSize; break;
      case 'ArrowDown': dy = stepSize; break;
    }

    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const clampX = (x: number) => Math.max(fairX, Math.min(fairX + fairW, x));
    const clampY = (y: number) => Math.max(fairY, Math.min(fairY + fairH, y));

    const gs = env.getGlobalState();

    for (const obj of this.selectedObjects) {
      if (obj.type === 'tee') {
        if (this.editorLevelData) {
          this.editorLevelData.tee.x = clampX(this.editorLevelData.tee.x + dx);
          this.editorLevelData.tee.y = clampY(this.editorLevelData.tee.y + dy);
        }
        gs.ball.x = clampX(gs.ball.x + dx);
        gs.ball.y = clampY(gs.ball.y + dy);
      } else if (obj.type === 'cup') {
        if (this.editorLevelData) {
          this.editorLevelData.cup.x = clampX(this.editorLevelData.cup.x + dx);
          this.editorLevelData.cup.y = clampY(this.editorLevelData.cup.y + dy);
        }
        gs.hole.x = clampX(gs.hole.x + dx);
        gs.hole.y = clampY(gs.hole.y + dy);
      } else if (obj.type === 'post') {
        const o: any = obj.object;
        o.x = clampX(o.x + dx);
        o.y = clampY(o.y + dy);
      } else if (obj.type === 'wall' || obj.type === 'water' || obj.type === 'sand' || obj.type === 'bridge' || obj.type === 'hill') {
        const o: any = obj.object;
        o.x = clampX(o.x + dx);
        o.y = clampY(o.y + dy);
      } else if (obj.type === 'wallsPoly' || obj.type === 'waterPoly' || obj.type === 'sandPoly') {
        const poly: any = obj.object;
        const pts: number[] = poly.points || [];
        for (let i = 0; i < pts.length; i += 2) {
          pts[i] = clampX(pts[i] + dx);
          pts[i + 1] = clampY(pts[i + 1] + dy);
        }
      } else if (obj.type === 'decoration') {
        const d: any = obj.object;
        d.x = clampX(d.x + dx);
        d.y = clampY(d.y + dy);
      }
    }

    env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(env);
    
    const stepDesc = largeStep ? 'large step' : 'grid step';
    env.showToast(`Nudged ${this.selectedObjects.length} object(s) by ${stepDesc}`);
  }

  private alignSelectedObjects(direction: string, env: EditorEnv): void {
    if (this.selectedObjects.length < 2) return;

    this.pushUndoSnapshot(`Align ${this.selectedObjects.length} object(s)`);

    // Get bounds of all selected objects
    const bounds = this.selectedObjects.map(obj => this.getObjectBounds(obj));
    
    let targetValue: number;
    let isHorizontal: boolean;

    switch (direction) {
      case 'ArrowLeft': // Align left edges
        targetValue = Math.min(...bounds.map(b => b.x));
        isHorizontal = true;
        break;
      case 'ArrowRight': // Align right edges
        targetValue = Math.max(...bounds.map(b => b.x + b.w));
        isHorizontal = true;
        break;
      case 'ArrowUp': // Align top edges
        targetValue = Math.min(...bounds.map(b => b.y));
        isHorizontal = false;
        break;
      case 'ArrowDown': // Align bottom edges
        targetValue = Math.max(...bounds.map(b => b.y + b.h));
        isHorizontal = false;
        break;
      default:
        return;
    }

    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const clampX = (x: number) => Math.max(fairX, Math.min(fairX + fairW, x));
    const clampY = (y: number) => Math.max(fairY, Math.min(fairY + fairH, y));

    const gs = env.getGlobalState();

    for (let i = 0; i < this.selectedObjects.length; i++) {
      const obj = this.selectedObjects[i];
      const objBounds = bounds[i];
      
      let dx = 0, dy = 0;
      
      if (isHorizontal) {
        if (direction === 'ArrowLeft') {
          dx = targetValue - objBounds.x;
        } else { // ArrowRight
          dx = targetValue - (objBounds.x + objBounds.w);
        }
      } else {
        if (direction === 'ArrowUp') {
          dy = targetValue - objBounds.y;
        } else { // ArrowDown
          dy = targetValue - (objBounds.y + objBounds.h);
        }
      }

      // Apply the alignment offset
      if (obj.type === 'tee') {
        if (this.editorLevelData) {
          this.editorLevelData.tee.x = clampX(this.editorLevelData.tee.x + dx);
          this.editorLevelData.tee.y = clampY(this.editorLevelData.tee.y + dy);
        }
        gs.ball.x = clampX(gs.ball.x + dx);
        gs.ball.y = clampY(gs.ball.y + dy);
      } else if (obj.type === 'cup') {
        if (this.editorLevelData) {
          this.editorLevelData.cup.x = clampX(this.editorLevelData.cup.x + dx);
          this.editorLevelData.cup.y = clampY(this.editorLevelData.cup.y + dy);
        }
        gs.hole.x = clampX(gs.hole.x + dx);
        gs.hole.y = clampY(gs.hole.y + dy);
      } else if (obj.type === 'post') {
        const o: any = obj.object;
        o.x = clampX(o.x + dx);
        o.y = clampY(o.y + dy);
      } else if (obj.type === 'wall' || obj.type === 'water' || obj.type === 'sand' || obj.type === 'bridge' || obj.type === 'hill') {
        const o: any = obj.object;
        o.x = clampX(o.x + dx);
        o.y = clampY(o.y + dy);
      } else if (obj.type === 'wallsPoly' || obj.type === 'waterPoly' || obj.type === 'sandPoly') {
        const poly: any = obj.object;
        const pts: number[] = poly.points || [];
        for (let j = 0; j < pts.length; j += 2) {
          pts[j] = clampX(pts[j] + dx);
          pts[j + 1] = clampY(pts[j + 1] + dy);
        }
      } else if (obj.type === 'decoration') {
        const d: any = obj.object;
        d.x = clampX(d.x + dx);
        d.y = clampY(d.y + dy);
      }
    }

    env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(env);
    
    const alignmentType = isHorizontal 
      ? (direction === 'ArrowLeft' ? 'left edges' : 'right edges')
      : (direction === 'ArrowUp' ? 'top edges' : 'bottom edges');
    env.showToast(`Aligned ${this.selectedObjects.length} objects to ${alignmentType}`);
  }

  // Helper method to finish polygon creation
  private finishPolygon(env: EditorEnv): void {
    if (!this.polygonInProgress || this.polygonInProgress.points.length < 6) {
      this.polygonInProgress = null;
      return;
    }

    this.pushUndoSnapshot(`Place ${this.polygonInProgress.tool}`);
    const poly = { points: [...this.polygonInProgress.points] };
    const gs = env.getGlobalState();

    if (this.polygonInProgress.tool === 'wallsPoly') {
      gs.polyWalls.push(poly);
      if (this.editorLevelData) this.editorLevelData.wallsPoly.push(poly);
    } else if (this.polygonInProgress.tool === 'waterPoly') {
      gs.watersPoly.push(poly);
      if (this.editorLevelData) this.editorLevelData.waterPoly.push(poly);
    } else if (this.polygonInProgress.tool === 'sandPoly') {
      gs.sandsPoly.push(poly);
      if (this.editorLevelData) this.editorLevelData.sandPoly.push(poly);
    }

    env.setGlobalState(gs);
    this.polygonInProgress = null;
  }

  // Menu definitions
  private readonly EDITOR_MENUS: Record<EditorMenuId, { title: string; items: Array<{ label: string; item: EditorMenuItem; separator?: boolean }> }> = {
    file: {
      title: 'File',
      items: [
        { label: 'New', item: { kind: 'action', action: 'new' } },
        { label: 'Save', item: { kind: 'action', action: 'save' } },
        { label: 'Save As', item: { kind: 'action', action: 'saveAs' } },
        { label: 'Level Load', item: { kind: 'action', action: 'load' } },
        { label: 'Import', item: { kind: 'action', action: 'import' } },
        { label: 'Export', item: { kind: 'action', action: 'export' } },
        { label: 'Metadata', item: { kind: 'action', action: 'metadata' } },
        { label: 'Suggest Par', item: { kind: 'action', action: 'suggestPar' } },
        { label: 'Test Level', item: { kind: 'action', action: 'test' }, separator: true },
        { label: 'Delete', item: { kind: 'action', action: 'delete' } },
        { label: 'Back/Exit', item: { kind: 'action', action: 'back' }, separator: true }
      ]
    },
    objects: {
      title: 'Objects',
      items: [
        { label: 'Tee', item: { kind: 'tool', tool: 'tee' } },
        { label: 'Cup', item: { kind: 'tool', tool: 'cup' } },
        { label: 'Post', item: { kind: 'tool', tool: 'post' }, separator: true },
        { label: 'Wall', item: { kind: 'tool', tool: 'wall' } },
        { label: 'WallsPoly', item: { kind: 'tool', tool: 'wallsPoly' } },
        { label: 'Bridge', item: { kind: 'tool', tool: 'bridge' }, separator: true },
        { label: 'Water', item: { kind: 'tool', tool: 'water' } },
        { label: 'WaterPoly', item: { kind: 'tool', tool: 'waterPoly' } },
        { label: 'Sand', item: { kind: 'tool', tool: 'sand' } },
        { label: 'SandPoly', item: { kind: 'tool', tool: 'sandPoly' } },
        { label: 'Hill', item: { kind: 'tool', tool: 'hill' } }
      ]
    },
    decorations: {
      title: 'Decorations',
      items: [
        { label: 'Flowers', item: { kind: 'decoration', decoration: 'flowers' } },
        { label: 'Trees', item: { kind: 'decoration', decoration: 'trees' } },
        { label: 'Rocks', item: { kind: 'decoration', decoration: 'rocks' } },
        { label: 'Bushes', item: { kind: 'decoration', decoration: 'bushes' } }
      ]
    },
    tools: {
      title: 'Editor Tools',
      items: [
        { label: 'Select Tool', item: { kind: 'tool', tool: 'select' } },
        { label: 'Undo (Ctrl+Z)', item: { kind: 'action', action: 'undo' }, separator: true },
        { label: 'Redo (Ctrl+Y)', item: { kind: 'action', action: 'redo' } },
        { label: 'Copy (Ctrl+C)', item: { kind: 'action', action: 'copy' }, separator: true },
        { label: 'Cut (Ctrl+X)', item: { kind: 'action', action: 'cut' } },
        { label: 'Paste (Ctrl+V)', item: { kind: 'action', action: 'paste' } },
        { label: 'Duplicate (Ctrl+D)', item: { kind: 'action', action: 'duplicate' } },
        { label: 'Grid Toggle', item: { kind: 'action', action: 'gridToggle' }, separator: true },
        { label: 'Grid -', item: { kind: 'action', action: 'gridMinus' } },
        { label: 'Grid +', item: { kind: 'action', action: 'gridPlus' } }
      ]
    }
  };

  init(env: EditorEnv): void {
    this.env = env;
    // Initialize editor with environment
    // Ensure select tool is always the default
    this.selectedTool = 'select';
    // Try to initialize from saved local storage once per session
    // Run single-slot migration on first use
    try { env.migrateSingleSlotIfNeeded?.(); } catch {}
    
    if (this.editorLevelData === null) {
      // Level initialization now handled by Firebase migration
      // The migrateSingleSlotIfNeeded call above handles localStorage migration
    }
    
    if (this.editorLevelData === null) {
      // Build a minimal default level
      const globalState = env.getGlobalState();
      const defaultCupR = globalState.hole.r || 8;
      this.editorLevelData = {
        canvas: { width: globalState.WIDTH, height: globalState.HEIGHT },
        course: { index: 1, total: 1, title: 'Untitled' },
        par: 3,
        tee: { x: globalState.COURSE_MARGIN + 60, y: Math.floor(globalState.HEIGHT / 2) },
        cup: { x: globalState.WIDTH - globalState.COURSE_MARGIN - 60, y: Math.floor(globalState.HEIGHT / 2), r: defaultCupR },
        walls: [],
        wallsPoly: [],
        posts: [],
        bridges: [],
        water: [],
        waterPoly: [],
        sand: [],
        sandPoly: [],
        hills: [],
        decorations: []
      } as Level;
    }
    
    // Apply editor data to rendering globals
    const globalState = env.getGlobalState();
    env.setGlobalState({
      levelCanvas: {
        width: this.editorLevelData.canvas?.width ?? globalState.WIDTH,
        height: this.editorLevelData.canvas?.height ?? globalState.HEIGHT
      },
      walls: this.editorLevelData.walls ?? [],
      sands: this.editorLevelData.sand ?? [],
      sandsPoly: this.editorLevelData.sandPoly ?? [],
      waters: this.editorLevelData.water ?? [],
      watersPoly: this.editorLevelData.waterPoly ?? [],
      decorations: this.editorLevelData.decorations ?? [],
      hills: this.editorLevelData.hills ?? [],
      bridges: this.editorLevelData.bridges ?? [],
      posts: this.editorLevelData.posts ?? [],
      polyWalls: this.editorLevelData.wallsPoly ?? [],
      // Use tee/cup as ball/hole preview locations
      ball: { x: this.editorLevelData.tee.x, y: this.editorLevelData.tee.y, vx: 0, vy: 0, moving: false },
      hole: { x: this.editorLevelData.cup.x, y: this.editorLevelData.cup.y, r: this.editorLevelData.cup.r }
    });
  }

  render(env: EditorEnv): void {
    const { ctx, width: WIDTH, height: HEIGHT } = env;
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();

    // Sync grid state from environment (if provided)
    try {
      this.showGrid = env.getShowGrid();
    } catch {}

    // Update dynamic menu labels
    this.EDITOR_MENUS.tools.items[1].label = this.showGrid ? 'Grid On' : 'Grid Off';

    // Reset hotspots each frame
    this.uiHotspots = [];

    // Background table felt
    ctx.fillStyle = COLORS.table;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Fairway panel
    ctx.fillStyle = COLORS.fairway;
    ctx.fillRect(fairX, fairY, fairW, fairH);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.fairwayLine;
    ctx.strokeRect(fairX + 1, fairY + 1, Math.max(0, fairW - 2), Math.max(0, fairH - 2));

    // Grid
    if (this.showGrid) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(fairX, fairY, fairW, fairH);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = fairX; x <= fairX + fairW; x += 20) {
        ctx.moveTo(Math.round(x) + 0.5, fairY);
        ctx.lineTo(Math.round(x) + 0.5, fairY + fairH);
      }
      for (let y = fairY; y <= fairY + fairH; y += 20) {
        ctx.moveTo(fairX, Math.round(y) + 0.5);
        ctx.lineTo(fairX + fairW, Math.round(y) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Pull globals for geometry render
    const gs = env.getGlobalState();
    const { waters, watersPoly, sands, sandsPoly, bridges, hills, decorations, walls, polyWalls, posts, ball, hole } = gs as any;

    // Terrain before walls
    // Water (rects)
    for (let i = 0; i < waters.length; i++) {
      const r = waters[i];
      const obj: SelectableObject = { type: 'water', object: r, index: i };
      this.renderWithRotation(ctx, obj, () => {
        ctx.fillStyle = COLORS.waterFill;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.waterStroke;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      });
    }
    // Water (polys)
    if (watersPoly.length > 0) {
      ctx.fillStyle = COLORS.waterFill;
      for (const wp of watersPoly) {
        const pts = wp.points;
        if (!pts || pts.length < 6) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.waterStroke;
        ctx.stroke();
      }
    }
    // Sand (rects)
    for (let i = 0; i < sands.length; i++) {
      const r = sands[i];
      const obj: SelectableObject = { type: 'sand', object: r, index: i };
      this.renderWithRotation(ctx, obj, () => {
        ctx.fillStyle = COLORS.sandFill;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.sandStroke;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      });
    }
    // Sand (polys)
    if (sandsPoly.length > 0) {
      ctx.fillStyle = COLORS.sandFill;
      for (const sp of sandsPoly) {
        const pts = sp.points;
        if (!pts || pts.length < 6) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.sandStroke;
        ctx.stroke();
      }
    }
    // Bridges
    for (let i = 0; i < bridges.length; i++) {
      const r = bridges[i];
      const obj: SelectableObject = { type: 'bridge', object: r, index: i };
      this.renderWithRotation(ctx, obj, () => {
        ctx.fillStyle = COLORS.fairway;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.fairwayLine;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      });
    }
    // Hills
    for (let i = 0; i < hills.length; i++) {
      const h = hills[i];
      const obj: SelectableObject = { type: 'hill', object: h, index: i };
      this.renderWithRotation(ctx, obj, () => {
        const slopeDir = (h as any).dir || 'S';
        let grad: CanvasGradient;
        if (slopeDir === 'N') grad = ctx.createLinearGradient(h.x, h.y + h.h, h.x, h.y);
        else if (slopeDir === 'S') grad = ctx.createLinearGradient(h.x, h.y, h.x, h.y + h.h);
        else if (slopeDir === 'W') grad = ctx.createLinearGradient(h.x + h.w, h.y, h.x, h.y);
        else grad = ctx.createLinearGradient(h.x, h.y, h.x + h.w, h.y);
        grad.addColorStop(0, 'rgba(255,255,255,0.10)');
        grad.addColorStop(1, 'rgba(0,0,0,0.10)');
        ctx.fillStyle = grad;
        ctx.fillRect(h.x, h.y, h.w, h.h);
      });
    }
    // Decorations clipped to fairway
    ctx.save();
    ctx.beginPath();
    ctx.rect(fairX, fairY, fairW, fairH);
    ctx.clip();
    for (const d of decorations) {
      if (d.kind === 'flowers') {
        const step = 16;
        for (let y = d.y; y < d.y + d.h; y += step) {
          for (let x = d.x; x < d.x + d.w; x += step) {
            ctx.save();
            ctx.translate(x + 8, y + 8);
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 4; i++) {
              const ang = (i * Math.PI) / 2;
              ctx.beginPath();
              ctx.arc(Math.cos(ang) * 5, Math.sin(ang) * 5, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = '#d11e2a';
            ctx.beginPath();
            ctx.arc(0, 0, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
    ctx.restore();

    // Walls (rects)
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const obj: SelectableObject = { type: 'wall', object: w, index: i };
      this.renderWithRotation(ctx, obj, () => {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(w.x + 2, w.y + 2, w.w, w.h);
        ctx.fillStyle = COLORS.wallFill;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.wallStroke;
        ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.moveTo(w.x + 1, w.y + 1);
        ctx.lineTo(w.x + w.w - 1, w.y + 1);
        ctx.moveTo(w.x + 1, w.y + 1);
        ctx.lineTo(w.x + 1, w.y + w.h - 1);
        ctx.stroke();
      });
    }
    // Polygon walls
    ctx.lineWidth = 2;
    for (const poly of polyWalls) {
      const pts = poly.points;
      if (!pts || pts.length < 6) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(pts[0] + 2, pts[1] + 2);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + 2, pts[i + 1] + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLORS.wallFill;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLORS.wallStroke;
      ctx.stroke();
    }
    // Posts
    for (const p of posts) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(p.x + 2, p.y + 2, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLORS.wallFill;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = COLORS.wallStroke; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 1, 0, Math.PI * 2); ctx.stroke();
    }

    // Tee marker (ball)
    {
      const r = 6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(ball.x + 2, ball.y + 3, r * 0.9, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Cup marker (hole)
    {
      const r = (hole as any).r ?? 8;
      ctx.fillStyle = COLORS.holeFill;
      ctx.beginPath(); ctx.arc(hole.x, hole.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = COLORS.holeRim; ctx.stroke();
      ctx.fillStyle = COLORS.wallFill;
      const stickW = 3, stickH = 24;
      ctx.fillRect(hole.x - stickW / 2, hole.y - stickH - r, stickW, stickH);
    }

    // Drag outline preview for rectangle tools
    if (this.isEditorDragging && this.editorDragTool && (
      this.editorDragTool === 'wall' || this.editorDragTool === 'bridge' || this.editorDragTool === 'water' || this.editorDragTool === 'sand' || this.editorDragTool === 'hill'
    )) {
      const x0 = this.editorDragStart.x;
      const y0 = this.editorDragStart.y;
      const x1 = this.editorDragCurrent.x;
      const y1 = this.editorDragCurrent.y;
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0);
      const rh = Math.abs(y1 - y0);
      if (rw > 0 || rh > 0) {
        ctx.save();
        // Clip to fairway for visuals
        ctx.beginPath(); ctx.rect(fairX, fairY, fairW, fairH); ctx.clip();
        const tool = this.editorDragTool;
        if (tool === 'water') {
          ctx.globalAlpha = 0.35; ctx.fillStyle = COLORS.waterFill; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        } else if (tool === 'sand') {
          ctx.globalAlpha = 0.35; ctx.fillStyle = COLORS.sandFill; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        } else if (tool === 'bridge') {
          ctx.globalAlpha = 0.20; ctx.fillStyle = COLORS.fairway; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff'; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        }
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Post radius picker
    if (this.postRadiusPicker && this.postRadiusPicker.visible) {
      const picker = this.postRadiusPicker;
      const size = 100;
      const x = picker.x - size / 2;
      const y = picker.y - size / 2;
      
      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, size, size);
      
      // Radius options
      const radii = [6, 8, 10, 12, 16, 20];
      const cols = 3;
      const cellW = size / cols;
      const cellH = size / 2;
      
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      for (let i = 0; i < radii.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cellX = x + col * cellW;
        const cellY = y + row * cellH;
        
        ctx.fillStyle = picker.selectedRadius === radii[i] ? '#00ff00' : '#ffffff';
        ctx.fillText(radii[i].toString(), cellX + cellW/2, cellY + cellH/2);
      }
      
      // Instructions
      ctx.font = '12px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Click radius', picker.x, picker.y + size/2 + 15);
    }

    // Hill direction picker
    if (this.hillDirectionPicker && this.hillDirectionPicker.visible) {
      const picker = this.hillDirectionPicker;
      const size = 80;
      const x = picker.x - size / 2;
      const y = picker.y - size / 2;
      
      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, size, size);
      
      // Direction arrows
      const dirs = [
        { dir: 'N', x: x + size/2, y: y + 10, label: '↑' },
        { dir: 'S', x: x + size/2, y: y + size - 20, label: '↓' },
        { dir: 'W', x: x + 10, y: y + size/2, label: '←' },
        { dir: 'E', x: x + size - 20, y: y + size/2, label: '→' }
      ];
      
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      for (const d of dirs) {
        ctx.fillStyle = picker.selectedDir === d.dir ? '#00ff00' : '#ffffff';
        ctx.fillText(d.label, d.x, d.y);
      }
      
      // Instructions
      ctx.font = '12px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Click direction', picker.x, picker.y + size/2 + 15);
    }

    // Polygon in progress preview
    if (this.polygonInProgress && this.polygonInProgress.points.length >= 2) {
      const pts = this.polygonInProgress.points;
      const tool = this.polygonInProgress.tool;
      
      ctx.save();
      ctx.beginPath();
      ctx.rect(fairX, fairY, fairW, fairH);
      ctx.clip();
      
      // Draw polygon outline
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i], pts[i + 1]);
      }
      // Close the polygon if we have enough points
      if (pts.length >= 6) {
        ctx.closePath();
      }
      
      // Fill based on tool type
      if (tool === 'waterPoly') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = COLORS.waterFill;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS.waterStroke;
      } else if (tool === 'sandPoly') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = COLORS.sandFill;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS.sandStroke;
      } else if (tool === 'wallsPoly') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = COLORS.wallFill;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS.wallStroke;
      }
      
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw vertices as small circles
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < pts.length; i += 2) {
        ctx.beginPath();
        ctx.arc(pts[i], pts[i + 1], 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      
      ctx.restore();
    }

    // Update selection bounds cache for group selections each frame
    this.selectionBoundsCache = (this.selectedObjects.length > 1) ? this.getSelectionBounds() : null;

    // Selection tool visuals
    if (this.selectedTool === 'select') {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00aaff';

      // --- Group selection bounding box ---
      if (this.selectedObjects.length > 1 && this.selectionBoundsCache) {
        const selB = this.selectionBoundsCache;
        const dx = this.isDragMoving ? this.dragMoveOffset.x : 0;
        const dy = this.isDragMoving ? this.dragMoveOffset.y : 0;
        const drawB = { x: selB.x + dx, y: selB.y + dy, w: selB.w, h: selB.h };
        const hasPoly = this.selectedObjects.some(o => o.type === 'wallsPoly' || o.type === 'waterPoly' || o.type === 'sandPoly');
        // Outline
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffaa00';
        ctx.strokeRect(drawB.x, drawB.y, drawB.w, drawB.h);
        ctx.setLineDash([]);
        // Handles (reuse helpers) - only if no polygon in selection
        if (!hasPoly) {
          const handles = this.getResizeHandles(drawB);
          ctx.fillStyle = '#ffaa00';
          for (const h of handles) {
            ctx.fillRect(h.x, h.y, h.w, h.h);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.strokeRect(h.x, h.y, h.w, h.h);
          }
          const rotHandles = this.getRotationHandles(drawB);
          ctx.fillStyle = '#ff6600';
          for (const rh of rotHandles) {
            ctx.beginPath();
            ctx.arc(rh.x + rh.w / 2, rh.y + rh.h / 2, rh.w / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(rh.x + rh.w / 2, rh.y + rh.h / 2, rh.w / 2, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      for (const obj of this.selectedObjects) {
        const bounds = this.getObjectBounds(obj);
        const offsetX = this.isDragMoving ? this.dragMoveOffset.x : 0;
        const offsetY = this.isDragMoving ? this.dragMoveOffset.y : 0;
        const displayBounds = { x: bounds.x + offsetX, y: bounds.y + offsetY, w: bounds.w, h: bounds.h };
        if (this.isResizing && this.resizeStartBounds && this.resizeStartMouse && this.selectedObjects.length === 1 && this.selectedObjects[0] === obj) {
          displayBounds.x = (obj.object as any).x;
          displayBounds.y = (obj.object as any).y;
          if ('w' in obj.object && 'h' in obj.object) {
            displayBounds.w = (obj.object as any).w;
            displayBounds.h = (obj.object as any).h;
          }
        }
        ctx.strokeRect(displayBounds.x, displayBounds.y, displayBounds.w, displayBounds.h);

        if (this.selectedObjects.length === 1 && obj === this.selectedObjects[0] && (
          obj.type === 'wall' || obj.type === 'water' || obj.type === 'sand' || obj.type === 'bridge' || obj.type === 'hill' || obj.type === 'decoration'
        )) {
          const handles = this.getResizeHandles(displayBounds);
          ctx.setLineDash([]);
          for (const handle of handles) {
            ctx.fillStyle = '#00aaff';
            ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
          }
          const rotHandles = this.getRotationHandles(displayBounds);
          for (const rotHandle of rotHandles) {
            ctx.fillStyle = '#ff6600';
            ctx.beginPath();
            ctx.arc(rotHandle.x + rotHandle.w / 2, rotHandle.y + rotHandle.h / 2, rotHandle.w / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(rotHandle.x + rotHandle.w / 2, rotHandle.y + rotHandle.h / 2, rotHandle.w / 2, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#00aaff';
        } else if (this.selectedObjects.length === 1 && obj === this.selectedObjects[0] && (
          obj.type === 'wallsPoly' || obj.type === 'waterPoly' || obj.type === 'sandPoly'
        )) {
          // Draw vertex handles for selected polygon
          const pts: number[] = (obj.object as any).points || [];
          ctx.setLineDash([]);
          for (let i = 0; i < pts.length; i += 2) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(pts[i], pts[i + 1], 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          // Restore dashed selection outline style
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#00aaff';
        } else {
          const handleSize = 6;
          ctx.setLineDash([]);
          ctx.fillStyle = '#00aaff';
          const corners = [
            { x: displayBounds.x - handleSize / 2, y: displayBounds.y - handleSize / 2 },
            { x: displayBounds.x + displayBounds.w - handleSize / 2, y: displayBounds.y - handleSize / 2 },
            { x: displayBounds.x - handleSize / 2, y: displayBounds.y + displayBounds.h - handleSize / 2 },
            { x: displayBounds.x + displayBounds.w - handleSize / 2, y: displayBounds.y + displayBounds.h - handleSize / 2 }
          ];
          for (const corner of corners) {
            ctx.fillRect(corner.x, corner.y, handleSize, handleSize);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.strokeRect(corner.x, corner.y, handleSize, handleSize);
          }
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#00aaff';
        }
      }

      // Selection box while dragging
      if (this.isSelectionDragging && this.selectionBoxStart) {
        const boxX = Math.min(this.selectionBoxStart.x, this.selectionBoxStart.x + this.dragMoveOffset.x);
        const boxY = Math.min(this.selectionBoxStart.y, this.selectionBoxStart.y + this.dragMoveOffset.y);
        const boxW = Math.abs(this.dragMoveOffset.x);
        const boxH = Math.abs(this.dragMoveOffset.y);
        ctx.globalAlpha = 0.1; ctx.fillStyle = '#00aaff'; ctx.fillRect(boxX, boxY, boxW, boxH); ctx.globalAlpha = 1;
        ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.strokeStyle = '#00aaff'; ctx.strokeRect(boxX, boxY, boxW, boxH);
      }
      ctx.restore();
    }

    // Menubar (drawn last)
    const menubarX = 0, menubarY = 0, menubarW = WIDTH, menubarH = 28;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(menubarX, menubarY, menubarW, menubarH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1;
    ctx.strokeRect(menubarX, menubarY, menubarW, menubarH - 1);

    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const menuIds: EditorMenuId[] = ['file', 'objects', 'decorations', 'tools'];
    let mx = 8; const my = menubarH / 2;
    for (const menuId of menuIds) {
      const menu = this.EDITOR_MENUS[menuId];
      const textW = ctx.measureText(menu.title).width;
      const menuW = textW + 16;
      const isOpen = this.openEditorMenu === menuId;
      ctx.fillStyle = isOpen ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(mx, 2, menuW, menubarH - 4);
      if (isOpen) { ctx.strokeStyle = '#ffffff'; ctx.strokeRect(mx, 2, menuW, menubarH - 4); }
      ctx.fillStyle = '#ffffff';
      ctx.fillText(menu.title, mx + 8, my);
      this.uiHotspots.push({ kind: 'menu', menu: menuId, x: mx, y: 0, w: menuW, h: menubarH });
      mx += menuW;
    }

    // Dropdown
    if (this.openEditorMenu) {
      const menu = this.EDITOR_MENUS[this.openEditorMenu];
      // Compute header x
      let headerX = 8;
      for (const menuId of menuIds) {
        if (menuId === this.openEditorMenu) break;
        const m = this.EDITOR_MENUS[menuId];
        const tw = ctx.measureText(m.title).width;
        headerX += tw + 16;
      }
      let maxWidth = 0;
      for (const item of menu.items) {
        const w = ctx.measureText(item.label).width; if (w > maxWidth) maxWidth = w;
      }
      const dropdownW = Math.max(120, maxWidth + 24);
      const itemH = 22;
      const dropdownH = menu.items.length * itemH + 4;
      const dropdownX = headerX;
      const dropdownY = menubarH;

      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(dropdownX, dropdownY, dropdownW, dropdownH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1;
      ctx.strokeRect(dropdownX, dropdownY, dropdownW, dropdownH);

      let itemY = dropdownY + 2;
      for (let i = 0; i < menu.items.length; i++) {
        const menuItem = menu.items[i];
        const isActive = i === this.editorMenuActiveItemIndex;
        const isSelected = (() => {
          if (menuItem.item.kind === 'tool') return this.selectedTool === menuItem.item.tool;
          return false;
        })();
        if (isActive || isSelected) {
          ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)';
          ctx.fillRect(dropdownX + 1, itemY, dropdownW - 2, itemH);
        }
        if (menuItem.separator && i > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(dropdownX + 6, itemY - 1);
          ctx.lineTo(dropdownX + dropdownW - 6, itemY - 1);
          ctx.stroke();
        }
        // Generate dynamic label based on current state
        let displayLabel = menuItem.label;
        let isDisabled = false;
        
        if (menuItem.item.kind === 'action') {
          switch (menuItem.item.action) {
            case 'undo':
              displayLabel = this.canUndo() ? 'Undo (Ctrl+Z)' : 'Undo';
              isDisabled = !this.canUndo();
              break;
            case 'redo':
              displayLabel = this.canRedo() ? 'Redo (Ctrl+Y)' : 'Redo';
              isDisabled = !this.canRedo();
              break;
            case 'copy':
              displayLabel = this.selectedObjects.length > 0 ? 'Copy (Ctrl+C)' : 'Copy';
              isDisabled = this.selectedObjects.length === 0;
              break;
            case 'cut':
              displayLabel = this.selectedObjects.length > 0 ? 'Cut (Ctrl+X)' : 'Cut';
              isDisabled = this.selectedObjects.length === 0;
              break;
            case 'paste':
              displayLabel = this.clipboard.length > 0 ? 'Paste (Ctrl+V)' : 'Paste';
              isDisabled = this.clipboard.length === 0;
              break;
            case 'gridToggle':
              displayLabel = this.showGrid ? 'Grid On' : 'Grid Off';
              break;
            case 'gridMinus':
              displayLabel = `Grid - (${this.gridSize}px)`;
              break;
            case 'gridPlus':
              displayLabel = `Grid + (${this.gridSize}px)`;
              break;
          }
        }
        
        ctx.fillStyle = isDisabled ? 'rgba(255,255,255,0.5)' : '#ffffff';
        ctx.fillText(displayLabel, dropdownX + 8, itemY + itemH / 2);
        this.uiHotspots.push({ kind: 'menuItem', menu: this.openEditorMenu, item: menuItem.item, x: dropdownX, y: itemY, w: dropdownW, h: itemH });
        itemY += itemH;
      }
    }

    env.renderGlobalOverlays();
  }

  handleMouseDown(e: MouseEvent, env: EditorEnv): void {
    if (env.isOverlayActive?.()) return;
    const p = env.worldFromEvent(e);

    // 1) Handle post radius picker first
    if (this.postRadiusPicker && this.postRadiusPicker.visible) {
      const picker = this.postRadiusPicker;
      const size = 100;
      const x = picker.x - size / 2;
      const y = picker.y - size / 2;
      
      // Check if clicking on radius options
      const radii = [6, 8, 10, 12, 16, 20];
      const cols = 3;
      const cellW = size / cols;
      const cellH = size / 2;
      
      for (let i = 0; i < radii.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cellX = x + col * cellW;
        const cellY = y + row * cellH;
        
        if (p.x >= cellX && p.x <= cellX + cellW && p.y >= cellY && p.y <= cellY + cellH) {
          // Update the post's radius
          const gs = env.getGlobalState();
          if (picker.postIndex >= 0 && picker.postIndex < gs.posts.length) {
            (gs.posts[picker.postIndex] as any).r = radii[i];
            if (this.editorLevelData && picker.postIndex < this.editorLevelData.posts.length) {
              this.editorLevelData.posts[picker.postIndex].r = radii[i];
            }
            env.setGlobalState(gs);
          }
          this.postRadiusPicker = null;
          return;
        }
      }
      
      // Click outside picker closes it
      if (!(p.x >= x && p.x <= x + size && p.y >= y && p.y <= y + size)) {
        this.postRadiusPicker = null;
        return;
      }
    }

    // 2) Handle hill direction picker
    if (this.hillDirectionPicker && this.hillDirectionPicker.visible) {
      const picker = this.hillDirectionPicker;
      const size = 80;
      const x = picker.x - size / 2;
      const y = picker.y - size / 2;
      
      // Check if clicking on direction arrows
      const dirs = [
        { dir: 'N', x: x + size/2, y: y + 10, label: '↑' },
        { dir: 'S', x: x + size/2, y: y + size - 20, label: '↓' },
        { dir: 'W', x: x + 10, y: y + size/2, label: '←' },
        { dir: 'E', x: x + size - 20, y: y + size/2, label: '→' }
      ];
      
      for (const d of dirs) {
        const hitSize = 15;
        if (p.x >= d.x - hitSize/2 && p.x <= d.x + hitSize/2 && p.y >= d.y - hitSize/2 && p.y <= d.y + hitSize/2) {
          // Update the most recently created hill's direction
          const gs = env.getGlobalState();
          if (gs.hills.length > 0) {
            const lastHill = gs.hills[gs.hills.length - 1] as any;
            lastHill.dir = d.dir;
            if (this.editorLevelData && this.editorLevelData.hills.length > 0) {
              this.editorLevelData.hills[this.editorLevelData.hills.length - 1].dir = d.dir;
            }
            env.setGlobalState(gs);
          }
          this.hillDirectionPicker = null;
          return;
        }
      }
      
      // Click outside picker closes it
      if (!(p.x >= x && p.x <= x + size && p.y >= y && p.y <= y + size)) {
        this.hillDirectionPicker = null;
        return;
      }
    }

    // 2) UI hotspots (menus)
    for (const hs of this.uiHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'menu') {
          this.openEditorMenu = (this.openEditorMenu === hs.menu) ? null : hs.menu;
          this.editorMenuActiveItemIndex = 0;
          return;
        }
        if (hs.kind === 'menuItem') {
          const item = hs.item;
          if (item.kind === 'tool') {
            this.selectedTool = item.tool;
            this.openEditorMenu = null;
            return;
          }
          if (item.kind === 'decoration') {
            this.selectedDecoration = item.decoration;
            this.selectedTool = 'decoration';
            this.openEditorMenu = null;
            return;
          }
          if (item.kind === 'action') {
            if (item.action === 'gridToggle') {
              try { env.setShowGrid?.(!env.getShowGrid()); } catch {}
            } else if (item.action === 'gridMinus') {
              try { const g = Math.max(2, env.getGridSize() - 2); env.setGridSize?.(g); } catch {}
            } else if (item.action === 'gridPlus') {
              try { const g = Math.max(2, env.getGridSize() + 2); env.setGridSize?.(g); } catch {}
            } else if (item.action === 'new') {
              void this.newLevel();
            } else if (item.action === 'save') {
              void this.save();
            } else if (item.action === 'saveAs') {
              void this.saveAs();
            } else if (item.action === 'load') {
              void this.openLoadPicker();
            } else if (item.action === 'import') {
              void this.importLevel();
            } else if (item.action === 'export') {
              void this.exportLevel();
            } else if (item.action === 'metadata') {
              void this.editMetadata();
            } else if (item.action === 'suggestPar') {
              void this.suggestPar();
            } else if (item.action === 'test') {
              void this.testLevel();
            } else if (item.action === 'delete') {
              void this.openDeletePicker();
            } else if (item.action === 'undo') {
              if (this.canUndo()) this.performUndo();
            } else if (item.action === 'redo') {
              if (this.canRedo()) this.performRedo();
            } else if (item.action === 'copy') {
              if (this.selectedObjects.length > 0) this.copySelectedObjects();
            } else if (item.action === 'cut') {
              if (this.selectedObjects.length > 0) this.cutSelectedObjects();
            } else if (item.action === 'paste') {
              if (this.clipboard.length > 0) this.pasteObjects(this.lastMousePosition.x, this.lastMousePosition.y);
            } else if (item.action === 'back') {
              (async () => {
                const ok = await env.showConfirm('Exit Level Editor and return to Main Menu? Unsaved changes will be lost.', 'Exit Editor');
                if (ok) {
                  // Clear any open menus before leaving
                  this.openEditorMenu = null;
                  env.exitToMenu();
                }
              })();
            }
            this.openEditorMenu = null;
            return;
          }
        }
      }
    }

    // 2) Tool-specific behavior
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const inFairway = (p.x >= fairX && p.x <= fairX + fairW && p.y >= fairY && p.y <= fairY + fairH);
    const snap = (n: number) => {
      try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); return Math.round(n / g) * g; } } catch {}
      return n;
    };
    const px = snap(Math.max(fairX, Math.min(fairX + fairW, p.x)));
    const py = snap(Math.max(fairY, Math.min(fairY + fairH, p.y)));

    if (this.selectedTool !== 'select') {
      // Start rectangle placement for rect tools
      if (inFairway && (this.selectedTool === 'wall' || this.selectedTool === 'bridge' || this.selectedTool === 'water' || this.selectedTool === 'sand' || this.selectedTool === 'hill')) {
        this.isEditorDragging = true;
        this.editorDragTool = this.selectedTool;
        this.editorDragStart = { x: px, y: py };
        this.editorDragCurrent = { x: px, y: py };
        return;
      }
      // Poly tools: click to start polygon, subsequent clicks add vertices, double-click or Enter to finish
      if (this.selectedTool === 'wallsPoly' || this.selectedTool === 'waterPoly' || this.selectedTool === 'sandPoly') {
        if (!this.polygonInProgress) {
          // Start new polygon
          this.polygonInProgress = { tool: this.selectedTool, points: [px, py] };
          return;
        } else {
          // Check if clicking near the starting point to close polygon
          const startX = this.polygonInProgress.points[0];
          const startY = this.polygonInProgress.points[1];
          const distToStart = Math.sqrt((px - startX) ** 2 + (py - startY) ** 2);
          
          if (distToStart < 15 && this.polygonInProgress.points.length >= 6) {
            // Close polygon by clicking near start
            this.finishPolygon(env);
            return;
          } else {
            // Add vertex to current polygon
            this.polygonInProgress.points.push(px, py);
            return;
          }
        }
      }
      
      // Point placement for tee/cup/post/decoration
      if (inFairway && (this.selectedTool === 'tee' || this.selectedTool === 'cup' || this.selectedTool === 'post' || this.selectedTool === 'decoration')) {
        this.pushUndoSnapshot(`Place ${this.selectedTool === 'decoration' ? this.selectedDecoration : this.selectedTool}`);
        const gs = env.getGlobalState();
        const defaultRadius = 12;
        
        if (this.selectedTool === 'tee') {
          gs.ball.x = px; gs.ball.y = py;
          if (this.editorLevelData) { this.editorLevelData.tee.x = px; this.editorLevelData.tee.y = py; }
        } else if (this.selectedTool === 'cup') {
          gs.hole.x = px; gs.hole.y = py;
          if (this.editorLevelData) { this.editorLevelData.cup.x = px; this.editorLevelData.cup.y = py; }
        } else if (this.selectedTool === 'post') {
          const post = { x: px, y: py, r: defaultRadius };
          gs.posts.push(post);
          if (this.editorLevelData) this.editorLevelData.posts.push(post);
        } else if (this.selectedTool === 'decoration') {
          const decoration = { 
            x: px, 
            y: py, 
            w: 32,
            h: 32,
            kind: this.selectedDecoration
          };
          gs.decorations.push(decoration);
          if (this.editorLevelData) this.editorLevelData.decorations.push(decoration);
        }
        
        if (this.selectedTool === 'post') {
          // Show radius picker for the new post
          this.postRadiusPicker = { 
            x: px, 
            y: py, 
            visible: true, 
            selectedRadius: defaultRadius,
            postIndex: gs.posts.length - 1
          };
        }
        
        env.setGlobalState(gs);
        return;
      }
    }

    // 3) Selection tool interactions
    // Group rotation handles when multiple selection (only if no polys selected)
    if (this.selectedTool === 'select' && this.selectedObjects.length > 1) {
      const selBounds = this.getSelectionBounds();
      const hasPoly = this.selectedObjects.some(o => o.type === 'wallsPoly' || o.type === 'waterPoly' || o.type === 'sandPoly');
      if (!hasPoly) {
        const rotHandles = this.getRotationHandles(selBounds);
        for (const rh of rotHandles) {
          if (p.x >= rh.x && p.x <= rh.x + rh.w && p.y >= rh.y && p.y <= rh.y + rh.h) {
            // Begin group rotation
            this.pushUndoSnapshot('Group rotate');
            this.isRotating = true;
            const cx = selBounds.x + selBounds.w / 2, cy = selBounds.y + selBounds.h / 2;
            this.rotationCenter = { x: cx, y: cy };
            this.rotationStartMouse = { x: px, y: py };
            this.groupRotationStartAngle = Math.atan2(py - cy, px - cx);
            // Snapshot originals for rotation
            this.groupRotateOriginals = this.selectedObjects.map(o => ({ obj: o, snap: JSON.parse(JSON.stringify(o.object)) }));
            return;
          }
        }
      }
    }

    // Group resize handles when multiple selection (disable if polys present)
    if (this.selectedTool === 'select' && this.selectedObjects.length > 1) {
      const selBounds = this.getSelectionBounds();
      const hasPoly = this.selectedObjects.some(o => o.type === 'wallsPoly' || o.type === 'waterPoly' || o.type === 'sandPoly');
      if (!hasPoly) {
        const handles = this.getResizeHandles(selBounds);
        for (let i = 0; i < handles.length; i++) {
          const h = handles[i];
          if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) {
            this.pushUndoSnapshot('Group resize');
            this.isGroupResizing = true;
            this.resizeHandleIndex = i;
            this.resizeStartBounds = { ...selBounds };
            this.resizeStartMouse = { x: px, y: py };
            // Snapshot originals for proportional scaling
            this.groupResizeOriginals = this.selectedObjects.map(o => ({ obj: o, snap: JSON.parse(JSON.stringify(o.object)) }));
            return;
          }
        }
      }
    }

    // Check rotation/resize handles first when single selection
    if (this.selectedTool === 'select' && this.selectedObjects.length === 1) {
      const obj = this.selectedObjects[0];
      const bounds = this.getObjectBounds(obj);
      // Allow rotation only for rect-like objects (not polygons/posts/tee/cup)
      if (obj.type === 'wall' || obj.type === 'water' || obj.type === 'sand' || obj.type === 'bridge' || obj.type === 'hill' || obj.type === 'decoration') {
        const rotHandles = this.getRotationHandles(bounds);
        for (const rh of rotHandles) {
          if (p.x >= rh.x && p.x <= rh.x + rh.w && p.y >= rh.y && p.y <= rh.y + rh.h) {
            // Begin rotation
            this.pushUndoSnapshot('Rotate object');
            this.isRotating = true;
            const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
            this.rotationCenter = { x: cx, y: cy };
            this.rotationStartMouse = { x: px, y: py };
            const o: any = obj.object;
            const baseRot = typeof o?.rot === 'number' ? o.rot : 0;
            const angNow = Math.atan2(py - cy, px - cx);
            this.rotationStartAngle = baseRot - angNow;
            return;
          }
        }
      }
      const handles = this.getResizeHandles(bounds);
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i];
        if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) {
          // Begin resize for rect-like objects only
          if (obj.type === 'wall' || obj.type === 'water' || obj.type === 'sand' || obj.type === 'bridge' || obj.type === 'hill' || obj.type === 'decoration') {
            this.pushUndoSnapshot('Resize object');
            this.isResizing = true;
            this.resizeHandleIndex = i;
            this.resizeStartBounds = { ...this.getObjectBounds(obj) };
            this.resizeStartMouse = { x: px, y: py };
            return;
          }
        }
      }
    }

    // Polygon vertex drag start (before general hit-test)
    if (this.selectedTool === 'select') {
      const vertexHit = this.findPolygonVertexAtPoint(px, py, env);
      if (vertexHit) {
        // Ensure the polygon is selected
        const isSame = (a: SelectableObject, b: SelectableObject) => a.type === b.type && (a as any).index === (b as any).index;
        if (!this.selectedObjects.some(o => isSame(o, vertexHit.obj))) {
          this.selectedObjects = [vertexHit.obj];
        }
        // Snapshot BEFORE modifying points during drag
        this.pushUndoSnapshot('Move polygon vertex');
        this.isVertexDragging = true;
        this.vertexDrag = vertexHit;
        return;
      }
    }

    // Hit-test objects for selection and drag-move
    const hit = this.findObjectAtPoint(px, py, env);
    if (this.selectedTool === 'select') {
      if (hit) {
        if (e.shiftKey) {
          // Toggle selection
          const idx = this.selectedObjects.indexOf(hit);
          if (idx >= 0) this.selectedObjects.splice(idx, 1); else this.selectedObjects.push(hit);
        } else {
          this.selectedObjects = [hit];
        }
        // Begin drag-move
        this.pushUndoSnapshot('Move selection');
        this.isDragMoving = true;
        this.dragMoveStart = { x: px, y: py };
        this.dragMoveOffset = { x: 0, y: 0 };
      } else {
        // Begin marquee selection
        this.isSelectionDragging = true;
        this.selectionBoxStart = { x: px, y: py };
        this.dragMoveOffset = { x: 0, y: 0 };
        if (!e.shiftKey) this.selectedObjects = [];
      }
    }
  }

  handleMouseMove(e: MouseEvent, env: EditorEnv): void {
    const p = env.worldFromEvent(e);
    
    // Track mouse position for clipboard paste
    this.lastMousePosition = { x: p.x, y: p.y };
    
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const snap = (n: number) => {
      try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); return Math.round(n / g) * g; } } catch {}
      return n;
    };
    const px = snap(Math.max(fairX, Math.min(fairX + fairW, p.x)));
    const py = snap(Math.max(fairY, Math.min(fairY + fairH, p.y)));

    // Update drag placement preview
    if (this.isEditorDragging && this.editorDragTool) {
      this.editorDragCurrent = { x: px, y: py };
      return;
    }

    // Vertex dragging for polygon points
    if (this.isVertexDragging && this.vertexDrag) {
      const { obj, vertexIndex } = this.vertexDrag;
      const poly: any = obj.object as any;
      if (Array.isArray(poly.points)) {
        const i = vertexIndex * 2;
        if (i >= 0 && i + 1 < poly.points.length) {
          poly.points[i] = px;
          poly.points[i + 1] = py;
        }
      }
      return;
    }

    // --- Group rotation ---
    if (this.isRotating && this.selectedObjects.length > 1 && this.rotationCenter && this.groupRotateOriginals) {
      const angNow = Math.atan2(py - this.rotationCenter.y, px - this.rotationCenter.x);
      let delta = angNow - this.groupRotationStartAngle;
      if (e.shiftKey) {
        const step = Math.PI / 12; // 15° snap
        delta = Math.round(delta / step) * step;
      }
      const cx = this.rotationCenter.x;
      const cy = this.rotationCenter.y;
      const cosA = Math.cos(delta);
      const sinA = Math.sin(delta);
      const rotatePoint = (x: number, y: number) => {
        const dx = x - cx; const dy = y - cy;
        return { x: cx + dx * cosA - dy * sinA, y: cy + dx * sinA + dy * cosA };
      };
      for (const rec of this.groupRotateOriginals) {
        const o: any = rec.snap;
        const tgt: any = rec.obj.object as any;
        const t = rec.obj.type as SelectableObject['type'];
        if (t === 'wallsPoly' || t === 'waterPoly' || t === 'sandPoly') {
          continue; // polygons are translate-only
        }
        if (t === 'wall' || t === 'water' || t === 'sand' || t === 'bridge' || t === 'hill' || t === 'decoration') {
          // rotate rect center around group center, apply added rotation
          const ox = o.x ?? 0, oy = o.y ?? 0, ow = o.w ?? 0, oh = o.h ?? 0;
          const ocx = ox + ow / 2, ocy = oy + oh / 2;
          const p2 = rotatePoint(ocx, ocy);
          tgt.x = p2.x - ow / 2; tgt.y = p2.y - oh / 2;
          const baseRot = typeof o?.rot === 'number' ? o.rot : 0;
          tgt.rot = baseRot + delta;
          if ('w' in tgt) tgt.w = ow;
          if ('h' in tgt) tgt.h = oh;
        } else if (t === 'post') {
          const p2 = rotatePoint(o.x, o.y);
          tgt.x = p2.x; tgt.y = p2.y;
          // radius unchanged
        } else if (t === 'tee' || t === 'cup') {
          const p2 = rotatePoint(o.x, o.y);
          tgt.x = p2.x; tgt.y = p2.y;
        }
      }
      return;
    }

    // --- Single-object rotation ---
    if (this.isRotating && this.selectedObjects.length === 1 && this.rotationCenter) {
      const obj = this.selectedObjects[0];
      const angNow = Math.atan2(py - this.rotationCenter.y, px - this.rotationCenter.x);
      let newRot = this.rotationStartAngle + angNow;
      if (e.shiftKey) {
        const step = Math.PI / 12; // 15° snap
        newRot = Math.round(newRot / step) * step;
      }
      (obj.object as any).rot = newRot;
      return;
    }

    // --- Single-object resize ---
    if (this.isResizing && !this.isGroupResizing && this.selectedObjects.length === 1 && this.resizeStartBounds && this.resizeStartMouse && this.resizeHandleIndex !== null) {
      const obj = this.selectedObjects[0];
      const dx = px - this.resizeStartMouse.x;
      const dy = py - this.resizeStartMouse.y;
      // Start from original bounds
      let { x, y, w, h } = { ...this.resizeStartBounds };
      const idx = this.resizeHandleIndex;
      // Corner handles (0..3) then edges (4..7)
      if (idx === 0) { x += dx; y += dy; w -= dx; h -= dy; } // NW
      else if (idx === 1) { y += dy; w += dx; h -= dy; } // NE
      else if (idx === 2) { x += dx; w -= dx; h += dy; } // SW
      else if (idx === 3) { w += dx; h += dy; } // SE
      else if (idx === 4) { y += dy; h -= dy; } // N
      else if (idx === 5) { w += dx; } // E
      else if (idx === 6) { h += dy; } // S
      else if (idx === 7) { x += dx; w -= dx; } // W

      // Enforce minimums
      if (w < 1) { x += (w - 1); w = 1; }
      if (h < 1) { y += (h - 1); h = 1; }

      // Apply to rect-like object
      const o: any = obj.object as any;
      o.x = x; o.y = y; if ('w' in o) o.w = w; if ('h' in o) o.h = h;
      return;
    }

    // --- Group resize ---
    if (this.isGroupResizing && this.resizeStartBounds && this.resizeStartMouse && this.groupResizeOriginals && this.resizeHandleIndex !== null) {
      const dx = px - this.resizeStartMouse.x;
      const dy = py - this.resizeStartMouse.y;
      let { x: bx, y: by, w: bw, h: bh } = { ...this.resizeStartBounds };
      const idx = this.resizeHandleIndex;
      if (idx === 0) { bx += dx; by += dy; bw -= dx; bh -= dy; }
      else if (idx === 1) { by += dy; bw += dx; bh -= dy; }
      else if (idx === 2) { bx += dx; bw -= dx; bh += dy; }
      else if (idx === 3) { bw += dx; bh += dy; }
      else if (idx === 4) { by += dy; bh -= dy; }
      else if (idx === 5) { bw += dx; }
      else if (idx === 6) { bh += dy; }
      else if (idx === 7) { bx += dx; bw -= dx; }
      if (bw < 1) { bx += (bw - 1); bw = 1; }
      if (bh < 1) { by += (bh - 1); bh = 1; }
      // Compute scale factors
      const scaleX = bw / this.resizeStartBounds.w;
      const scaleY = bh / this.resizeStartBounds.h;
      const baseX = this.resizeStartBounds.x;
      const baseY = this.resizeStartBounds.y;
      for (const rec of this.groupResizeOriginals) {
        const o: any = rec.snap;
        const objType = rec.obj.type;
        if (objType === 'wall' || objType === 'water' || objType === 'sand' || objType === 'bridge' || objType === 'hill' || objType === 'post' || objType === 'decoration') {
          const relX = o.x - baseX;
          const relY = o.y - baseY;
          (rec.obj.object as any).x = bx + relX * scaleX;
          (rec.obj.object as any).y = by + relY * scaleY;
          if ('w' in o) (rec.obj.object as any).w = (o.w || 0) * scaleX;
          if ('h' in o) (rec.obj.object as any).h = (o.h || 0) * scaleY;
          if ('r' in o) (rec.obj.object as any).r = (o.r || 0) * ((scaleX + scaleY) / 2);
        } else if (objType === 'tee' || objType === 'cup') {
          const relX = o.x - baseX;
          const relY = o.y - baseY;
          (rec.obj.object as any).x = bx + relX * scaleX;
          (rec.obj.object as any).y = by + relY * scaleY;
        }
        // Poly types skipped for now
      }
      return;
    }

    if (this.isDragMoving && this.dragMoveStart) {
      this.dragMoveOffset = { x: px - this.dragMoveStart.x, y: py - this.dragMoveStart.y };
      return;
    }

    if (this.isSelectionDragging && this.selectionBoxStart) {
      this.dragMoveOffset = { x: px - this.selectionBoxStart.x, y: py - this.selectionBoxStart.y };
      return;
    }

  handleMouseUp(e: MouseEvent, env: EditorEnv): void {
    const p = env.worldFromEvent(e);
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const snap = (n: number) => {
      try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); return Math.round(n / g) * g; } } catch {}
      return n;
    };
    const px = snap(clamp(p.x, fairX, fairX + fairW));
    const py = snap(clamp(p.y, fairY, fairY + fairH));

    // Finish editor rectangle placement (wall/bridge/water/sand/hill)
    if (this.isEditorDragging && this.editorDragTool && this.editorDragStart && this.editorDragCurrent) {
      const sx = Math.min(this.editorDragStart.x, this.editorDragCurrent.x);
      const sy = Math.min(this.editorDragStart.y, this.editorDragCurrent.y);
      const sw = Math.max(1, Math.abs(this.editorDragCurrent.x - this.editorDragStart.x));
      const sh = Math.max(1, Math.abs(this.editorDragCurrent.y - this.editorDragStart.y));
      this.pushUndoSnapshot(`Place ${this.editorDragTool}`);
      const gs = env.getGlobalState();
      if (this.editorDragTool === 'wall') {
        const o: any = { x: sx, y: sy, w: sw, h: sh, rot: 0 };
        (gs.walls as any[]).push(o);
        if (this.editorLevelData) (this.editorLevelData.walls as any[]).push(o);
      } else if (this.editorDragTool === 'bridge') {
        const o: any = { x: sx, y: sy, w: sw, h: sh, rot: 0 };
        (gs.bridges as any[]).push(o);
        if (this.editorLevelData) (this.editorLevelData.bridges as any[]).push(o);
      } else if (this.editorDragTool === 'water') {
        const o: any = { x: sx, y: sy, w: sw, h: sh, rot: 0 };
        (gs.waters as any[]).push(o);
        if (this.editorLevelData) (this.editorLevelData.water as any[]).push(o);
      } else if (this.editorDragTool === 'sand') {
        const o: any = { x: sx, y: sy, w: sw, h: sh, rot: 0 };
        (gs.sands as any[]).push(o);
        if (this.editorLevelData) (this.editorLevelData.sand as any[]).push(o);
      } else if (this.editorDragTool === 'hill') {
        const o: any = { x: sx, y: sy, w: sw, h: sh, rot: 0, dir: 'N' };
        (gs.hills as any[]).push(o);
        if (this.editorLevelData) (this.editorLevelData.hills as any[]).push(o);
        // open hill direction picker near the center
        const cx = sx + sw / 2, cy = sy + sh / 2;
        this.hillDirectionPicker = { x: cx, y: cy, visible: true, selectedDir: 'N' as any } as any;
      }
      env.setGlobalState(gs);
      this.isEditorDragging = false;
      this.editorDragTool = null;
      this.editorDragStart = null;
      this.editorDragCurrent = null;
      this.syncEditorDataFromGlobals(env);
      return;
    }

    // Commit polygon vertex drag (snapshot was taken on mouse down)
    if (this.isVertexDragging) {
      this.isVertexDragging = false;
      this.vertexDrag = null;
      this.syncEditorDataFromGlobals(env);
      return;
    }

    // Finish rotations
    if (this.isRotating) {
      this.isRotating = false;
      this.rotationCenter = null;
      this.rotationStartMouse = null;
      this.rotationStartAngle = 0;
      this.groupRotationStartAngle = 0;
      this.groupRotateOriginals = null;
      this.syncEditorDataFromGlobals(env);
      return;
    }

    // Finish single/group resize
    if (this.isResizing || this.isGroupResizing) {
      this.isResizing = false;
      this.isGroupResizing = false;
      this.resizeHandleIndex = null;
      this.resizeStartBounds = null;
      this.resizeStartMouse = null;
      this.groupResizeOriginals = null;
      this.syncEditorDataFromGlobals(env);
      return;
    }

    // Finish drag-move by applying accumulated offset
    if (this.isDragMoving && this.dragMoveStart) {
      const dx = this.dragMoveOffset.x;
      const dy = this.dragMoveOffset.y;
      if (dx !== 0 || dy !== 0) {
        for (const so of this.selectedObjects) {
          const t = so.type as any;
          const o: any = so.object as any;
          if (t === 'wallsPoly' || t === 'waterPoly' || t === 'sandPoly') {
            const pts: number[] = Array.isArray(o.points) ? o.points : [];
            for (let i = 0; i + 1 < pts.length; i += 2) { pts[i] += dx; pts[i + 1] += dy; }
          } else if (t === 'tee' || t === 'cup' || t === 'post' || t === 'wall' || t === 'water' || t === 'sand' || t === 'bridge' || t === 'hill' || t === 'decoration') {
            if (typeof o.x === 'number') o.x += dx;
            if (typeof o.y === 'number') o.y += dy;
          }
        }
      }
      this.isDragMoving = false;
      this.dragMoveStart = null;
      this.dragMoveOffset = { x: 0, y: 0 };
      this.syncEditorDataFromGlobals(env);
      return;
    }

    // Finish selection box
    if (this.isSelectionDragging && this.selectionBoxStart) {
      const boxX = Math.min(this.selectionBoxStart.x, this.selectionBoxStart.x + this.dragMoveOffset.x);
      const boxY = Math.min(this.selectionBoxStart.y, this.selectionBoxStart.y + this.dragMoveOffset.y);
      const boxW = Math.abs(this.dragMoveOffset.x);
      const boxH = Math.abs(this.dragMoveOffset.y);
      const box = { x: boxX, y: boxY, w: boxW, h: boxH };
      const inBox = (b: { x: number; y: number; w: number; h: number }) => !(b.x + b.w < box.x || b.y + b.h < box.y || b.x > box.x + box.w || b.y > box.y + box.h);

      const gs = env.getGlobalState();
      const newlySelected: SelectableObject[] = [] as any;
      const pushIf = (obj: SelectableObject) => { const b = this.getObjectBounds(obj); if (inBox(b)) newlySelected.push(obj); };

      // Tee and Cup
      pushIf({ type: 'tee', object: { x: gs.ball.x, y: gs.ball.y, r: (gs.ball as any).r || 8 } } as any);
      pushIf({ type: 'cup', object: { x: gs.hole.x, y: gs.hole.y, r: (gs.hole as any).r || 8 } } as any);
      // Arrays
      (gs.posts as any[]).forEach((o, i) => pushIf({ type: 'post', object: o, index: i } as any));
      (gs.walls as any[]).forEach((o, i) => pushIf({ type: 'wall', object: o, index: i } as any));
      (gs.polyWalls as any[]).forEach((o, i) => pushIf({ type: 'wallsPoly', object: o, index: i } as any));
      (gs.waters as any[]).forEach((o, i) => pushIf({ type: 'water', object: o, index: i } as any));
      (gs.watersPoly as any[]).forEach((o, i) => pushIf({ type: 'waterPoly', object: o, index: i } as any));
      (gs.sands as any[]).forEach((o, i) => pushIf({ type: 'sand', object: o, index: i } as any));
      (gs.sandsPoly as any[]).forEach((o, i) => pushIf({ type: 'sandPoly', object: o, index: i } as any));
      (gs.bridges as any[]).forEach((o, i) => pushIf({ type: 'bridge', object: o, index: i } as any));
      (gs.hills as any[]).forEach((o, i) => pushIf({ type: 'hill', object: o, index: i } as any));
      (gs.decorations as any[]).forEach((o, i) => pushIf({ type: 'decoration', object: o, index: i } as any));

      if (e.shiftKey) {
        // Union
        const set = new Set(this.selectedObjects);
        for (const o of newlySelected) set.add(o);
        this.selectedObjects = Array.from(set);
      } else {
        this.selectedObjects = newlySelected;
      }

      this.isSelectionDragging = false;
      this.selectionBoxStart = null;
      this.dragMoveOffset = { x: 0, y: 0 };
      return;
    }
  }

  // Hit-test for polygon vertices across all polygon types
  private findPolygonVertexAtPoint(px: number, py: number, env: EditorEnv): { obj: SelectableObject; vertexIndex: number } | null {
    const gs = env.getGlobalState();
    const threshold = 8; // pixels

    const testPolyArray = <T extends { points: number[] }>(arr: T[] | undefined, type: SelectableObject['type']): { obj: SelectableObject; vertexIndex: number } | null => {
      if (!arr) return null;
      for (let idx = 0; idx < arr.length; idx++) {
        const poly: any = arr[idx];
        const pts: number[] = Array.isArray(poly.points) ? poly.points : [];
        for (let i = 0, vi = 0; i + 1 < pts.length; i += 2, vi++) {
          const vx = pts[i];
          const vy = pts[i + 1];
          const dx = px - vx;
          const dy = py - vy;
          if (Math.hypot(dx, dy) <= threshold) {
            const obj: SelectableObject = { type: type as any, object: poly, index: idx } as any;
            return { obj, vertexIndex: vi };
          }
        }
      }
      return null;
    };

    return (
      testPolyArray(gs.polyWalls as any[], 'wallsPoly') ||
      testPolyArray(gs.watersPoly as any[], 'waterPoly') ||
      testPolyArray(gs.sandsPoly as any[], 'sandPoly') ||
      null
    );
  }
  // General object hit-test used by selection and clicking
  private findObjectAtPoint(px: number, py: number, env: EditorEnv): SelectableObject | null {
    const gs = env.getGlobalState();
    // Tee
    {
      const teeObj: SelectableObject = { type: 'tee', object: { x: gs.ball.x, y: gs.ball.y, r: (gs.ball as any).r || 8 } } as any;
      if (this.isPointInObject(px, py, teeObj)) return teeObj;
    }
    // Cup
    {
      const cupObj: SelectableObject = { type: 'cup', object: { x: gs.hole.x, y: gs.hole.y, r: (gs.hole as any).r || 8 } } as any;
      if (this.isPointInObject(px, py, cupObj)) return cupObj;
    }
    // Posts
    for (let i = 0; i < (gs.posts as any[]).length; i++) {
      const obj: SelectableObject = { type: 'post', object: (gs.posts as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Walls
    for (let i = 0; i < (gs.walls as any[]).length; i++) {
      const obj: SelectableObject = { type: 'wall', object: (gs.walls as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Polygon walls
    for (let i = 0; i < (gs.polyWalls as any[]).length; i++) {
      const obj: SelectableObject = { type: 'wallsPoly', object: (gs.polyWalls as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Water rects
    for (let i = 0; i < (gs.waters as any[]).length; i++) {
      const obj: SelectableObject = { type: 'water', object: (gs.waters as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Water polys
    for (let i = 0; i < (gs.watersPoly as any[]).length; i++) {
      const obj: SelectableObject = { type: 'waterPoly', object: (gs.watersPoly as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Sand rects
    for (let i = 0; i < (gs.sands as any[]).length; i++) {
      const obj: SelectableObject = { type: 'sand', object: (gs.sands as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Sand polys
    for (let i = 0; i < (gs.sandsPoly as any[]).length; i++) {
      const obj: SelectableObject = { type: 'sandPoly', object: (gs.sandsPoly as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Bridges
    for (let i = 0; i < (gs.bridges as any[]).length; i++) {
      const obj: SelectableObject = { type: 'bridge', object: (gs.bridges as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Hills
    for (let i = 0; i < (gs.hills as any[]).length; i++) {
      const obj: SelectableObject = { type: 'hill', object: (gs.hills as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    // Decorations
    for (let i = 0; i < (gs.decorations as any[]).length; i++) {
      const obj: SelectableObject = { type: 'decoration', object: (gs.decorations as any[])[i], index: i } as any;
      if (this.isPointInObject(px, py, obj)) return obj;
    }
    return null;
  }

  // Synchronize editor's internal level data from the current global state
  private syncEditorDataFromGlobals(env: EditorEnv): void {
    const gs = env.getGlobalState();
    if (!this.editorLevelData) this.editorLevelData = {} as any;

    // Canvas size (fallback to globals/env sizes)
    const width = gs.levelCanvas?.width ?? gs.WIDTH ?? env.width;
    const height = gs.levelCanvas?.height ?? gs.HEIGHT ?? env.height;
    this.editorLevelData.canvas = { width, height };

    // Preserve existing course/meta if present
    this.editorLevelData.course = this.editorLevelData.course ?? { index: 1, total: 1, title: this.editorLevelData?.course?.title ?? 'Untitled' };
    this.editorLevelData.par = typeof this.editorLevelData.par === 'number' ? this.editorLevelData.par : 3;

    // Tee/Cup from ball/hole preview
    const teeR = (gs.ball as any)?.r ?? (this.editorLevelData.tee?.r ?? 8);
    const cupR = (gs.hole as any)?.r ?? (this.editorLevelData.cup?.r ?? 8);
    this.editorLevelData.tee = { x: gs.ball?.x ?? 0, y: gs.ball?.y ?? 0, r: teeR };
    this.editorLevelData.cup = { x: gs.hole?.x ?? 0, y: gs.hole?.y ?? 0, r: cupR };

    // Arrays (deep copy)
    this.editorLevelData.walls = JSON.parse(JSON.stringify(gs.walls ?? []));
    this.editorLevelData.wallsPoly = JSON.parse(JSON.stringify(gs.polyWalls ?? []));
    this.editorLevelData.posts = JSON.parse(JSON.stringify(gs.posts ?? []));
    this.editorLevelData.bridges = JSON.parse(JSON.stringify(gs.bridges ?? []));
    this.editorLevelData.water = JSON.parse(JSON.stringify(gs.waters ?? []));
    this.editorLevelData.waterPoly = JSON.parse(JSON.stringify(gs.watersPoly ?? []));
    this.editorLevelData.sand = JSON.parse(JSON.stringify(gs.sands ?? []));
    this.editorLevelData.sandPoly = JSON.parse(JSON.stringify(gs.sandsPoly ?? []));
    this.editorLevelData.hills = JSON.parse(JSON.stringify(gs.hills ?? []));
    this.editorLevelData.decorations = JSON.parse(JSON.stringify(gs.decorations ?? []));
  }

  // Compute axis-aligned bounds for the current selection
  private getSelectionBounds(): { x: number; y: number; w: number; h: number } {
    if (this.selectedObjects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    if (this.selectedObjects.length === 1) return this.getObjectBounds(this.selectedObjects[0]);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of this.selectedObjects) {
      const b = this.getObjectBounds(obj);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // Compute axis-aligned bounds for a single object (handles polygons and rotated rect-like types)
  private getObjectBounds(obj: SelectableObject): { x: number; y: number; w: number; h: number } {
    const t = obj.type as SelectableObject['type'];
    const o: any = obj.object as any;

    // Circle-like (tee/cup/post)
    if (t === 'tee' || t === 'cup' || t === 'post') {
      const r = (o?.r ?? 8) as number;
      return { x: (o?.x ?? 0) - r, y: (o?.y ?? 0) - r, w: r * 2, h: r * 2 };
    }

    // Polygon types
    if (t === 'wallsPoly' || t === 'waterPoly' || t === 'sandPoly') {
      const pts: number[] = Array.isArray(o?.points) ? o.points : [];
      if (pts.length < 2) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const x = pts[i];
        const y = pts[i + 1];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    // Rect-like with optional rotation
    const rx = o?.x ?? 0;
    const ry = o?.y ?? 0;
    const rw = o?.w ?? 0;
    const rh = o?.h ?? 0;
    const rot = typeof o?.rot === 'number' ? o.rot : 0;
    if (!rot) {
      return { x: rx, y: ry, w: rw, h: rh };
    }
    // AABB of rotated rectangle around center
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const cosA = Math.cos(rot);
    const sinA = Math.sin(rot);
    const corners = [
      { x: -rw / 2, y: -rh / 2 },
      { x: rw / 2, y: -rh / 2 },
      { x: -rw / 2, y: rh / 2 },
      { x: rw / 2, y: rh / 2 }
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      const wx = cx + c.x * cosA - c.y * sinA;
      const wy = cy + c.x * sinA + c.y * cosA;
      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // Rotation handle(s) positioned above top-center of the bounds
  private getRotationHandles(bounds: { x: number; y: number; w: number; h: number }): Array<{ x: number; y: number; w: number; h: number }> {
    const size = 10; // visual size for circular handle
    const gap = 14;  // gap above the top edge
    const cx = bounds.x + bounds.w / 2;
    const hx = cx - size / 2;
    const hy = bounds.y - gap - size;
    return [{ x: hx, y: hy, w: size, h: size }];
  }

  // 8 resize handles: 0..3 corners (NW, NE, SW, SE), 4..7 edges (N, E, S, W)
  private getResizeHandles(bounds: { x: number; y: number; w: number; h: number }): Array<{ x: number; y: number; w: number; h: number }> {
    const s = 8; // square handle size
    const x = bounds.x, y = bounds.y, w = bounds.w, h = bounds.h;
    const mx = x + w / 2;
    const my = y + h / 2;
    return [
      // Corners: NW, NE, SW, SE
      { x: x - s / 2,     y: y - s / 2,     w: s, h: s },
      { x: x + w - s / 2, y: y - s / 2,     w: s, h: s },
      { x: x - s / 2,     y: y + h - s / 2, w: s, h: s },
      { x: x + w - s / 2, y: y + h - s / 2, w: s, h: s },
      // Edges: N, E, S, W
      { x: mx - s / 2,    y: y - s / 2,     w: s, h: s },
      { x: x + w - s / 2, y: my - s / 2,    w: s, h: s },
      { x: mx - s / 2,    y: y + h - s / 2, w: s, h: s },
      { x: x - s / 2,     y: my - s / 2,    w: s, h: s }
    ];
  }

  // Helper: point-inside test by object type
  private isPointInObject(px: number, py: number, obj: SelectableObject): boolean {
    const type = obj.type as SelectableObject['type'];
    const o: any = obj.object as any;
    if (type === 'tee' || type === 'cup' || type === 'post') {
      const r = o.r || 8;
      const dx = px - o.x; const dy = py - o.y;
      return (dx * dx + dy * dy) <= r * r;
    }
    if (type === 'wallsPoly' || type === 'waterPoly' || type === 'sandPoly') {
      const pts: number[] = Array.isArray(o.points) ? o.points : [];
      if (pts.length < 6) return false;
      // ray cast
      let inside = false;
      for (let i = 0, j = (pts.length / 2 - 1); i < pts.length / 2; j = i++) {
        const xi = pts[i * 2], yi = pts[i * 2 + 1];
        const xj = pts[j * 2], yj = pts[j * 2 + 1];
        const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-6) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }
    // Rect-like with optional rotation
    const rx = o.x || 0, ry = o.y || 0, rw = o.w || 0, rh = o.h || 0;
    const cx = rx + rw / 2, cy = ry + rh / 2;
    const rot = typeof o.rot === 'number' ? o.rot : 0;
    const s = Math.sin(-rot), c = Math.cos(-rot);
    const lx = c * (px - cx) - s * (py - cy) + cx;
    const ly = s * (px - cx) + c * (py - cy) + cy;
    return (lx >= rx && lx <= rx + rw && ly >= ry && ly <= ry + rh);
  }
}

export const levelEditor: LevelEditor = new LevelEditorImpl();
