    /*
  Level Editor module
  -------------------
  This module encapsulates Level Editor state, input handling, rendering, and persistence helpers.
  Migrated from main.ts to modularize the Level Editor code while maintaining existing behavior.

  Note: Per project policy, avoid localStorage for persistence in dev/admin builds. The eventual
  implementation will integrate file-based persistence; for browser-only builds expose Import/Export.
*/

import { 
  importLevelFromFile, 
  saveLevelAsDownload,
  applyLevelDataFixups,
  validateLevelData
} from './filesystem';
import { importLevelFromScreenshot } from './importScreenshot';
import firebaseLevelStore from '../firebase/FirebaseLevelStore';
import type { LevelEntry as FirebaseLevelEntry } from '../firebase/FirebaseLevelStore';
import firebaseCourseStore from '../firebase/FirebaseCourseStore';
import { estimatePar, suggestCupPositions as heuristicSuggestCups, lintCupPath, computePathDebug } from './levelHeuristics';
import type { PathDebug } from './levelHeuristics';

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
  | { type: 'hill'; object: Slope; index: number }
  | { type: 'overlay'; object: any };

export type EditorTool =
  | 'select' | 'tee' | 'cup' | 'wall' | 'wallsPoly' | 'walls45' | 'post' | 'bridge' | 'water' | 'waterPoly' | 'water45' | 'sand' | 'sandPoly' | 'sand45' | 'hill' | 'decoration' | 'measure';

export type EditorAction =
  | 'save' | 'saveAs' | 'load' | 'import' | 'importScreenshot' | 'importAnnotate' | 'export' | 'new' | 'delete' | 'test' | 'metadata' | 'suggestPar' | 'suggestCup' | 'gridToggle' | 'previewFillOnClose' | 'previewDashedNext' | 'alignmentGuides' | 'guideDetailsToggle' | 'rulersToggle' | 'back' | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'duplicate' | 'chamfer' | 'angledCorridor' | 'courseCreator'
  // Overlay Screenshot actions (View menu + Tools launcher)
  | 'overlayOpen' | 'overlayToggle' | 'overlayOpacityUp' | 'overlayOpacityDown' | 'overlayZToggle' | 'overlayLockToggle' | 'overlaySnapToggle' | 'overlayFitFairway' | 'overlayFitCanvas' | 'overlayReset' | 'overlayFlipH' | 'overlayFlipV' | 'overlayThroughClick' | 'overlayAspectToggle' | 'overlayCalibrateScale'
  | 'alignLeft' | 'alignRight' | 'alignTop' | 'alignBottom' | 'alignCenterH' | 'alignCenterV' | 'distributeH' | 'distributeV';

export type EditorMenuId = 'file' | 'edit' | 'view' | 'objects' | 'decorations' | 'tools';

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
  // Optional panelized metadata form; returns null on cancel
  showMetadataForm?(init: { title: string; author: string; par: string; description?: string; tags?: string }, dialogTitle?: string): Promise<{ title: string; author: string; par: string; description: string; tags: string } | null>;
  showList(title: string, items: Array<{label: string; value: any}>, startIndex?: number): Promise<any>;
  showDnDList?(title: string, items: Array<{label: string; value: any}>): Promise<Array<{label: string; value: any}> | null>;
  showCourseEditor?(courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] }): Promise<{ action: string; courseData?: any; levelIndex?: number } | null>;
  showUiCourseCreator?(courseList: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>): Promise<{ action: string; courseData?: any } | null>;
  // Import Review overlay (optional)
  showImportReview?(init: {
    imageData: ImageData;
    thresholds: any;
    fairway: { x: number; y: number; w: number; h: number };
    gridSize: number;
    canvas: { width: number; height: number };
    currentPolys: { wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> };
  }): Promise<{ thresholds: any; polys: { wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> } } | null>;
  // Annotation overlay (optional)
  showAnnotateScreenshot?(file: File, opts: any): Promise<any | null>;
  renderGlobalOverlays(): void;
  isOverlayActive?(): boolean;
  migrateSingleSlotIfNeeded?(): void;
  exitToMenu(): void;
  getUserId(): string;
  testLevel?(levelData: any): Promise<void>;
  // Role
  getUserRole?(): 'admin' | 'user';
}

export interface LevelEditor {
  // Lifecycle
  init(env: EditorEnv): void;
  reset(): void;

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
  // Suggest Cup markers (transient hints rendered on canvas)
  private suggestedCupCandidates: Array<{ x: number; y: number; score: number; lengthPx: number; turns: number }> | null = null;
  // Visual Path Preview (computed from A* used in Suggest Par)
  private pathPreview: PathDebug | null = null;
  private showPathPreview: boolean = false;

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
  private editorDragStart: { x: number; y: number } | null = null;
  private editorDragCurrent: { x: number; y: number } | null = null;

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
  // Polygon preview line join toggle (Alt toggles)
  private polygonJoinBevel: boolean = false;
  // View option: when true, in-progress polygon preview only fills on close
  private previewFillOnClose: boolean = false;
  // View option: when true, show next-segment preview as dashed; otherwise solid
  private previewDashedNextSegment: boolean = true;
  // View option: enable alignment guides (snap + guide lines)
  private showAlignmentGuides: boolean = true;
  // View option: show rulers (top/left)
  private showRulers: boolean = false;
  // View option: show numeric guide detail labels (axis/spacing). When off, only cyan guide lines render.
  private showGuideDetails: boolean = true;
  // Importer guidance: require the user to click Tee (and optionally Cup) after screenshot import
  private pendingTeeConfirm: boolean = false;
  private pendingCupConfirm: boolean = false;
  // Transient live guides computed during interactions
  private liveGuides: Array<{ kind: 'x' | 'y'; pos: number }> = [];
  // Persistent ruler-dragged guides
  private persistentGuides: Array<{ kind: 'x' | 'y'; pos: number }> = [];
  // Ruler-drag interaction state
  private isRulerDragging: boolean = false;
  private rulerDragKind: 'x' | 'y' | null = null;
  private rulerDragPos: number | null = null;
  private lastRulerClickMs: number = 0;
  private lastRulerBand: 'x' | 'y' | null = null;
  // Transient guide bubbles (small labels shown near guides)
  private liveGuideBubbles: Array<{ x: number; y: number; text: string }> = [];
  // Measure tool state
  private measureStart: { x: number; y: number } | null = null;
  private measureEnd: { x: number; y: number } | null = null;
  private pinnedMeasures: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> = [];
  private lastClickMs: number = 0;
  private lastClickPos: { x: number; y: number } | null = null;
  // Track last modifier keys for preview constraints
  private lastModifiers: { shift: boolean; ctrl: boolean; alt: boolean } = { shift: false, ctrl: false, alt: false };
  
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
  
  // Overlay Screenshot session state (editor-only; not persisted)
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayNatural: { width: number; height: number } = { width: 0, height: 0 };
  private overlayVisible: boolean = false;
  private overlayOpacity: number = 0.5; // 0..1
  private overlayAbove: boolean = false; // z-order: false=below geometry, true=above geometry
  private overlayLocked: boolean = false;
  private overlaySnapToGrid: boolean = true;
  private overlayThroughClick: boolean = false;
  private overlayTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false, preserveAspect: true } as {
    x: number; y: number; scaleX: number; scaleY: number; rotation: number; flipH: boolean; flipV: boolean; preserveAspect: boolean;
  };
  // Overlay interaction state
  private overlayIsDragging: boolean = false;
  private overlayDragStartMouse: { x: number; y: number } | null = null;
  private overlayStartPos: { x: number; y: number } | null = null;
  private overlayIsResizing: boolean = false;
  private overlayResizeAnchorLocal: { x: number; y: number } | null = null;
  private overlayResizeAnchorWorld: { x: number; y: number } | null = null;
  private overlayResizeStartScale: { sx: number; sy: number } | null = null;
  private overlayResizeAxis: 'both' | 'x' | 'y' = 'both';
  private overlayActiveHandle: 'corner0' | 'corner1' | 'corner2' | 'corner3' | 'edgeTop' | 'edgeRight' | 'edgeBottom' | 'edgeLeft' | null = null;
  private overlayIsRotating: boolean = false;
  private overlayRotateStartAngleLocal: number = 0;
  private overlayRotateInitialRotation: number = 0;
  private overlayCalibrate: null | { phase: 'pickA' | 'pickB'; aLocal?: { x:number; y:number }; aWorld?: { x:number; y:number } } = null;
  
  // Helper: constrain a segment to 0/45/90-degree increments relative to last vertex
  private constrainTo45(prevX: number, prevY: number, px: number, py: number, gridOn: boolean, gridSize: number): { x: number; y: number } {
    // Start with optional grid snap
    const snap = (n: number) => (gridOn ? Math.round(n / gridSize) * gridSize : n);
    let x = snap(px);
    let y = snap(py);
    const dx = x - prevX;
    const dy = y - prevY;
    if (dx === 0 || Math.abs(dx) < 1e-6) return { x: prevX, y };
    if (dy === 0 || Math.abs(dy) < 1e-6) return { x, y: prevY };
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    // Decide axis vs diagonal with a simple threshold; otherwise snap to perfect diagonal
    const axisBias = 1.5; // if one component is 1.5x larger, prefer axis
    if (adx > ady * axisBias) return { x, y: prevY };
    if (ady > adx * axisBias) return { x: prevX, y };
    // Diagonal: make |dx| == |dy| preserving signs and using the larger magnitude
    const len = Math.max(adx, ady);
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    return { x: prevX + sx * len, y: prevY + sy * len };
  }

  // ----- Overlay helpers -----
  private async openOverlayImage(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = false;
      input.onchange = () => {
        const f = (input.files && input.files[0]) ? input.files[0] : null;
        resolve(f);
      };
      input.click();
    });
    if (!file) return;

    try {
      const img = await this.loadImageFromFile(file);
      // Downscale to max dimension to keep perf reasonable
      const maxDim = 2048;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const c2d = canvas.getContext('2d');
      if (!c2d) throw new Error('2D context not available');
      c2d.imageSmoothingQuality = 'high';
      c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
      this.overlayCanvas = canvas;
      this.overlayNatural = { width: canvas.width, height: canvas.height };
      this.overlayVisible = true;
      this.overlayOpacity = 0.5;
      this.overlayAbove = false;
      this.overlayLocked = false;
      this.overlaySnapToGrid = true;
      this.resetOverlayTransform(env);
      this.fitOverlayToFairway(env);
      try { env.showToast('Overlay image loaded'); } catch {}
    } catch (e) {
      console.error('openOverlayImage failed', e);
      try { this.env?.showToast('Failed to load overlay'); } catch {}
    }
  }

  private resetOverlayTransform(env: EditorEnv): void {
    this.overlayTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false, preserveAspect: true };
  }

  private fitOverlayToFairway(env: EditorEnv): void {
    if (!this.overlayCanvas) return;
    const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
    const iw = this.overlayNatural.width || this.overlayCanvas.width;
    const ih = this.overlayNatural.height || this.overlayCanvas.height;
    if (iw <= 0 || ih <= 0 || fw <= 0 || fh <= 0) return;
    const s = Math.min(fw / iw, fh / ih);
    const dw = iw * s;
    const dh = ih * s;
    this.overlayTransform.scaleX = s;
    this.overlayTransform.scaleY = s;
    this.overlayTransform.x = fx + Math.floor((fw - dw) / 2);
    this.overlayTransform.y = fy + Math.floor((fh - dh) / 2);
  }

  private renderOverlay(env: EditorEnv): void {
    if (!this.overlayCanvas) return;
    const { ctx } = env;
    const img = this.overlayCanvas;
    const t = this.overlayTransform;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, this.overlayOpacity));
    // Apply transform
    const cx = t.x;
    const cy = t.y;
    ctx.translate(cx, cy);
    ctx.rotate(t.rotation || 0);
    const sx = (t.flipH ? -1 : 1) * (t.scaleX || 1);
    const sy = (t.flipV ? -1 : 1) * (t.scaleY || 1);
    ctx.scale(sx, sy);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // Compute whether a world point lies within the transformed overlay image bounds
  private isPointInOverlay(px: number, py: number): boolean {
    if (!this.overlayCanvas) return false;
    const t = this.overlayTransform;
    const iw = this.overlayNatural.width || this.overlayCanvas.width;
    const ih = this.overlayNatural.height || this.overlayCanvas.height;
    const sx = (t.flipH ? -1 : 1) * (t.scaleX || 1);
    const sy = (t.flipV ? -1 : 1) * (t.scaleY || 1);
    const dx = px - t.x;
    const dy = py - t.y;
    const c = Math.cos(t.rotation || 0);
    const s = Math.sin(t.rotation || 0);
    // Inverse rotate
    const xr = dx * c + dy * s;
    const yr = -dx * s + dy * c;
    // Inverse scale
    const lx = xr / sx;
    const ly = yr / sy;
    return (lx >= 0 && ly >= 0 && lx <= iw && ly <= ih);
  }

  // Convert a world point to overlay local coordinates (before rotation/scale)
  private worldToOverlayLocal(px: number, py: number): { x: number; y: number } {
    if (!this.overlayCanvas) return { x: 0, y: 0 };
    const t = this.overlayTransform;
    const sx = (t.flipH ? -1 : 1) * (t.scaleX || 1);
    const sy = (t.flipV ? -1 : 1) * (t.scaleY || 1);
    const dx = px - t.x;
    const dy = py - t.y;
    const c = Math.cos(t.rotation || 0);
    const s = Math.sin(t.rotation || 0);
    const xr = dx * c + dy * s;
    const yr = -dx * s + dy * c;
    return { x: xr / sx, y: yr / sy };
  }

  // Compute handle world positions for overlay (corners, edges, rotation handle)
  private getOverlayHandlePositions(): {
    corners: [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}];
    edges: { top:{x:number;y:number}; right:{x:number;y:number}; bottom:{x:number;y:number}; left:{x:number;y:number} };
    rotation: { x:number; y:number };
  } | null {
    if (!this.overlayCanvas) return null;
    const t = this.overlayTransform;
    const iw = this.overlayNatural.width || this.overlayCanvas.width;
    const ih = this.overlayNatural.height || this.overlayCanvas.height;
    const c = Math.cos(t.rotation || 0);
    const s = Math.sin(t.rotation || 0);
    const sx = (t.flipH ? -1 : 1) * (t.scaleX || 1);
    const sy = (t.flipV ? -1 : 1) * (t.scaleY || 1);
    const worldPt = (lx: number, ly: number) => {
      const lx2 = lx * sx;
      const ly2 = ly * sy;
      return { x: t.x + (lx2 * c - ly2 * s), y: t.y + (lx2 * s + ly2 * c) };
    };
    const p0 = worldPt(0, 0);
    const p1 = worldPt(iw, 0);
    const p2 = worldPt(iw, ih);
    const p3 = worldPt(0, ih);
    // Edge midpoints
    const top = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const right = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const bottom = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
    const left = { x: (p3.x + p0.x) / 2, y: (p3.y + p0.y) / 2 };
    // Rotation handle 20px outwards from top edge
    const nx = p0.y - p1.y, ny = p1.x - p0.x; const nlen = Math.hypot(nx, ny) || 1; const ux = nx / nlen, uy = ny / nlen;
    const rotation = { x: top.x + ux * 20, y: top.y + uy * 20 };
    return { corners: [p0, p1, p2, p3], edges: { top, right, bottom, left }, rotation };
  }

  private renderOverlayHandles(env: EditorEnv): void {
    if (!this.overlayCanvas) return;
    const { ctx } = env;
    const handles = this.getOverlayHandlePositions();
    if (!handles) return;
    const [p0, p1, p2, p3] = handles.corners;
    const pr = handles.rotation;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00aaff';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // Corner handles
    const drawHandle = (pt: {x:number;y:number}) => {
      const hs = 6;
      ctx.fillStyle = '#00aaff';
      ctx.fillRect(pt.x - hs/2, pt.y - hs/2, hs, hs);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(pt.x - hs/2, pt.y - hs/2, hs, hs);
    };
    drawHandle(p0); drawHandle(p1); drawHandle(p2); drawHandle(p3);
    // Edge handles (midpoints)
    const drawEdge = (pt: {x:number;y:number}) => {
      const hs = 6;
      ctx.fillStyle = '#55ccff';
      ctx.fillRect(pt.x - hs/2, pt.y - hs/2, hs, hs);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.strokeRect(pt.x - hs/2, pt.y - hs/2, hs, hs);
    };
    drawEdge(handles.edges.top);
    drawEdge(handles.edges.right);
    drawEdge(handles.edges.bottom);
    drawEdge(handles.edges.left);
    // Rotation handle (circle)
    ctx.fillStyle = '#ff6600';
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pr.x, pr.y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  private fitOverlayToCanvas(env: EditorEnv): void {
    if (!this.overlayCanvas) return;
    const WIDTH = env.width, HEIGHT = env.height;
    const iw = this.overlayNatural.width || this.overlayCanvas.width;
    const ih = this.overlayNatural.height || this.overlayCanvas.height;
    if (iw <= 0 || ih <= 0 || WIDTH <= 0 || HEIGHT <= 0) return;
    const s = Math.min(WIDTH / iw, HEIGHT / ih);
    const dw = iw * s;
    const dh = ih * s;
    this.overlayTransform.scaleX = s;
    this.overlayTransform.scaleY = s;
    this.overlayTransform.x = Math.floor((WIDTH - dw) / 2);
    this.overlayTransform.y = Math.floor((HEIGHT - dh) / 2);
  }

  private loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Compute snapping for drag-move based on the selection bounds rather than the mouse point.
  // Returns adjusted dx/dy and any guide lines used for snapping. Considers left/center/right and top/middle/bottom of the moved selection.
  private computeMoveSnapForSelection(rawDx: number, rawDy: number, env: EditorEnv): { dx: number; dy: number; guides: Array<{ kind: 'x' | 'y'; pos: number }> } {
    const guides: Array<{ kind: 'x' | 'y'; pos: number }> = [];
    if (!this.showAlignmentGuides || this.selectedObjects.length === 0) return { dx: rawDx, dy: rawDy, guides };
    const threshold = 6;
    const gs = env.getGlobalState();
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const candX: number[] = [fairX, fairX + Math.floor(fairW / 2), fairX + fairW];
    const candY: number[] = [fairY, fairY + Math.floor(fairH / 2), fairY + fairH];
    // Include persistent ruler guides
    for (const g of this.persistentGuides) { if (g.kind === 'x') candX.push(g.pos); else candY.push(g.pos); }
    // Candidate bounds from non-selected objects
    const arrays: Array<{ arr: any[]; type: SelectableObject['type'] }> = [
      { arr: gs.walls || [], type: 'wall' as any },
      { arr: gs.polyWalls || [], type: 'wallsPoly' as any },
      { arr: gs.waters || [], type: 'water' as any },
      { arr: gs.watersPoly || [], type: 'waterPoly' as any },
      { arr: gs.sands || [], type: 'sand' as any },
      { arr: gs.sandsPoly || [], type: 'sandPoly' as any },
      { arr: gs.bridges || [], type: 'bridge' as any },
      { arr: gs.hills || [], type: 'hill' as any },
      { arr: gs.posts || [], type: 'post' as any },
      { arr: gs.decorations || [], type: 'decoration' as any },
    ];
    for (const { arr, type } of arrays) {
      const a = arr as any[];
      for (let i = 0; i < a.length; i++) {
        const obj: SelectableObject = { type: type, object: a[i], index: i } as any;
        // Skip currently selected
        if (this.selectedObjects.some(o => o.type === obj.type && (o as any).index === (obj as any).index)) continue;
        const b = this.getObjectBounds(obj);
        if (b.w > 0 && b.h > 0) {
          candX.push(b.x, b.x + Math.floor(b.w / 2), b.x + b.w);
          candY.push(b.y, b.y + Math.floor(b.h / 2), b.y + b.h);
        }
      }
    }

    // Proposed moved selection bounds
    const sel = this.getSelectionBounds();
    const moved = { x: sel.x + rawDx, y: sel.y + rawDy, w: sel.w, h: sel.h };
    const testXs = [moved.x, moved.x + Math.floor(moved.w / 2), moved.x + moved.w];
    const testYs = [moved.y, moved.y + Math.floor(moved.h / 2), moved.y + moved.h];

    // Find best X adjustment
    let bestXAdjust = 0; let bestXDist = Number.POSITIVE_INFINITY; let bestXGuide: number | null = null;
    for (const tx of testXs) {
      for (const cx of candX) {
        const d = Math.abs(tx - cx);
        if (d < bestXDist) { bestXDist = d; bestXAdjust = cx - tx; bestXGuide = cx; }
      }
    }
    // Find best Y adjustment
    let bestYAdjust = 0; let bestYDist = Number.POSITIVE_INFINITY; let bestYGuide: number | null = null;
    for (const ty of testYs) {
      for (const cy of candY) {
        const d = Math.abs(ty - cy);
        if (d < bestYDist) { bestYDist = d; bestYAdjust = cy - ty; bestYGuide = cy; }
      }
    }
    let dx = rawDx, dy = rawDy;
    if (bestXGuide !== null && bestXDist <= threshold) { dx = rawDx + bestXAdjust; guides.push({ kind: 'x', pos: bestXGuide }); }
    if (bestYGuide !== null && bestYDist <= threshold) { dy = rawDy + bestYAdjust; guides.push({ kind: 'y', pos: bestYGuide }); }
    // Grid quantization for displacement and guides
    try {
      const gridOn = this.showGrid && env.getShowGrid();
      if (gridOn) {
        const g = env.getGridSize();
        dx = Math.round(dx / g) * g;
        dy = Math.round(dy / g) * g;
        for (let i = 0; i < guides.length; i++) { guides[i] = { kind: guides[i].kind, pos: Math.round(guides[i].pos / g) * g }; }
      }
    } catch {}
    return { dx, dy, guides };
  }

  // Compute alignment snapping for current mouse position against nearby object edges/centers and fairway edges
  private computeAlignmentSnap(px: number, py: number, env: EditorEnv): { x: number; y: number; guides: Array<{ kind: 'x' | 'y'; pos: number }> } {
    const guides: Array<{ kind: 'x' | 'y'; pos: number }> = [];
    if (!this.showAlignmentGuides) return { x: px, y: py, guides };
    const threshold = 6;
    const gs = env.getGlobalState();
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const candX: number[] = [fairX, fairX + Math.floor(fairW / 2), fairX + fairW];
    const candY: number[] = [fairY, fairY + Math.floor(fairH / 2), fairY + fairH];
    // Include persistent ruler guides
    for (const g of this.persistentGuides) {
      if (g.kind === 'x') candX.push(g.pos); else candY.push(g.pos);
    }
    const pushB = (b: { x: number; y: number; w: number; h: number }) => {
      candX.push(b.x, b.x + Math.floor(b.w / 2), b.x + b.w);
      candY.push(b.y, b.y + Math.floor(b.h / 2), b.y + b.h);
    };
    const arrays: Array<{ arr: any[]; type: SelectableObject['type'] }> = [
      { arr: gs.walls || [], type: 'wall' as any },
      { arr: gs.polyWalls || [], type: 'wallsPoly' as any },
      { arr: gs.waters || [], type: 'water' as any },
      { arr: gs.watersPoly || [], type: 'waterPoly' as any },
      { arr: gs.sands || [], type: 'sand' as any },
      { arr: gs.sandsPoly || [], type: 'sandPoly' as any },
      { arr: gs.bridges || [], type: 'bridge' as any },
      { arr: gs.hills || [], type: 'hill' as any },
      { arr: gs.posts || [], type: 'post' as any },
      { arr: gs.decorations || [], type: 'decoration' as any },
    ];
    for (const { arr, type } of arrays) {
      const a = arr as any[];
      for (let i = 0; i < a.length; i++) {
        const obj: SelectableObject = { type: type, object: a[i], index: i } as any;
        // Skip objects currently selected to avoid self-snapping
        if (this.selectedObjects.some(o => o.type === obj.type && (o as any).index === (obj as any).index)) continue;
        const b = this.getObjectBounds(obj);
        if (b.w > 0 && b.h > 0) pushB(b);
      }
    }
    let sx = px, sy = py;
    // Snap X
    let bestDx = Number.POSITIVE_INFINITY; let bestX: number | null = null;
    for (const cx of candX) {
      const d = Math.abs(px - cx);
      if (d < bestDx) { bestDx = d; bestX = cx; }
    }
    if (bestX !== null && bestDx <= threshold) { sx = bestX; guides.push({ kind: 'x', pos: bestX }); }
    // Snap Y
    let bestDy = Number.POSITIVE_INFINITY; let bestY: number | null = null;
    for (const cy of candY) {
      const d = Math.abs(py - cy);
      if (d < bestDy) { bestDy = d; bestY = cy; }
    }
    if (bestY !== null && bestDy <= threshold) { sy = bestY; guides.push({ kind: 'y', pos: bestY }); }
    // Respect grid: when grid is on, round snapped result to grid to keep objects aligned with grid
    try {
      const gridOn = this.showGrid && env.getShowGrid();
      if (gridOn) {
        const g = env.getGridSize();
        sx = Math.round(sx / g) * g;
        sy = Math.round(sy / g) * g;
        // Also quantize guide positions so the rendered guide lines align with the grid
        for (let i = 0; i < guides.length; i++) {
          const gi = guides[i];
          const qp = Math.round(gi.pos / g) * g;
          guides[i] = { kind: gi.kind, pos: qp };
        }
      }
    } catch {}
    return { x: sx, y: sy, guides };
  }

  // Helper: find nearest snap to existing polygon vertices or edges
  private findNearestPolySnap(px: number, py: number, env: EditorEnv, exclude?: { x: number; y: number } | null): { x: number; y: number; kind: 'vertex' | 'edge'; x1?: number; y1?: number; x2?: number; y2?: number } | null {
    const gs = env.getGlobalState();
    const threshold = 10; // px
    let best: any = null;
    let bestDist = Infinity;

    const testPoly = (points: number[]) => {
      for (let i = 0; i + 1 < points.length; i += 2) {
        const vx = points[i], vy = points[i + 1];
        if (exclude && Math.abs(vx - exclude.x) < 1e-6 && Math.abs(vy - exclude.y) < 1e-6) continue;
        const dvx = vx - px, dvy = vy - py;
        const dv = Math.hypot(dvx, dvy);
        if (dv < bestDist && dv <= threshold) { bestDist = dv; best = { x: vx, y: vy, kind: 'vertex' as const }; }
      }
      // edges
      for (let i = 0; i + 3 < points.length; i += 2) {
        const x1 = points[i], y1 = points[i + 1];
        const x2 = points[i + 2], y2 = points[i + 3];
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) continue;
        let t = ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const sx = x1 + t * dx, sy = y1 + t * dy;
        const dist = Math.hypot(px - sx, py - sy);
        if (dist < bestDist && dist <= threshold) { bestDist = dist; best = { x: sx, y: sy, kind: 'edge' as const, x1, y1, x2, y2 }; }
      }
    };

    const polys: any[] = [];
    try { if (Array.isArray((gs as any).polyWalls)) polys.push(...(gs as any).polyWalls); } catch {}
    try { if (Array.isArray((gs as any).watersPoly)) polys.push(...(gs as any).watersPoly); } catch {}
    try { if (Array.isArray((gs as any).sandsPoly)) polys.push(...(gs as any).sandsPoly); } catch {}
    for (const poly of polys) {
      if (Array.isArray(poly?.points)) testPoly(poly.points);
    }
    return best;
  }

  // Helper: compute constrained and snapped point for polygon tools
  private computePolygonSnap(prev: { x: number; y: number } | null, desired: { x: number; y: number }, tool: EditorTool, modifiers: { ctrl: boolean; shift: boolean }, env: EditorEnv): { x: number; y: number; guide?: { kind: 'vertex'|'edge'; x: number; y: number; x1?: number; y1?: number; x2?: number; y2?: number } } {
    const gridOn = (() => { try { return this.showGrid && env.getShowGrid(); } catch { return false; } })();
    const gridSize = (() => { try { return env.getGridSize(); } catch { return this.gridSize; } })();
    const snapGrid = (n: number) => (gridOn ? Math.round(n / gridSize) * gridSize : n);
    let nx = snapGrid(desired.x);
    let ny = snapGrid(desired.y);
    if (prev) {
      const use45 = (
        ((tool === 'walls45' || tool === 'water45' || tool === 'sand45') && !modifiers.ctrl) ||
        ((tool === 'wallsPoly' || tool === 'waterPoly' || tool === 'sandPoly') && modifiers.shift)
      );
      if (use45) {
        const c = this.constrainTo45(prev.x, prev.y, nx, ny, gridOn, gridSize);
        nx = c.x; ny = c.y;
      }
    }
    // Snap to existing poly vertices/edges
    const snap = this.findNearestPolySnap(nx, ny, env, prev);
    if (snap) {
      nx = snap.x; ny = snap.y;
      return { x: nx, y: ny, guide: snap };
    }
    return { x: nx, y: ny };
  }

  // Helper: snap a coordinate to nearest grid line offset by radius (for posts)
  private snapCoordEdgeAligned(n: number, grid: number, radius: number): number {
    // Generate candidates at +/- radius from surrounding grid lines and pick the nearest
    const kFloor = Math.floor(n / grid);
    const kCeil = Math.ceil(n / grid);
    const candidates = [
      kFloor * grid - radius,
      kFloor * grid + radius,
      kCeil * grid - radius,
      kCeil * grid + radius
    ];
    let best = candidates[0];
    let bestD = Math.abs(n - best);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(n - candidates[i]);
      if (d < bestD) { bestD = d; best = candidates[i]; }
    }
    return best;
  }
  
  // Helper: snap post center so its edges align to grid lines if grid is enabled
  private snapPostPosition(x: number, y: number, r: number, env: EditorEnv): { x: number; y: number } {
    try {
      if (this.showGrid && env.getShowGrid()) {
        const g = env.getGridSize();
        const sx = this.snapCoordEdgeAligned(x, g, r);
        const sy = this.snapCoordEdgeAligned(y, g, r);
        const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
        // Clamp to fairway bounds for center
        return {
          x: Math.max(fx, Math.min(fx + fw, sx)),
          y: Math.max(fy, Math.min(fy + fh, sy))
        };
      }
    } catch {}
    return { x, y };
  }

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

  // Public API: allow host to reset editor state
  reset(): void {
    this.resetEditorSession();
  }

  // Resolve a friendly display name for the current user without assuming getUserName exists
  private resolveDisplayName(env: EditorEnv): string {
    try {
      const anyEnv = env as any;
      if (typeof anyEnv.getUserName === 'function') {
        const n = (anyEnv.getUserName() || '').toString().trim();
        if (n) return n;
      }
    } catch {}
    try {
      const gs = env.getGlobalState?.();
      const n = (gs?.userProfile?.name || '').toString().trim();
      if (n) return n;
    } catch {}
    // Fallback to stable userId
    return env.getUserId();
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

  // Admin-only Course Creator overlay - redesigned single-screen UI
  async openCourseCreator(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    const isAdmin = (typeof env.getUserRole === 'function') ? (env.getUserRole() === 'admin') : false;
    if (!isAdmin) {
      env.showToast('Admin only');
      return;
    }

    const labelForLevelId = async (id: string): Promise<string> => {
      const all = await firebaseLevelStore.getAllLevels(env.getUserId());
      const found = all.find(le => le.name === id);
      return found ? found.title : id;
    };

    const pickLevelFromAll = async (excludeIds: Set<string>): Promise<{ id: string; title: string } | null> => {
      const all = await firebaseLevelStore.getAllLevels(env.getUserId());
      const candidates = all.filter(le => !excludeIds.has(le.name));
      if (candidates.length === 0) {
        env.showToast('No more levels to add');
        return null;
      }
      const items = candidates.map(le => ({ label: `${le.title} — ${le.author}`, value: le }));
      const chosen = await env.showList('Add Level to Course', items, 0);
      if (!chosen) return null;
      const le: any = (chosen as any).value ?? chosen;
      return { id: le.name, title: le.title };
    };

    // Show Course Creator UI
    const courses = await firebaseCourseStore.getCourses();
    const coursesWithTitles = await Promise.all(
      courses.map(async (c) => {
        const levelTitles = await Promise.all(c.levelIds.map((id: string) => labelForLevelId(id)));
        return { id: c.id, title: c.title, levelIds: [...(c.levelIds || [])], levelTitles };
      })
    );
    
    const chosen = await env.showUiCourseCreator?.(coursesWithTitles);
    if (!chosen) return;
    
    let courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] };
    
    if (chosen.action === 'newCourse') {
      const title = await env.showPrompt('New course title:', 'New Course', 'Create Course');
      if (title === null) return;
      const id = await firebaseCourseStore.createCourse(title, [], true);
      env.showToast(`Created course "${title}"`);
      courseData = { id, title, levelIds: [], levelTitles: [] };
    } else if (chosen.action === 'editCourse' && chosen.courseData) {
      courseData = chosen.courseData;
    } else if (chosen.action === 'deleteCourse' && chosen.courseData) {
      const ok = await env.showConfirm(`Permanently delete course "${chosen.courseData.title}"?`, 'Delete Course');
      if (ok) {
        await firebaseCourseStore.deleteCourse(chosen.courseData.id);
        env.showToast('Course deleted');
      }
      return;
    } else {
      return;
    }

    // Show the new Course Editor UI
    while (true) {
      const result = await (env as any).showCourseEditor(courseData);
      if (!result) break; // User cancelled

      const { action } = result;
      
      if (action === 'save') {
        // Use the potentially updated courseData returned from the overlay
        const updated = (result as any).courseData || courseData;
        try {
          console.log('CourseEditor: Saving course', {
            id: updated.id,
            title: updated.title,
            levelIds: updated.levelIds
          });
          await firebaseCourseStore.updateCourse(updated.id, {
            title: updated.title,
            levelIds: Array.isArray(updated.levelIds) ? [...updated.levelIds] : []
          } as any);
          console.log('CourseEditor: Save complete for course', updated.id);
          env.showToast('Course saved');
        } catch (e) {
          console.error('CourseEditor: Save failed', e);
          env.showToast('Failed to save course');
        }
        break;
      }
      
      if (action === 'addLevel') {
        const exclude = new Set(courseData.levelIds);
        const pick = await pickLevelFromAll(exclude);
        if (pick) {
          courseData.levelIds.push(pick.id);
          courseData.levelTitles.push(pick.title);
          env.showToast(`Added level: ${pick.title}`);
        }
        continue;
      }
      
      if (action === 'removeLevel') {
        const levelIndex = result.levelIndex;
        if (levelIndex >= 0 && levelIndex < courseData.levelIds.length) {
          const removedTitle = courseData.levelTitles[levelIndex] || courseData.levelIds[levelIndex];
          courseData.levelIds.splice(levelIndex, 1);
          courseData.levelTitles.splice(levelIndex, 1);
          env.showToast(`Removed level: ${removedTitle}`);
        }
        continue;
      }
      
      if (action === 'deleteCourse') {
        const ok = await env.showConfirm(`Permanently delete course "${courseData.title}"?`, 'Delete Course');
        if (ok) {
          await firebaseCourseStore.deleteCourse(courseData.id);
          env.showToast('Course deleted');
          break;
        }
        continue;
      }
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

  // Fully reset the editor session so that re-entering starts fresh
  private resetEditorSession(): void {
    // Clear geometry and metadata so init() rebuilds defaults
    this.editorLevelData = null;
    this.editorCurrentSavedId = null;
    // Clear selection and UI state
    this.selectedObjects = [] as any;
    this.openEditorMenu = null;
    this.uiHotspots = [];
    this.editorMenuActiveItemIndex = -1;
    // Clear transient interaction state
    this.clearDragState();
    // Clear undo/redo
    this.undoStack = [];
    this.redoStack = [];
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
        // Per-type final snap to ensure alignment despite center-based offset
        if (clipObj.type === 'post') {
          const r = (newObj.r ?? 12) as number;
          const snapped = this.snapPostPosition(newObj.x, newObj.y, r, this.env!);
          newObj.x = snapped.x; newObj.y = snapped.y;
        } else if (
          clipObj.type === 'wall' || clipObj.type === 'water' || clipObj.type === 'sand' ||
          clipObj.type === 'bridge' || clipObj.type === 'hill' || clipObj.type === 'decoration'
        ) {
          newObj.x = snap(clampX(newObj.x));
          newObj.y = snap(clampY(newObj.y));
        }
      }
      
      // Handle polygon points
      if (clipObj.type === 'wallsPoly' || clipObj.type === 'waterPoly' || clipObj.type === 'sandPoly') {
        const points: number[] = newObj.points || [];
        for (let i = 0; i < points.length; i += 2) {
          points[i] = snap(clampX(points[i] + pasteOffsetX));
          points[i + 1] = snap(clampY(points[i + 1] + pasteOffsetY));
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

  // Convert selected rect-like objects (wall/water/sand) into beveled polygons (octagons) respecting rotation
  private async chamferBevelSelected(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    if (this.selectedObjects.length === 0) { env.showToast('No selection'); return; }

    // Filter eligible rect-like objects
    const eligible = this.selectedObjects.filter(o => (o.type === 'wall' || o.type === 'water' || o.type === 'sand')) as Array<SelectableObject & { index: number }>;
    if (eligible.length === 0) { env.showToast('Select wall/water/sand rectangles to chamfer'); return; }

    // Prompt for bevel amount in pixels
    const defPx = 10;
    let bevelPx = defPx;
    try {
      const s = await env.showPrompt('Bevel amount (pixels):', String(defPx), 'Chamfer/Bevel');
      if (s === null) return;
      const v = Math.max(1, Math.floor(Number(s)));
      if (Number.isFinite(v)) bevelPx = v;
    } catch {}

    this.pushUndoSnapshot(`Chamfer ${eligible.length} rectangle(s)`);

    const gs = env.getGlobalState();
    const createdPolys: SelectableObject[] = [];

    // Helper to rotate a point about center
    const rotP = (x: number, y: number, cx: number, cy: number, rot: number) => {
      if (!rot) return { x, y };
      const s = Math.sin(rot), c = Math.cos(rot);
      const dx = x - cx, dy = y - cy;
      return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
    };

    // Build conversions first
    type Removal = { type: 'wall'|'water'|'sand'; index: number };
    const removals: Removal[] = [];

    for (const sel of eligible) {
      const o: any = sel.object as any;
      const rx = o?.x ?? 0, ry = o?.y ?? 0, rw = o?.w ?? 0, rh = o?.h ?? 0;
      if (rw <= 0 || rh <= 0) continue;
      const rot = typeof o?.rot === 'number' ? o.rot : 0;
      const cx = rx + rw / 2, cy = ry + rh / 2;

      const maxBevel = Math.floor(Math.max(1, Math.min(rw, rh) / 2 - 1));
      const b = Math.max(1, Math.min(bevelPx, maxBevel));

      // Axis-aligned octagon points before rotation
      const ptsAx = [
        { x: rx + b,      y: ry },           // top edge inset from left
        { x: rx + rw - b, y: ry },           // top edge inset from right
        { x: rx + rw,     y: ry + b },       // right edge inset from top
        { x: rx + rw,     y: ry + rh - b },  // right edge inset from bottom
        { x: rx + rw - b, y: ry + rh },      // bottom edge inset from right
        { x: rx + b,      y: ry + rh },      // bottom edge inset from left
        { x: rx,          y: ry + rh - b },  // left edge inset from bottom
        { x: rx,          y: ry + b }        // left edge inset from top
      ];

      // Apply rotation
      const pts = ptsAx.map(p => rotP(p.x, p.y, cx, cy, rot));

      // Optional grid snapping for nicer alignment
      let gridOn = false, g = 20;
      try { gridOn = this.showGrid && env.getShowGrid(); g = env.getGridSize(); } catch {}
      const snap = (n: number) => gridOn ? Math.round(n / g) * g : Math.round(n); // at least whole-pixel snap

      const flat: number[] = [];
      for (const p of pts) { flat.push(snap(p.x), snap(p.y)); }

      if (sel.type === 'wall') {
        (gs.polyWalls as any[]).push({ points: flat });
        createdPolys.push({ type: 'wallsPoly', object: (gs.polyWalls as any[])[(gs.polyWalls as any[]).length - 1], index: (gs.polyWalls as any[]).length - 1 } as any);
        removals.push({ type: 'wall', index: sel.index });
      } else if (sel.type === 'water') {
        (gs.watersPoly as any[]).push({ points: flat });
        createdPolys.push({ type: 'waterPoly', object: (gs.watersPoly as any[])[(gs.watersPoly as any[]).length - 1], index: (gs.watersPoly as any[]).length - 1 } as any);
        removals.push({ type: 'water', index: sel.index });
      } else if (sel.type === 'sand') {
        (gs.sandsPoly as any[]).push({ points: flat });
        createdPolys.push({ type: 'sandPoly', object: (gs.sandsPoly as any[])[(gs.sandsPoly as any[]).length - 1], index: (gs.sandsPoly as any[]).length - 1 } as any);
        removals.push({ type: 'sand', index: sel.index });
      }
    }

    // Apply removals (descending indices within each type)
    const byType: Record<string, number[]> = { wall: [], water: [], sand: [] } as any;
    for (const r of removals) byType[r.type].push(r.index);
    for (const key of Object.keys(byType)) {
      const arr = byType[key];
      arr.sort((a, b) => b - a);
      for (const idx of arr) {
        if (key === 'wall') { if (idx >= 0 && idx < (gs.walls as any[]).length) (gs.walls as any[]).splice(idx, 1); }
        if (key === 'water') { if (idx >= 0 && idx < (gs.waters as any[]).length) (gs.waters as any[]).splice(idx, 1); }
        if (key === 'sand')  { if (idx >= 0 && idx < (gs.sands as any[]).length)  (gs.sands as any[]).splice(idx, 1); }
      }
    }

    // Select newly created polygons to give feedback
    this.selectedObjects = createdPolys;
    env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(env);
    env.showToast(`Chamfered ${eligible.length} rectangle(s) into polygons`);
  }

  // Align selected objects to edges or centers depending on direction
  private alignSelectedObjects(direction: 'ArrowLeft'|'ArrowRight'|'ArrowUp'|'ArrowDown'|'centerH'|'centerV', env: EditorEnv): void {
    if (this.selectedObjects.length < 2) return;

    this.pushUndoSnapshot(`Align ${this.selectedObjects.length} object(s)`);
    const bounds = this.selectedObjects.map(obj => this.getObjectBounds(obj));
    let targetValue = 0; let isHorizontal = true;
    switch (direction) {
      case 'ArrowLeft': targetValue = Math.min(...bounds.map(b => b.x)); isHorizontal = true; break;
      case 'ArrowRight': targetValue = Math.max(...bounds.map(b => b.x + b.w)); isHorizontal = true; break;
      case 'ArrowUp': targetValue = Math.min(...bounds.map(b => b.y)); isHorizontal = false; break;
      case 'ArrowDown': targetValue = Math.max(...bounds.map(b => b.y + b.h)); isHorizontal = false; break;
      case 'centerH': targetValue = (Math.min(...bounds.map(b => b.x)) + Math.max(...bounds.map(b => b.x + b.w))) / 2; isHorizontal = true; break;
      case 'centerV': targetValue = (Math.min(...bounds.map(b => b.y)) + Math.max(...bounds.map(b => b.y + b.h))) / 2; isHorizontal = false; break;
    }
    const gs = env.getGlobalState();
    for (let i = 0; i < this.selectedObjects.length; i++) {
      const obj = this.selectedObjects[i];
      const b = bounds[i];
      let dx = 0, dy = 0;
      if (isHorizontal) {
        if (direction === 'ArrowLeft') dx = targetValue - b.x;
        else if (direction === 'ArrowRight') dx = targetValue - (b.x + b.w);
        else if (direction === 'centerH') dx = targetValue - (b.x + b.w / 2);
      } else {
        if (direction === 'ArrowUp') dy = targetValue - b.y;
        else if (direction === 'ArrowDown') dy = targetValue - (b.y + b.h);
        else if (direction === 'centerV') dy = targetValue - (b.y + b.h / 2);
      }
      this.translateObject(obj, dx, dy, gs);
    }
    env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(env);
    env.showToast(`Aligned ${this.selectedObjects.length} object(s)`);
  }

  // Distribute selected objects evenly along H/V axis
  private distributeSelectedObjects(orientation: 'H' | 'V', env: EditorEnv): void {
    if (this.selectedObjects.length < 3) return;
    this.pushUndoSnapshot(`Distribute ${this.selectedObjects.length} object(s) ${orientation === 'H' ? 'horizontally' : 'vertically'}`);
    const items = this.selectedObjects.map(obj => ({ obj, b: this.getObjectBounds(obj) }));
    if (orientation === 'H') items.sort((a, b) => (a.b.x + a.b.w / 2) - (b.b.x + b.b.w / 2));
    else items.sort((a, b) => (a.b.y + a.b.h / 2) - (b.b.y + b.b.h / 2));
    const first = items[0].b; const last = items[items.length - 1].b;
    const span = orientation === 'H' ? (last.x + last.w - first.x) : (last.y + last.h - first.y);
    const totalSize = items.reduce((acc, it) => acc + (orientation === 'H' ? it.b.w : it.b.h), 0);
    const gaps = items.length - 1; const gapSize = (span - totalSize) / gaps;
    const gs = env.getGlobalState();
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]; const cur = items[i];
      if (orientation === 'H') {
        const target = prev.b.x + prev.b.w + gapSize;
        const dx = target - cur.b.x; this.translateObject(cur.obj, dx, 0, gs); cur.b.x += dx;
      } else {
        const target = prev.b.y + prev.b.h + gapSize;
        const dy = target - cur.b.y; this.translateObject(cur.obj, 0, dy, gs); cur.b.y += dy;
      }
    }
    env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(env);
  }

  // Translate helper by type
  private translateObject(obj: SelectableObject, dx: number, dy: number, gs: any): void {
    const t = obj.type as SelectableObject['type'];
    const o: any = obj.object as any;
    if (t === 'overlay') {
      this.overlayTransform.x += dx;
      this.overlayTransform.y += dy;
      return;
    }
    if (t === 'wallsPoly' || t === 'waterPoly' || t === 'sandPoly') {
      const pts: number[] = Array.isArray(o.points) ? o.points : [];
      for (let i = 0; i + 1 < pts.length; i += 2) { pts[i] += dx; pts[i + 1] += dy; }
    } else if (t === 'tee') {
      o.x += dx; o.y += dy; gs.ball.x = o.x; gs.ball.y = o.y;
    } else if (t === 'cup') {
      o.x += dx; o.y += dy; gs.hole.x = o.x; gs.hole.y = o.y;
    } else {
      if (typeof o.x === 'number') o.x += dx;
      if (typeof o.y === 'number') o.y += dy;
    }
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

    if (this.polygonInProgress.tool === 'wallsPoly' || this.polygonInProgress.tool === 'walls45') {
      gs.polyWalls.push(poly);
      if (this.editorLevelData) this.editorLevelData.wallsPoly.push(poly);
    } else if (this.polygonInProgress.tool === 'waterPoly' || this.polygonInProgress.tool === 'water45') {
      gs.watersPoly.push(poly);
      if (this.editorLevelData) this.editorLevelData.waterPoly.push(poly);
    } else if (this.polygonInProgress.tool === 'sandPoly' || this.polygonInProgress.tool === 'sand45') {
      gs.sandsPoly.push(poly);
      if (this.editorLevelData) this.editorLevelData.sandPoly.push(poly);
    }

    env.setGlobalState(gs);
    this.polygonInProgress = null;
    // Clear transient guide visuals after commit
    this.liveGuides = [];
    this.liveGuideBubbles = [];
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
        { label: 'Import (JSON)', item: { kind: 'action', action: 'import' } },
        { label: 'Import from Screenshot (Auto)…', item: { kind: 'action', action: 'importScreenshot' } },
        { label: 'Import from Screenshot (Annotate)…', item: { kind: 'action', action: 'importAnnotate' } },
        { label: 'Export', item: { kind: 'action', action: 'export' } },
        { label: 'Delete', item: { kind: 'action', action: 'delete' } },
        { label: 'Back/Exit', item: { kind: 'action', action: 'back' }, separator: true }
      ]
    },
    edit: {
      title: 'Edit',
      items: [
        { label: 'Undo (Ctrl+Z)', item: { kind: 'action', action: 'undo' } },
        { label: 'Redo (Ctrl+Y)', item: { kind: 'action', action: 'redo' }, separator: true },
        { label: 'Copy (Ctrl+C)', item: { kind: 'action', action: 'copy' } },
        { label: 'Cut (Ctrl+X)', item: { kind: 'action', action: 'cut' } },
        { label: 'Paste (Ctrl+V)', item: { kind: 'action', action: 'paste' } },
        { label: 'Duplicate (Ctrl+D)', item: { kind: 'action', action: 'duplicate' }, separator: true },
        { label: 'Align Left', item: { kind: 'action', action: 'alignLeft' } },
        { label: 'Align Right', item: { kind: 'action', action: 'alignRight' } },
        { label: 'Align Top', item: { kind: 'action', action: 'alignTop' } },
        { label: 'Align Bottom', item: { kind: 'action', action: 'alignBottom' } },
        { label: 'Align Center (H)', item: { kind: 'action', action: 'alignCenterH' } },
        { label: 'Align Center (V)', item: { kind: 'action', action: 'alignCenterV' } },
        { label: 'Distribute Horizontally', item: { kind: 'action', action: 'distributeH' } },
        { label: 'Distribute Vertically', item: { kind: 'action', action: 'distributeV' } }
      ]
    },
    view: {
      title: 'View',
      items: [
        { label: 'Grid Toggle', item: { kind: 'action', action: 'gridToggle' } },
        { label: 'Preview Fill Only On Close', item: { kind: 'action', action: 'previewFillOnClose' } },
        { label: 'Dashed Next Segment', item: { kind: 'action', action: 'previewDashedNext' } },
        { label: 'Alignment Guides', item: { kind: 'action', action: 'alignmentGuides' } },
        { label: 'Guide Details', item: { kind: 'action', action: 'guideDetailsToggle' } },
        { label: 'Rulers', item: { kind: 'action', action: 'rulersToggle' } },
        // Overlay Screenshot options
        { label: 'Overlay: Show/Hide', item: { kind: 'action', action: 'overlayToggle' } },
        { label: 'Overlay: Opacity +', item: { kind: 'action', action: 'overlayOpacityUp' } },
        { label: 'Overlay: Opacity -', item: { kind: 'action', action: 'overlayOpacityDown' } },
        { label: 'Overlay: Z-Order (Above/Below)', item: { kind: 'action', action: 'overlayZToggle' } },
        { label: 'Overlay: Lock', item: { kind: 'action', action: 'overlayLockToggle' } },
        { label: 'Overlay: Snap to Grid', item: { kind: 'action', action: 'overlaySnapToggle' } },
        { label: 'Overlay: Fit to Fairway', item: { kind: 'action', action: 'overlayFitFairway' } },
        { label: 'Overlay: Fit to Canvas', item: { kind: 'action', action: 'overlayFitCanvas' } },
        { label: 'Overlay: Reset Transform', item: { kind: 'action', action: 'overlayReset' } },
        { label: 'Overlay: Preserve Aspect', item: { kind: 'action', action: 'overlayAspectToggle' } },
        { label: 'Overlay: Flip Horizontal', item: { kind: 'action', action: 'overlayFlipH' } },
        { label: 'Overlay: Flip Vertical', item: { kind: 'action', action: 'overlayFlipV' } },
        { label: 'Overlay: Through-click (Above)', item: { kind: 'action', action: 'overlayThroughClick' } },
        { label: 'Overlay: Calibrate Scale…', item: { kind: 'action', action: 'overlayCalibrateScale' } }
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
        { label: 'Walls45', item: { kind: 'tool', tool: 'walls45' } },
        { label: 'Bridge', item: { kind: 'tool', tool: 'bridge' }, separator: true },
        { label: 'Water', item: { kind: 'tool', tool: 'water' } },
        { label: 'WaterPoly', item: { kind: 'tool', tool: 'waterPoly' } },
        { label: 'Water45', item: { kind: 'tool', tool: 'water45' } },
        { label: 'Sand', item: { kind: 'tool', tool: 'sand' } },
        { label: 'SandPoly', item: { kind: 'tool', tool: 'sandPoly' } },
        { label: 'Sand45', item: { kind: 'tool', tool: 'sand45' } },
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
        { label: 'Measure Tool', item: { kind: 'tool', tool: 'measure' } },
        { label: 'Overlay Screenshot…', item: { kind: 'action', action: 'overlayOpen' } },
        { label: 'Metadata', item: { kind: 'action', action: 'metadata' } },
        { label: 'Suggest Par', item: { kind: 'action', action: 'suggestPar' } },
        { label: 'Suggest Cup Positions', item: { kind: 'action', action: 'suggestCup' } },
        { label: 'Test Level', item: { kind: 'action', action: 'test' }, separator: true },
        { label: 'Chamfer Bevel…', item: { kind: 'action', action: 'chamfer' } },
        { label: 'Angled Corridor…', item: { kind: 'action', action: 'angledCorridor' } },
        // Admin-only tool entry (conditionally rendered at runtime)
        { label: 'Course Creator', item: { kind: 'action', action: 'courseCreator' }, separator: true }
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
    // Post-import guidance banner
    if (this.pendingTeeConfirm || this.pendingCupConfirm) {
      const msg = this.pendingTeeConfirm ? 'Click to set Tee' : 'Click to set Cup';
      const pad = 10;
      const textW = Math.ceil(ctx.measureText ? ctx.measureText(msg).width : msg.length * 8);
      const bw = Math.min(fairW - 40, textW + 24);
      const bx = fairX + Math.floor((fairW - bw) / 2);
      const by = fairY + 8;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(bx, by, bw, 28);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(msg, bx + bw / 2, by + 14);
      ctx.restore();
    }

    // Sync grid state from environment (if provided)
    try {
      this.showGrid = env.getShowGrid();
    } catch {}

    // Dynamic labels are resolved at draw-time per item; no pre-mutation of menu items needed

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

    // Overlay Screenshot — render BELOW geometry when enabled and set to below
    if (this.overlayVisible && this.overlayCanvas && !this.overlayAbove) {
      this.renderOverlay(env);
    }

    // Render pinned measurements
    if (this.pinnedMeasures.length > 0) {
      ctx.save();
      for (const m of this.pinnedMeasures) {
        const a = m.a, b = m.b;
        ctx.strokeStyle = 'rgba(255,255,102,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffff66';
        ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
      }
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

        // Direction indicators: subtle arrows pointing downhill; density/alpha scale with strength
        const dirX = (slopeDir.includes('E') ? 1 : 0) + (slopeDir.includes('W') ? -1 : 0);
        const dirY = (slopeDir.includes('S') ? 1 : 0) + (slopeDir.includes('N') ? -1 : 0);
        if (dirX !== 0 || dirY !== 0) {
          const s = Math.max(0.5, Math.min(1.5, ((h as any).strength ?? 1)));
          const step = Math.max(18, Math.min(28, 24 / s));
          ctx.save();
          const alpha = Math.max(0.18, Math.min(0.5, 0.22 + (s - 1) * 0.18));
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.lineWidth = 1.5;
          // small arrow drawing helper (inline to avoid cross-module dependency)
          const drawArrow = (cx: number, cy: number, dx: number, dy: number, size: number) => {
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const tipX = cx + ux * size;
            const tipY = cy + uy * size;
            const tailX = cx - ux * size;
            const tailY = cy - uy * size;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
            const head = Math.max(3, Math.min(6, size * 0.6));
            const px = -uy; const py = ux;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - ux * head + px * head * 0.6, tipY - uy * head + py * head * 0.6);
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - ux * head - px * head * 0.6, tipY - uy * head - py * head * 0.6);
            ctx.stroke();
          };
          for (let yy = h.y + step * 0.5; yy < h.y + h.h; yy += step) {
            for (let xx = h.x + step * 0.5; xx < h.x + h.w; xx += step) {
              drawArrow(xx, yy, dirX, dirY, 7);
            }
          }
          ctx.restore();
        }
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

    // Suggested cup markers (transient)
    if (this.suggestedCupCandidates && this.suggestedCupCandidates.length > 0) {
      ctx.save();
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let i = 0; i < this.suggestedCupCandidates.length; i++) {
        const s = this.suggestedCupCandidates[i];
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#333333'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#111111';
        ctx.fillText(String(i + 1), s.x, s.y + 10);
      }
      ctx.restore();
    }

    // Visual Path Preview overlay (debug)
    if (this.showPathPreview && this.pathPreview && this.pathPreview.found) {
      const pp = this.pathPreview;
      // Polyline of the path
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffd24a';
      ctx.beginPath();
      for (let i = 0; i < pp.worldPoints.length; i++) {
        const p = pp.worldPoints[i];
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Nodes: color code terrain
      for (let i = 0; i < pp.worldPoints.length; i++) {
        const p = pp.worldPoints[i];
        const isSand = pp.sandAt[i];
        const isHill = pp.hillAt[i];
        ctx.lineWidth = 2;
        if (isSand) { ctx.strokeStyle = '#d4b36a'; }
        else if (isHill) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; }
        else { ctx.strokeStyle = '#333333'; }
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.stroke();
      }

      // Mark turns
      for (let i = 2; i < pp.pathCells.length; i++) {
        const a = pp.pathCells[i - 2], b = pp.pathCells[i - 1], c = pp.pathCells[i];
        const v1c = b.c - a.c, v1r = b.r - a.r;
        const v2c = c.c - b.c, v2r = c.r - b.r;
        if (v1c !== v2c || v1r !== v2r) {
          const p = pp.worldPoints[i - 1];
          ctx.strokeStyle = '#ff6ea6';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x - 5, p.y - 5); ctx.lineTo(p.x + 5, p.y + 5);
          ctx.moveTo(p.x - 5, p.y + 5); ctx.lineTo(p.x + 5, p.y - 5);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Drag outline preview for rectangle tools
    if (
      this.isEditorDragging && this.editorDragTool && this.editorDragStart && this.editorDragCurrent && (
        this.editorDragTool === 'wall' || this.editorDragTool === 'bridge' || this.editorDragTool === 'water' || this.editorDragTool === 'sand' || this.editorDragTool === 'hill'
      )
    ) {
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
      
      // Direction arrows (cardinals + diagonals)
      const mid = size / 2;
      const pad = 10;
      const dirs = [
        { dir: 'N',  x: x + mid,       y: y + pad,        label: '↑' },
        { dir: 'S',  x: x + mid,       y: y + size - pad - 10, label: '↓' },
        { dir: 'W',  x: x + pad,       y: y + mid,        label: '←' },
        { dir: 'E',  x: x + size - pad - 10, y: y + mid,  label: '→' },
        { dir: 'NW', x: x + pad + 6,   y: y + pad + 6,    label: '↖' },
        { dir: 'NE', x: x + size - pad - 16, y: y + pad + 6, label: '↗' },
        { dir: 'SW', x: x + pad + 6,   y: y + size - pad - 16, label: '↙' },
        { dir: 'SE', x: x + size - pad - 16, y: y + size - pad - 16, label: '↘' }
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
      
      // Draw polygon outline (open path only; do NOT close while drafting)
      ctx.beginPath();
      ctx.lineJoin = this.polygonJoinBevel ? 'bevel' : 'miter';
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i], pts[i + 1]);
      }
      // Intentionally do not closePath() here to avoid drawing a closing dashed edge during preview.
      
      // Fill based on tool type (treat 45° variants as their base types)
      if (tool === 'waterPoly' || tool === 'water45') {
        // Respect View toggle: only fill on close
        if (!this.previewFillOnClose && pts.length >= 8) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = COLORS.waterFill;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = COLORS.waterStroke;
      } else if (tool === 'sandPoly' || tool === 'sand45') {
        if (!this.previewFillOnClose && pts.length >= 8) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = COLORS.sandFill;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = COLORS.sandStroke;
      } else if (tool === 'wallsPoly' || tool === 'walls45') {
        // Do not fill early for walls: wait until at least 4 points (unless View toggle forces no preview fill at all)
        if (!this.previewFillOnClose && pts.length >= 8) { // 4 points * 2 coords
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = COLORS.wallFill;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = COLORS.wallStroke;
      }
      
      // Render placed edges as solid lines; reserve dashed style for the next-segment preview only.
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.stroke();
      
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

      // Draw preview segment from last vertex to snapped mouse point with guide visuals
      try {
        const lastX = pts[pts.length - 2];
        const lastY = pts[pts.length - 1];
        const desired = { x: this.lastMousePosition.x, y: this.lastMousePosition.y };
        let res = this.computePolygonSnap({ x: lastX, y: lastY }, desired, tool,
          { ctrl: this.lastModifiers.ctrl, shift: this.lastModifiers.shift }, env);
        // Also align to global guides if enabled and not overridden by modifiers
        const allowGuides = this.showAlignmentGuides && !this.lastModifiers.ctrl && !this.lastModifiers.alt;
        if (allowGuides) {
          const ag = this.computeAlignmentSnap(res.x, res.y, env);
          if (ag.guides && ag.guides.length) {
            this.liveGuides = ag.guides;
            // Bubble for snapped axis value
            this.liveGuideBubbles = [];
            const g0 = ag.guides[0];
            const axisLabel = g0.kind === 'x' ? `x=${Math.round(ag.x)}` : `y=${Math.round(ag.y)}`;
            this.liveGuideBubbles.push({ x: desired.x + 10, y: desired.y + 10, text: axisLabel });
          } else {
            this.liveGuides = [];
          }
          res = { ...res, x: ag.x, y: ag.y } as any;
        } else {
          this.liveGuides = [];
        }
        // Next-segment preview: dashed or solid based on View toggle
        if (this.previewDashedNextSegment) ctx.setLineDash([4, 3]); else ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffff66';
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(res.x, res.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Subtle drafting hint near cursor
        try {
          const hint = 'Enter: Close  •  Esc: Cancel';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const pad = 4;
          const tw = Math.ceil(ctx.measureText(hint).width);
          const th = 14;
          const hx = Math.min(Math.max(res.x + 10, fairX + 2), fairX + fairW - tw - pad * 2 - 2);
          const hy = Math.min(Math.max(res.y + 10, fairY + 2), fairY + fairH - th - pad * 2 - 2);
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(hx, hy, tw + pad * 2, th + pad * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(hx, hy, tw + pad * 2, th + pad * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillText(hint, hx + pad, hy + pad);
        } catch {}
        // Numeric readout for preview (length and angle)
        try {
          const dx = res.x - lastX;
          const dy = res.y - lastY;
          const len = Math.hypot(dx, dy);
          const ang = Math.atan2(dy, dx) * 180 / Math.PI;
          const readout = `L=${len.toFixed(1)} px  θ=${ang.toFixed(1)}°`;
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const pad2 = 4;
          const tw2 = Math.ceil(ctx.measureText(readout).width);
          const th2 = 14;
          const midx = (lastX + res.x) / 2;
          const midy = (lastY + res.y) / 2;
          const bx = Math.min(Math.max(midx + 8, fairX + 2), fairX + fairW - tw2 - pad2 * 2 - 2);
          const by = Math.min(Math.max(midy + 8, fairY + 2), fairY + fairH - th2 - pad2 * 2 - 2);
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(bx, by, tw2 + pad2 * 2, th2 + pad2 * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, tw2 + pad2 * 2, th2 + pad2 * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillText(readout, bx + pad2, by + pad2);
        } catch {}
        // Guide indicator
        if (res.guide) {
          if (res.guide.kind === 'vertex') {
            ctx.fillStyle = '#ffff66';
            ctx.beginPath();
            ctx.arc(res.x, res.y, 5, 0, Math.PI * 2);
            ctx.fill();
          } else if (res.guide.kind === 'edge' && res.guide.x1 !== undefined) {
            ctx.strokeStyle = 'rgba(255,255,102,0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(res.guide.x1!, res.guide.y1!);
            ctx.lineTo(res.guide.x2!, res.guide.y2!);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      } catch {}
      
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

    // Persistent ruler guides
    if (this.persistentGuides && this.persistentGuides.length > 0) {
      const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
      ctx.save();
      ctx.strokeStyle = 'rgba(0,224,255,0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      for (const g of this.persistentGuides) {
        ctx.beginPath();
        if (g.kind === 'x') {
          const gx = Math.max(fx, Math.min(fx + fw, g.pos));
          ctx.moveTo(gx, fy);
          ctx.lineTo(gx, fy + fh);
        } else {
          const gy = Math.max(fy, Math.min(fy + fh, g.pos));
          ctx.moveTo(fx, gy);
          ctx.lineTo(fx + fw, gy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Alignment Guides (live)
    if (this.showAlignmentGuides && this.liveGuides && this.liveGuides.length > 0) {
      const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
      ctx.save();
      ctx.strokeStyle = '#00e0ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      for (const g of this.liveGuides) {
        ctx.beginPath();
        if (g.kind === 'x') {
          const gx = Math.max(fx, Math.min(fx + fw, g.pos));
          ctx.moveTo(gx, fy);
          ctx.lineTo(gx, fy + fh);
        } else {
          const gy = Math.max(fy, Math.min(fy + fh, g.pos));
          ctx.moveTo(fx, gy);
          ctx.lineTo(fx + fw, gy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Guide bubbles (labels) — stacked at top-left inside fairway when enabled
    if (this.showGuideDetails && this.liveGuideBubbles && this.liveGuideBubbles.length > 0) {
      const { x: fx, y: fy } = env.fairwayRect();
      ctx.save();
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const pad = 4; const th = 16; const gap = 4;
      let row = 0;
      for (const b of this.liveGuideBubbles) {
        const tw = Math.ceil(ctx.measureText(b.text).width);
        const bx = fx + 6; // margin inside fairway
        const by = fy + 6 + row * (th + pad * 2 + gap);
        ctx.fillStyle = 'rgba(0,0,0,0.70)';
        ctx.fillRect(bx, by, tw + pad * 2, th + pad * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, tw + pad * 2, th + pad * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(b.text, bx + pad, by + pad);
        row++;
      }
      ctx.restore();
    }

    // Measure Tool overlay
    if (this.selectedTool === 'measure' && this.measureStart && this.measureEnd) {
      const a = this.measureStart, b = this.measureEnd;
      ctx.save();
      ctx.strokeStyle = '#ffff66';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fill();
      // Label with length/angle/delta
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const label = `L=${len.toFixed(1)} px  θ=${ang.toFixed(1)}°  Δ=(${dx.toFixed(1)}, ${dy.toFixed(1)})`;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const midx = (a.x + b.x) / 2;
      const midy = (a.y + b.y) / 2;
      const pad = 4;
      const tw = Math.ceil(ctx.measureText(label).width);
      const th = 16;
      const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
      const bx = Math.min(Math.max(midx + 8, fx + 2), fx + fw - tw - pad * 2 - 2);
      const by = Math.min(Math.max(midy + 8, fy + 2), fy + fh - th - pad * 2 - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.70)';
      ctx.fillRect(bx, by, tw + pad * 2, th + pad * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, tw + pad * 2, th + pad * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(label, bx + pad, by + pad);
      ctx.restore();
    }

    // Rulers (top/left) — drawn within fairway bounds
    if (this.showRulers) {
      const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
      const topH = 18, leftW = 18;
      ctx.save();
      // Top ruler
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(fx, fy, fw, topH);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(fx, fy, fw, topH);
      // Left ruler
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(fx, fy, leftW, fh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(fx, fy, leftW, fh);
      // Ticks
      ctx.strokeStyle = '#cfd2cf';
      ctx.fillStyle = '#cfd2cf';
      ctx.font = '10px system-ui, sans-serif';
      // Ticks respect grid settings
      let minor = 20, mid = 50, major = 100;
      try {
        const gridOn = this.showGrid && env.getShowGrid();
        if (gridOn) {
          const g = env.getGridSize();
          minor = Math.max(5, g);
          mid = g * 5;
          major = g * 10;
        }
      } catch {}
      // X axis ticks
      for (let x = 0; x <= fw; x += minor) {
        const X = fx + x;
        const isMajor = (x % major) === 0;
        const isMid = !isMajor && (x % mid) === 0;
        const th = isMajor ? 10 : isMid ? 7 : 4;
        ctx.beginPath(); ctx.moveTo(X, fy + topH); ctx.lineTo(X, fy + topH - th); ctx.stroke();
        if (isMajor) { ctx.fillText(String(x), X + 2, fy + 2); }
      }
      // Y axis ticks
      for (let y = 0; y <= fh; y += minor) {
        const Y = fy + y;
        const isMajor = (y % major) === 0;
        const isMid = !isMajor && (y % mid) === 0;
        const tw = isMajor ? 10 : isMid ? 7 : 4;
        ctx.beginPath(); ctx.moveTo(fx + leftW, Y); ctx.lineTo(fx + leftW - tw, Y); ctx.stroke();
        if (isMajor) { ctx.fillText(String(y), fx + 2, Y + 2); }
      }
      // Cursor crosshair on rulers (snap to grid if enabled)
      let cxr = this.lastMousePosition?.x ?? (fx + fw / 2);
      let cyr = this.lastMousePosition?.y ?? (fy + fh / 2);
      try {
        const gridOn = this.showGrid && env.getShowGrid();
        if (gridOn) {
          const g = env.getGridSize();
          cxr = Math.round(cxr / g) * g;
          cyr = Math.round(cyr / g) * g;
        }
      } catch {}
      if (cxr >= fx && cxr <= fx + fw) { ctx.strokeStyle = 'rgba(255,255,102,0.8)'; ctx.beginPath(); ctx.moveTo(cxr, fy); ctx.lineTo(cxr, fy + topH); ctx.stroke(); }
      if (cyr >= fy && cyr <= fy + fh) { ctx.strokeStyle = 'rgba(255,255,102,0.8)'; ctx.beginPath(); ctx.moveTo(fx, cyr); ctx.lineTo(fx + leftW, cyr); ctx.stroke(); }
      ctx.restore();
    }

    // Menubar (drawn last)
    // When overlay is ABOVE geometry, render it just before menubar and selection overlays
    if (this.overlayVisible && this.overlayCanvas && this.overlayAbove) {
      this.renderOverlay(env);
    }
    // Draw overlay transform handles when the overlay is selected with the Select Tool (single selection), and no menu is open
    if (
      this.overlayVisible && this.overlayCanvas && !this.overlayLocked &&
      this.openEditorMenu === null &&
      this.selectedTool === 'select' && this.selectedObjects.length === 1 && this.selectedObjects[0].type === 'overlay'
    ) {
      this.renderOverlayHandles(env);
    }
    const menubarX = 0, menubarY = 0, menubarW = WIDTH, menubarH = 28;
    // Darker bar to match UI_Design panel aesthetic
    ctx.fillStyle = 'rgba(0,0,0,0.70)';
    ctx.fillRect(menubarX, menubarY, menubarW, menubarH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1;
    ctx.strokeRect(menubarX, menubarY, menubarW, menubarH - 1);

    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const menuIds: EditorMenuId[] = ['file', 'edit', 'view', 'objects', 'decorations', 'tools'];
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
      // Filter items for admin gating
      const isAdmin = (typeof env.getUserRole === 'function') ? (env.getUserRole() === 'admin') : false;
      const visibleItems = menu.items.filter(mi => {
        if (this.openEditorMenu === 'tools' && mi.item.kind === 'action' && (mi.item as any).action === 'courseCreator') {
          return isAdmin;
        }
        return true;
      });

      let maxWidth = 0;
      for (const item of visibleItems) {
        const w = ctx.measureText(item.label).width; if (w > maxWidth) maxWidth = w;
      }
      const dropdownW = Math.max(120, maxWidth + 24);
      const itemH = 22;
      const dropdownH = visibleItems.length * itemH + 4;
      const dropdownX = headerX;
      const dropdownY = menubarH;

      // Panel-like dropdown per updated UI: dark background with light border
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(dropdownX, dropdownY, dropdownW, dropdownH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1;
      ctx.strokeRect(dropdownX, dropdownY, dropdownW, dropdownH);

      let itemY = dropdownY + 2;
      for (let i = 0; i < visibleItems.length; i++) {
        const menuItem = visibleItems[i];
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
            case 'duplicate':
              displayLabel = this.selectedObjects.length > 0 ? 'Duplicate (Ctrl+D)' : 'Duplicate';
              isDisabled = this.selectedObjects.length === 0;
              break;
            case 'alignLeft':
            case 'alignRight':
            case 'alignTop':
            case 'alignBottom':
            case 'alignCenterH':
            case 'alignCenterV':
            case 'distributeH':
            case 'distributeV':
              isDisabled = this.selectedObjects.length < 2;
              break;
            case 'gridToggle':
              displayLabel = this.showGrid ? 'Grid On' : 'Grid Off';
              break;
            case 'previewFillOnClose':
              displayLabel = `Preview Fill Only On Close: ${this.previewFillOnClose ? 'On' : 'Off'}`;
              break;
            case 'previewDashedNext':
              displayLabel = `Dashed Next Segment: ${this.previewDashedNextSegment ? 'On' : 'Off'}`;
              break;
            case 'alignmentGuides':
              displayLabel = `Alignment Guides: ${this.showAlignmentGuides ? 'On' : 'Off'}`;
              break;
            case 'guideDetailsToggle':
              displayLabel = `Guide Details: ${this.showGuideDetails ? 'On' : 'Off'}`;
              break;
            case 'rulersToggle':
              displayLabel = `Rulers: ${this.showRulers ? 'On' : 'Off'}`;
              break;
            // Overlay dynamic labels
            case 'overlayToggle':
              displayLabel = `Overlay: ${this.overlayVisible ? 'On' : 'Off'}`;
              break;
            case 'overlayOpacityUp':
              displayLabel = `Overlay: Opacity + (${Math.round(this.overlayOpacity * 100)}%)`;
              isDisabled = !this.overlayVisible || this.overlayOpacity >= 1;
              break;
            case 'overlayOpacityDown':
              displayLabel = `Overlay: Opacity - (${Math.round(this.overlayOpacity * 100)}%)`;
              isDisabled = !this.overlayVisible || this.overlayOpacity <= 0;
              break;
            case 'overlayZToggle':
              displayLabel = `Overlay: ${this.overlayAbove ? 'Above Geometry' : 'Below Geometry'}`;
              isDisabled = !this.overlayVisible;
              break;
            case 'overlayLockToggle':
              displayLabel = `Overlay: ${this.overlayLocked ? 'Locked' : 'Unlocked'}`;
              isDisabled = !this.overlayVisible;
              break;
            case 'overlaySnapToggle':
              displayLabel = `Overlay: Snap to Grid ${this.overlaySnapToGrid ? 'On' : 'Off'}`;
              isDisabled = !this.overlayVisible;
              break;
            case 'overlayFitFairway':
              displayLabel = 'Overlay: Fit to Fairway';
              isDisabled = !this.overlayVisible || !this.overlayCanvas;
              break;
            case 'overlayFitCanvas':
              displayLabel = 'Overlay: Fit to Canvas';
              isDisabled = !this.overlayVisible || !this.overlayCanvas;
              break;
            case 'overlayReset':
              displayLabel = 'Overlay: Reset Transform';
              isDisabled = !this.overlayVisible || !this.overlayCanvas;
              break;
            case 'overlayFlipH':
              displayLabel = 'Overlay: Flip Horizontal';
              isDisabled = !this.overlayVisible || !this.overlayCanvas || this.overlayLocked;
              break;
            case 'overlayFlipV':
              displayLabel = 'Overlay: Flip Vertical';
              isDisabled = !this.overlayVisible || !this.overlayCanvas || this.overlayLocked;
              break;
            case 'overlayThroughClick':
              displayLabel = `Overlay: Through-click (Above) ${this.overlayThroughClick ? 'On' : 'Off'}`;
              isDisabled = !this.overlayVisible || !this.overlayCanvas || !this.overlayAbove;
              break;
            case 'overlayAspectToggle':
              displayLabel = `Overlay: Preserve Aspect ${this.overlayTransform.preserveAspect ? 'On' : 'Off'}`;
              isDisabled = !this.overlayVisible || !this.overlayCanvas || this.overlayLocked;
              break;
            case 'overlayCalibrateScale':
              displayLabel = 'Overlay: Calibrate Scale…';
              isDisabled = !this.overlayVisible || !this.overlayCanvas || this.overlayLocked;
              break;
            case 'suggestCup':
              // keep default label
              break;
            default:
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

    // Detect if click hits any UI menu/menuItem hotspot from last render
    const clickHitsMenu = this.uiHotspots.some(hs => (
      (hs.kind === 'menu' || hs.kind === 'menuItem') &&
      p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h
    ));
    // Swallow clicks when overlay is above and through-click is off (but allow overlay interactions and always allow menus)
    const overlayClickInsideAbove = (
      this.overlayVisible && this.overlayCanvas && this.overlayAbove && !this.overlayThroughClick &&
      this.isPointInOverlay(p.x, p.y) && !clickHitsMenu
    );

    // Overlay Calibrate Scale flow (click two points on the overlay image)
    if (this.overlayVisible && this.overlayCanvas && this.overlayCalibrate) {
      if (!this.isPointInOverlay(p.x, p.y)) {
        try { env.showToast('Calibrate: click inside the overlay image'); } catch {}
        return;
      }
      const local = this.worldToOverlayLocal(p.x, p.y);
      if (this.overlayCalibrate.phase === 'pickA') {
        // Record anchor local and world to preserve during scaling
        const t = this.overlayTransform;
        const c = Math.cos(t.rotation || 0), s = Math.sin(t.rotation || 0);
        const sx = (t.flipH ? -1 : 1) * (t.scaleX || 1);
        const sy = (t.flipV ? -1 : 1) * (t.scaleY || 1);
        const ax = local.x, ay = local.y;
        const wx = t.x + (ax * sx * c - ay * sy * s);
        const wy = t.y + (ax * sx * s + ay * sy * c);
        this.overlayCalibrate = { phase: 'pickB', aLocal: { x: local.x, y: local.y }, aWorld: { x: wx, y: wy } };
        try { env.showToast('Calibrate: click the second point on the overlay'); } catch {}
        return;
      } else if (this.overlayCalibrate.phase === 'pickB' && this.overlayCalibrate.aLocal && this.overlayCalibrate.aWorld) {
        const a = this.overlayCalibrate.aLocal;
        const distLocal = Math.hypot(local.x - a.x, local.y - a.y);
        if (distLocal < 1e-3) { try { env.showToast('Calibrate: points too close; try again'); } catch {} ; this.overlayCalibrate = { phase: 'pickA' }; return; }
        (async () => {
          const defaultPx = Math.round(Math.hypot(p.x - this.overlayCalibrate!.aWorld!.x, p.y - this.overlayCalibrate!.aWorld!.y)).toString();
          const val = await env.showPrompt('Enter real distance between points (pixels):', defaultPx, 'Calibrate Scale');
          if (val !== null) {
            const realPx = parseFloat(val);
            if (!isNaN(realPx) && isFinite(realPx) && realPx > 0) {
              const t = this.overlayTransform;
              const scaleMul = realPx / distLocal;
              const newSx = Math.max(0.001, t.scaleX * scaleMul);
              const newSy = Math.max(0.001, t.scaleY * scaleMul);
              // Re-anchor at point A
              const c = Math.cos(t.rotation || 0), s = Math.sin(t.rotation || 0);
              const ax = a.x, ay = a.y;
              const wx = this.overlayCalibrate!.aWorld!.x, wy = this.overlayCalibrate!.aWorld!.y;
              const signX = (t.flipH ? -1 : 1);
              const signY = (t.flipV ? -1 : 1);
              const tx = wx - (ax * signX * newSx * c - ay * signY * newSy * s);
              const ty = wy - (ax * signX * newSx * s + ay * signY * newSy * c);
              this.overlayTransform.scaleX = newSx;
              this.overlayTransform.scaleY = newSy;
              this.overlayTransform.x = tx;
              this.overlayTransform.y = ty;
              try { env.showToast('Overlay scale calibrated'); } catch {}
            } else {
              try { env.showToast('Invalid distance'); } catch {}
            }
          }
          this.overlayCalibrate = null;
        })();
        return;
      }
    }

    const overlaySelectedSingle = (
      this.overlayVisible && this.overlayCanvas && !this.overlayLocked &&
      this.selectedTool === 'select' && this.selectedObjects.length === 1 && this.selectedObjects[0].type === 'overlay'
    );

    // If the overlay is selected (single) with the Select Tool, enable its native interactions
    if (overlaySelectedSingle && !clickHitsMenu) {
      // Drag-move inside overlay
      if (this.isPointInOverlay(p.x, p.y)) {
        this.overlayIsDragging = true;
        this.overlayDragStartMouse = { x: p.x, y: p.y };
        this.overlayStartPos = { x: this.overlayTransform.x, y: this.overlayTransform.y };
        return;
      }

      // Resize via overlay-specific handles
      const handles = this.getOverlayHandlePositions();
      if (handles) {
        const iw = this.overlayNatural.width || this.overlayCanvas!.width;
        const ih = this.overlayNatural.height || this.overlayCanvas!.height;
        const threshold = 10;
        type Hit = { kind: 'corner0'|'corner1'|'corner2'|'corner3'|'edgeTop'|'edgeRight'|'edgeBottom'|'edgeLeft'; pt:{x:number;y:number} };
        const hits: Hit[] = [
          { kind: 'corner0', pt: handles.corners[0] },
          { kind: 'corner1', pt: handles.corners[1] },
          { kind: 'corner2', pt: handles.corners[2] },
          { kind: 'corner3', pt: handles.corners[3] },
          { kind: 'edgeTop', pt: handles.edges.top },
          { kind: 'edgeRight', pt: handles.edges.right },
          { kind: 'edgeBottom', pt: handles.edges.bottom },
          { kind: 'edgeLeft', pt: handles.edges.left }
        ];
        let chosen: Hit | null = null;
        for (const h of hits) { if (Math.hypot(p.x - h.pt.x, p.y - h.pt.y) <= threshold) { chosen = h; break; } }
        if (chosen) {
          const t = this.overlayTransform;
          this.overlayIsResizing = true;
          this.overlayActiveHandle = chosen.kind;
          // Set anchor local and axis based on handle
          if (chosen.kind === 'corner0') { this.overlayResizeAnchorLocal = { x: iw, y: ih }; this.overlayResizeAxis = 'both'; }
          else if (chosen.kind === 'corner1') { this.overlayResizeAnchorLocal = { x: 0, y: ih }; this.overlayResizeAxis = 'both'; }
          else if (chosen.kind === 'corner2') { this.overlayResizeAnchorLocal = { x: 0, y: 0 }; this.overlayResizeAxis = 'both'; }
          else if (chosen.kind === 'corner3') { this.overlayResizeAnchorLocal = { x: iw, y: 0 }; this.overlayResizeAxis = 'both'; }
          else if (chosen.kind === 'edgeTop') { this.overlayResizeAnchorLocal = { x: 0, y: ih }; this.overlayResizeAxis = 'y'; }
          else if (chosen.kind === 'edgeRight') { this.overlayResizeAnchorLocal = { x: 0, y: 0 }; this.overlayResizeAxis = 'x'; }
          else if (chosen.kind === 'edgeBottom') { this.overlayResizeAnchorLocal = { x: 0, y: 0 }; this.overlayResizeAxis = 'y'; }
          else if (chosen.kind === 'edgeLeft') { this.overlayResizeAnchorLocal = { x: iw, y: 0 }; this.overlayResizeAxis = 'x'; }
          // Record anchor world position to keep fixed during resize
          const c = Math.cos(t.rotation || 0), s = Math.sin(t.rotation || 0);
          const sx = (t.flipH ? -1 : 1) * (t.scaleX || 1);
          const sy = (t.flipV ? -1 : 1) * (t.scaleY || 1);
          const anchorLocal = this.overlayResizeAnchorLocal!;
          const ax = anchorLocal.x, ay = anchorLocal.y;
          const wx = t.x + (ax * sx * c - ay * sy * s);
          const wy = t.y + (ax * sx * s + ay * sy * c);
          this.overlayResizeAnchorWorld = { x: wx, y: wy };
          this.overlayResizeStartScale = { sx: t.scaleX, sy: t.scaleY };
          return;
        }
      }

      // Rotation via top-mid handle
      const t = this.overlayTransform;
      const iw = this.overlayNatural.width || this.overlayCanvas!.width;
      const c = Math.cos(t.rotation || 0), s = Math.sin(t.rotation || 0);
      const sx = (t.flipH ? -1 : 1) * (t.scaleX || 1);
      const sy = (t.flipV ? -1 : 1) * (t.scaleY || 1);
      const p0x = t.x, p0y = t.y;
      const p1x = t.x + (iw * sx * c - 0 * sy * s);
      const p1y = t.y + (iw * sx * s + 0 * sy * c);
      const mx = (p0x + p1x) / 2, my = (p0y + p1y) / 2;
      const nx = p0y - p1y, ny = p1x - p0x; const nlen = Math.hypot(nx, ny) || 1; const ux = nx / nlen, uy = ny / nlen;
      const prx = mx + ux * 20, pry = my + uy * 20;
      if (Math.hypot(p.x - prx, p.y - pry) <= 10) {
        this.overlayIsRotating = true;
        const local = this.worldToOverlayLocal(p.x, p.y);
        this.overlayRotateStartAngleLocal = Math.atan2(local.y, local.x);
        this.overlayRotateInitialRotation = this.overlayTransform.rotation || 0;
        return;
      }
    }

    // Note: do not early-return here. We allow selection logic below to run so clicking the overlay selects it even when it's Above.

    // Pending confirmations from screenshot import: click-to-confirm Tee/Cup
    if (this.pendingTeeConfirm || this.pendingCupConfirm) {
      const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
      let px = clamp(p.x, fx, fx + fw);
      let py = clamp(p.y, fy, fy + fh);
      try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); px = Math.round(px / g) * g; py = Math.round(py / g) * g; } } catch {}
      const gs = env.getGlobalState();
      if (this.pendingTeeConfirm) {
        gs.ball.x = px; gs.ball.y = py;
        if (!this.editorLevelData) this.editorLevelData = {} as any;
        if (!this.editorLevelData.tee) this.editorLevelData.tee = { x: px, y: py, r: 8 };
        this.editorLevelData.tee.x = px; this.editorLevelData.tee.y = py;
        this.pendingTeeConfirm = false;
        env.setGlobalState(gs);
        try { env.showToast('Tee set'); } catch {}
        if (this.pendingCupConfirm) { try { env.showToast('Now click to set Cup'); } catch {} }
        return;
      }
      if (this.pendingCupConfirm) {
        gs.hole.x = px; gs.hole.y = py;
        if (!this.editorLevelData) this.editorLevelData = {} as any;
        if (!this.editorLevelData.cup) this.editorLevelData.cup = { x: px, y: py, r: 12 };
        this.editorLevelData.cup.x = px; this.editorLevelData.cup.y = py;
        this.pendingCupConfirm = false;
        env.setGlobalState(gs);
        try { env.showToast('Cup set'); } catch {}
        return;
      }
    }

    // Ruler-drag guides: start drag when clicking on ruler bands, support double-click to clear
    if (this.showRulers) {
      const { x: fx, y: fy, w: fw, h: fh } = env.fairwayRect();
      const topH = 18, leftW = 18;
      const inTop = (p.x >= fx && p.x <= fx + fw && p.y >= fy && p.y <= fy + topH);
      const inLeft = (p.x >= fx && p.x <= fx + leftW && p.y >= fy && p.y <= fy + fh);
      const now = Date.now();
      if (inTop || inLeft) {
        const band: 'x' | 'y' = inTop ? 'x' : 'y';
        // Double-click on same band clears persistent guides for that axis
        if (this.lastRulerBand === band && (now - this.lastRulerClickMs) < 300) {
          this.persistentGuides = this.persistentGuides.filter(g => g.kind !== band);
          try { env.showToast(`Cleared ${band.toUpperCase()} ruler guides`); } catch {}
          this.lastRulerClickMs = 0; this.lastRulerBand = null;
          return;
        }
        this.lastRulerClickMs = now; this.lastRulerBand = band;
        this.isRulerDragging = true;
        this.rulerDragKind = band;
        const clampX = (x: number) => Math.max(fx, Math.min(fx + fw, x));
        const clampY = (y: number) => Math.max(fy, Math.min(fy + fh, y));
        let pos0 = band === 'x' ? clampX(p.x) : clampY(p.y);
        // Snap guide to grid if enabled
        try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); pos0 = Math.round(pos0 / g) * g; } } catch {}
        this.rulerDragPos = pos0;
        // Initialize preview
        this.liveGuides = [{ kind: band, pos: this.rulerDragPos! }];
        this.liveGuideBubbles = [{ x: p.x + 10, y: p.y + 10, text: `${band}=${Math.round(this.rulerDragPos!)}` }];
        return;
      }
    }

    // Measure Tool begin
    if (this.selectedTool === 'measure') {
      // Right-click: clear any in-progress and pinned measurements and do not start a new one
      if (e.button === 2) {
        e.preventDefault();
        this.measureStart = null; this.measureEnd = null;
        this.pinnedMeasures = [];
        try { env.showToast('Cleared measurements'); } catch {}
        return;
      }
      const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
      const snap = (n: number) => { try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); return Math.round(n / g) * g; } } catch {} return n; };
      const px = snap(clamp(p.x, fairX, fairX + fairW));
      const py = snap(clamp(p.y, fairY, fairY + fairH));

    // Finish overlay drag
    if (this.overlayIsDragging) {
      this.overlayIsDragging = false;
      this.overlayDragStartMouse = null;
      this.overlayStartPos = null;
      return;
    }
    if (this.overlayIsResizing) {
      this.overlayIsResizing = false;
      this.overlayResizeAnchorLocal = null;
      this.overlayResizeAnchorWorld = null;
      this.overlayResizeStartScale = null;
      this.overlayActiveHandle = null;
      this.overlayResizeAxis = 'both';
      return;
    }
    if (this.overlayIsRotating) {
      this.overlayIsRotating = false;
      return;
    }
      // Detect double-click to clear pinned measures
      const now = Date.now();
      if (this.lastClickPos && (now - this.lastClickMs) < 300) {
        const dx = px - this.lastClickPos.x, dy = py - this.lastClickPos.y;
        if ((dx * dx + dy * dy) <= 36) {
          this.pinnedMeasures = [];
          this.measureStart = null; this.measureEnd = null;
          try { env.showToast('Cleared pinned measurements'); } catch {}
        }
      }
      this.lastClickMs = now; this.lastClickPos = { x: px, y: py };
      this.measureStart = { x: px, y: py };
      this.measureEnd = { x: px, y: py };
      return;
    }

    // If cup suggestions are visible, allow clicking a marker to apply
    if (this.suggestedCupCandidates && this.suggestedCupCandidates.length > 0) {
      const radius = 12;
      for (let i = 0; i < this.suggestedCupCandidates.length; i++) {
        const s = this.suggestedCupCandidates[i];
        const dx = p.x - s.x, dy = p.y - s.y;
        if (dx * dx + dy * dy <= radius * radius) {
          this.pushUndoSnapshot('Set cup from suggestion');
          const gs = env.getGlobalState();
          const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
          const clampX = (x: number) => Math.max(fairX, Math.min(fairX + fairW, x));
          const clampY = (y: number) => Math.max(fairY, Math.min(fairY + fairH, y));
          const nx = clampX(s.x), ny = clampY(s.y);
          gs.hole.x = nx; gs.hole.y = ny;
          if (this.editorLevelData) { this.editorLevelData.cup.x = nx; this.editorLevelData.cup.y = ny; }
          env.setGlobalState(gs);
          this.suggestedCupCandidates = null;
          env.showToast(`Cup set to suggestion #${i + 1}`);
          // Lint and offer Par Suggest immediately after setting the cup
          try {
            let cellSize = 20;
            try { const g = env.getGridSize(); if (typeof g === 'number' && g > 0) cellSize = Math.max(10, Math.min(40, g)); } catch {}
            const fair = env.fairwayRect();
            const warnings = lintCupPath(this.editorLevelData, fair, cellSize);
            if (warnings && warnings.length) {
              env.showToast(warnings[0]);
              if (warnings[1]) env.showToast(warnings[1]);
            }
            // Pull gameplay + heuristic tuning from global state for consistency with Suggest Par
            const gsAll = env.getGlobalState?.() || {};
            const frictionK = typeof gsAll.frictionK === 'number' ? gsAll.frictionK
              : (typeof gsAll.physicsFrictionK === 'number' ? gsAll.physicsFrictionK : 1.2);
            const sandMult = typeof gsAll.sandMultiplier === 'number' ? gsAll.sandMultiplier
              : (typeof gsAll.physicsSandMultiplier === 'number' ? gsAll.physicsSandMultiplier : 6.0);
            const baselineShotPx = typeof gsAll.baselineShotPx === 'number' ? gsAll.baselineShotPx : 320;
            const turnPenaltyPerTurn = typeof gsAll.turnPenaltyPerTurn === 'number' ? gsAll.turnPenaltyPerTurn : 0.08;
            const hillBump = typeof gsAll.hillBump === 'number' ? gsAll.hillBump : 0.2;
            const parInfo = estimatePar(this.editorLevelData, fair, cellSize, {
              baselineShotPx,
              sandPenaltyPerCell: 0.01,
              turnPenaltyPerTurn,
              turnPenaltyMax: 1.5,
              hillBump,
              bankWeight: 0.12,
              bankPenaltyMax: 1.0,
              frictionK,
              referenceFrictionK: 1.2,
              sandFrictionMultiplier: sandMult
            });
            void env.showConfirm(`Suggested par is ${parInfo.suggestedPar}. Apply now?`, 'Suggest Par')
              .then((apply) => {
                if (apply) {
                  this.pushUndoSnapshot('Set par');
                  this.editorLevelData.par = parInfo.suggestedPar;
                  env.showToast(`Par set to ${parInfo.suggestedPar}`);
                }
              });
          } catch {}
          return;
        }
      }
    }

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
          // Update the post's radius and re-snap its center to grid edges for alignment
          const gs = env.getGlobalState();
          if (picker.postIndex >= 0 && picker.postIndex < gs.posts.length) {
            const post: any = gs.posts[picker.postIndex];
            post.r = radii[i];
            const snapped = this.snapPostPosition(post.x, post.y, post.r, env);
            post.x = snapped.x; post.y = snapped.y;
            if (this.editorLevelData && picker.postIndex < this.editorLevelData.posts.length) {
              this.editorLevelData.posts[picker.postIndex].r = radii[i];
              this.editorLevelData.posts[picker.postIndex].x = post.x;
              this.editorLevelData.posts[picker.postIndex].y = post.y;
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
      
      // Check if clicking on direction arrows (cardinals + diagonals)
      const mid = size / 2;
      const pad = 10;
      const dirs = [
        { dir: 'N',  x: x + mid,       y: y + pad,        label: '↑' },
        { dir: 'S',  x: x + mid,       y: y + size - pad - 10, label: '↓' },
        { dir: 'W',  x: x + pad,       y: y + mid,        label: '←' },
        { dir: 'E',  x: x + size - pad - 10, y: y + mid,  label: '→' },
        { dir: 'NW', x: x + pad + 6,   y: y + pad + 6,    label: '↖' },
        { dir: 'NE', x: x + size - pad - 16, y: y + pad + 6, label: '↗' },
        { dir: 'SW', x: x + pad + 6,   y: y + size - pad - 16, label: '↙' },
        { dir: 'SE', x: x + size - pad - 16, y: y + size - pad - 16, label: '↘' }
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
              try {
                const newShow = !env.getShowGrid();
                env.setShowGrid?.(newShow);
                this.showGrid = newShow; // keep local state in sync in case env doesn't repaint immediately
              } catch {}
            } else if (item.action === 'previewFillOnClose') {
              this.previewFillOnClose = !this.previewFillOnClose;
              try { env.showToast(`Preview Fill Only On Close ${this.previewFillOnClose ? 'ON' : 'OFF'}`); } catch {}
            } else if (item.action === 'previewDashedNext') {
              this.previewDashedNextSegment = !this.previewDashedNextSegment;
              try { env.showToast(`Dashed Next Segment ${this.previewDashedNextSegment ? 'ON' : 'OFF'}`); } catch {}
            } else if (item.action === 'alignmentGuides') {
              this.showAlignmentGuides = !this.showAlignmentGuides;
              try { env.showToast(`Alignment Guides ${this.showAlignmentGuides ? 'ON' : 'OFF'}`); } catch {}
            } else if (item.action === 'guideDetailsToggle') {
              this.showGuideDetails = !this.showGuideDetails;
              try { env.showToast(`Guide Details ${this.showGuideDetails ? 'ON' : 'OFF'}`); } catch {}
            } else if (item.action === 'rulersToggle') {
              this.showRulers = !this.showRulers;
              try { env.showToast(`Rulers ${this.showRulers ? 'ON' : 'OFF'}`); } catch {}
            } else if (item.action === 'alignLeft') {
              this.alignSelectedObjects('ArrowLeft', env);
            } else if (item.action === 'alignRight') {
              this.alignSelectedObjects('ArrowRight', env);
            } else if (item.action === 'alignTop') {
              this.alignSelectedObjects('ArrowUp', env);
            } else if (item.action === 'alignBottom') {
              this.alignSelectedObjects('ArrowDown', env);
            } else if (item.action === 'alignCenterH') {
              this.alignSelectedObjects('centerH', env);
            } else if (item.action === 'alignCenterV') {
              this.alignSelectedObjects('centerV', env);
            } else if (item.action === 'distributeH') {
              this.distributeSelectedObjects('H', env);
            } else if (item.action === 'distributeV') {
              this.distributeSelectedObjects('V', env);
            } else if (item.action === 'suggestCup') {
              void this.suggestCup();
            } else if (item.action === 'courseCreator') {
              // Admin gating (double enforcement)
              const isAdmin = (typeof env.getUserRole === 'function') ? (env.getUserRole() === 'admin') : false;
              if (!isAdmin) {
                try { env.showToast('Admin only'); } catch {}
                this.openEditorMenu = null;
                return;
              }
              // Open Course Creator overlay
              void this.openCourseCreator();
              this.openEditorMenu = null;
              return;
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
            } else if (item.action === 'importScreenshot') {
              void this.importFromScreenshot();
            } else if (item.action === 'importAnnotate') {
              void this.importFromScreenshotAnnotate();
            } else if (item.action === 'overlayOpen') {
              void this.openOverlayImage();
            } else if (item.action === 'overlayToggle') {
              this.overlayVisible = !this.overlayVisible;
              try { env.showToast(`Overlay ${this.overlayVisible ? 'ON' : 'OFF'}`); } catch {}
            } else if (item.action === 'overlayOpacityUp') {
              if (this.overlayVisible) this.overlayOpacity = Math.max(0, Math.min(1, this.overlayOpacity + 0.05));
            } else if (item.action === 'overlayOpacityDown') {
              if (this.overlayVisible) this.overlayOpacity = Math.max(0, Math.min(1, this.overlayOpacity - 0.05));
            } else if (item.action === 'overlayZToggle') {
              if (this.overlayVisible) this.overlayAbove = !this.overlayAbove;
            } else if (item.action === 'overlayLockToggle') {
              if (this.overlayVisible) this.overlayLocked = !this.overlayLocked;
            } else if (item.action === 'overlaySnapToggle') {
              if (this.overlayVisible) this.overlaySnapToGrid = !this.overlaySnapToGrid;
            } else if (item.action === 'overlayFitFairway') {
              if (this.overlayVisible && this.overlayCanvas) this.fitOverlayToFairway(env);
            } else if (item.action === 'overlayReset') {
              if (this.overlayVisible) this.resetOverlayTransform(env);
            } else if (item.action === 'overlayFitCanvas') {
              if (this.overlayVisible && this.overlayCanvas) this.fitOverlayToCanvas(env);
            } else if (item.action === 'overlayFlipH') {
              if (this.overlayVisible && !this.overlayLocked) this.overlayTransform.flipH = !this.overlayTransform.flipH;
            } else if (item.action === 'overlayFlipV') {
              if (this.overlayVisible && this.overlayCanvas && !this.overlayLocked) this.overlayTransform.flipV = !this.overlayTransform.flipV;
            } else if (item.action === 'overlayThroughClick') {
              if (this.overlayVisible && this.overlayCanvas && this.overlayAbove) {
                this.overlayThroughClick = !this.overlayThroughClick;
              } else {
                try { env.showToast('Through-click is available only when Overlay is Above.'); } catch {}
              }
            } else if (item.action === 'overlayAspectToggle') {
              if (this.overlayVisible && this.overlayCanvas && !this.overlayLocked) this.overlayTransform.preserveAspect = !this.overlayTransform.preserveAspect;
            } else if (item.action === 'overlayCalibrateScale') {
              if (this.overlayVisible && this.overlayCanvas && !this.overlayLocked) {
                this.overlayCalibrate = { phase: 'pickA' };
                try { env.showToast('Calibrate: click first point on the overlay'); } catch {}
              }
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
            } else if (item.action === 'duplicate') {
              if (this.selectedObjects.length > 0) this.duplicateSelectedObjects();
            } else if (item.action === 'chamfer') {
              void this.chamferBevelSelected();
            } else if (item.action === 'angledCorridor') {
              void this.placeAngledCorridorStamp();
            } else if (item.action === 'back') {
              (async () => {
                const ok = await env.showConfirm('Exit Level Editor and return to Main Menu? Unsaved changes will be lost.', 'Exit Editor');
                if (ok) {
                  // Clear any open menus before leaving
                  this.openEditorMenu = null;
                  // Reset session so a fresh level is created on next entry
                  this.resetEditorSession();
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
    // Raw clamped mouse (no snap) used for hit-testing and drag-start
    const rx = Math.max(fairX, Math.min(fairX + fairW, p.x));
    const ry = Math.max(fairY, Math.min(fairY + fairH, p.y));
    // Snapped absolute position used for placements/vertices
    let px = snap(rx);
    let py = snap(ry);
    const gridOn = (() => { try { return this.showGrid && env.getShowGrid(); } catch { return false; } })();
    const gridSize = (() => { try { return env.getGridSize(); } catch { return this.gridSize; } })();

    if (this.selectedTool !== 'select') {
      // Start rectangle placement for rect tools
      if (inFairway && (this.selectedTool === 'wall' || this.selectedTool === 'bridge' || this.selectedTool === 'water' || this.selectedTool === 'sand' || this.selectedTool === 'hill')) {
        this.isEditorDragging = true;
        this.editorDragTool = this.selectedTool;
        this.editorDragStart = { x: px, y: py };
        this.editorDragCurrent = { x: px, y: py };
        return;
      }
      // Poly tools: click to start polygon, subsequent clicks add vertices, click-near-start or Enter to finish
      if (
        this.selectedTool === 'wallsPoly' || this.selectedTool === 'waterPoly' || this.selectedTool === 'sandPoly' ||
        this.selectedTool === 'walls45'  || this.selectedTool === 'water45'  || this.selectedTool === 'sand45'
      ) {
        if (!this.polygonInProgress) {
          // Start new polygon — include alignment guide snap if enabled (Ctrl=grid-only, Alt=disable guides)
          let sx = px, sy = py;
          const allowGuides = this.showAlignmentGuides && !e.ctrlKey && !e.altKey;
          if (allowGuides) {
            const ag = this.computeAlignmentSnap(px, py, env);
            sx = ag.x; sy = ag.y; this.liveGuides = ag.guides;
            // Bubble for snapped axis value
            this.liveGuideBubbles = [];
            if (ag.guides.length) {
              const g0 = ag.guides[0];
              const label = g0.kind === 'x' ? `x=${Math.round(sx)}` : `y=${Math.round(sy)}`;
              this.liveGuideBubbles.push({ x: px + 10, y: py + 10, text: label });
            }
          } else { this.liveGuides = []; this.liveGuideBubbles = []; }
          this.polygonInProgress = { tool: this.selectedTool, points: [sx, sy] };
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
          }
          // Otherwise add a new point using snapping + 45° constraint logic
          const lastLen = this.polygonInProgress.points.length;
          const prev = { x: this.polygonInProgress.points[lastLen - 2], y: this.polygonInProgress.points[lastLen - 1] };
          let res = this.computePolygonSnap(prev, { x: px, y: py }, this.selectedTool,
            { ctrl: !!e.ctrlKey, shift: !!e.shiftKey }, env);
          // Apply alignment guides to the resulting point to match preview (Ctrl=grid-only, Alt=disable guides)
          const allowGuides = this.showAlignmentGuides && !e.ctrlKey && !e.altKey;
          if (allowGuides) {
            const ag = this.computeAlignmentSnap(res.x, res.y, env);
            res = { ...res, x: ag.x, y: ag.y } as any;
            this.liveGuides = ag.guides;
            // Guide bubble for axis/spacing
            this.liveGuideBubbles = [];
            if (ag.guides.length) {
              const g0 = ag.guides[0];
              const label = g0.kind === 'x' ? `x=${Math.round(ag.x)}` : `y=${Math.round(ag.y)}`;
              this.liveGuideBubbles.push({ x: px + 10, y: py + 10, text: label });
              const space = Math.round(Math.abs((g0.kind === 'x' ? ag.x : ag.y) - g0.pos));
              this.liveGuideBubbles.push({ x: px + 10, y: py - 24, text: (g0.kind === 'x' ? `↔ ${space} px` : `↕ ${space} px`) });
            }
          } else { this.liveGuides = []; this.liveGuideBubbles = []; }
          this.polygonInProgress.points.push(res.x, res.y);
          return;
        }
      }
      
      // Point placement for tee/cup/post/decoration
      if (inFairway && (this.selectedTool === 'tee' || this.selectedTool === 'cup' || this.selectedTool === 'post' || this.selectedTool === 'decoration')) {
        this.pushUndoSnapshot(`Place ${this.selectedTool === 'decoration' ? this.selectedDecoration : this.selectedTool}`);
        const gs = env.getGlobalState();
        const defaultRadius = 12;
        // For posts, snap center so edges align with grid lines (similar feel to wall edges)
        if (this.selectedTool === 'post') {
          const snapPos = this.snapPostPosition(px, py, defaultRadius, env);
          px = snapPos.x; py = snapPos.y;
        }
        
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
        for (let i = 0; i < rotHandles.length; i++) {
          const h = rotHandles[i];
          if (rx >= h.x && rx <= h.x + h.w && ry >= h.y && ry <= h.y + h.h) {
            this.pushUndoSnapshot('Rotate object');
            this.isRotating = true;
            this.rotationCenter = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
            this.rotationStartMouse = { x: px, y: py };
            this.rotationStartAngle = Math.atan2(py - this.rotationCenter.y, px - this.rotationCenter.x) - (obj as any).object.rot || 0;
            return;
          }
        }
      }
      const handles = this.getResizeHandles(bounds);
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i];
        if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) {
          // Begin resize for rect-like objects only (overlay excluded; it uses its own handles)
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

    // Polygon vertex drag start (before general hit-test) — use raw mouse for hit-test
    if (this.selectedTool === 'select') {
      const vertexHit = this.findPolygonVertexAtPoint(rx, ry, env);
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
    const hit = this.findObjectAtPoint(rx, ry, env);
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
        this.dragMoveStart = { x: rx, y: ry };
        this.dragMoveOffset = { x: 0, y: 0 };
      } else {
        // Begin marquee selection
        this.isSelectionDragging = true;
        this.selectionBoxStart = { x: rx, y: ry };
        this.dragMoveOffset = { x: 0, y: 0 };
        if (!e.shiftKey) this.selectedObjects = [];
      }
    }
  }

  handleMouseMove(e: MouseEvent, env: EditorEnv): void {
    const p = env.worldFromEvent(e);
    
    // Track mouse position for clipboard paste
    this.lastMousePosition = { x: p.x, y: p.y };
    // Track modifiers
    this.lastModifiers = { shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey };
    // Track modifier keys and preview join style
    this.lastModifiers = { shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey };
    if (this.polygonInProgress) this.polygonJoinBevel = !!e.altKey;
    
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const gridOn = (() => { try { return this.showGrid && env.getShowGrid(); } catch { return false; } })();
    const gridSize = (() => { try { return env.getGridSize(); } catch { return this.gridSize; } })();
    const clampX = (x: number) => Math.max(fairX, Math.min(fairX + fairW, x));
    const clampY = (y: number) => Math.max(fairY, Math.min(fairY + fairH, y));
    const snap = (n: number) => gridOn ? Math.round(n / gridSize) * gridSize : n;
    const rx = clampX(p.x);
    const ry = clampY(p.y);
    const px = snap(rx);
    const py = snap(ry);

    // Safety: if mouse button was released (no primary button), ensure overlay interactions end
    if ((this.overlayIsDragging || this.overlayIsResizing || this.overlayIsRotating) && (e.buttons === 0)) {
      if (this.overlayIsDragging) {
        this.overlayIsDragging = false;
        this.overlayDragStartMouse = null;
        this.overlayStartPos = null;
      }
      if (this.overlayIsResizing) {
        this.overlayIsResizing = false;
        this.overlayResizeAnchorLocal = null;
        this.overlayResizeAnchorWorld = null;
        this.overlayResizeStartScale = null;
        this.overlayActiveHandle = null;
        this.overlayResizeAxis = 'both';
      }
      if (this.overlayIsRotating) {
        this.overlayIsRotating = false;
      }
      // Do not return, allow rest of move handling to proceed safely after state reset
    }

    // Overlay drag update
    if (this.overlayIsDragging && this.overlayDragStartMouse && this.overlayStartPos) {
      const rawDx = p.x - this.overlayDragStartMouse.x;
      const rawDy = p.y - this.overlayDragStartMouse.y;
      let dx = rawDx, dy = rawDy;
      if (this.overlaySnapToGrid) {
        try {
          const g = env.getGridSize();
          dx = Math.round(rawDx / g) * g;
          dy = Math.round(rawDy / g) * g;
        } catch {}
      }
      this.overlayTransform.x = this.overlayStartPos.x + dx;
      this.overlayTransform.y = this.overlayStartPos.y + dy;
      return;
    }

    // Overlay resize update (bottom-right only)
    if (this.overlayIsResizing && this.overlayResizeAnchorLocal && this.overlayResizeAnchorWorld && this.overlayResizeStartScale) {
      if (!this.overlayCanvas) return;
      const iw = this.overlayNatural.width || this.overlayCanvas!.width;
      const ih = this.overlayNatural.height || this.overlayCanvas!.height;
      const local = this.worldToOverlayLocal(p.x, p.y);
      let nsx = Math.max(0.01, local.x / Math.max(1, iw));
      let nsy = Math.max(0.01, local.y / Math.max(1, ih));
      // Axis constraints
      if (this.overlayResizeAxis === 'x') {
        if (this.overlayTransform.preserveAspect) { nsy = nsx; } else { nsy = this.overlayTransform.scaleY; }
      } else if (this.overlayResizeAxis === 'y') {
        if (this.overlayTransform.preserveAspect) { nsx = nsy; } else { nsx = this.overlayTransform.scaleX; }
      }
      if (this.overlayTransform.preserveAspect && this.overlayResizeAxis === 'both') {
        const s = Math.max(nsx, nsy);
        nsx = s; nsy = s;
      }
      const t = this.overlayTransform;
      // Keep anchor world fixed: T' = W_anchor - R * (S' * A_local)
      const c = Math.cos(t.rotation || 0), s = Math.sin(t.rotation || 0);
      const ax = this.overlayResizeAnchorLocal.x, ay = this.overlayResizeAnchorLocal.y;
      const wx = this.overlayResizeAnchorWorld!.x, wy = this.overlayResizeAnchorWorld!.y;
      const tx = wx - (ax * (t.flipH ? -1 : 1) * nsx * c - ay * (t.flipV ? -1 : 1) * nsy * s);
      const ty = wy - (ax * (t.flipH ? -1 : 1) * nsx * s + ay * (t.flipV ? -1 : 1) * nsy * c);
      this.overlayTransform.scaleX = nsx;
      this.overlayTransform.scaleY = nsy;
      this.overlayTransform.x = tx;
      this.overlayTransform.y = ty;
      return;
    }

    // Overlay rotate update
    if (this.overlayIsRotating) {
      const local = this.worldToOverlayLocal(p.x, p.y);
      const a1 = Math.atan2(local.y, local.x);
      const delta = a1 - this.overlayRotateStartAngleLocal;
      const rot = this.overlayRotateInitialRotation + delta;
      if (this.lastModifiers.shift) {
        const step = Math.PI / 12; // 15° snap
        this.overlayTransform.rotation = Math.round(rot / step) * step;
      } else {
        this.overlayTransform.rotation = rot;
      }
      return;
    }

    // Ruler drag update (live preview of guide)
    if (this.isRulerDragging && this.rulerDragKind) {
      let pos = this.rulerDragKind === 'x' ? clampX(p.x) : clampY(p.y);
      // Snap guide to grid if enabled
      try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); pos = Math.round(pos / g) * g; } } catch {}
      this.rulerDragPos = pos;
      this.liveGuides = [{ kind: this.rulerDragKind, pos }];
      this.liveGuideBubbles = [{ x: px + 10, y: py + 10, text: `${this.rulerDragKind}=${Math.round(pos)}` }];
      return;
    }

    // Measure Tool update
    if (this.selectedTool === 'measure' && this.measureStart) {
      this.measureEnd = { x: px, y: py };
      return;
    }

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
          let sx = px, sy = py;
          // Ctrl forces grid-only; Alt disables guides
          const allowGuides = this.showAlignmentGuides && !e.ctrlKey && !e.altKey;
          if (allowGuides) {
            const snapRes = this.computeAlignmentSnap(px, py, env);
            sx = snapRes.x; sy = snapRes.y; this.liveGuides = snapRes.guides;
          } else {
            this.liveGuides = [];
          }
          poly.points[i] = sx;
          poly.points[i + 1] = sy;
          // Spacing bubble relative to snapped guide
          this.liveGuideBubbles = [];
          if (this.liveGuides && this.liveGuides.length) {
            const g0 = this.liveGuides[0];
            const space = Math.round(Math.abs((g0.kind === 'x' ? sx : sy) - g0.pos));
            this.liveGuideBubbles.push({ x: px + 10, y: py - 24, text: (g0.kind === 'x' ? `↔ ${space} px` : `↕ ${space} px`) });
          }
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
      let ax = px, ay = py;
      // Ctrl forces grid-only; Alt disables guides
      const allowGuides = this.showAlignmentGuides && !e.ctrlKey && !e.altKey;
      if (allowGuides) {
        const snapRes = this.computeAlignmentSnap(px, py, env);
        ax = snapRes.x; ay = snapRes.y; this.liveGuides = snapRes.guides; this.liveGuideBubbles = [];
        if (snapRes.guides.length) {
          const g = snapRes.guides[0];
          const label = g.kind === 'x' ? `x=${Math.round(ax)}` : `y=${Math.round(ay)}`;
          this.liveGuideBubbles.push({ x: px + 10, y: py + 10, text: label });
        }
      } else { this.liveGuides = []; this.liveGuideBubbles = []; }
      const dx = ax - this.resizeStartMouse.x;
      const dy = ay - this.resizeStartMouse.y;
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
      // Spacing bubble relative to snapped guide
      if (this.liveGuides && this.liveGuides.length) {
        const g0 = this.liveGuides[0];
        const left = x, cx = x + w / 2, right = x + w;
        const nearest = [left, cx, right].sort((a,b)=> Math.abs(a - g0.pos) - Math.abs(b - g0.pos))[0];
        const space = Math.round(Math.abs(nearest - g0.pos));
        this.liveGuideBubbles.push({ x: ax + 10, y: ay - 24, text: `↔ ${space} px` });
      }
      return;
    }

    // --- Group resize ---
    if (this.isGroupResizing && this.resizeStartBounds && this.resizeStartMouse && this.groupResizeOriginals && this.resizeHandleIndex !== null) {
      let ax = px, ay = py;
      // Ctrl forces grid-only; Alt disables guides
      const allowGuides = this.showAlignmentGuides && !e.ctrlKey && !e.altKey;
      if (allowGuides) {
        const snapRes = this.computeAlignmentSnap(px, py, env);
        ax = snapRes.x; ay = snapRes.y; this.liveGuides = snapRes.guides;
      } else { this.liveGuides = []; }
      const dx = ax - this.resizeStartMouse.x;
      const dy = ay - this.resizeStartMouse.y;
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
      // Compute raw delta from drag start (mouse), then apply axis lock, then selection-bounds-based snapping
      let rawDx = rx - this.dragMoveStart.x;
      let rawDy = ry - this.dragMoveStart.y;
      if (e.shiftKey) {
        if (Math.abs(rawDx) >= Math.abs(rawDy)) { rawDy = 0; } else { rawDx = 0; }
      }
      // Ctrl forces grid-only; Alt disables guides
      const allowGuides = this.showAlignmentGuides && !e.ctrlKey && !e.altKey;
      let dx = rawDx, dy = rawDy;
      this.liveGuides = [];
      this.liveGuideBubbles = [];
      if (allowGuides) {
        const selSnap = this.computeMoveSnapForSelection(rawDx, rawDy, env);
        dx = selSnap.dx; dy = selSnap.dy; this.liveGuides = selSnap.guides;
        if (selSnap.guides.length) {
          const g = selSnap.guides[0];
          const sel = this.getSelectionBounds();
          const disp = { x: sel.x + dx, y: sel.y + dy, w: sel.w, h: sel.h };
          const label = g.kind === 'x' ? `x=${Math.round(disp.x)}` : `y=${Math.round(disp.y)}`;
          this.liveGuideBubbles.push({ x: px + 10, y: py + 10, text: label });
        }
      } else {
        // If guides are off, still respect grid for non-circular selection
        const selectionIsAllCircles = this.selectedObjects.length > 0 && this.selectedObjects.every(o => (o.type === 'post' || o.type === 'tee' || o.type === 'cup'));
        if (!selectionIsAllCircles) { dx = gridOn ? Math.round(rawDx / gridSize) * gridSize : rawDx; dy = gridOn ? Math.round(rawDy / gridSize) * gridSize : rawDy; }
      }
      this.dragMoveOffset = { x: dx, y: dy };
      // Delta bubble
      this.liveGuideBubbles.push({ x: px + 10, y: py - 24, text: `Δ=(${Math.round(dx)}, ${Math.round(dy)})` });
      // Spacing bubble relative to snapped guide
      if (this.liveGuides && this.liveGuides.length) {
        const g0 = this.liveGuides[0];
        const sel = this.getSelectionBounds();
        const disp = { x: sel.x + dx, y: sel.y + dy, w: sel.w, h: sel.h };
        if (g0.kind === 'x') {
          const left = disp.x, cx = disp.x + disp.w / 2, right = disp.x + disp.w;
          const nearest = [left, cx, right].sort((a,b)=> Math.abs(a - g0.pos) - Math.abs(b - g0.pos))[0];
          const space = Math.round(Math.abs(nearest - g0.pos));
          this.liveGuideBubbles.push({ x: px + 10, y: py - 42, text: `↔ ${space} px` });
        } else {
          const top = disp.y, cy = disp.y + disp.h / 2, bottom = disp.y + disp.h;
          const nearest = [top, cy, bottom].sort((a,b)=> Math.abs(a - g0.pos) - Math.abs(b - g0.pos))[0];
          const space = Math.round(Math.abs(nearest - g0.pos));
          this.liveGuideBubbles.push({ x: px + 10, y: py - 42, text: `↕ ${space} px` });
        }
      }
      return;
    }

    if (this.isSelectionDragging && this.selectionBoxStart) {
      const rawDx = rx - this.selectionBoxStart.x;
      const rawDy = ry - this.selectionBoxStart.y;
      const dx = gridOn ? Math.round(rawDx / gridSize) * gridSize : rawDx;
      const dy = gridOn ? Math.round(rawDy / gridSize) * gridSize : rawDy;
      this.dragMoveOffset = { x: dx, y: dy };
      return;
    }

  }

  handleMouseUp(e: MouseEvent, env: EditorEnv): void {
    const p = env.worldFromEvent(e);
    
    // Track mouse position for clipboard paste
    this.lastMousePosition = { x: p.x, y: p.y };
    // Track modifiers
    this.lastModifiers = { shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey };
    // Track modifier keys and preview join style
    this.lastModifiers = { shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey };
    if (this.polygonInProgress) this.polygonJoinBevel = !!e.altKey;
    
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const snap = (n: number) => {
      try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); return Math.round(n / g) * g; } } catch {}
      return n;
    };
    const px = snap(clamp(p.x, fairX, fairX + fairW));
    const py = snap(clamp(p.y, fairY, fairY + fairH));

    // Measure Tool finalize: mouse up pins current measurement
    if (this.selectedTool === 'measure') {
      // Right click on mouse up should already be handled in mousedown path
      if (this.measureStart && this.measureEnd) {
        this.pinnedMeasures.push({ a: { ...this.measureStart }, b: { ...this.measureEnd } });
        this.measureStart = null; this.measureEnd = null;
        // Clear any guide details from prior alignment helpers
        this.liveGuides = [];
        this.liveGuideBubbles = [];
        try { if (e.button !== 2) env.showToast('Pinned measurement'); } catch {}
        return;
      }
    }

    // Finalize ruler drag -> persist guide
    if (this.isRulerDragging && this.rulerDragKind && this.rulerDragPos !== null) {
      const kind = this.rulerDragKind;
      let pos = kind === 'x' ? Math.max(fairX, Math.min(fairX + fairW, this.rulerDragPos))
                               : Math.max(fairY, Math.min(fairY + fairH, this.rulerDragPos));
      // Snap persisted guide to grid if enabled
      try { if (this.showGrid && env.getShowGrid()) { const g = env.getGridSize(); pos = Math.round(pos / g) * g; } } catch {}
      this.persistentGuides.push({ kind, pos });
      try { env.showToast(`Added ${kind.toUpperCase()} guide @ ${Math.round(pos)}`); } catch {}
      this.isRulerDragging = false;
      this.rulerDragKind = null;
      this.rulerDragPos = null;
      this.liveGuides = [];
      this.liveGuideBubbles = [];
      return;
    }

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
      // Clear transient guide visuals after placement
      this.liveGuides = [];
      this.liveGuideBubbles = [];
      return;
    }

    // Commit polygon vertex drag (snapshot was taken on mouse down)
    if (this.isVertexDragging) {
      this.isVertexDragging = false;
      this.vertexDrag = null;
      this.syncEditorDataFromGlobals(env);
      this.liveGuides = [];
      this.liveGuideBubbles = [];
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
      this.liveGuides = [];
      this.liveGuideBubbles = [];
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
      this.liveGuides = [];
      this.liveGuideBubbles = [];
      return;
    }

    // Finish drag-move by applying accumulated offset
    if (this.isDragMoving && this.dragMoveStart) {
      const dx = this.dragMoveOffset.x;
      const dy = this.dragMoveOffset.y;
      if (dx !== 0 || dy !== 0) {
        const gs = env.getGlobalState();
        const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
        const clampX = (x: number) => Math.max(fairX, Math.min(fairX + fairW, x));
        const clampY = (y: number) => Math.max(fairY, Math.min(fairY + fairH, y));
        const gridOn = (() => { try { return this.showGrid && env.getShowGrid(); } catch { return false; } })();
        const gridSize = (() => { try { return env.getGridSize(); } catch { return this.gridSize; } })();
        const snap = (n: number) => gridOn ? Math.round(n / gridSize) * gridSize : n;

        for (const so of this.selectedObjects) {
          const t = so.type as any;
          const o: any = so.object as any;
          if (t === 'wallsPoly' || t === 'waterPoly' || t === 'sandPoly') {
            const pts: number[] = Array.isArray(o.points) ? o.points : [];
            for (let i = 0; i + 1 < pts.length; i += 2) { pts[i] += dx; pts[i + 1] += dy; }
          } else if (t === 'tee') {
            let nx = o.x + dx, ny = o.y + dy;
            nx = clampX(snap(nx));
            ny = clampY(snap(ny));
            o.x = nx; o.y = ny;
            gs.ball.x = nx; gs.ball.y = ny;
          } else if (t === 'cup') {
            let nx = o.x + dx, ny = o.y + dy;
            nx = clampX(snap(nx));
            ny = clampY(snap(ny));
            o.x = nx; o.y = ny;
            gs.hole.x = nx; gs.hole.y = ny;
          } else if (t === 'post' || t === 'wall' || t === 'water' || t === 'sand' || t === 'bridge' || t === 'hill' || t === 'decoration') {
            if (typeof o.x === 'number') o.x += dx;
            if (typeof o.y === 'number') o.y += dy;
            if (t === 'post') {
              const snapped = this.snapPostPosition(o.x, o.y, o.r ?? 12, env);
              o.x = snapped.x; o.y = snapped.y;
            }
          }
        }
        env.setGlobalState(gs);
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
        const set = new Set(this.selectedObjects);
        for (const o of newlySelected) set.add(o);
        this.selectedObjects = Array.from(set);
      } else {
        this.selectedObjects = newlySelected;
      }

      this.isSelectionDragging = false;
      this.selectionBoxStart = null;
      this.dragMoveOffset = { x: 0, y: 0 };
      this.syncEditorDataFromGlobals(env);
      return;
    }
  }
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
    // Hit-test order should mirror the reverse of render order (top-most first):
    // tee, cup, posts, polyWalls, walls, decorations, hills, bridges, sandPoly, sand, waterPoly, water
    // Also iterate arrays in reverse to prioritize most recently drawn objects.

    // Overlay (session-only): allow selection/move/resize/rotate via Select Tool when visible and not locked
    if (this.overlayVisible && this.overlayCanvas && !this.overlayLocked) {
      if (this.isPointInOverlay(px, py)) {
        return { type: 'overlay', object: this.overlayTransform } as any;
      }
    }

    // Tee (drawn last)
    {
      const teeObj: SelectableObject = { type: 'tee', object: { x: gs.ball.x, y: gs.ball.y, r: (gs.ball as any).r || 8 } } as any;
      if (this.isPointInObject(px, py, teeObj)) return teeObj;
    }
    // Cup (drawn last)
    {
      const cupObj: SelectableObject = { type: 'cup', object: { x: gs.hole.x, y: gs.hole.y, r: (gs.hole as any).r || 8 } } as any;
      if (this.isPointInObject(px, py, cupObj)) return cupObj;
    }
    // Posts
    {
      const arr = (gs.posts as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'post', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Polygon walls (rendered above walls)
    {
      const arr = (gs.polyWalls as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'wallsPoly', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Walls
    {
      const arr = (gs.walls as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'wall', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Decorations
    {
      const arr = (gs.decorations as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'decoration', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Hills
    {
      const arr = (gs.hills as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'hill', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Bridges
    {
      const arr = (gs.bridges as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'bridge', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Sand polys
    {
      const arr = (gs.sandsPoly as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'sandPoly', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Sand rects
    {
      const arr = (gs.sands as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'sand', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Water polys
    {
      const arr = (gs.watersPoly as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'waterPoly', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    // Water rects
    {
      const arr = (gs.waters as any[]) || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj: SelectableObject = { type: 'water', object: arr[i], index: i } as any;
        if (this.isPointInObject(px, py, obj)) return obj;
      }
    }
    return null;
  }

  // Keyboard shortcuts
  handleKeyDown(e: KeyboardEvent, env: EditorEnv): void {
    if (env.isOverlayActive?.()) return;

    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    // Track last mouse position might be updated elsewhere; ensure exists
    this.lastMousePosition = this.lastMousePosition || { x: 0, y: 0 } as any;

    // Polygon finalize/cancel
    if (key === 'Enter') {
      if (this.polygonInProgress) {
        e.preventDefault();
        this.finishPolygon(env);
        return;
      }
      // Pin current measurement
      if (this.selectedTool === 'measure' && this.measureStart && this.measureEnd) {
        e.preventDefault();
        this.pinnedMeasures.push({ a: { ...this.measureStart }, b: { ...this.measureEnd } });
        this.measureStart = null; this.measureEnd = null;
        try { env.showToast('Pinned measurement'); } catch {}
        return;
      }
    }
    if (key === 'Escape') {
      e.preventDefault();
      this.polygonInProgress = null;
      this.measureStart = null; this.measureEnd = null;
      this.isEditorDragging = false;
      this.isSelectionDragging = false;
      this.isDragMoving = false;
      this.isResizing = false;
      this.isGroupResizing = false;
      this.isRotating = false;
      this.isVertexDragging = false;
      this.openEditorMenu = null;
      this.postRadiusPicker = null;
      this.hillDirectionPicker = null;
      this.suggestedCupCandidates = null;
      this.showPathPreview = false;
      this.resizeHandleIndex = null;
      this.resizeStartBounds = null;
      this.resizeStartMouse = null;
      this.dragMoveStart = null;
      this.dragMoveOffset = { x: 0, y: 0 };
      return;
    }

    // Overlay quick controls (handled before selection so it takes precedence when active)
    if (this.overlayVisible && this.overlayCanvas) {
      // Opacity adjustments
      if (key === '[') {
        e.preventDefault();
        this.overlayOpacity = Math.max(0, Math.min(1, this.overlayOpacity - (e.shiftKey ? 0.10 : 0.05)));
        return;
      }
      if (key === ']') {
        e.preventDefault();
        this.overlayOpacity = Math.max(0, Math.min(1, this.overlayOpacity + (e.shiftKey ? 0.10 : 0.05)));
        return;
      }
      // Quick scale/rotate when overlay is selected and unlocked
      const overlaySelected = (
        this.selectedTool === 'select' && this.selectedObjects.length === 1 && (this.selectedObjects[0] as any).type === 'overlay' && !this.overlayLocked
      );
      if (overlaySelected) {
        if (key === '=' || key === '+') { e.preventDefault(); this.overlayTransform.scaleX *= 1.02; this.overlayTransform.scaleY *= 1.02; return; }
        if (key === '-') { e.preventDefault(); this.overlayTransform.scaleX *= 0.98; this.overlayTransform.scaleY *= 0.98; return; }
        if (key === ',') { e.preventDefault(); this.overlayTransform.rotation -= (e.shiftKey ? Math.PI/12 : Math.PI/180); return; }
        if (key === '.') { e.preventDefault(); this.overlayTransform.rotation += (e.shiftKey ? Math.PI/12 : Math.PI/180); return; }
      }
    }

    // Arrow keys: nudge selection (Shift => larger step)
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      if (this.selectedObjects.length > 0) {
        e.preventDefault();
        this.nudgeSelectedObjects(key, e.shiftKey, env);
      }
      return;
    }

    if (ctrl) {
      switch (key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          if (e.shiftKey) { if (this.canRedo()) this.performRedo(); }
          else { if (this.canUndo()) this.performUndo(); }
          return;
        case 'y':
          e.preventDefault();
          if (this.canRedo()) this.performRedo();
          return;
        case 'c':
          e.preventDefault();
          if (this.selectedObjects.length > 0) this.copySelectedObjects();
          return;
        case 'x':
          e.preventDefault();
          if (this.selectedObjects.length > 0) this.cutSelectedObjects();
          return;
        case 'v':
          e.preventDefault();
          if (this.clipboard.length > 0) this.pasteObjects(this.lastMousePosition.x, this.lastMousePosition.y);
          return;
        case 'd':
          e.preventDefault();
          if (this.selectedObjects.length > 0) this.duplicateSelectedObjects();
          return;
        case 'g':
          e.preventDefault();
          try {
            const newShow = !env.getShowGrid();
            env.setShowGrid?.(newShow);
            this.showGrid = newShow;
          } catch {}
          return;
      }
    }

    // Toggle Path Preview overlay (debug): P
    if (key.toLowerCase() === 'p') {
      if (this.pathPreview && this.pathPreview.found) {
        e.preventDefault();
        this.showPathPreview = !this.showPathPreview;
        env.showToast(`Path Preview ${this.showPathPreview ? 'ON' : 'OFF'}`);
      } else {
        // If no preview yet, compute one quickly with current grid size
        const fair = env.fairwayRect();
        let cellSize = 20;
        try { const g = env.getGridSize(); if (typeof g === 'number' && g > 0) cellSize = Math.max(10, Math.min(40, g)); } catch {}
        this.syncEditorDataFromGlobals(env);
        this.pathPreview = computePathDebug(this.editorLevelData, fair, cellSize);
        this.showPathPreview = !!this.pathPreview?.found;
        env.showToast(`Path Preview ${this.showPathPreview ? 'ON' : 'OFF'} (cell=${cellSize})`);
      }
      return;
    }

    // Delete selection
    if (key === 'Delete' || key === 'Backspace') {
      if (this.selectedObjects.length > 0) {
        e.preventDefault();
        this.pushUndoSnapshot(`Delete ${this.selectedObjects.length} object(s)`);
        this.deleteSelectedObjects();
      }
      return;
    }
  }

  // Delete currently selected objects from the level
  private deleteSelectedObjects(): void {
    if (!this.env) return;
    const env = this.env;
    if (this.selectedObjects.length === 0) return;

    const gs = env.getGlobalState();
    let blocked = false;

    // Collect indices to delete per array type
    const del: Record<string, number[]> = {
      wall: [], water: [], sand: [], bridge: [], hill: [], decoration: [], post: [],
      wallsPoly: [], waterPoly: [], sandPoly: []
    } as any;

    for (const so of this.selectedObjects) {
      const t = so.type as SelectableObject['type'];
      if (t === 'tee' || t === 'cup') { blocked = true; continue; }
      if ('index' in (so as any) && typeof (so as any).index === 'number') {
        del[t]?.push((so as any).index);
      }
    }

    const removeFrom = (arr: any[], indices: number[]) => {
      indices.sort((a, b) => b - a);
      for (const i of indices) { if (i >= 0 && i < arr.length) arr.splice(i, 1); }
    };

    removeFrom(gs.walls as any[], del.wall);
    removeFrom(gs.polyWalls as any[], del.wallsPoly);
    removeFrom(gs.waters as any[], del.water);
    removeFrom(gs.watersPoly as any[], del.waterPoly);
    removeFrom(gs.sands as any[], del.sand);
    removeFrom(gs.sandsPoly as any[], del.sandPoly);
    removeFrom(gs.bridges as any[], del.bridge);
    removeFrom(gs.hills as any[], del.hill);
    removeFrom(gs.decorations as any[], del.decoration);
    removeFrom(gs.posts as any[], del.post);

    env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(env);
    this.selectedObjects = [];
    if (blocked) try { env.showToast('Tee/Cup cannot be deleted'); } catch {}
  }

  // Nudge selected objects by arrow keys; Shift => larger step
  private nudgeSelectedObjects(direction: 'ArrowLeft'|'ArrowRight'|'ArrowUp'|'ArrowDown', bigStep: boolean, env: EditorEnv): void {
    if (this.selectedObjects.length === 0) return;
    const gs = env.getGlobalState();
    const { x: fairX, y: fairY, w: fairW, h: fairH } = env.fairwayRect();
    const clampX = (x: number) => Math.max(fairX, Math.min(fairX + fairW, x));
    const clampY = (y: number) => Math.max(fairY, Math.min(fairY + fairH, y));
    let step = 1;
    try { const g = env.getGridSize(); if (bigStep && typeof g === 'number' && g > 0) step = Math.max(2, Math.min(40, g)); else if (bigStep) step = 10; } catch { if (bigStep) step = 10; }
    let dx = 0, dy = 0;
    if (direction === 'ArrowLeft') dx = -step;
    else if (direction === 'ArrowRight') dx = step;
    else if (direction === 'ArrowUp') dy = -step;
    else if (direction === 'ArrowDown') dy = step;

    for (const so of this.selectedObjects) {
      const t = so.type as SelectableObject['type'];
      const o: any = so.object as any;
      if (t === 'wallsPoly' || t === 'waterPoly' || t === 'sandPoly') {
        const pts: number[] = Array.isArray(o.points) ? o.points : [];
        for (let i = 0; i + 1 < pts.length; i += 2) {
          pts[i] = clampX(pts[i] + dx);
          pts[i + 1] = clampY(pts[i + 1] + dy);
        }
      } else if (t === 'tee') {
        const nx = clampX(o.x + dx), ny = clampY(o.y + dy);
        o.x = nx; o.y = ny; gs.ball.x = nx; gs.ball.y = ny;
      } else if (t === 'cup') {
        const nx = clampX(o.x + dx), ny = clampY(o.y + dy);
        o.x = nx; o.y = ny; gs.hole.x = nx; gs.hole.y = ny;
      } else if (t === 'post' || t === 'wall' || t === 'water' || t === 'sand' || t === 'bridge' || t === 'hill' || t === 'decoration') {
        if (typeof o.x === 'number') o.x = clampX(o.x + dx);
        if (typeof o.y === 'number') o.y = clampY(o.y + dy);
        if (t === 'post') {
          const snapped = this.snapPostPosition(o.x, o.y, o.r ?? 12, env);
          o.x = snapped.x; o.y = snapped.y;
        }
      }
    }
    env.setGlobalState(gs);
    this.syncEditorDataFromGlobals(env);
  }

  // Placeholder for Angled Corridor stamp placement
  private async placeAngledCorridorStamp(): Promise<void> {
    if (!this.env) return; 
    try { this.env.showToast('Angled Corridor tool is not implemented yet'); } catch {}
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

    // Overlay bounds from transform and natural size (AABB of possibly rotated quad)
    if (t === 'overlay') {
      if (!this.overlayCanvas) return { x: 0, y: 0, w: 0, h: 0 };
      const iw = this.overlayNatural.width || this.overlayCanvas.width;
      const ih = this.overlayNatural.height || this.overlayCanvas.height;
      const tx = this.overlayTransform.x;
      const ty = this.overlayTransform.y;
      const rot = this.overlayTransform.rotation || 0;
      const sx = (this.overlayTransform.flipH ? -1 : 1) * (this.overlayTransform.scaleX || 1);
      const sy = (this.overlayTransform.flipV ? -1 : 1) * (this.overlayTransform.scaleY || 1);
      const c = Math.cos(rot), s = Math.sin(rot);
      const worldPt = (lx: number, ly: number) => {
        const lx2 = lx * sx, ly2 = ly * sy;
        return { x: tx + (lx2 * c - ly2 * s), y: ty + (lx2 * s + ly2 * c) };
      };
      const p0 = worldPt(0, 0);
      const p1 = worldPt(iw, 0);
      const p2 = worldPt(iw, ih);
      const p3 = worldPt(0, ih);
      const minX = Math.min(p0.x, p1.x, p2.x, p3.x);
      const minY = Math.min(p0.y, p1.y, p2.y, p3.y);
      const maxX = Math.max(p0.x, p1.x, p2.x, p3.x);
      const maxY = Math.max(p0.y, p1.y, p2.y, p3.y);
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

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

  // Helper: render a rect-like object with optional rotation by applying a center-based transform
  private renderWithRotation(ctx: CanvasRenderingContext2D, obj: SelectableObject, draw: () => void): void {
    const t = obj.type as SelectableObject['type'];
    const o: any = obj.object as any;
    const rot = typeof o?.rot === 'number' ? o.rot : 0;
    // Only rect-like types support rotation; polygons and circles are handled separately
    const rotatable = (t === 'wall' || t === 'water' || t === 'sand' || t === 'bridge' || t === 'hill' || t === 'decoration');
    if (!rot || !rotatable) {
      draw();
      return;
    }
    const rx = o?.x ?? 0, ry = o?.y ?? 0, rw = o?.w ?? 0, rh = o?.h ?? 0;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
    draw();
    ctx.restore();
  }

  // Helper: point-inside test by object type
  private isPointInObject(px: number, py: number, obj: SelectableObject): boolean {
    const type = obj.type as SelectableObject['type'];
    const o: any = obj.object as any;
    if (type === 'overlay') {
      return this.isPointInOverlay(px, py);
    }
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

  // --- Persistence commands and helpers ---

  private applyLevelToEnv(level: any, env: EditorEnv): void {
    // Store deep copy as editor data
    this.editorLevelData = JSON.parse(JSON.stringify(level));

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

    // Reset selection and drag state after applying a level
    this.selectedObjects = [];
    this.clearDragState();
  }

  async newLevel(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    const gs = env.getGlobalState();
    const W = (gs?.WIDTH ?? 800);
    const H = (gs?.HEIGHT ?? 600);
    const M = (gs?.COURSE_MARGIN ?? 40);
    const displayName = this.resolveDisplayName(env);

    const newLevel: Level = {
      canvas: { width: Math.max(600, Math.min(W, 1600)), height: Math.max(400, Math.min(H, 1200)) },
      course: { index: 1, total: 1 },
      par: 3,
      tee: { x: M + 60, y: Math.floor(H / 2) },
      cup: { x: W - M - 60, y: Math.floor(H / 2), r: 12 },
      walls: [],
      wallsPoly: [],
      posts: [],
      bridges: [],
      water: [],
      waterPoly: [],
      sand: [],
      sandPoly: [],
      hills: [],
      decorations: [],
      meta: { authorId: env.getUserId(), authorName: displayName || undefined, created: new Date().toISOString(), modified: new Date().toISOString() }
    };

    this.editorCurrentSavedId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.applyLevelToEnv(newLevel, env);
    env.showToast('New level created');
  }

  async save(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    this.syncEditorDataFromGlobals(env);

    // Ensure meta fields
    const username = env.getUserId();
    const displayName = this.resolveDisplayName(env);
    const level = applyLevelDataFixups({ ...this.editorLevelData });
    level.meta = level.meta || {};
    // Do NOT overwrite authorId on normal save; preserve original owner
    if (!level.meta.created) level.meta.created = new Date().toISOString();
    level.meta.modified = new Date().toISOString();
    // Unix timestamp per firebase.md
    (level.meta as any).lastModified = Date.now();
    // Ensure meta.title reflects course.title when present
    if (!level.meta.title) {
      const ct = level.course?.title?.toString().trim();
      if (ct) level.meta.title = ct;
    }

    // Validation before attempting to save
    const validation = validateLevelData(level);
    if (!validation.valid) {
      env.showToast(`Save failed: ${validation.errors.join(', ')}`);
      return;
    }

    if (!this.editorCurrentSavedId) {
      // No existing Firebase ID -> Save As
      await this.saveAs();
      return;
    }

    // Permission check: prevent overwriting others' levels unless admin
    const userRole = env.getUserRole?.() || 'user';
    const isAdmin = userRole === 'admin';
    if (!isAdmin) {
      try {
        const existing = await firebaseLevelStore.loadLevel(this.editorCurrentSavedId);
        const ownerId = existing && (existing as any).meta ? (existing as any).meta.authorId : undefined;
        // If owner is missing or different, block overwrite for non-admins
        if (ownerId !== username) {
          env.showToast('You cannot overwrite a level you do not own. Saving a copy instead.');
          await this.saveAs();
          return;
        }
      } catch {
        // If load fails, fall through; Firebase will enforce permissions as a backstop
      }
    }

    try {
      // Fill missing or placeholder authorName with display name
      if (!level.meta.authorName || level.meta.authorName === 'Unknown' || level.meta.authorName === username) {
        level.meta.authorName = displayName;
      }

      const id = await firebaseLevelStore.saveLevel(level, this.editorCurrentSavedId, username);
      this.editorCurrentSavedId = id;
      const title = level.course?.title || level.meta?.title || 'Level';
      env.showToast(`Saved "${title}"`);
    } catch (e) {
      console.error(e);
      env.showToast('Save failed');
    }
  }

  async saveAs(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    this.syncEditorDataFromGlobals(env);

    const username = env.getUserId();
    const displayName = this.resolveDisplayName(env);
    const level = applyLevelDataFixups({ ...this.editorLevelData });
    level.meta = level.meta || {};
    // New copy must always be owned by the current user
    level.meta.authorId = username;
    // Propagate authorName from environment (fallback to userId)
    level.meta.authorName = displayName;
    if (!level.meta.created) level.meta.created = new Date().toISOString();
    level.meta.modified = new Date().toISOString();
    (level.meta as any).lastModified = Date.now();

    // Ask for a title and validate it
    const suggested = (level.course?.title || level.meta?.title || 'Untitled').toString().trim();
    const rawTitle = await env.showPrompt('Level Title:', suggested, 'Save');
    if (rawTitle === null) return;
    const title = String(rawTitle).trim();
    if (!title) { env.showToast('Please enter a level title.'); return; }
    if (title.length > 120) { env.showToast('Title too long (max 120 characters).'); return; }

    // Persist title in both course and meta for compatibility
    level.course = level.course || { index: 1, total: 1 };
    (level.course as any).title = title || 'Untitled';
    level.meta = level.meta || {};
    level.meta.title = title || 'Untitled';

    // Final validation before save
    {
      const validation = validateLevelData(level);
      if (!validation.valid) {
        env.showToast(`Save failed: ${validation.errors.join(', ')}`);
        return;
      }
    }

    try {
      const id = await firebaseLevelStore.saveLevel(level, undefined, username);
      this.editorCurrentSavedId = id;
      env.showToast(`Saved "${title || 'Untitled'}"`);
    } catch (e) {
      console.error(e);
      env.showToast('Save failed');
    }
  }

  async openLoadPicker(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    const username = env.getUserId();
    const userRole = env.getUserRole?.() || 'user';
    const isAdmin = userRole === 'admin';

    // Load all available levels based on permissions
    let allEntries: FirebaseLevelEntry[] = [];
    
    try {
      if (isAdmin) {
        // Admin can see all levels
        allEntries = await firebaseLevelStore.getAllLevels(username);
      } else {
        // Regular users see their own levels + public levels
        const userLevels = await firebaseLevelStore.getUserLevels(username);
        const publicLevels = await firebaseLevelStore.getAllLevels(username);
        // Filter to avoid duplicates and only show accessible levels
        const userLevelIds = new Set(userLevels.map(l => l.name));
        const accessiblePublic = publicLevels.filter(l => !userLevelIds.has(l.name));
        allEntries = [...userLevels, ...accessiblePublic];
      }
    } catch (error) {
      console.error('Failed to load levels for picker:', error);
      env.showToast('Failed to load levels');
      return;
    }

    if (!allEntries || allEntries.length === 0) {
      env.showToast('No levels found');
      return;
    }

    // Categorize levels for filtering
    const myLevels = allEntries.filter(e => e.author === username || 
      (e.data?.meta?.authorId === username) || (e.data?.meta?.authorName === username));
    const otherUserLevels = allEntries.filter(e => 
      e.author !== username && e.author !== 'Unknown' && e.author !== 'Dev' &&
      e.data?.meta?.authorId !== username && e.data?.meta?.authorName !== username);
    const devLevels = allEntries.filter(e => 
      e.author === 'Dev' || e.author === 'Unknown' || 
      (!e.data?.meta?.authorId && !e.data?.meta?.authorName));

    // Create filter options
    const filterOptions = [
      { label: `All Levels (${allEntries.length})`, value: 'all' },
      { label: `My Levels (${myLevels.length})`, value: 'mine' },
      { label: `Other Users (${otherUserLevels.length})`, value: 'others' },
      { label: `Dev Levels (${devLevels.length})`, value: 'dev' }
    ];

    // Show filter selection first
    const filterChoice = await env.showList('Load Level - Select Filter', filterOptions, 0);
    if (!filterChoice) return;

    const filterValue = (filterChoice as any)?.value || 'all';
    
    // Apply filter
    let filteredEntries: FirebaseLevelEntry[];
    switch (filterValue) {
      case 'mine':
        filteredEntries = myLevels;
        break;
      case 'others':
        filteredEntries = otherUserLevels;
        break;
      case 'dev':
        filteredEntries = devLevels;
        break;
      default:
        filteredEntries = allEntries;
    }

    if (filteredEntries.length === 0) {
      env.showToast('No levels found for selected filter');
      return;
    }

    // Sort by last modified (newest first)
    filteredEntries.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));

    // Create level selection items
    const items = filteredEntries.map((e) => ({
      label: `${e.title} by ${e.author} (${new Date(e.lastModified || 0).toLocaleDateString()})`,
      value: e
    }));

    const chosen = await env.showList('Load Level - Select Level', items, 0);
    if (!chosen) return;

    const ok = await env.showConfirm('Load selected level and discard current changes?', 'Load Level');
    if (!ok) return;

    const chosenItem: any = chosen as any;
    const le: FirebaseLevelEntry = (chosenItem && chosenItem.value) ? chosenItem.value : (chosen as FirebaseLevelEntry);
    console.log('Editor load: selected level', { id: (le as any)?.name, title: (le as any)?.title, user: username, filter: filterValue });
    
    // Load level data
    let levelData: any = (le as any)?.data ?? (chosenItem && chosenItem.value ? chosenItem.value.data : undefined);
    if (typeof levelData === 'string') {
      try {
        levelData = JSON.parse(levelData);
      } catch (e) {
        console.warn('Level data JSON string parse failed, will refetch:', e);
        levelData = null;
      }
    }

    if (!levelData || typeof levelData !== 'object') {
      // Fallback: fetch the full level by ID from Firebase
      console.log('Editor load: fetching by id', le.name);
      let fetched = await firebaseLevelStore.loadLevel(le.name, username);
      if (!fetched && isAdmin) {
        // Admin fallback: try without user scope
        fetched = await firebaseLevelStore.loadLevel(le.name);
      }
      if (!fetched) {
        env.showToast('Failed to load level data');
        return;
      }
      console.log('Editor load: fetched level OK', { id: le.name });
      levelData = fetched;
    }

    const fixed = applyLevelDataFixups(levelData);
    this.applyLevelToEnv(fixed, env);
    this.editorCurrentSavedId = le.name; // Firebase ID
    env.showToast(`Loaded "${le.title}" by ${le.author}`);
  }

  async openDeletePicker(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    const username = env.getUserId();

    const entries = await firebaseLevelStore.getUserLevels(username);
    if (!entries || entries.length === 0) {
      env.showToast('No user levels to delete');
      return;
    }

    const items = entries.map((e) => ({
      label: `${e.title}`,
      value: e
    }));

    const chosen = await env.showList('Delete Level', items, 0);
    if (!chosen) return;

    const chosenDelItem: any = chosen as any;
    const le: FirebaseLevelEntry = (chosenDelItem && chosenDelItem.value) ? chosenDelItem.value : (chosen as FirebaseLevelEntry);
    const ok = await env.showConfirm(`Permanently delete "${le.title}"?`, 'Delete Level');
    if (!ok) return;

    try {
      await firebaseLevelStore.deleteLevel(le.name, username);
      if (this.editorCurrentSavedId === le.name) this.editorCurrentSavedId = null;
      env.showToast(`Deleted "${le.title}"`);
    } catch (e) {
      console.error(e);
      env.showToast('Delete failed');
    }
  }

  async importLevel(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    const data = await importLevelFromFile();
    if (!data) return;

    const fixed = applyLevelDataFixups(data);
    // Ensure author tracking
    fixed.meta = fixed.meta || {};
    if (!fixed.meta.authorId) fixed.meta.authorId = env.getUserId();
    fixed.meta.modified = new Date().toISOString();
    if (!fixed.meta.created) fixed.meta.created = fixed.meta.modified;

    this.editorCurrentSavedId = null; // imported file is not yet saved
    this.applyLevelToEnv(fixed, env);
    env.showToast('Imported level');
  }

  async importFromScreenshot(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = false;
      input.onchange = (e) => {
        const f = (e.target as HTMLInputElement).files?.[0] || null;
        resolve(f);
      };
      input.click();
    });
    if (!file) return;

    const targetW = Math.max(400, Math.floor(env.width));
    const targetH = Math.max(300, Math.floor(env.height));
    const imported = await importLevelFromScreenshot(file, { targetWidth: targetW, targetHeight: targetH, gridSize: (()=>{ try { return env.getGridSize(); } catch { return 20; } })() });
    if (!imported) { try { env.showToast('Import failed'); } catch {} return; }

    // Preserve importer review payload (ImageData cannot survive JSON clone in fixups)
    const reviewSeed = (imported as any).__review;
    const fixed = applyLevelDataFixups(imported);
    // Ensure author tracking and timestamps
    fixed.meta = fixed.meta || {};
    if (!fixed.meta.authorId) fixed.meta.authorId = env.getUserId();
    if (!fixed.meta.authorName) fixed.meta.authorName = this.resolveDisplayName(env);
    fixed.meta.modified = new Date().toISOString();
    if (!fixed.meta.created) fixed.meta.created = fixed.meta.modified;

    this.editorCurrentSavedId = null; // new imported draft
    this.applyLevelToEnv(fixed, env);

    // Import Review overlay (if available)
    try {
      const gridSize = (()=>{ try { return env.getGridSize(); } catch { return 20; } })();
      const reviewInit = reviewSeed; // use pre-fixups seed that still holds ImageData
      if (reviewInit && reviewInit.imageData && typeof env.showImportReview === 'function') {
        const res = await env.showImportReview({
          imageData: reviewInit.imageData,
          thresholds: reviewInit.thresholds,
          fairway: reviewInit.fairway,
          gridSize,
          canvas: fixed.canvas,
          currentPolys: { wallsPoly: fixed.wallsPoly || [], sandPoly: fixed.sandPoly || [], waterPoly: fixed.waterPoly || [] }
        });
        if (res && res.polys) {
          // Apply accepted polygons
          fixed.wallsPoly = res.polys.wallsPoly;
          fixed.sandPoly = res.polys.sandPoly;
          fixed.waterPoly = res.polys.waterPoly;
          // Update editor state to reflect changes
          this.applyLevelToEnv(fixed, env);
          try { env.showToast('Import review applied'); } catch {}
        }
      }
    } catch {}

    // Post-import confirmations: always ask for Tee click; Cup only if not confidently detected
    this.pendingTeeConfirm = true;
    const cupDetected = !!(fixed?.meta?.importInfo?.cupDetected);
    this.pendingCupConfirm = !cupDetected;
    // Switch tool to Tee for clarity (click is intercepted regardless)
    this.selectedTool = 'tee';
    env.showToast('Imported from screenshot');
    try {
      env.showToast('Click to set Tee');
      if (this.pendingCupConfirm) env.showToast('Then click to set Cup');
    } catch {}
  }

  async importFromScreenshotAnnotate(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    
    // File picker for screenshot
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files?.[0];
        resolve(f || null);
      };
      input.click();
    });
    
    if (!file) return;
    
    try {
      env.showToast('Opening annotation overlay...');
      
      // Use annotation overlay if available
      if (typeof env.showAnnotateScreenshot === 'function') {
        const gridSize = (() => { try { return env.getGridSize(); } catch { return 20; } })();
        const level = await env.showAnnotateScreenshot(file, {
          targetWidth: 800,
          targetHeight: 600,
          gridSize
        });
        
        if (level) {
          // Apply fixups and import
          const fixed = applyLevelDataFixups(level);
          if (!fixed.meta.authorId) fixed.meta.authorId = env.getUserId();
          if (!fixed.meta.authorName) fixed.meta.authorName = this.resolveDisplayName(env);
          fixed.meta.modified = new Date().toISOString();
          if (!fixed.meta.created) fixed.meta.created = fixed.meta.modified;
          
          this.editorCurrentSavedId = null; // new imported draft
          this.applyLevelToEnv(fixed, env);
          
          env.showToast('Annotated level imported successfully!');
        } else {
          env.showToast('Annotation cancelled');
        }
      } else {
        env.showToast('Annotation overlay not available');
      }
    } catch (e) {
      console.error('importFromScreenshotAnnotate failed:', e);
      env.showToast('Import failed');
    }
  }

  async exportLevel(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    this.syncEditorDataFromGlobals(env);

    const level = applyLevelDataFixups({ ...this.editorLevelData });
    const base = (level.course?.title || 'level')
      .toString().trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '') || 'level';
    const filename = `${base}.json`;
    const ok = saveLevelAsDownload(level, filename);
    env.showToast(ok ? `Exported ${filename}` : 'Export failed');
  }

  async editMetadata(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    this.syncEditorDataFromGlobals(env);
    
    const currentTitle = (this.editorLevelData?.course?.title || this.editorLevelData?.meta?.title || 'Untitled').toString();
    const currentAuthor = (this.editorLevelData?.meta?.authorName || '').toString();
    const currentPar = String((this.editorLevelData?.par ?? 3) | 0);
    const currentDesc = (this.editorLevelData?.meta?.description || '').toString();
    const currentTags = Array.isArray(this.editorLevelData?.meta?.tags)
      ? (this.editorLevelData.meta.tags as string[]).join(', ')
      : (this.editorLevelData?.meta?.tags || '').toString();
    
    // Prefer the new panelized form if host provides it
    if (typeof env.showMetadataForm === 'function') {
      const formResult = await env.showMetadataForm(
        { title: currentTitle, author: currentAuthor, par: currentPar, description: currentDesc, tags: currentTags },
        'Metadata'
      );
      if (!formResult) return; // canceled
      let par = parseInt((formResult.par || '').trim(), 10);
      if (!Number.isFinite(par)) par = 3;
      par = Math.max(1, Math.min(20, par));
      if (!this.editorLevelData.meta) this.editorLevelData.meta = {} as any;
      this.editorLevelData.meta.title = (formResult.title || '').toString();
      this.editorLevelData.meta.authorName = (formResult.author || '').toString();
      this.editorLevelData.meta.description = (formResult.description || '').toString();
      this.editorLevelData.meta.tags = (formResult.tags || '').split(',').map((t: string) => t.trim()).filter((t: string) => !!t);
      this.editorLevelData.par = par;
      env.showToast('Metadata updated');
      await this.save();
      return;
    }
    
    // Fallback: legacy prompt sequence
    const title = await env.showPrompt('Level Title:', currentTitle, 'Metadata');
    if (title === null) return;
    const author = await env.showPrompt('Author Name:', currentAuthor, 'Metadata');
    if (author === null) return;
    const parInput = await env.showPrompt('Par (1-20):', currentPar, 'Metadata');
    if (parInput === null) return;
    const description = await env.showPrompt('Description (optional):', currentDesc, 'Metadata');
    if (description === null) return;
    const tagsInput = await env.showPrompt('Tags (comma-separated, optional):', currentTags, 'Metadata');
    if (tagsInput === null) return;
    const tTitle = String(title).trim();
    if (!tTitle) { env.showToast('Title cannot be empty.'); return; }
    let par = parseInt((parInput || '').trim(), 10);
    if (!Number.isFinite(par)) par = 3;
    par = Math.max(1, Math.min(20, par));
    if (!this.editorLevelData.meta) this.editorLevelData.meta = {} as any;
    this.editorLevelData.meta.title = (title || '').toString();
    this.editorLevelData.meta.authorName = (author || '').toString();
    this.editorLevelData.meta.description = (description || '').toString();
    this.editorLevelData.meta.tags = (tagsInput || '').split(',').map((t: string) => t.trim()).filter((t: string) => !!t);
    this.editorLevelData.par = par;
    // Also mirror created/modified timestamps in meta
    const nowIso = new Date().toISOString();
    if (!this.editorLevelData.meta.created) this.editorLevelData.meta.created = nowIso;
    this.editorLevelData.meta.modified = nowIso;
    (this.editorLevelData.meta as any).lastModified = Date.now();
    this.editorLevelData.par = par;
    env.showToast('Metadata updated');
    // Persist immediately so users see updates reflected in lists
    await this.save();
  }

  async suggestPar(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    this.syncEditorDataFromGlobals(env);

    // Use A* over a coarse grid derived from the fairway
    const fair = env.fairwayRect();
    let cellSize = 20;
    try { const g = env.getGridSize(); if (typeof g === 'number' && g > 0) cellSize = Math.max(10, Math.min(40, g)); } catch {}

    // Pull gameplay friction + heuristic tuning from global state when available
    const gsAll = env.getGlobalState?.() || {};
    const frictionK = typeof gsAll.frictionK === 'number' ? gsAll.frictionK
      : (typeof gsAll.physicsFrictionK === 'number' ? gsAll.physicsFrictionK : 1.2);
    const sandMult = typeof gsAll.sandMultiplier === 'number' ? gsAll.sandMultiplier
      : (typeof gsAll.physicsSandMultiplier === 'number' ? gsAll.physicsSandMultiplier : 6.0);
    const baselineShotPx = typeof gsAll.baselineShotPx === 'number' ? gsAll.baselineShotPx : 320;
    const turnPenaltyPerTurn = typeof gsAll.turnPenaltyPerTurn === 'number' ? gsAll.turnPenaltyPerTurn : 0.08;
    const hillBump = typeof gsAll.hillBump === 'number' ? gsAll.hillBump : 0.2;

    const { reachable, suggestedPar, pathLengthPx, notes } = estimatePar(this.editorLevelData, fair, cellSize, {
      baselineShotPx,
      sandPenaltyPerCell: 0.01,
      turnPenaltyPerTurn,
      turnPenaltyMax: 1.5,
      hillBump,
      bankWeight: 0.12,
      bankPenaltyMax: 1.0,
      // Physics-aware scaling so D (px per stroke) adjusts with friction
      frictionK,
      referenceFrictionK: 1.2,
      sandFrictionMultiplier: sandMult
    });
    // Compute debug path for overlay
    this.pathPreview = computePathDebug(this.editorLevelData, fair, cellSize);
    this.showPathPreview = !!this.pathPreview?.found;

    const extra = [] as string[];
    extra.push(reachable ? 'Path: reachable' : 'Path: no path (fallback heuristic)');
    extra.push(`Path length ~${Math.round(pathLengthPx)} px`);
    if (notes && notes.length) extra.push(...notes);

    const message = `Suggested par is ${suggestedPar} (cell=${cellSize}).\n${extra.join('\n')}`;
    const accept = await env.showConfirm(message, 'Suggest Par');
    if (!accept) return;
    this.pushUndoSnapshot('Set par');
    this.editorLevelData.par = suggestedPar;
    env.showToast(`Par set to ${suggestedPar}`);
    env.showToast('Path Preview ON — press P to toggle');
  }

  async testLevel(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    this.syncEditorDataFromGlobals(env);
    if (typeof env.testLevel === 'function') {
      await env.testLevel(this.editorLevelData);
    } else {
      env.showToast('Test not supported in this build');
    }
  }

  async suggestCup(): Promise<void> {
    if (!this.env) return;
    const env = this.env;
    this.syncEditorDataFromGlobals(env);
    const fair = env.fairwayRect();
    let cellSize = 20;
    try { const g = env.getGridSize(); if (typeof g === 'number' && g > 0) cellSize = Math.max(10, Math.min(40, g)); } catch {}

    const picks = heuristicSuggestCups(this.editorLevelData, fair, cellSize, 5, {
      edgeMargin: Math.max(20, cellSize * 2),
      minStraightnessRatio: 1.06,
      minTurns: 0,
      bankWeight: Math.max(8, Math.round(cellSize * 0.5))
    });

    if (!picks || picks.length === 0) {
      env.showToast('No suitable cup positions found');
      this.suggestedCupCandidates = null;
      return;
    }

    this.suggestedCupCandidates = picks;
    env.showToast('Click a numbered marker to set the Cup. Press Esc to cancel.');
  }

  // Interface implementation: minimal state exposure for main UI
  getSelectedTool(): EditorTool { return this.selectedTool; }
  setSelectedTool(t: EditorTool): void { this.selectedTool = t; }
  getUiHotspots(): EditorHotspot[] { return this.uiHotspots; }

}

export const levelEditor: LevelEditor = new LevelEditorImpl();
