 import CHANGELOG_RAW from '../CHANGELOG.md?raw';
import firebaseManager from './firebase';
import { levelEditor } from './editor/levelEditor';
import { computePolysFromThresholds, buildDefaultThresholds, importLevelFromAnnotations, AnnotationData, AnnotationOptions, findAnnotationAtPoint } from './editor/importScreenshot';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Dev detection helper (Vite env first, then localhost heuristics)
function isDevBuild(): boolean {
  const envDev = (import.meta as any)?.env?.DEV;
  if (typeof envDev === 'boolean') return envDev;
  if (typeof envDev === 'string') return envDev === 'true';
  try {
    const h = window.location.hostname;
    const p = window.location.port;
    return h === 'localhost' || h === '127.0.0.1' || p === '5173';
  } catch {
    return false;
  }

}

// Course thumbnails (generated from first level in the course)
const courseThumbnailCache = new Map<string, string>();
const courseImageCache = new Map<string, HTMLImageElement>();

function getCourseThumbnail(course: { id: string; courseData?: any }): string {
  const key = String(course.id || '');
  if (!key) return '';
  if (courseThumbnailCache.has(key)) return courseThumbnailCache.get(key)!;
  // Kick off async generation (simple: first level's thumbnail)
  (async () => {
    try {
      if (!firebaseReady) return;
      const levelIds: string[] = course.courseData?.levelIds || [];
      const firstId = levelIds[0];
      if (!firstId) return;
      const all = await firebaseManager.levels.getAllLevels(undefined);
      const entry = all.find((e: any) => e?.name === firstId);
      if (!entry || !entry.data) return;
      const thumb = generateLevelThumbnail(entry.data);
      courseThumbnailCache.set(key, thumb);
    } catch (err) {
      console.warn('Failed to generate course thumbnail for', key, err);
    }
  })();
  return '';
}

// Ensure the current profile (by name) is synchronized with Firebase users
// Sets userProfile.id to the Firebase ID. No legacy migrations are performed.
async function ensureUserSyncedWithFirebase(): Promise<void> {
  try {
    const name = (userProfile.name || '').trim();
    if (!name) return;
    if (!firebaseReady) return;

    const all = firebaseManager.users.getAll();
    const match = all.find((u: any) => (u.name || '').toLowerCase() === name.toLowerCase());
    if (match) {
    // Elevate 'admin' name if needed
    if (name.toLowerCase() === 'admin' && match.role !== 'admin') {
      try { await firebaseManager.users.toggleRole(match.id); match.role = 'admin'; } catch {}
    }

    const oldUserId = userProfile.id;
    userProfile.role = match.role as any;
    userProfile.id = match.id;
    saveUserProfile();
    } else {
      const defaultRole = (name.toLowerCase() === 'admin') ? 'admin' : 'user';
      const rec = await firebaseManager.users.addUser(name, defaultRole as any);

      const oldUserId = userProfile.id;
      userProfile.role = rec.role as any;
      userProfile.id = rec.id;
      saveUserProfile();
    }
  } catch (e) {
    console.error('ensureUserSyncedWithFirebase failed:', e);
  }
}
// End ensureUserSyncedWithFirebase

// Multilevel persistence (vp.levels.v1)
type SavedLevelV1 = { id: string; level: Level };
type LevelsDocV1 = { version: 1; levels: SavedLevelV1[] };
const LS_LEVELS_KEY = 'vp.levels.v1';

// Filesystem integration
type LevelSource = 'localStorage' | 'filesystem' | 'firebase';
type LevelEntry = {
  id: string;
  level: Level;
  source: LevelSource;
  filename?: string; // for filesystem levels
};

// Cache for filesystem levels
let filesystemLevelsCache: LevelEntry[] = [];
let filesystemCacheValid = false;

function newLevelId(): string {
  return 'lvl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// ------------------------------
// In-Game Modal Overlay System
// ------------------------------
type UiOverlayKind = 'none' | 'toast' | 'confirm' | 'prompt' | 'list' | 'dndList' | 'courseEditor' | 'courseCreator' | 'metadata' | 'loadLevels' | 'importReview' | 'annotateScreenshot';
type UiToast = { id: number; message: string; expiresAt: number };
type UiListItem = { id?: string; label: string; value?: any; disabled?: boolean };
type UiOverlayState = {
  kind: UiOverlayKind;
  // Shared
  title?: string;
  message?: string;
  // Positioning (for draggable overlays)
  posX?: number;
  posY?: number;
  // Drag state (internal)
  dragActive?: boolean;
  dragOffsetX?: number;
  dragOffsetY?: number;
  // Prompt
  inputText?: string;
  inputPlaceholder?: string;
  // List
  listItems?: UiListItem[];
  listIndex?: number;
  // DnD List (internal)
  dndDragIndex?: number;
  dndTargetIndex?: number;
  dndPointerY?: number;
  dndScroll?: number;
  // Course Editor
  courseData?: {
    id: string;
    title: string;
    levelIds: string[];
    levelTitles: string[];
  };
  courseEditingTitle?: boolean;
  courseNewTitle?: string;
  selectedLevelIndex?: number;
  scrollOffset?: number;
  dragState?: {
    dragIndex: number;
    startY: number;
    currentY: number;
    isDragging: boolean;
    targetIndex?: number;
  } | null;
  // Course Creator
  courseList?: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>;
  selectedCourseIndex?: number;
  courseScrollOffset?: number;
  // Import Review overlay
  imageData?: ImageData;
  thresholds?: any;
  fairway?: { x: number; y: number; w: number; h: number };
  gridSize?: number;
  canvas?: { width: number; height: number };
  currentPolys?: { wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> };
  previewPolys?: { wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> };
  showWalls?: boolean;
  showSand?: boolean;
  showWater?: boolean;
  // Load Levels overlay state
  loadLevels?: Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }>; 
  loadFilter?: 'all' | 'built-in' | 'user' | 'local';
  loadSearch?: string;
  loadSearchFocus?: boolean;
  hoverFilter?: 'all' | 'built-in' | 'user' | 'local' | null;
  hoverLevelIndex?: number | null;
  hoverBtn?: 'load' | 'cancel' | null;
  hoverSearch?: boolean;
  // DnD overlay hovers
  hoverDnDIndex?: number | null;
  hoverDnDBtn?: 'save' | 'cancel' | null;
  // Resolution
  resolve?: (value: any) => void;
  reject?: (reason?: any) => void;
  cancelable?: boolean;
  // Metadata form fields
  metaTitle?: string;
  metaAuthor?: string;
  metaPar?: string; // keep as string while editing
  metaDescription?: string;
  metaTags?: string; // comma-separated while editing
  metaFocus?: 'title' | 'author' | 'par' | 'description' | 'tags' | 'none';
  // Annotation overlay
  annotationImage?: HTMLImageElement;
  annotationCanvas?: HTMLCanvasElement;
  annotationData?: AnnotationData;
  currentTool?: 'select' | 'walls' | 'water' | 'sand' | 'hills' | 'posts' | 'fairway' | 'tee' | 'cup';
  isDrawing?: boolean;
  currentPath?: Array<{ x: number; y: number }>;
  selectedItem?: { type: string; index: number } | null;
  selectedPoint?: { itemType: string; itemIndex: number; pointIndex: number } | null;
};

let uiOverlay: UiOverlayState = { kind: 'none' };
let uiToasts: UiToast[] = [];
let toastCounter = 0;

function isOverlayActive(): boolean { return uiOverlay.kind !== 'none'; }

function showUiToast(message: string, durationMs = 2200): void {
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  uiToasts.push({ id: ++toastCounter, message, expiresAt: now + durationMs });
}

function showUiConfirm(message: string, title = 'Confirm'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    uiOverlay = { kind: 'confirm', title, message, resolve, cancelable: true };
  });
}

// Annotation overlay: allows manual tracing of level elements
export async function showAnnotateScreenshot(file: File, opts: AnnotationOptions): Promise<any | null> {
  return new Promise(async (resolve) => {
    try {
      // Load and prepare image
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        
        // Create annotation canvas
        const canvas = document.createElement('canvas');
        const maxSize = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.8);
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Initialize annotation state
        const annotationData: AnnotationData = {
          walls: [],
          water: [],
          sand: [],
          hills: [],
          posts: [],
          fairway: undefined,
          tee: undefined,
          cup: undefined
        };
        
        uiOverlay = {
          kind: 'annotateScreenshot',
          title: 'Annotate Screenshot',
          annotationImage: img,
          annotationCanvas: canvas,
          annotationData,
          currentTool: 'walls',
          isDrawing: false,
          currentPath: [],
          undoStack: [],
          resolve: (result) => {
            if (result) {
              // Convert annotations to level using new import function
              try {
                const normOpts = {
                  ...opts,
                  sourceWidth: canvas.width,
                  sourceHeight: canvas.height
                } as any;
                const level = importLevelFromAnnotations(result, normOpts);
                resolve(level);
              } catch (err) {
                console.error('Failed to import from annotations:', err);
                resolve(null);
              }
            } else {
              resolve(null);
            }
          }
        } as UiOverlayState;
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      
      img.src = url;
    } catch (e) {
      console.error('Failed to show annotation overlay:', e);
      resolve(null);
    }
  });
}

// Import Review overlay: allows reviewing detected polys and optionally clearing categories.
async function showUiImportReview(init: {
  imageData: ImageData;
  thresholds: any;
  fairway: { x: number; y: number; w: number; h: number };
  gridSize: number;
  canvas: { width: number; height: number };
  currentPolys: { wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> };
}): Promise<{ thresholds: any; polys: { wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> } } | null> {
  return new Promise(async (resolve) => {
    // Seed overlay state and eagerly compute an initial preview so Accept works even if user never hits Recompute
    const state: any = {
      kind: 'importReview',
      title: 'Import Review',
      ...init,
      clearWalls: false,
      clearSand: false,
      clearWater: false,
      loosenClicks: 0,
      resolve
    };
    try {
      if (!state.previewPolys && state.imageData && state.thresholds && state.fairway) {
        state.previewPolys = await computePolysFromThresholds(
          state.imageData,
          state.fairway,
          state.thresholds,
          Math.max(2, state.gridSize || 20),
          (state.canvas?.width) || state.imageData.width,
          (state.canvas?.height) || state.imageData.height
        );
      }
    } catch {}
    uiOverlay = state as UiOverlayState;
  });
}

function showUiPrompt(message: string, def = '', title = 'Input'): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    uiOverlay = { kind: 'prompt', title, message, inputText: def, cancelable: true, resolve };
  });
}

// Metadata form overlay
function showUiMetadataForm(init: { title: string; author: string; par: string; description?: string; tags?: string }, dialogTitle = 'Metadata') {
  return new Promise<{ title: string; author: string; par: string; description: string; tags: string } | null>((resolve) => {
    uiOverlay = {
      kind: 'metadata',
      title: dialogTitle,
      metaTitle: init.title ?? '',
      metaAuthor: init.author ?? '',
      metaPar: init.par ?? '3',
      metaDescription: init.description ?? '',
      metaTags: init.tags ?? '',
      metaFocus: 'title',
      cancelable: true,
      resolve
    } as any;
  });
}

function showUiList(title: string, items: UiListItem[], startIndex = 0): Promise<UiListItem | null> {
  console.log('showUiList called with title:', title, 'items:', items.length);
  return new Promise<UiListItem | null>((resolve) => {
    const idx = Math.max(0, Math.min(items.length - 1, startIndex));
    uiOverlay = { kind: 'list', title, listItems: items, listIndex: idx, cancelable: true, resolve };
    console.log('showUiList set uiOverlay:', JSON.stringify(uiOverlay, (key, value) => key === 'resolve' ? '[Function]' : value));
    console.log('showUiList set uiOverlay:', uiOverlay);
  });
}

// Draggable, scrollable list with explicit Save/Cancel used by Course Creator
function showUiDnDList(title: string, items: UiListItem[]): Promise<UiListItem[] | null> {
  return new Promise<UiListItem[] | null>((resolve) => {
    // Clone items to avoid mutating caller's array until Save
    const cloned = items.map(it => ({ ...it }));
    uiOverlay = { kind: 'dndList', title, listItems: cloned, dndScroll: 0, listIndex: 0, cancelable: true, resolve };
  });
}

function showUiCourseEditor(courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] }): Promise<{ action: string; courseData?: any } | null> {
  return new Promise<{ action: string; courseData?: any } | null>((resolve) => {
    uiOverlay = {
      kind: 'courseEditor',
      title: `Edit Course: ${courseData.title}`,
      courseData: { ...courseData },
      courseEditingTitle: false,
      courseNewTitle: courseData.title,
      selectedLevelIndex: -1,
      scrollOffset: 0,
      dragState: null,
      cancelable: true,
      resolve
    };
  });
}

function showUiCourseCreator(courseList: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>): Promise<{ action: string; courseData?: any } | null> {
  return new Promise<{ action: string; courseData?: any } | null>((resolve) => {
    uiOverlay = {
      kind: 'courseCreator',
      title: 'Course Creator',
      courseList: [...courseList],
      selectedCourseIndex: -1,
      courseScrollOffset: 0,
      cancelable: true,
      resolve
    };
  });
}

// Overlay input handling
function handleOverlayKey(e: KeyboardEvent) {
  if (!isOverlayActive()) return;
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  try { e.stopImmediatePropagation(); } catch {}
  const k = uiOverlay.kind;
  if (k === 'confirm') {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { uiOverlay.resolve?.(true); uiOverlay = { kind: 'none' }; return; }
    if (e.code === 'Escape') { uiOverlay.resolve?.(false); uiOverlay = { kind: 'none' }; return; }
  } else if (k === 'prompt') {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { uiOverlay.resolve?.(uiOverlay.inputText ?? ''); uiOverlay = { kind: 'none' }; return; }
    if (e.code === 'Escape') { uiOverlay.resolve?.(null); uiOverlay = { kind: 'none' }; return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      uiOverlay.inputText = (uiOverlay.inputText ?? '') + e.key;
      return;
    }
    if (e.code === 'Backspace') {
      const t = (uiOverlay.inputText ?? '');
      uiOverlay.inputText = t.slice(0, Math.max(0, t.length - 1));
      return;
    }
  } else if (k === 'annotateScreenshot') {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Complete current polygon
      if (uiOverlay.isDrawing && uiOverlay.currentPath && uiOverlay.currentPath.length >= 3) {
        const tool = uiOverlay.currentTool || 'walls';
        const data = uiOverlay.annotationData;
        if (data) {
          const polygon = { points: [...uiOverlay.currentPath] };
          
          if (tool === 'walls') {
            data.walls.push(polygon);
          } else if (tool === 'water') {
            data.water.push(polygon);
          } else if (tool === 'sand') {
            data.sand.push(polygon);
          } else if (tool === 'hills') {
            data.hills.push({ ...polygon, direction: 0 });
          } else if (tool === 'fairway') {
            data.fairway = polygon;
          }
          
          console.log(`Completed ${tool} polygon with ${uiOverlay.currentPath.length} points`);
        }
        
        // Reset drawing state
        uiOverlay.isDrawing = false;
        uiOverlay.currentPath = [];
      }
      return;
    }
    if (e.code === 'Escape') {
      if (uiOverlay.isDrawing) {
        // Cancel current polygon
        console.log('Cancelled current polygon');
        uiOverlay.isDrawing = false;
        uiOverlay.currentPath = [];
      } else if (uiOverlay.selectedItem) {
        // Clear selection
        uiOverlay.selectedItem = null;
        console.log('Cleared selection');
      } else {
        // Cancel entire annotation
        uiOverlay.resolve?.(null);
        uiOverlay = { kind: 'none' };
      }
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      // Delete selected item
      const selected = uiOverlay.selectedItem;
      const data = uiOverlay.annotationData;
      if (selected && data) {
        if (selected.type === 'posts') {
          data.posts.splice(selected.index, 1);
          console.log(`Deleted post ${selected.index}`);
        } else if (selected.type === 'tee') {
          data.tee = undefined;
          console.log('Deleted tee');
        } else if (selected.type === 'cup') {
          data.cup = undefined;
          console.log('Deleted cup');
        } else if (selected.type === 'fairway') {
          data.fairway = undefined;
          console.log('Deleted fairway');
        } else if (selected.type === 'walls') {
          data.walls.splice(selected.index, 1);
          console.log(`Deleted wall ${selected.index}`);
        } else if (selected.type === 'water') {
          data.water.splice(selected.index, 1);
          console.log(`Deleted water ${selected.index}`);
        } else if (selected.type === 'sand') {
          data.sand.splice(selected.index, 1);
          console.log(`Deleted sand ${selected.index}`);
        } else if (selected.type === 'hills') {
          data.hills.splice(selected.index, 1);
          console.log(`Deleted hill ${selected.index}`);
        }
        uiOverlay.selectedItem = null; // Clear selection after deletion
      }
      return;
    }
  } else if (k === 'list') {
    const items = uiOverlay.listItems ?? [];
    if (e.code === 'ArrowDown') { uiOverlay.listIndex = Math.min(items.length - 1, (uiOverlay.listIndex ?? 0) + 1); return; }
    if (e.code === 'ArrowUp') { uiOverlay.listIndex = Math.max(0, (uiOverlay.listIndex ?? 0) - 1); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const idx = uiOverlay.listIndex ?? 0;
      uiOverlay.resolve?.(items[idx] ?? null); uiOverlay = { kind: 'none' }; return;
    }
    if (e.code === 'Escape') { uiOverlay.resolve?.(null); uiOverlay = { kind: 'none' }; return; }
  } else if (k === 'metadata') {
    if (e.code === 'Escape') { uiOverlay.resolve?.(null); uiOverlay = { kind: 'none' }; return; }
    if (e.code === 'Tab') {
      const order: Array<typeof uiOverlay.metaFocus> = ['title','author','par','description','tags'];
      const idx = order.indexOf(uiOverlay.metaFocus || 'title');
      const next = (idx + 1) % order.length;
      uiOverlay.metaFocus = order[next];
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      uiOverlay.resolve?.({
        title: uiOverlay.metaTitle || '',
        author: uiOverlay.metaAuthor || '',
        par: uiOverlay.metaPar || '3',
        description: uiOverlay.metaDescription || '',
        tags: uiOverlay.metaTags || ''
      });
      uiOverlay = { kind: 'none' };
      return;
    }
    // Text input into the focused field
    const key = e.key;
    if (key && key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const f = uiOverlay.metaFocus || 'title';
      if (f === 'title') uiOverlay.metaTitle = (uiOverlay.metaTitle || '') + key;
      else if (f === 'author') uiOverlay.metaAuthor = (uiOverlay.metaAuthor || '') + key;
      else if (f === 'par') uiOverlay.metaPar = (uiOverlay.metaPar || '') + key;
      else if (f === 'description') uiOverlay.metaDescription = (uiOverlay.metaDescription || '') + key;
      else if (f === 'tags') uiOverlay.metaTags = (uiOverlay.metaTags || '') + key;
      return;
    }
    if (e.code === 'Backspace') {
      const f = uiOverlay.metaFocus || 'title';
      const rm1 = (s?: string) => (s ?? '').slice(0, Math.max(0, (s ?? '').length - 1));
      if (f === 'title') uiOverlay.metaTitle = rm1(uiOverlay.metaTitle);
      else if (f === 'author') uiOverlay.metaAuthor = rm1(uiOverlay.metaAuthor);
      else if (f === 'par') uiOverlay.metaPar = rm1(uiOverlay.metaPar);
      else if (f === 'description') uiOverlay.metaDescription = rm1(uiOverlay.metaDescription);
      else if (f === 'tags') uiOverlay.metaTags = rm1(uiOverlay.metaTags);
      return;
    }
  } else if (k === 'loadLevels') {
    // Keyboard handling for Load Levels overlay
    const items = uiOverlay.loadLevels ?? [];
    if (uiOverlay.loadSearchFocus) {
      if (e.code === 'Escape') { uiOverlay.loadSearchFocus = false; return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { /* keep focus but do not close */ return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { uiOverlay.loadSearch = (uiOverlay.loadSearch || '') + e.key; return; }
      if (e.code === 'Backspace') { const t = uiOverlay.loadSearch || ''; uiOverlay.loadSearch = t.slice(0, Math.max(0, t.length - 1)); return; }
      return;
    }
    // Arrow navigation and quick load
    if (e.code === 'ArrowDown') { uiOverlay.selectedLevelIndex = Math.min(items.length - 1, (uiOverlay.selectedLevelIndex ?? 0) + 1); return; }
    if (e.code === 'ArrowUp') { uiOverlay.selectedLevelIndex = Math.max(0, (uiOverlay.selectedLevelIndex ?? 0) - 1); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { const idx = uiOverlay.selectedLevelIndex ?? 0; uiOverlay.resolve?.(items[idx] ?? null); uiOverlay = { kind: 'none' }; return; }
    if (e.code === 'Escape') { uiOverlay.resolve?.(null); uiOverlay = { kind: 'none' }; return; }
  } else if (k === 'courseEditor') {
    if (uiOverlay.courseEditingTitle) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        uiOverlay.courseEditingTitle = false;
        if (uiOverlay.courseData && uiOverlay.courseNewTitle) {
          uiOverlay.courseData.title = uiOverlay.courseNewTitle;
          uiOverlay.title = `Edit Course: ${uiOverlay.courseNewTitle}`;
        }
        return;
      }
      if (e.code === 'Escape') {
        uiOverlay.courseEditingTitle = false;
        uiOverlay.courseNewTitle = uiOverlay.courseData?.title || '';
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        uiOverlay.courseNewTitle = (uiOverlay.courseNewTitle || '') + e.key;
        return;
      }
      if (e.code === 'Backspace') {
        const t = (uiOverlay.courseNewTitle || '');
        uiOverlay.courseNewTitle = t.slice(0, Math.max(0, t.length - 1));
        return;
      }
    } else {
      const levels = uiOverlay.courseData?.levelIds || [];
      if (e.code === 'ArrowDown') {
        const newIndex = Math.min(levels.length - 1, (uiOverlay.selectedLevelIndex ?? -1) + 1);
        uiOverlay.selectedLevelIndex = newIndex;
        // Auto-scroll to keep selection visible
        const rowHeight = 40;
        const maxVisibleRows = Math.floor((Math.min(600, HEIGHT - 120) - 200) / rowHeight);
        const scrollOffset = uiOverlay.scrollOffset ?? 0;
        if (newIndex >= scrollOffset + maxVisibleRows) {
          uiOverlay.scrollOffset = newIndex - maxVisibleRows + 1;
        }
        return;
      }
      if (e.code === 'ArrowUp') {
        const newIndex = Math.max(-1, (uiOverlay.selectedLevelIndex ?? -1) - 1);
        uiOverlay.selectedLevelIndex = newIndex;
        // Auto-scroll to keep selection visible
        const scrollOffset = uiOverlay.scrollOffset ?? 0;
        if (newIndex >= 0 && newIndex < scrollOffset) {
          uiOverlay.scrollOffset = newIndex;
        }
        return;
      }
      if (e.code === 'Escape') {
        uiOverlay.resolve?.(null);
        uiOverlay = { kind: 'none' };
        return;
      }
    }
  } else if (k === 'courseCreator') {
    const courses = uiOverlay.courseList || [];
    if (e.code === 'ArrowDown') {
      const newIndex = Math.min(courses.length, (uiOverlay.selectedCourseIndex ?? -1) + 1); // Allow selecting "New Course"
      uiOverlay.selectedCourseIndex = newIndex;
      // Auto-scroll to keep selection visible
      const rowHeight = 40;
      const maxVisibleRows = Math.floor((Math.min(600, HEIGHT - 120) - 200) / rowHeight);
      const scrollOffset = uiOverlay.courseScrollOffset ?? 0;
      if (newIndex >= scrollOffset + maxVisibleRows) {
        uiOverlay.courseScrollOffset = newIndex - maxVisibleRows + 1;
      }
      return;
    }
    if (e.code === 'ArrowUp') {
      const newIndex = Math.max(-1, (uiOverlay.selectedCourseIndex ?? -1) - 1);
      uiOverlay.selectedCourseIndex = newIndex;
      // Auto-scroll to keep selection visible
      const scrollOffset = uiOverlay.courseScrollOffset ?? 0;
      if (newIndex >= 0 && newIndex < scrollOffset) {
        uiOverlay.courseScrollOffset = newIndex;
      }
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const idx = uiOverlay.selectedCourseIndex ?? -1;
      if (idx === courses.length) {
        // "New Course" selected
        uiOverlay.resolve?.({ action: 'newCourse' });
        uiOverlay = { kind: 'none' };
      } else if (idx >= 0 && idx < courses.length) {
        // Existing course selected
        uiOverlay.resolve?.({ action: 'editCourse', courseData: courses[idx] });
        uiOverlay = { kind: 'none' };
      }
      return;
    }
    if (e.code === 'Escape') {
      uiOverlay.resolve?.(null);
      uiOverlay = { kind: 'none' };
      return;
    }
  } else if (k === 'dndList') {
    const items = uiOverlay.listItems ?? [];
    if (e.code === 'ArrowDown') { uiOverlay.listIndex = Math.min(items.length - 1, (uiOverlay.listIndex ?? 0) + 1); return; }
    if (e.code === 'ArrowUp') { uiOverlay.listIndex = Math.max(0, (uiOverlay.listIndex ?? 0) - 1); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Save
      uiOverlay.resolve?.(items);
      uiOverlay = { kind: 'none' };
      return;
    }
    if (e.code === 'Escape') { uiOverlay.resolve?.(null); uiOverlay = { kind: 'none' }; return; }
  }
}
// Use capture phase so we intercept before other global handlers
window.addEventListener('keydown', handleOverlayKey, true);

// Swallow keyup/keypress when an overlay is active so other global handlers don't fire
function swallowOverlayKey(e: KeyboardEvent) {
  if (!isOverlayActive()) return;
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  try { e.stopImmediatePropagation(); } catch {}
}
// Capture phase to intercept before other listeners
window.addEventListener('keyup', swallowOverlayKey, true);
window.addEventListener('keypress', swallowOverlayKey as any, true);
document.addEventListener('keypress', swallowOverlayKey as any, true);
try { canvas.addEventListener('keypress', swallowOverlayKey as any, true); } catch {}

type OverlayHotspot = { kind: 'btn' | 'listItem' | 'input' | 'drag' | 'levelItem' | 'canvas'; index?: number; action?: string; id?: string; x: number; y: number; w: number; h: number };
let overlayHotspots: OverlayHotspot[] = [];

// Course Select hotspots
type CourseSelectHotspot = { kind: 'courseItem' | 'btn'; index?: number; action?: string; x: number; y: number; w: number; h: number };
let courseSelectHotspots: CourseSelectHotspot[] = [];

function handleOverlayMouseDown(e: MouseEvent) {
  if (!isOverlayActive()) return;
  // Swallow clicks when an overlay is active so underlying UI doesn't receive them
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  const p = worldFromEvent(e);
  for (const hs of overlayHotspots) {
    if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
      if (uiOverlay.kind === 'confirm' && hs.kind === 'btn') {
        const isOk = hs.index === 0; // 0: OK, 1: Cancel
        uiOverlay.resolve?.(!!isOk);
        uiOverlay = { kind: 'none' };
        return;
      }
      if (uiOverlay.kind === 'prompt') {
        if (hs.kind === 'btn') {
          const isOk = hs.index === 0;
          uiOverlay.resolve?.(isOk ? (uiOverlay.inputText ?? '') : null);
          uiOverlay = { kind: 'none' };
          return;
        }
        if (hs.kind === 'input') {
          // focusing is implicit; typing handled by key handler
          return;
        }
      }
      if (uiOverlay.kind === 'importReview') {
        if (hs.kind === 'btn') {
          const a = hs.action || '';
          const o: any = uiOverlay as any;
          const applyToggle = (key: 'showWalls'|'showSand'|'showWater') => { o[key] = !(o[key] !== false); };
          const nudgeThresholds = (looser: boolean) => {
            const t = o.thresholds || buildDefaultThresholds();
            const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
            const clamp360 = (v: number) => Math.max(0, Math.min(360, v));
            // Slightly larger nudge so users see an effect per click
            const dH = looser ? 12 : -12;
            const dS = looser ? 0.05 : -0.05;
            const dV = looser ? 0.05 : -0.05;
            // Fairway
            t.fairway.hMin = clamp360(t.fairway.hMin - dH);
            t.fairway.hMax = clamp360(t.fairway.hMax + dH);
            t.fairway.sMin = clamp01(t.fairway.sMin - dS);
            t.fairway.vMin = clamp01(t.fairway.vMin - dV);
            // Water
            t.water.hMin = clamp360(t.water.hMin - dH);
            t.water.hMax = clamp360(t.water.hMax + dH);
            t.water.sMin = clamp01(t.water.sMin - dS);
            t.water.vMin = clamp01(t.water.vMin - dV);
            // Sand
            t.sand.hMin = clamp360(t.sand.hMin - dH);
            t.sand.hMax = clamp360(t.sand.hMax + dH);
            t.sand.sMin = clamp01(t.sand.sMin - dS);
            t.sand.vMin = clamp01(t.sand.vMin - dV);
            // Walls (gray/low sat high val)
            t.walls.sMax = clamp01(t.walls.sMax + (looser ? dS : -dS));
            t.walls.vMin = clamp01(t.walls.vMin - dV);
            o.thresholds = t;
          };
          const recompute = async () => {
            try {
              const img: ImageData | undefined = o.imageData;
              if (!img) return;
              const fair = o.fairway || { x: 0, y: 0, w: img.width, h: img.height };
              const grid = o.gridSize || 20;
              const cw = o.canvas?.width || img.width;
              const ch = o.canvas?.height || img.height;
              if (o.thresholds) {
                o.previewPolys = await computePolysFromThresholds(img, fair, o.thresholds, grid, cw, ch);
              }
              o.lastRecomputeAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            } catch {}
          };
          if (a === 'toggle_walls') { applyToggle('showWalls'); return; }
          if (a === 'toggle_sand') { applyToggle('showSand'); return; }
          if (a === 'toggle_water') { applyToggle('showWater'); return; }
          if (a === 'looser') { nudgeThresholds(true); recompute().catch(console.error); return; }
          if (a === 'stricter') { nudgeThresholds(false); recompute().catch(console.error); return; }
          if (a === 'recompute') { recompute().catch(console.error); return; }
          if (a === 'accept') {
            const polys0 = (o.previewPolys || o.currentPolys) || { wallsPoly: [], sandPoly: [], waterPoly: [] };
            // Honor visibility toggles: if a layer is hidden in the review, exclude it on Accept
            const polys = {
              wallsPoly: (o.showWalls === false) ? [] : (polys0.wallsPoly || []),
              sandPoly:  (o.showSand  === false) ? [] : (polys0.sandPoly  || []),
              waterPoly: (o.showWater === false) ? [] : (polys0.waterPoly || [])
            };
            uiOverlay.resolve?.({ thresholds: o.thresholds, polys });
            uiOverlay = { kind: 'none' } as any;
            return;
          }
          if (a === 'cancel') {
            uiOverlay.resolve?.(null);
            uiOverlay = { kind: 'none' } as any;
            return;
          }
        }
        return;
      }
      if (uiOverlay.kind === 'annotateScreenshot') {
        if (hs.kind === 'btn') {
          const action = hs.action || '';
          if (action.startsWith('tool_')) {
            // Tool selection
            const tool = action.replace('tool_', '') as any;
            uiOverlay.currentTool = tool;
            return;
          }
          if (action === 'clear_all') {
            // Clear all annotations
            if (uiOverlay.annotationData) {
              uiOverlay.annotationData = {
                walls: [], water: [], sand: [], hills: [], posts: [],
                fairway: undefined, tee: undefined, cup: undefined
              };
            }
            // Also cancel any current drawing and clear selection
            uiOverlay.isDrawing = false;
            uiOverlay.currentPath = [];
            uiOverlay.selectedItem = null;
            console.log('Cleared all annotations');
            return;
          }
          if (action === 'delete_selected') {
            // Delete the selected item
            const selected = uiOverlay.selectedItem;
            const data = uiOverlay.annotationData;
            if (selected && data) {
              if (selected.type === 'posts') {
                data.posts.splice(selected.index, 1);
                console.log(`Deleted post ${selected.index}`);
              } else if (selected.type === 'tee') {
                data.tee = undefined;
                console.log('Deleted tee');
              } else if (selected.type === 'cup') {
                data.cup = undefined;
                console.log('Deleted cup');
              } else if (selected.type === 'fairway') {
                data.fairway = undefined;
                console.log('Deleted fairway');
              } else if (selected.type === 'walls') {
                data.walls.splice(selected.index, 1);
                console.log(`Deleted wall ${selected.index}`);
              } else if (selected.type === 'water') {
                data.water.splice(selected.index, 1);
                console.log(`Deleted water ${selected.index}`);
              } else if (selected.type === 'sand') {
                data.sand.splice(selected.index, 1);
                console.log(`Deleted sand ${selected.index}`);
              } else if (selected.type === 'hills') {
                data.hills.splice(selected.index, 1);
                console.log(`Deleted hill ${selected.index}`);
              }
              uiOverlay.selectedItem = null; // Clear selection after deletion
            }
            return;
          }
          if (action === 'accept') {
            // Accept annotations and create level
            const annotationData = uiOverlay.annotationData || {
              walls: [], water: [], sand: [], hills: [], posts: [],
              fairway: undefined, tee: undefined, cup: undefined
            };
            uiOverlay.resolve?.(annotationData);
            uiOverlay = { kind: 'none' };
            return;
          }
          if (action === 'cancel') {
            // Cancel annotation
            uiOverlay.resolve?.(null);
            uiOverlay = { kind: 'none' };
            return;
          }
        }
        if (hs.kind === 'canvas') {
          // Canvas interaction functionality
          const tool = uiOverlay.currentTool || 'walls';
          const canvasInfo = (uiOverlay as any).canvasInfo;
          if (!canvasInfo) return;
          
          // Convert screen coordinates to image coordinates
          const p = worldFromEvent(e);
          const canvasX = (p.x - canvasInfo.x) / canvasInfo.scale;
          const canvasY = (p.y - canvasInfo.y) / canvasInfo.scale;
          
          // Ensure we have annotation data
          if (!uiOverlay.annotationData) {
            uiOverlay.annotationData = {
              walls: [], water: [], sand: [], hills: [], posts: [],
              fairway: undefined, tee: undefined, cup: undefined
            };
          }
          
          const data = uiOverlay.annotationData;
          
          if (tool === 'select') {
            // Selection mode - use improved selection logic from importScreenshot module
            const selected = findAnnotationAtPoint(data, canvasX, canvasY, 10);
            
            if (selected) {
              uiOverlay.selectedItem = selected;
              console.log(`Selected ${selected.type} ${selected.index}`);
            } else {
              uiOverlay.selectedItem = null;
              console.log('Nothing selected');
            }
            
          } else {
            // Drawing mode - existing functionality
            if (tool === 'tee') {
              // Single click to place tee
              data.tee = { x: canvasX, y: canvasY, r: 8 };
              console.log(`Placed tee at (${Math.round(canvasX)}, ${Math.round(canvasY)})`);
            } else if (tool === 'cup') {
              // Single click to place cup
              data.cup = { x: canvasX, y: canvasY, r: 12 };
              console.log(`Placed cup at (${Math.round(canvasX)}, ${Math.round(canvasY)})`);
            } else if (tool === 'posts') {
              // Single click to place post
              data.posts.push({ x: canvasX, y: canvasY, r: 6 });
              console.log(`Added post at (${Math.round(canvasX)}, ${Math.round(canvasY)})`);
            } else {
              // Polygon tools (walls, water, sand, hills, fairway)
              if (!uiOverlay.isDrawing) {
                // Start new polygon
                uiOverlay.isDrawing = true;
                uiOverlay.currentPath = [{ x: canvasX, y: canvasY }];
                console.log(`Started drawing ${tool} polygon`);
              } else {
                // Add point to current polygon
                if (uiOverlay.currentPath) {
                  uiOverlay.currentPath.push({ x: canvasX, y: canvasY });
                  console.log(`Added point to ${tool} polygon: (${Math.round(canvasX)}, ${Math.round(canvasY)})`);
                }
              }
            }
          }
          return;
        }
        return;
      }
      if (uiOverlay.kind === 'list') {
        if (hs.kind === 'listItem' && typeof hs.index === 'number') {
          const items = uiOverlay.listItems ?? [];
          const item = items[hs.index];
          if (item && !item.disabled) {
            uiOverlay.resolve?.(item);
            uiOverlay = { kind: 'none' };
          }
          return;
        }
        if (hs.kind === 'btn') {
          // Cancel button
          uiOverlay.resolve?.(null);
          uiOverlay = { kind: 'none' };
          return;
        }
      }
      if (uiOverlay.kind === 'dndList') {
        if (hs.kind === 'listItem' && typeof hs.index === 'number') {
          // Begin drag for this item
          uiOverlay.dndDragIndex = hs.index;
          uiOverlay.dndPointerY = p.y;
          uiOverlay.dndTargetIndex = hs.index;
          return;
        }
        if (hs.kind === 'btn' && typeof hs.index === 'number') {
          const isSave = hs.index === 0; // 0: Save, 1: Cancel
          if (isSave) {
            uiOverlay.resolve?.(uiOverlay.listItems ?? []);
          } else {
            uiOverlay.resolve?.(null);
          }
          uiOverlay = { kind: 'none' };
          return;
        }
      }
      if (uiOverlay.kind === 'metadata') {
        if (hs.kind === 'btn' && typeof hs.index === 'number') {
          const isSave = hs.index === 0; // 0: Save, 1: Cancel
          if (isSave) {
            uiOverlay.resolve?.({
              title: uiOverlay.metaTitle || '',
              author: uiOverlay.metaAuthor || '',
              par: uiOverlay.metaPar || '3',
              description: uiOverlay.metaDescription || '',
              tags: uiOverlay.metaTags || ''
            });
          } else {
            uiOverlay.resolve?.(null);
          }
          uiOverlay = { kind: 'none' };
          return;
        }
        if (hs.kind === 'input' && typeof hs.index === 'number') {
          const order = ['title','author','par','description','tags'] as const;
          const idx = Math.max(0, Math.min(order.length - 1, hs.index));
          uiOverlay.metaFocus = order[idx];
          return;
        }
      }
      if (uiOverlay.kind === 'courseEditor') {
        if (hs.kind === 'btn') {
          const action = hs.action || '';
          if (action === 'renameCourse') {
            uiOverlay.courseEditingTitle = true;
            return;
          }
          if (action === 'addLevel') {
            uiOverlay.resolve?.({ action: 'addLevel', courseData: uiOverlay.courseData });
            uiOverlay = { kind: 'none' };
            return;
          }
          if (action === 'removeLevel') {
            const idx = uiOverlay.selectedLevelIndex ?? -1;
            if (idx >= 0) {
              uiOverlay.resolve?.({ action: 'removeLevel', levelIndex: idx, courseData: uiOverlay.courseData });
              uiOverlay = { kind: 'none' };
            }
            return;
          }
          if (action === 'deleteCourse') {
            uiOverlay.resolve?.({ action: 'deleteCourse', courseData: uiOverlay.courseData });
            uiOverlay = { kind: 'none' };
            return;
          }
          if (action === 'save') {
            uiOverlay.resolve?.({ action: 'save', courseData: uiOverlay.courseData });
            uiOverlay = { kind: 'none' };
            return;
          }
          if (action === 'cancel') {
            uiOverlay.resolve?.({ action: 'cancel' });
            uiOverlay = { kind: 'none' };
            return;
          }
        }
        if (hs.kind === 'levelItem' && typeof hs.index === 'number') {
          uiOverlay.selectedLevelIndex = hs.index;
          // Start drag state for reordering
          uiOverlay.dragState = {
            dragIndex: hs.index,
            startY: e.clientY,
            currentY: e.clientY,
            isDragging: false
          };
          return;
        }
      }
      if (uiOverlay.kind === 'courseCreator') {
        if (hs.kind === 'btn') {
          const action = hs.action || '';
          if (action === 'newCourse') {
            uiOverlay.resolve?.({ action: 'newCourse' });
            uiOverlay = { kind: 'none' };
            return;
          }
          if (action === 'editCourse') {
            const idx = uiOverlay.selectedCourseIndex ?? -1;
            const courses = uiOverlay.courseList || [];
            if (idx >= 0 && idx < courses.length) {
              uiOverlay.resolve?.({ action: 'editCourse', courseData: courses[idx] });
              uiOverlay = { kind: 'none' };
            }
            return;
          }
          if (action === 'deleteCourse') {
            const idx = uiOverlay.selectedCourseIndex ?? -1;
            const courses = uiOverlay.courseList || [];
            if (idx >= 0 && idx < courses.length) {
              uiOverlay.resolve?.({ action: 'deleteCourse', courseData: courses[idx] });
              uiOverlay = { kind: 'none' };
            }
            return;
          }
          if (action === 'cancel') {
            uiOverlay.resolve?.(null);
            uiOverlay = { kind: 'none' };
            return;
          }
        }
        if (hs.kind === 'listItem' && typeof hs.index === 'number') {
          uiOverlay.selectedCourseIndex = hs.index;
          return;
        }
      }
      if (uiOverlay.kind === 'loadLevels') {
        // Click into search field
        if (hs.kind === 'input' && hs.id === 'loadSearch') {
          uiOverlay.loadSearchFocus = true;
          return;
        }
        // Clicking elsewhere clears search focus
        uiOverlay.loadSearchFocus = false;
        if (hs.kind === 'btn') {
          const action = hs.action || '';
          if (action.startsWith('filter_')) {
            const f = action.replace('filter_', '') as any;
            uiOverlay.loadFilter = f;
            // Reset scrolling and selection when filter changes
            uiOverlay.scrollOffset = 0;
            uiOverlay.selectedLevelIndex = 0;
            return;
          }
          if (action === 'load') {
            const all = uiOverlay.loadLevels ?? [];
            const idx = uiOverlay.selectedLevelIndex ?? 0;
            uiOverlay.resolve?.(all[idx] ?? null);
            uiOverlay = { kind: 'none' };
            return;
          }
          if (action === 'cancel') {
            uiOverlay.resolve?.(null);
            uiOverlay = { kind: 'none' };
            return;
          }
        }
        if (hs.kind === 'levelItem' && typeof hs.index === 'number') {
          uiOverlay.selectedLevelIndex = hs.index;
          return;
        }
      }
      // Drag start (title bar)
      if (hs.kind === 'drag') {
        uiOverlay.dragActive = true;
        uiOverlay.dragOffsetX = p.x - hs.x;
        uiOverlay.dragOffsetY = p.y - hs.y;
        // Initialize position if not set
        if (typeof uiOverlay.posX !== 'number') uiOverlay.posX = hs.x;
        if (typeof uiOverlay.posY !== 'number') uiOverlay.posY = hs.y;
        return;
      }
    }
  }
}
// Ensure overlay clicks are handled before underlying UI by using capture phase
canvas.addEventListener('mousedown', handleOverlayMouseDown, { capture: true });
canvas.addEventListener('mousemove', handleOverlayMouseMove, { capture: true });

function handleOverlayMouseMove(e: MouseEvent) {
  if (!isOverlayActive()) return;
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  const p = worldFromEvent(e);
  // Overlay panel dragging
  if (uiOverlay.dragActive) {
    const panelW = Math.min(640, WIDTH - 80);
    const margin = 20;
    let px = p.x - (uiOverlay.dragOffsetX ?? 0);
    let py = p.y - (uiOverlay.dragOffsetY ?? 0);
    px = Math.max(margin, Math.min(WIDTH - panelW - margin, px));
    py = Math.max(margin, Math.min(HEIGHT - 120, py));
    uiOverlay.posX = px;
    uiOverlay.posY = py;
  }
  // DnD list dragging logic
  if (uiOverlay.kind === 'dndList' && typeof uiOverlay.dndDragIndex === 'number') {
    uiOverlay.dndPointerY = p.y;
    // Determine target index by inspecting visible listItem hotspots
    let target: number | null = null;
    for (const hs of overlayHotspots) {
      if (hs.kind === 'listItem') {
        const mid = hs.y + hs.h / 2;
        if (p.y < mid && p.y >= hs.y - 2 && p.y <= hs.y + hs.h + 2) {
          target = Math.max(0, (hs.index ?? 0));
          break;
        }
        if (p.y >= mid && p.y <= hs.y + hs.h + 6) {
          target = Math.min((uiOverlay.listItems?.length ?? 1), (hs.index ?? 0) + 1);
        }
      }
    }
    if (target !== null) uiOverlay.dndTargetIndex = target;
  }
  // Overlay hover tracking (loadLevels, dndList)
  if (uiOverlay.kind === 'loadLevels') {
    uiOverlay.hoverFilter = undefined;
    uiOverlay.hoverSearch = false;
    uiOverlay.hoverLevelIndex = undefined;
    uiOverlay.hoverBtn = undefined;
    for (const hs of overlayHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'btn' && (hs.action || '').startsWith('filter_')) {
          const filt = (hs.action || '').replace('filter_', '') as 'all' | 'built-in' | 'user' | 'local';
          uiOverlay.hoverFilter = filt;
        } else if (hs.kind === 'input' && hs.id === 'loadSearch') {
          uiOverlay.hoverSearch = true;
        } else if (hs.kind === 'levelItem' && typeof hs.index === 'number') {
          uiOverlay.hoverLevelIndex = hs.index;
        } else if (hs.kind === 'btn') {
          const a = hs.action || '';
          if (a === 'load' || a === 'cancel') uiOverlay.hoverBtn = a;
        }
        break;
      }
    }
  } else if (uiOverlay.kind === 'dndList') {
    uiOverlay.hoverDnDIndex = undefined;
    uiOverlay.hoverDnDBtn = undefined;
    for (const hs of overlayHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'listItem' && typeof hs.index === 'number') {
          uiOverlay.hoverDnDIndex = hs.index;
        }
        if (hs.kind === 'btn' && typeof hs.index === 'number') {
          uiOverlay.hoverDnDBtn = hs.index === 0 ? 'save' : 'cancel';
        }
        break;
      }
    }
  }
  // Course Editor drag-and-drop logic
  if (uiOverlay.kind === 'courseEditor' && uiOverlay.dragState) {
    const dragState = uiOverlay.dragState;
    dragState.currentY = e.clientY;
    const dragDistance = Math.abs(dragState.currentY - dragState.startY);
    if (dragDistance > 5 && !dragState.isDragging) {
      dragState.isDragging = true;
    }
    if (dragState.isDragging) {
      // Determine target index by inspecting visible levelItem hotspots
      let target: number | null = null;
      for (const hs of overlayHotspots) {
        if (hs.kind === 'levelItem') {
          const mid = hs.y + hs.h / 2;
          if (p.y < mid && p.y >= hs.y - 2 && p.y <= hs.y + hs.h + 2) {
            target = Math.max(0, (hs.index ?? 0));
            break;
          }
          if (p.y >= mid && p.y <= hs.y + hs.h + 6) {
            const levels = uiOverlay.courseData?.levelIds || [];
            target = Math.min(levels.length, (hs.index ?? 0) + 1);
          }
        }
      }
      if (target !== null && target !== dragState.dragIndex) {
        dragState.targetIndex = target;
      }
    }
  }
}


function handleOverlayMouseUp(e: MouseEvent) {
  if (!isOverlayActive()) return;
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  if (uiOverlay.dragActive) {
    uiOverlay.dragActive = false;
  }
  if (uiOverlay.kind === 'dndList' && typeof uiOverlay.dndDragIndex === 'number') {
    const from = uiOverlay.dndDragIndex;
    let to = typeof uiOverlay.dndTargetIndex === 'number' ? uiOverlay.dndTargetIndex : from;
    const items = uiOverlay.listItems ?? [];
    if (to < 0) to = 0;
    if (to > items.length) to = items.length;
    if (from !== to && items.length > 0) {
      const copy = items.slice();
      const [moved] = copy.splice(from, 1);
      copy.splice(to > from ? to - 1 : to, 0, moved);
      uiOverlay.listItems = copy;
    }
    uiOverlay.dndDragIndex = undefined;
    uiOverlay.dndTargetIndex = undefined;
    uiOverlay.dndPointerY = undefined;
  }
  // Course Editor drag-and-drop completion
  if (uiOverlay.kind === 'courseEditor' && uiOverlay.dragState) {
    const dragState = uiOverlay.dragState;
    if (dragState.isDragging && typeof dragState.targetIndex === 'number') {
      const from = dragState.dragIndex;
      const to = dragState.targetIndex;
      const courseData = uiOverlay.courseData;
      if (courseData && from !== to) {
        // Reorder level IDs and titles
        const levelIds = [...courseData.levelIds];
        const levelTitles = [...courseData.levelTitles];
        const [movedId] = levelIds.splice(from, 1);
        const [movedTitle] = levelTitles.splice(from, 1);
        const insertIndex = to > from ? to - 1 : to;
        levelIds.splice(insertIndex, 0, movedId);
        levelTitles.splice(insertIndex, 0, movedTitle);
        courseData.levelIds = levelIds;
        courseData.levelTitles = levelTitles;
        // Update selected index to follow the moved item
        uiOverlay.selectedLevelIndex = insertIndex;
      }
    }
    uiOverlay.dragState = null;
  }
}
canvas.addEventListener('mouseup', handleOverlayMouseUp, { capture: true });

// Type adapter to convert between Firebase and main app Level formats
function adaptFirebaseLevelToMain(firebaseLevel: any): Level {
  const level = { ...firebaseLevel };
  
  // Convert polygon points from Firebase format {x,y}[] to main app format number[]
  const normalizePoly = (arr: any[]) => arr.map((poly: any) => {
    const pts = poly?.points ?? [];
    if (Array.isArray(pts) && pts.length > 0 && typeof pts[0] === 'number') {
      // Already number[]
      return { points: pts };
    }
    // Assume array of {x,y}
    return { points: Array.isArray(pts) ? pts.flatMap((p: any) => [p.x, p.y]) : [] };
  });
  if (Array.isArray(level.wallsPoly)) level.wallsPoly = normalizePoly(level.wallsPoly);
  if (Array.isArray(level.waterPoly)) level.waterPoly = normalizePoly(level.waterPoly);
  if (Array.isArray(level.sandPoly)) level.sandPoly = normalizePoly(level.sandPoly);
  // Normalize posts radius property for engine (expects r)
  if (Array.isArray(level.posts)) {
    level.posts = level.posts.map((p: any) => ({ ...p, r: (p?.r ?? p?.radius ?? 8) }));
  }
  // Ensure cup radius is provided
  if (level.cup && typeof level.cup.r !== 'number') {
    level.cup.r = 12;
  }
  
  // Ensure required fields exist
  if (!level.course) level.course = { index: 1, total: 1, title: level.meta?.title || 'Untitled' };
  if (!level.par) level.par = level.meta?.par || 3;
  
  return level;
}

function adaptMainLevelToFirebase(mainLevel: Level): any {
  const level = { ...mainLevel };
  
  // Convert polygon points from main app format number[] to Firebase format {x,y}[]
  if (level.wallsPoly) {
    (level as any).wallsPoly = level.wallsPoly.map((poly: any) => {
      const points = [];
      for (let i = 0; i < poly.points.length; i += 2) {
        points.push({ x: poly.points[i], y: poly.points[i + 1] });
      }
      return { points };
    });
  }
  if (level.waterPoly) {
    (level as any).waterPoly = level.waterPoly.map((poly: any) => {
      const points = [];
      for (let i = 0; i < poly.points.length; i += 2) {
        points.push({ x: poly.points[i], y: poly.points[i + 1] });
      }
      return { points };
    });
  }
  if (level.sandPoly) {
    (level as any).sandPoly = level.sandPoly.map((poly: any) => {
      const points = [];
      for (let i = 0; i < poly.points.length; i += 2) {
        points.push({ x: poly.points[i], y: poly.points[i + 1] });
      }
      return { points };
    });
  }
  
  // Move course/par info to meta
  if (!level.meta) level.meta = {} as any;
  (level.meta as any).title = level.course?.title;
  (level.meta as any).par = level.par;
  
  return level;
}

// Level storage now handled by Firebase
async function readLevelsDoc(): Promise<LevelsDocV1> {
  if (!firebaseReady) return { version: 1, levels: [] };
  
  try {
    const userId = (userProfile.role === 'admin') ? undefined : getUserId();
    const levelEntries = await firebaseManager.levels.getAllLevels(userId);
    const savedLevels: SavedLevelV1[] = levelEntries.map(entry => ({
      id: entry.name,
      level: adaptFirebaseLevelToMain(entry.data)
    }));
    return { version: 1, levels: savedLevels };
  } catch (error) {
    console.error('Failed to read levels from Firebase:', error);
    return { version: 1, levels: [] };
  }
}

async function writeLevelsDoc(doc: LevelsDocV1): Promise<void> {
  if (!firebaseReady) return;
  
  try {
    // Save each level to Firebase
    const userId = getUserId();
    for (const savedLevel of doc.levels) {
      const firebaseLevel = adaptMainLevelToFirebase(savedLevel.level);
      await firebaseManager.levels.saveLevel(firebaseLevel, savedLevel.id, userId);
    }
  } catch (error) {
    console.error('Failed to write levels to Firebase:', error);
  }
}

// Filesystem operations
async function scanFilesystemLevels(): Promise<LevelEntry[]> {
  // Only available during development builds to avoid 404s in production
  if (!isDevBuild()) {
    return [];
  }
  try {
    const levels: LevelEntry[] = [];
    
    // Known level files to try loading (fallback for dev mode)
    const knownLevels = [
      'level1.json', 'level2.json', 'level3.json', 'level4.json', 
      'level5.json', 'level6.json', 'level7.json', 'level8.json'
    ];
    
    // First try to scan directory (works in production)
    try {
      const response = await fetch('/levels/');
      if (response.ok) {
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = doc.querySelectorAll('a[href$=".json"]');
        
        if (links.length > 0) {
          console.log('Using directory listing for filesystem levels');
          for (const link of links) {
            const href = link.getAttribute('href');
            if (!href || href === 'course.json') continue;
            
            try {
              const levelData = await loadFilesystemLevel(href);
              if (levelData) {
                const id = `fs_${href.replace('.json', '')}`;
                levels.push({
                  id,
                  level: levelData,
                  source: 'filesystem',
                  filename: href
                });
              }
            } catch (error) {
              console.warn(`Failed to load level ${href}:`, error);
            }
          }
          return levels;
        }
      }
    } catch (error) {
      console.log('Directory listing failed, trying known level files');
    }
    
    // Fallback: try known level files directly
    console.log('Using known level files for filesystem scanning');
    for (const filename of knownLevels) {
      try {
        const levelData = await loadFilesystemLevel(filename);
        if (levelData) {
          const id = `fs_${filename.replace('.json', '')}`;
          levels.push({
            id,
            level: levelData,
            source: 'filesystem',
            filename
          });
        }
      } catch (error) {
        // Silently continue - level file doesn't exist
      }
    }
    
    console.log(`Found ${levels.length} filesystem levels`);
    return levels;
  } catch (error) {
    console.warn('Failed to scan filesystem levels:', error);
    return [];
  }
}

async function loadFilesystemLevel(filename: string): Promise<Level | null> {
  try {
    const response = await fetch(`/levels/${filename}`);
    if (!response.ok) return null;
    
    const levelData = await response.json() as Level;
    
    // Schema validation
    const validation = validateLevelSchema(levelData);
    if (!validation.valid) {
      console.warn(`Invalid level schema in ${filename}:`, validation.errors);
      return null;
    }
    
    return levelData;
  } catch (error) {
    console.warn(`Failed to load filesystem level ${filename}:`, error);
    return null;
  }
}

async function saveFilesystemLevel(level: Level, filename: string, userDirectory?: boolean): Promise<boolean> {
  try {
    // Determine save path based on user preference
    let suggestedPath = filename;
    if (userDirectory && userProfile.name) {
      const sanitizedUsername = userProfile.name.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
      suggestedPath = `User_Levels/${sanitizedUsername}/${filename}`;
    }
    
    // In a real filesystem integration, this would write to the actual filesystem
    // For now, we'll use the File System Access API if available, or fall back to download
    
    if ('showSaveFilePicker' in window) {
      // Use File System Access API
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Level files',
          accept: { 'application/json': ['.json'] }
        }]
      });
      
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(level, null, 2));
      await writable.close();
      
      console.log(`Level saved via File System Access API: ${filename}`);
      return true;
    } else {
      // Fall back to download with suggested directory structure in filename
      const downloadFilename = userDirectory ? suggestedPath.replace(/\//g, '_') : filename;
      const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log(`Level downloaded as: ${downloadFilename}`);
      return true;
    }
  } catch (error) {
    console.warn(`Failed to save filesystem level ${filename}:`, error);
    return false;
  }
}

// Combined level operations
async function getAllLevels(): Promise<LevelEntry[]> {
  const allLevels: LevelEntry[] = [];
  
  // Get Firebase levels
  if (firebaseReady) {
    try {
      const userId = (userProfile.role === 'admin') ? undefined : getUserId();
      const firebaseLevels = await firebaseManager.levels.getAllLevels(userId);
      for (const levelEntry of firebaseLevels) {
        allLevels.push({
          id: levelEntry.name,
          level: adaptFirebaseLevelToMain(levelEntry.data),
          source: 'firebase'
        });
      }
    } catch (error) {
      console.error('Failed to get Firebase levels:', error);
    }
  }
  
  // Get filesystem levels (cached)
  if (!filesystemCacheValid) {
    filesystemLevelsCache = await scanFilesystemLevels();
    filesystemCacheValid = true;
  }
  
  allLevels.push(...filesystemLevelsCache);
  
  return allLevels;
}

function invalidateFilesystemCache(): void {
  filesystemCacheValid = false;
}

// Schema validation
function validateLevelSchema(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data || typeof data !== 'object') {
    errors.push('Level data must be an object');
    return { valid: false, errors };
  }
  
  // Required fields
  if (!data.canvas || typeof data.canvas !== 'object') {
    errors.push('Missing or invalid canvas field');
  } else {
    if (typeof data.canvas.width !== 'number' || data.canvas.width <= 0) {
      errors.push('Canvas width must be a positive number');
    }
    if (typeof data.canvas.height !== 'number' || data.canvas.height <= 0) {
      errors.push('Canvas height must be a positive number');
    }
  }
  
  if (!data.tee || typeof data.tee !== 'object') {
    errors.push('Missing or invalid tee field');
  } else {
    if (typeof data.tee.x !== 'number' || typeof data.tee.y !== 'number') {
      errors.push('Tee position must have numeric x and y coordinates');
    }
  }
  
  if (!data.cup || typeof data.cup !== 'object') {
    errors.push('Missing or invalid cup field');
  } else {
    if (typeof data.cup.x !== 'number' || typeof data.cup.y !== 'number') {
      errors.push('Cup position must have numeric x and y coordinates');
    }
    if (data.cup.r !== undefined && (typeof data.cup.r !== 'number' || data.cup.r <= 0)) {
      errors.push('Cup radius must be a positive number');
    }
  }
  
  // Optional but validated if present
  if (data.par !== undefined && (typeof data.par !== 'number' || data.par < 1)) {
    errors.push('Par must be a positive number');
  }
  
  // Validate arrays if present
  const arrayFields = ['walls', 'wallsPoly', 'posts', 'bridges', 'water', 'waterPoly', 'sand', 'sandPoly', 'hills', 'decorations'];
  for (const field of arrayFields) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      errors.push(`${field} must be an array if present`);
    }
  }
  
  // Validate wall objects
  if (Array.isArray(data.walls)) {
    data.walls.forEach((wall: any, i: number) => {
      if (!wall || typeof wall !== 'object') {
        errors.push(`Wall ${i} must be an object`);
      } else {
        const requiredFields = ['x', 'y', 'w', 'h'];
        for (const field of requiredFields) {
          if (typeof wall[field] !== 'number') {
            errors.push(`Wall ${i} missing or invalid ${field}`);
          }
        }
      }
    });
  }
  
  // Validate posts
  if (Array.isArray(data.posts)) {
    data.posts.forEach((post: any, i: number) => {
      if (!post || typeof post !== 'object') {
        errors.push(`Post ${i} must be an object`);
      } else {
        if (typeof post.x !== 'number' || typeof post.y !== 'number' || typeof post.r !== 'number') {
          errors.push(`Post ${i} must have numeric x, y, and r fields`);
        }
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}

// Load levels from Firebase for Load Levels overlay
async function loadLevelsFromFirebase(): Promise<Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }>> {
  if (!firebaseReady) {
    console.warn('Firebase not ready; cannot load levels from Firebase');
    return [];
  }
  
  try {
    // Load levels from Firebase
    const levels = await firebaseManager.levels.getAllLevels(undefined);
    
    // Convert Firebase levels to Load Levels format
    const levelList: Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }> = levels.map(level => ({
      id: level.name,
      title: level.title,
      author: level.author,
      source: 'cloud',
      data: adaptFirebaseLevelToMain(level.data),
      lastModified: level.lastModified
    }));
    
    return levelList;
  } catch (error) {
    console.error('Failed to load levels from Firebase:', error);
    return [];
  }
}

// Show Load Levels overlay
function showUiLoadLevels(levels: Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }>): Promise<any> {
  return new Promise((resolve) => {
    uiOverlay = {
      kind: 'loadLevels',
      title: 'Load Levels',
      loadLevels: levels,
      loadFilter: 'all',
      selectedLevelIndex: 0,
      loadSearch: '',
      loadSearchFocus: false,
      hoverFilter: null,
      hoverLevelIndex: null,
      hoverBtn: null,
      hoverSearch: false,
      resolve
    };
  });
}

// (removed accidental LevelEditorEnv type/init block)

// Users Admin UI hotspots (rebuilt every frame while in users screen)
type UiHotspot = {
  kind: 'drag' | 'input' | 'btn' | 'listItem' | 'levelItem';
  x: number; y: number; w: number; h: number;
  index?: number;
  action?: string;
  id?: string;
};

type UsersHotspot = {
  kind: 'back' | 'addUser' | 'addAdmin' | 'export' | 'import' | 'promote' | 'demote' | 'enable' | 'disable' | 'remove' | 'listItem' | 'search';
  x: number; y: number; w: number; h: number;
  id?: string;
  index?: number;
};

let usersUiHotspots: UsersHotspot[] = [];

// Admin Menu state and hotspots
type AdminMenuHotspot = {
  kind: 'levelManagement' | 'userManagement' | 'gameSettings' | 'back';
  x: number; y: number; w: number; h: number;
};
let adminMenuHotspots: AdminMenuHotspot[] = [];

// Admin Game Settings state
type GameSettingsField = 'slope' | 'friction' | 'sand' | 'baseline' | 'turnPenalty' | 'hillBump' | 'bankWeight';
type GameSettingsHotspot = { kind: 'minus' | 'plus' | 'slider' | 'save' | 'cancel' | 'back'; field?: GameSettingsField; x: number; y: number; w: number; h: number };
let gameSettingsHotspots: GameSettingsHotspot[] = [];
let gameSettingsState: { slopeAccel: number; frictionK: number; sandMultiplier: number; baselineShotPx: number; turnPenaltyPerTurn: number; hillBump: number; bankWeight: number } = {
  slopeAccel: 720,
  frictionK: 1.2,
  sandMultiplier: 6.0,
  baselineShotPx: 320,
  turnPenaltyPerTurn: 0.08,
  hillBump: 0.2,
  bankWeight: 0.12
};

// Level Management state and hotspots
type LevelManagementHotspot = {
  kind: 'back' | 'delete' | 'levelItem';
  x: number; y: number; w: number; h: number;
  levelId?: string;
};

let levelManagementHotspots: LevelManagementHotspot[] = [];
let levelManagementState = {
  selectedLevelIndex: -1,
  scrollOffset: 0,
  levels: [] as Array<{ id: string; title: string; author: string; authorId?: string; lastModified: number; data: any }>
};

function clampToFairway(x: number, y: number): { x: number; y: number } {
  const fairX = COURSE_MARGIN;
  const fairY = COURSE_MARGIN;
  const fairW = Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2);
  const fairH = Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2);
  const cx = Math.max(fairX, Math.min(fairX + fairW, x));
  const cy = Math.max(fairY, Math.min(fairY + fairH, y));
  return { x: cx, y: cy };
}

// Boot-time dev diagnostics
try {
  const rawEnv = (import.meta as any)?.env?.DEV;
  console.log(`[DEV] App boot. import.meta.env.DEV(raw)=${rawEnv} | computedDev=${isDevBuild()}`);
} catch {}

// Fixed logical size
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// Ensure canvas can receive focus to improve keyboard reliability during mouse drags
try {
  canvas.setAttribute('tabindex', '0');
  (canvas as any).tabIndex = 0;
} catch {}
canvas.addEventListener('mousedown', () => {
  try { (canvas as any).focus({ preventScroll: true }); } catch { try { (canvas as any).focus(); } catch {} }
});
// Disable default context menu to avoid interference
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Letterbox scaling to fit window while keeping aspect
function resize() {
  const container = canvas.parentElement as HTMLElement;
  const ww = container.clientWidth;
  const wh = container.clientHeight;
  const scale = Math.min(ww / WIDTH, wh / HEIGHT);
  canvas.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', resize);
resize();

// Global error logging to help surface early failures
window.addEventListener('error', (ev) => {
  try { console.error('[DEV] Window error:', ev.message || ev); } catch {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try { console.error('[DEV] Unhandled rejection:', (ev as any).reason); } catch {}
});

// Game state
let lastTime = performance.now();
let gameState: 'menu' | 'course' | 'options' | 'users' | 'changelog' | 'loading' | 'play' | 'sunk' | 'summary' | 'levelEditor' | 'userLevels' | 'adminMenu' | 'levelManagement' | 'gameSettings' = 'menu';

// Course Select state
let courseSelectState = {
  selectedCourseIndex: -1,
  scrollOffset: 0,
  courses: [] as Array<{ id: string; title: string; type: 'dev' | 'user' | 'firebase'; levelCount: number; courseData?: any }>
};

// User Levels state
let userLevelsState = {
  selectedLevelIndex: -1,
  scrollOffset: 0,
  searchQuery: '',
  filterSource: 'all' as 'all' | 'bundled' | 'filesystem' | 'localStorage'
};
let userLevelsHotspots: Array<{ kind: 'levelItem' | 'btn' | 'filter' | 'search'; index?: number; action?: string; filterId?: string; x: number; y: number; w: number; h: number }> = [];
let levelPaths: string[] = [];
let currentLevelIndex = 0;
let paused = false;
// When true, we are playing a single, ad-hoc level (e.g., user-made or editor test)
let singleLevelMode = false;
// Track current level path and best score for HUD display (course mode only)
let currentLevelPath: string | null = null;
let bestScoreForCurrentLevel: number | null = null;
const APP_VERSION = '0.3.27';
const restitution = 0.9; // wall bounce energy retention
// Runtime-tunable physics (admin)
let physicsFrictionK = 1.2;           // base exponential damping
let physicsSandMultiplier = 6.0;      // multiplier applied when in sand
// Velocity-based sand skimming: when speed is high, sand slows less
let sandSkimEnabled = true;
const sandSkimStart = 280; // px/s where skimming begins to reduce sand effect
const sandSkimFull = 460;  // px/s where sand effect is minimal (≈1x)
const stopSpeed = 5; // px/s threshold to consider stopped (tunable)

// Visual palette (retro mini-golf style)
const COLORS = {
  table: '#7a7b1e',      // mustard/dark-olive table
  fairway: '#126a23',    // classic green fairway
  fairwayBand: '#115e20',// subtle darker band
  fairwayLine: '#0b3b14',// dark outline for fairway
  wallFill: '#e2e2e2',   // light gray walls
  wallStroke: '#bdbdbd', // wall outline
  holeFill: '#0a1a0b',   // cup interior
  holeRim:  '#0f3f19',   // cup rim color
  hudText: '#111111',    // dark text on mustard background (matches screenshots)
  hudBg: '#0d1f10',
  // Terrain colors
  waterFill: '#1f6dff',
  waterStroke: '#1348aa',
  sandFill: '#d4b36a',
  sandStroke: '#a98545'
} as const;
const COURSE_MARGIN = 40; // inset for fairway rect
const HUD_HEIGHT = 32;
let physicsSlopeAccel = 720; // tuned base acceleration applied by hills (px/s^2)
// Anti-jam: count consecutive frames the slope is pushing the ball into an obstacle
let hillJamFrames = 0;
// Additional anti-jam: count frames with near-zero displacement while colliding on a hill
let hillJamPosFrames = 0;
let jamLastX = 0, jamLastY = 0;
const levelCache = new Map<string, Level>();

// User profile (minimal local profile)
type UserRole = 'admin' | 'user';
type UserProfile = { name: string; role: UserRole; id?: string };
let userProfile: UserProfile = { name: '', role: 'user' };
let isEditingUserName = false;

// Per-user score tracking
type UserScores = {
  [userId: string]: {
    [levelPath: string]: {
      bestScore: number;
      attempts: number;
      lastPlayed: string;
    };
  };
};
let userScores: UserScores = {};

function getUserId(): string {
  if (!userProfile.id) {
    userProfile.id = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    saveUserProfile();
  }
  return userProfile.id;
}

function loadUserProfile(): void {
  // Load from localStorage for session persistence
  const stored = localStorage.getItem('userProfile');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.id) userProfile.id = parsed.id;
      if (parsed.name) userProfile.name = parsed.name;
      if (parsed.role) userProfile.role = parsed.role;
    } catch (error) {
      console.warn('Failed to load user profile from localStorage:', error);
    }
  }
}

function saveUserProfile(): void {
  // Save to localStorage for session persistence
  try {
    localStorage.setItem('userProfile', JSON.stringify({
      id: userProfile.id,
      name: userProfile.name,
      role: userProfile.role
    }));
  } catch (error) {
    console.warn('Failed to save user profile to localStorage:', error);
  }
}

function loadUserScores(): void {
  // Scores loading now handled by Firebase
}

function saveUserScores(): void {
  // Scores saving now handled by Firebase
}

async function recordScore(levelPath: string, score: number): Promise<void> {
  const userId = getUserId();
  if (!userId || !firebaseReady) return;
  
  try {
    await firebaseManager.scores.saveScore(userId, levelPath, score);
    // Refresh best score after saving (only relevant in course mode)
    if (!singleLevelMode && currentLevelPath === levelPath) {
      try {
        bestScoreForCurrentLevel = await getBestScore(levelPath);
      } catch {}
    }
  } catch (error) {
    console.error('Failed to record score:', error);
  }
}

async function getBestScore(levelPath: string): Promise<number | null> {
  const userId = getUserId();
  if (!userId || !firebaseReady) return null;
  
  try {
    return await firebaseManager.scores.getBestScore(userId, levelPath);
  } catch (error) {
    console.error('Failed to get best score:', error);
    return null;
  }
}

// User profile and scores now loaded through Firebase during initialization
// Initialize Firebase services (async); fall back gracefully if it fails
let firebaseReady = false;
(async () => {
  try {
    await firebaseManager.init();
    firebaseReady = true;
    // Load global game settings (if present) and apply runtime physics
    try {
      const { FirebaseDatabase } = await import('./firebase/database.js');
      const gs = await FirebaseDatabase.getGameSettings();
      if (gs) {
        physicsSlopeAccel = typeof gs.slopeAccel === 'number' ? gs.slopeAccel : physicsSlopeAccel;
        physicsFrictionK = typeof gs.frictionK === 'number' ? gs.frictionK : physicsFrictionK;
        physicsSandMultiplier = typeof gs.sandMultiplier === 'number' ? gs.sandMultiplier : physicsSandMultiplier;
        // Seed local UI state for heuristics
        gameSettingsState.baselineShotPx = typeof gs.baselineShotPx === 'number' ? gs.baselineShotPx : gameSettingsState.baselineShotPx;
        gameSettingsState.turnPenaltyPerTurn = typeof gs.turnPenaltyPerTurn === 'number' ? gs.turnPenaltyPerTurn : gameSettingsState.turnPenaltyPerTurn;
        gameSettingsState.hillBump = typeof gs.hillBump === 'number' ? gs.hillBump : gameSettingsState.hillBump;
        gameSettingsState.bankWeight = typeof gs.bankWeight === 'number' ? gs.bankWeight : gameSettingsState.bankWeight;
      }
    } catch (e) {
      console.warn('Failed to load global game settings; using defaults', e);
    }
  } catch (e) {
    console.error('Failed to initialize Firebase services', e);
  }
})();

// Helper: is the typed name blocked due to a disabled user record?
function isNameDisabled(name: string): boolean {
  const n = (name || '').trim();
  if (!n) return false;
  try {
    if (firebaseReady) {
      const all = firebaseManager.users.getAll();
      const match = all.find((u: any) => (u.name || '').toLowerCase() === n.toLowerCase());
      return !!(match && match.enabled === false);
    } else {
      const raw = localStorage.getItem('vp.users');
      if (raw) {
        const doc = JSON.parse(raw);
        const arr = Array.isArray(doc?.users) ? doc.users : [];
        const match = arr.find((u: any) => (u?.name || '').toLowerCase() === n.toLowerCase());
        if (match && typeof match.enabled === 'boolean') return match.enabled === false;
      }
    }
  } catch {}
  return false;
}

function isStartEnabled(): boolean {
  const n = (userProfile.name || '').trim();
  if (!n) return false;
  if (isNameDisabled(n)) return false;
  return true;
}

type Wall = { x: number; y: number; w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };
type Circle = { x: number; y: number; r: number };
type Poly = { points: number[] };
type Decoration = { x: number; y: number; w: number; h: number; kind: 'flowers' };
type Slope = { x: number; y: number; w: number; h: number; dir: 'N'|'S'|'E'|'W'|'NE'|'NW'|'SE'|'SW'; strength?: number; falloff?: number };
type Level = {
  canvas: { width: number; height: number };
  course: { index: number; total: number; title?: string };
  par: number;
  tee: { x: number; y: number };
  cup: { x: number; y: number; r: number };
  walls: Wall[];
  sand?: Rect[];
  sandPoly?: Poly[];
  water?: Rect[];
  waterPoly?: Poly[];
  bridges?: Rect[];
  posts?: Circle[];
  wallsPoly?: Poly[];
  decorations?: Decoration[];
  hills?: Slope[];
  meta?: {
    authorId?: string;
    authorName?: string;
    created?: string;
    modified?: string;
  };
};

const ball = {
  x: WIDTH * 0.3,
  y: HEIGHT * 0.6,
  r: 8,
  vx: 0,
  vy: 0,
  moving: false,
};

const hole = { x: WIDTH * 0.75, y: HEIGHT * 0.4, r: 12 };
let walls: Wall[] = [];
let sands: Rect[] = [];
let sandsPoly: Poly[] = [];
let waters: Rect[] = [];
let watersPoly: Poly[] = [];
let bridges: Rect[] = [];
let posts: Circle[] = [];
let polyWalls: Poly[] = [];
let decorations: Decoration[] = [];
let hills: Slope[] = [];
// Logical level canvas size from level JSON; defaults to actual canvas size
let levelCanvas = { width: WIDTH, height: HEIGHT };

// Transient visuals
type SplashFx = { x: number; y: number; age: number };
let splashes: SplashFx[] = [];
type BounceFx = { x: number; y: number; nx: number; ny: number; age: number };
let bounces: BounceFx[] = [];

// Offscreen layer for hill arrows (masked composite)
let arrowsLayer: HTMLCanvasElement | null = null;
let arrowsCtx: CanvasRenderingContext2D | null = null;
let showSlopeArrows = true;

// Users admin state (panelized)
let usersState: { selectedIndex: number; scrollOffset: number; search: string } = {
  selectedIndex: 0,
  scrollOffset: 0,
  search: ''
};

function getFilteredUsers(): Array<{ id: string; name: string; role: string; enabled: boolean }> {
  if (!firebaseReady) return [] as any[];
  const all = firebaseManager.users.getAll().slice();
  all.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
  const q = (usersState.search || '').trim().toLowerCase();
  return q ? all.filter((u: any) => (u.name || '').toLowerCase().includes(q)) : all;
}

function getViewOffsetX(): number {
  const extra = WIDTH - levelCanvas.width;
  return extra > 0 ? Math.floor(extra / 2) : 0;
}

function canvasToPlayCoords(p: { x: number; y: number }): { x: number; y: number } {
  // Convert canvas coordinates to level/playfield coordinates, accounting for horizontal centering
  const offsetX = getViewOffsetX();
  return { x: p.x - offsetX, y: p.y };
}
let courseInfo: { index: number; total: number; par: number; title?: string } = { index: 1, total: 1, par: 3 };
let strokes = 0;
let preShot = { x: 0, y: 0 }; // position before current shot, for water reset
let courseScores: number[] = []; // strokes per completed hole
let coursePars: number[] = []; // par per hole
let holeRecorded = false; // guard to prevent double-recording
let summaryTimer: number | null = null; // timer to auto-open summary after last-hole banner
let isOptionsVolumeDragging = false;

// Audio (basic SFX via Web Audio API)
const AudioSfx = {
  ctx: null as (AudioContext | null),
  volume: 0.6,
  muted: false,
  ensure(): void {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch {}
  },
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); },
  toggleMute() { this.muted = !this.muted; },
  playPutt(): void {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 280;
    g.gain.value = 0.001;
    g.gain.linearRampToValueAtTime(0.12 * this.volume, this.ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + 0.09);
  },
  playBounce(intensity: number): void {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 500 + 800 * Math.max(0, Math.min(1, intensity));
    g.gain.value = 0.001;
    g.gain.linearRampToValueAtTime(0.08 * this.volume, this.ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.06);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + 0.07);
  },
  playSplash(): void {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const len = 0.25;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-6 * (i / data.length));
    }
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buffer;
    g.gain.value = 0.12 * this.volume;
    src.connect(g).connect(this.ctx.destination);
    src.start();
  },
  playSink(): void {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(720, this.ctx.currentTime + 0.12);
    g.gain.value = 0.001;
    g.gain.linearRampToValueAtTime(0.1 * this.volume, this.ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.18);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + 0.2);
  }
};

// Aim state
let isAiming = false;
let aimStart = { x: 0, y: 0 };
let aimCurrent = { x: 0, y: 0 };
// Dev-only: bank-shot path preview toggle
let debugPathPreview = false;

// UI: Menu button in HUD (toggles pause)
function getMenuRect() {
  const w = 72, h = 22;
  const x = 12; // left margin inside HUD
  const y = 5;  // within HUD strip
  return { x, y, w, h };
}

// UI: Pause panel rectangle
function getPausePanelRect() {
  // Standard 800x600 panel centered with safe margins (per UI_Design.md)
  const panelW = Math.min(800, WIDTH - 80);
  const panelH = Math.min(600, HEIGHT - 120);
  let px = Math.floor(WIDTH / 2 - panelW / 2);
  let py = Math.floor(HEIGHT / 2 - panelH / 2);
  px = Math.max(20, Math.min(WIDTH - panelW - 20, px));
  py = Math.max(20, Math.min(HEIGHT - panelH - 20, py));
  return { x: px, y: py, w: panelW, h: panelH };
}

// UI: Replay button on Pause overlay
function getPauseReplayRect() {
  const { x: px, y: py, w: pw, h: ph } = getPausePanelRect();
  const w = 120, h = 28;
  const gap = 16;
  const close = getPauseCloseRect();
  const x = close.x - w - gap;
  const y = py + ph - 60; // bottom row inside panel
  return { x, y, w, h };
}

// UI: Close button on Pause overlay
function getPauseCloseRect() {
  const { x: px, y: py, w: pw, h: ph } = getPausePanelRect();
  const w = 120, h = 28;
  const x = px + pw / 2 + 8; // right of center in bottom row
  const y = py + ph - 60;
  return { x, y, w, h };
}

// UI: Back to Main Menu button on Pause overlay (centered above bottom buttons)
function getPauseBackRect() {
  const { x: px, y: py, w: pw, h: ph } = getPausePanelRect();
  const w = 180, h = 28;
  const x = px + pw / 2 - w / 2;
  const y = py + ph - 100; // anchored above bottom row
  return { x, y, w, h };
}
// UI: Options button on Pause overlay (above bottom row)
function getPauseOptionsRect() {
  const { x: px, y: py, w: pw, h: ph } = getPausePanelRect();
  const w = 140, h = 28;
  const x = px + pw / 2 - w / 2;
  const y = py + ph - 130;
  return { x, y, w, h };
}
let hoverMenu = false;
let hoverPauseReplay = false;
let hoverPauseClose = false;
let hoverPauseBack = false;
let hoverMainStart = false;
let hoverMainLevelEditor = false;
let hoverMainOptions = false;
let hoverMainChangelog = false;
let hoverMainName = false;
let hoverCourseDev = false;
let hoverCourseUserLevels = false;
let hoverCourseBack = false;
let hoverChangelogBack = false;
let hoverSummaryBack = false;
let hoverOptionsBack = false;
let hoverOptionsVolMinus = false;
let hoverOptionsVolPlus = false;
let hoverOptionsMute = false;
let hoverOptionsSlopeToggle = false;
let hoverPauseOptions = false;
let hoverOptionsVolSlider = false;
let hoverOptionsUsers = false; // admin-only users button
// Users Admin inline search focus state
let usersSearchActive = false;

// User Levels state
interface UserLevelEntry {
  name: string;
  id?: string;
  author: string;
  data: any;
  source: 'filesystem' | 'localStorage' | 'bundled' | 'firebase';
  path?: string;
  lastModified?: number;
  thumbnailImage?: HTMLImageElement;
}
let userLevelsList: UserLevelEntry[] = [];
let filteredUserLevelsList: UserLevelEntry[] = [];
let selectedUserLevelIndex = 0;
let hoverUserLevelsBack = false;
let hoverUserLevelsAction: string | null = null; // 'play' | 'edit' | 'duplicate' | 'delete'
let levelSearchQuery = '';
let levelFilterSource = 'all'; // 'all', 'bundled', 'filesystem', 'localStorage'

// Load user levels list from Firebase
async function loadUserLevelsList(): Promise<void> {
  try {
    const username = userProfile?.name || 'DefaultUser';
    
    // Load from Firebase instead of filesystem/localStorage
    if (firebaseReady) {
      // Ensure we are using the Firebase user ID for this name
      await ensureUserSyncedWithFirebase();
      const userId = getUserId();
      console.log('User Made Levels: Loading from Firebase for userId:', userId);
      const firebaseLevels = await firebaseManager.levels.getAllLevels(userId);
      console.log('User Made Levels: Firebase returned', firebaseLevels.length, 'levels:', firebaseLevels);
      
      const allLevels: UserLevelEntry[] = firebaseLevels.map(entry => ({
        id: entry.name,
        name: entry.title,
        author: entry.author,
        data: adaptFirebaseLevelToMain(entry.data),
        source: 'firebase' as const,
        lastModified: entry.lastModified || 0
      }));
      
      userLevelsList = allLevels.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
      console.log('User Made Levels: Final userLevelsList length:', userLevelsList.length);
    } else {
      // Fallback: try to load from filesystem for bundled levels
      try {
        const { loadLevelsFromFilesystem } = await import('./editor/filesystem');
        const filesystemLevels = await loadLevelsFromFilesystem({ 
          username, 
          useUserDirectory: false // Only bundled levels as fallback
        });
        
        const allLevels: UserLevelEntry[] = filesystemLevels.map(level => ({
          name: level.name,
          author: level.data.meta?.authorName || 'Unknown',
          data: level.data,
          source: level.source as 'filesystem' | 'localStorage' | 'bundled',
          path: level.path,
          lastModified: level.lastModified || 0
        }));
        
        userLevelsList = allLevels.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
      } catch (error) {
        console.error('Failed to load fallback levels:', error);
        userLevelsList = [];
      }
    }
    
    // Sort by last modified (newest first), then by name
    userLevelsList = userLevelsList.sort((a, b) => {
      const timeA = a.lastModified || 0;
      const timeB = b.lastModified || 0;
      if (timeA !== timeB) return timeB - timeA;
      return a.name.localeCompare(b.name);
    });
    
    // Apply initial filtering
    applyLevelFilters();
  } catch (error) {
    console.error('Failed to load user levels list:', error);
    userLevelsList = [];
    filteredUserLevelsList = [];
  }
}

// Apply search and filter to user levels list
function applyLevelFilters(): void {
  let filtered = [...userLevelsList];
  
  // Apply source filter
  if (levelFilterSource !== 'all') {
    filtered = filtered.filter(level => level.source === levelFilterSource);
  }
  
  // Apply search query
  if (levelSearchQuery.trim()) {
    const query = levelSearchQuery.toLowerCase().trim();
    filtered = filtered.filter(level => 
      level.name.toLowerCase().includes(query) || 
      level.author.toLowerCase().includes(query)
    );
  }
  
  filteredUserLevelsList = filtered;
  
  // Adjust selection if needed
  if (selectedUserLevelIndex >= filteredUserLevelsList.length) {
    selectedUserLevelIndex = Math.max(0, filteredUserLevelsList.length - 1);
  }
}

// Generate a thumbnail for a level
function generateLevelThumbnail(levelData: any, width: number = 120, height: number = 80): string {
  // Create an off-screen canvas for thumbnail generation
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = width;
  thumbCanvas.height = height;
  const thumbCtx = thumbCanvas.getContext('2d')!;
  
  // Parse level data
  const fairway = levelData.fairway || { x: 0, y: 0, w: 800, h: 600 };
  const tee = levelData.tee || { x: 100, y: 300, r: 15 };
  const hole = levelData.hole || { x: 700, y: 300, r: 12 };
  const walls = levelData.walls || [];
  const wallsPoly = levelData.wallsPoly || [];
  const water = levelData.water || [];
  const waterPoly = levelData.waterPoly || [];
  const sand = levelData.sand || [];
  const sandPoly = levelData.sandPoly || [];
  const hills = levelData.hills || [];
  const bridges = levelData.bridges || [];
  const posts = levelData.posts || [];
  const decorations = levelData.decorations || [];
  
  // Calculate scale to fit the fairway in the thumbnail
  const scaleX = width / fairway.w;
  const scaleY = height / fairway.h;
  const scale = Math.min(scaleX, scaleY) * 0.9; // Leave some padding
  
  // Center the level in the thumbnail
  const offsetX = (width - fairway.w * scale) / 2 - fairway.x * scale;
  const offsetY = (height - fairway.h * scale) / 2 - fairway.y * scale;
  
  thumbCtx.save();
  thumbCtx.scale(scale, scale);
  thumbCtx.translate(offsetX / scale, offsetY / scale);
  
  // Background
  thumbCtx.fillStyle = COLORS.table;
  thumbCtx.fillRect(fairway.x - 20, fairway.y - 20, fairway.w + 40, fairway.h + 40);
  
  // Fairway
  thumbCtx.fillStyle = COLORS.fairway;
  thumbCtx.fillRect(fairway.x, fairway.y, fairway.w, fairway.h);
  thumbCtx.strokeStyle = COLORS.fairwayLine;
  thumbCtx.lineWidth = 2;
  thumbCtx.strokeRect(fairway.x, fairway.y, fairway.w, fairway.h);
  
  // Water areas
  for (const w of water) {
    thumbCtx.fillStyle = COLORS.waterFill;
    thumbCtx.fillRect(w.x, w.y, w.w, w.h);
  }
  for (const pw of waterPoly) {
    if (pw.points && pw.points.length >= 6) {
      thumbCtx.fillStyle = COLORS.waterFill;
      thumbCtx.beginPath();
      thumbCtx.moveTo(pw.points[0], pw.points[1]);
      for (let i = 2; i < pw.points.length; i += 2) {
        thumbCtx.lineTo(pw.points[i], pw.points[i + 1]);
      }
      thumbCtx.closePath();
      thumbCtx.fill();
    }
  }
  
  // Sand areas
  for (const s of sand) {
    thumbCtx.fillStyle = COLORS.sandFill;
    thumbCtx.fillRect(s.x, s.y, s.w, s.h);
  }
  for (const ps of sandPoly) {
    if (ps.points && ps.points.length >= 6) {
      thumbCtx.fillStyle = COLORS.sandFill;
      thumbCtx.beginPath();
      thumbCtx.moveTo(ps.points[0], ps.points[1]);
      for (let i = 2; i < ps.points.length; i += 2) {
        thumbCtx.lineTo(ps.points[i], ps.points[i + 1]);
      }
      thumbCtx.closePath();
      thumbCtx.fill();
    }
  }
  
  // Hills (simplified)
  for (const h of hills) {
    thumbCtx.fillStyle = 'rgba(255,255,255,0.1)';
    thumbCtx.fillRect(h.x, h.y, h.w, h.h);
  }
  
  // Bridges
  for (const b of bridges) {
    thumbCtx.fillStyle = COLORS.fairway;
    thumbCtx.fillRect(b.x, b.y, b.w, b.h);
  }
  
  // Walls
  for (const w of walls) {
    thumbCtx.fillStyle = COLORS.wallFill;
    thumbCtx.fillRect(w.x, w.y, w.w, w.h);
  }
  for (const pw of wallsPoly) {
    if (pw.points && pw.points.length >= 6) {
      thumbCtx.fillStyle = COLORS.wallFill;
      thumbCtx.beginPath();
      thumbCtx.moveTo(pw.points[0], pw.points[1]);
      for (let i = 2; i < pw.points.length; i += 2) {
        thumbCtx.lineTo(pw.points[i], pw.points[i + 1]);
      }
      thumbCtx.closePath();
      thumbCtx.fill();
    }
  }
  
  // Posts
  for (const p of posts) {
    thumbCtx.fillStyle = COLORS.wallFill;
    thumbCtx.beginPath();
    thumbCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    thumbCtx.fill();
  }
  
  // Tee (start position)
  thumbCtx.fillStyle = '#90EE90';
  thumbCtx.beginPath();
  thumbCtx.arc(tee.x, tee.y, tee.r, 0, Math.PI * 2);
  thumbCtx.fill();
  
  // Hole (cup)
  thumbCtx.fillStyle = COLORS.holeFill;
  thumbCtx.beginPath();
  thumbCtx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
  thumbCtx.fill();
  thumbCtx.strokeStyle = COLORS.holeRim;
  thumbCtx.lineWidth = 1;
  thumbCtx.stroke();
  
  thumbCtx.restore();
  
  return thumbCanvas.toDataURL();
}

// Cache for level thumbnails
const levelThumbnailCache = new Map<string, string>();

// Get or generate thumbnail for a level
function getLevelThumbnail(level: UserLevelEntry): string {
  const cacheKey = `${level.source}-${level.name}-${level.author}`;
  
  if (levelThumbnailCache.has(cacheKey)) {
    return levelThumbnailCache.get(cacheKey)!;
  }
  
  try {
    const thumbnail = generateLevelThumbnail(level.data);
    levelThumbnailCache.set(cacheKey, thumbnail);
    return thumbnail;
  } catch (error) {
    console.warn('Failed to generate thumbnail for level:', level.name, error);
    return ''; // Return empty string if thumbnail generation fails
  }
}

// Play a user level
async function playUserLevel(level: UserLevelEntry): Promise<void> {
  try {
    // Load the level data into the game
    const levelData = level.data;
    
    // Set up single-level play mode
    singleLevelMode = true;
    gameState = 'play';
    currentLevelIndex = 0;
    courseScores = [];
    
    // Load level data directly
    await loadLevelFromData(levelData);
    
    console.log(`Playing user level: ${level.name} by ${level.author}`);
  } catch (error) {
    console.error('Failed to play user level:', error);
    showUiToast('Failed to load level');
  }
}

// Edit a user level (if owner/admin)
async function editUserLevel(level: UserLevelEntry): Promise<void> {
  const isOwner = (level.author || '').toLowerCase() === (userProfile?.name || '').toLowerCase();
  const isAdmin = userProfile?.role === 'admin';
  
  if (!isOwner && !isAdmin) {
    showUiToast('You can only edit your own levels');
    return;
  }
  // (Game Settings render handled in main render loop)
  
  try {
    // Switch to Level Editor
    gameState = 'levelEditor';
    
    // Set the level ID for proper saving - this is the key fix
    // When the editor initializes, it will have the correct ID to update instead of creating new
    if (level.id) {
      // Store the level ID in a way the editor can access it
      (window as any).pendingEditLevelId = level.id;
      (window as any).pendingEditLevelData = level.data || level;
    }
    
    showUiToast(`Loading "${level.name}" in Level Editor...`);
    console.log(`Editing user level: ${level.name} (ID: ${level.id})`);
  } catch (error) {
    console.error('Failed to edit user level:', error);
    showUiToast('Failed to open level in editor');
  }
}

// Duplicate a user level (any user can duplicate any level)
async function duplicateUserLevel(level: UserLevelEntry): Promise<void> {
  try {
    const newName = await showUiPrompt(
      `Duplicate "${level.name}"?\nEnter new level name:`,
      `${level.name} (Copy)`,
      'Duplicate Level'
    );
    
    if (!newName || !newName.trim()) {
      showUiToast('Duplicate cancelled');
      return;
    }
    
    const trimmedName = newName.trim();
    
    // Create a copy of the level data
    let duplicatedLevel;
    try {
      duplicatedLevel = JSON.parse(JSON.stringify(level.data));
    } catch (error) {
      console.error('Failed to clone level data:', error);
      showUiToast('Failed to duplicate level - invalid data format');
      return;
    }
    
    // Update metadata for the new level
    if (!duplicatedLevel.meta) duplicatedLevel.meta = {};
    duplicatedLevel.meta.title = trimmedName;
    duplicatedLevel.meta.authorName = userProfile?.name || 'DefaultUser';
    duplicatedLevel.meta.authorId = getUserId();
    duplicatedLevel.meta.lastModified = Date.now();
    
    // Update course title if it exists
    if (duplicatedLevel.course) {
      duplicatedLevel.course.title = trimmedName;
    }
    
    // Save the duplicated level to Firebase
    if (firebaseReady) {
      const userId = getUserId();
      if (userId) {
        const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `level-${Date.now()}`;
        await firebaseManager.levels.saveLevel(duplicatedLevel, slug, userId);
        
        // Reload the levels list to show the new duplicate
        await loadUserLevelsList();
        
        showUiToast(`Duplicated: ${trimmedName}`);
        console.log(`Duplicated level: ${level.name} -> ${trimmedName}`);
      } else {
        showUiToast('User not authenticated');
      }
    } else {
      showUiToast('Firebase services not ready');
    }
  } catch (error) {
    console.error('Failed to duplicate user level:', error);
    showUiToast('Failed to duplicate level');
  }
}

// Delete a user level (if owner/admin)
async function deleteUserLevel(level: UserLevelEntry): Promise<void> {
  const isOwner = (level.author || '').toLowerCase() === (userProfile?.name || '').toLowerCase();
  const isAdmin = userProfile?.role === 'admin';
  
  if (!isOwner && !isAdmin) {
    showUiToast('You can only delete your own levels');
    return;
  }
  
  try {
    const confirmed = await showUiConfirm(
      `Delete "${level.name}" by ${level.author}?\nThis action cannot be undone.`,
      'Delete Level'
    );
    
    if (!confirmed) return;
    
    // Delete from Firebase storage
    if (level.source === 'firebase') {
      try {
        const userId = getUserId();
        if (userId && firebaseReady) {
          // Find the level by matching name and author
          const firebaseLevels = await firebaseManager.levels.getAllLevels(userId);
          const levelToDelete = firebaseLevels.find(l => l.title === level.name && l.author === level.author);
          
          if (level?.id) {
            await firebaseManager.levels.deleteLevel(level.id, userId);
          } else if (levelToDelete) {
            // Use the Firebase level ID (key)
            await firebaseManager.levels.deleteLevel(levelToDelete.name, userId);
          } else {
            showUiToast('Level not found in Firebase', 3000);
            return;
          }
        } else {
          showUiToast('Firebase not available or user not authenticated', 3000);
          return;
        }
      } catch (error) {
        console.error('Failed to delete level from Firebase:', error);
        showUiToast('Failed to delete level', 3000);
        return;
      }
    } else if (level.source === 'filesystem' && level.path) {
      // For filesystem levels, we can't actually delete them in a browser environment
      showUiToast('Cannot delete filesystem levels from browser. Use file manager to delete: ' + level.path, 4000);
      return;
    } else {
      // Legacy localStorage cleanup (should be rare after migration)
      showUiToast('Cannot delete legacy level - please use Level Editor', 3000);
      return;
    }
    
    // Wait a moment for Firebase to propagate the deletion
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Force clear any Firebase caches and reload the levels list
    if (firebaseReady && firebaseManager?.levels) {
      // Clear the Firebase level store cache
      (firebaseManager.levels as any).cachedLevels?.clear();
      (firebaseManager.levels as any).userLevelsCache?.clear();
    }
    
    // Reload the levels list
    await loadUserLevelsList();
    
    // Adjust selection if needed
    if (selectedUserLevelIndex >= userLevelsList.length) {
      selectedUserLevelIndex = Math.max(0, userLevelsList.length - 1);
    }
    
    showUiToast(`Deleted: ${level.name}`);
    console.log(`Deleted user level: ${level.name}`);
  } catch (error) {
    console.error('Failed to delete user level:', error);
    showUiToast('Failed to delete level');
  }
}

// Load level data directly (for user levels)
async function loadLevelFromData(levelData: any): Promise<void> {
  try {
    // Validate level data
    if (!levelData.tee || !levelData.cup) {
      throw new Error('Invalid level data - missing tee or cup');
    }
    
    // Use the existing loadLevel function with a temporary level object
    const tempLevel: Level = {
      tee: levelData.tee,
      cup: { x: levelData.cup.x, y: levelData.cup.y, r: (typeof levelData.cup.r === 'number' ? levelData.cup.r : 12) },
      canvas: levelData.canvas || { width: WIDTH, height: HEIGHT },
      walls: levelData.walls || [],
      wallsPoly: levelData.wallsPoly || [],
      posts: Array.isArray(levelData.posts) ? levelData.posts.map((p: any) => ({ ...p, r: (p?.r ?? p?.radius ?? 8) })) : [],
      bridges: levelData.bridges || [],
      water: levelData.water || [],
      waterPoly: levelData.watersPoly || levelData.waterPoly || [],
      sand: levelData.sand || [],
      sandPoly: levelData.sandsPoly || levelData.sandPoly || [],
      hills: levelData.hills || [],
      decorations: levelData.decorations || [],
      course: levelData.course || { index: 1, total: 1, title: 'User Level' },
      par: levelData.par || 3
    };
    
    // Store in level cache and load
    const tempPath = `user-level-${Date.now()}`;
    levelCache.set(tempPath, tempLevel);
    await loadLevel(tempPath);
    
    console.log('Loaded user level data successfully');
  } catch (error) {
    console.error('Failed to load level data:', error);
    throw error;
  }
}

// Test level from Level Editor
let isTestingLevel = false;
async function testLevelFromEditor(levelData: any): Promise<void> {
  try {
    // Validate level data
    if (!levelData.tee || !levelData.cup) {
      showUiToast('Level needs both a tee and cup to test');
      return;
    }
    
    // Create a test level object
    const testLevel: Level = {
      tee: levelData.tee,
      cup: { x: levelData.cup.x, y: levelData.cup.y, r: (typeof levelData.cup.r === 'number' ? levelData.cup.r : 12) },
      canvas: levelData.canvas || { width: WIDTH, height: HEIGHT },
      walls: levelData.walls || [],
      wallsPoly: levelData.wallsPoly || [],
      posts: Array.isArray(levelData.posts) ? levelData.posts.map((p: any) => ({ ...p, r: (p?.r ?? p?.radius ?? 8) })) : [],
      bridges: levelData.bridges || [],
      water: levelData.water || [],
      waterPoly: levelData.waterPoly || [],
      sand: levelData.sand || [],
      sandPoly: levelData.sandPoly || [],
      hills: levelData.hills || [],
      decorations: levelData.decorations || [],
      course: {
        index: 1,
        total: 1,
        title: levelData.course?.title || 'Test Level'
      },
      par: levelData.par || 3
    };
    
    // Store in level cache and switch to play mode
    const tempPath = `test-level-${Date.now()}`;
    levelCache.set(tempPath, testLevel);
    
    // Mark that we're testing a level
    isTestingLevel = true;
    singleLevelMode = true;
    
    // Switch to play mode
    gameState = 'play';
    currentLevelIndex = 0;
    courseScores = [];
    
    // Load the test level
    await loadLevel(tempPath);
    
    showUiToast(`Testing: ${testLevel.course.title} (Press Esc to return to editor)`);
    console.log('Started testing level:', testLevel.course.title);
  } catch (error) {
    console.error('Failed to test level:', error);
    showUiToast('Failed to test level');
  }
}

// Return to Level Editor from test mode
function returnToEditor(): void {
  if (isTestingLevel) {
    isTestingLevel = false;
    singleLevelMode = false;
    gameState = 'levelEditor';
    showUiToast('Returned to Level Editor');
  }
}
let transitioning = false; // prevent double-advance while changing holes
let lastAdvanceFromSunkMs = 0; // used to swallow trailing click after mousedown
const CLICK_SWALLOW_MS = 180; // shorten delay for snappier feel

let previousGameState: 'menu' | 'course' | 'options' | 'users' | 'changelog' | 'loading' | 'play' | 'sunk' | 'summary' | 'levelEditor' | 'adminMenu' | 'levelManagement' = 'menu';

// Hover state trackers for various panels
let hoverUsersBtnKind: UsersHotspot['kind'] | null = null;
let hoverUsersListIndex: number | null = null;
let hoverUsersSearch = false;
let hoverAdminKind: AdminMenuHotspot['kind'] | null = null;
let hoverLevelMgmtRowIndex: number | null = null;
let hoverLevelMgmtDeleteIndex: number | null = null;
let hoverCourseAction: string | null = null;
let hoverUserLevelsRowIndex: number | null = null;
let hoverUserLevelsSearch = false;
let hoverUserLevelsFilterId: string | null = null;

// Changelog screen state and helpers
let changelogText: string | null = (typeof CHANGELOG_RAW === 'string' && CHANGELOG_RAW.trim().length > 0) ? CHANGELOG_RAW : null;
let changelogLines: string[] = [];
let changelogScrollY = 0;
let isChangelogDragging = false;
let changelogDragStartY = 0;
let changelogScrollStartY = 0;

function getChangelogBackRect() {
  const panelW = Math.min(800, WIDTH - 80);
  const panelH = Math.min(600, HEIGHT - 120);
  const pad = 20;
  let px = Math.floor(WIDTH / 2 - panelW / 2);
  let py = Math.floor(HEIGHT / 2 - panelH / 2);
  px = Math.max(20, Math.min(WIDTH - panelW - 20, px));
  py = Math.max(20, Math.min(HEIGHT - panelH - 20, py));
  const w = 120, h = 32;
  const x = px + panelW - pad - w;
  const y = py + panelH - pad - h;
  return { x, y, w, h };
}

// Changelog content viewport
function getChangelogContentRect() {
  const panelW = Math.min(800, WIDTH - 80);
  const panelH = Math.min(600, HEIGHT - 120);
  const pad = 20;
  let px = Math.floor(WIDTH / 2 - panelW / 2);
  let py = Math.floor(HEIGHT / 2 - panelH / 2);
  px = Math.max(20, Math.min(WIDTH - panelW - 20, px));
  py = Math.max(20, Math.min(HEIGHT - panelH - 20, py));
  const x = px + pad;
  const y = py + pad + 32; // leave room for header
  const w = panelW - pad * 2 - 20; // leave space for scrollbar
  const h = panelH - pad * 2 - 32 - 60; // leave space for back button row
  return { x, y, w, h };
}

function clampChangelogScroll(): void {
  const r = getChangelogContentRect();
  const visibleHeight = r.h;
  const contentHeight = changelogLines.length * 20;
  const maxScroll = Math.max(0, contentHeight - visibleHeight);
  if (changelogScrollY < 0) changelogScrollY = 0;
  if (changelogScrollY > maxScroll) changelogScrollY = maxScroll;
}

async function ensureChangelogLoaded(): Promise<void> {
  if (changelogText !== null) return;
  const candidates = ['CHANGELOG.md', '/CHANGELOG.md'];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const txt = await res.text();
      if (txt && txt.trim().length > 0) {
        changelogText = txt;
        return;
      }
    } catch {}
  }
  if (changelogText === null && typeof CHANGELOG_RAW === 'string' && CHANGELOG_RAW.trim().length > 0) {
    changelogText = CHANGELOG_RAW;
    return;
  }
  console.error('Failed to load changelog from', candidates);
  changelogText = 'Failed to load CHANGELOG.md';
}

function wrapChangelog(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const rawLines = text.split('\n');
  const wrapped: string[] = [];
  for (let raw of rawLines) {
    // simple markdown-ish tweaks
    if (raw.startsWith('## ')) {
      wrapped.push('');
      raw = raw.substring(3);
    } else if (raw.startsWith('- ')) {
      raw = '• ' + raw.substring(2);
    }
    if (raw.trim() === '') { wrapped.push(''); continue; }
    const words = raw.split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      const w = context.measureText(test).width;
      if (w > maxWidth && line) {
        wrapped.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) wrapped.push(line);
  }
  return wrapped;
}
function advanceAfterSunk() {
  if (transitioning) return;
  transitioning = true;
  lastAdvanceFromSunkMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Continue to next step depending on whether this is the last hole
  if (!holeRecorded) {
    courseScores[currentLevelIndex] = strokes;
    holeRecorded = true;
    // Record score for current user
    if (currentLevelIndex < levelPaths.length) {
      recordScore(levelPaths[currentLevelIndex], strokes);
    }
  }
  const isLastHole = courseInfo.index >= courseInfo.total;
  if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
  if (isLastHole) {
    gameState = 'summary';
    transitioning = false;
  } else if (!singleLevelMode) {
    const next = currentLevelIndex + 1;
    // kick off preload of the following level to reduce perceived delay later
    preloadLevelByIndex(next + 1);
    currentLevelIndex = next;
    loadLevelByIndex(currentLevelIndex)
      .then(() => { transitioning = false; })
      .catch((err: unknown) => { console.error(err); transitioning = false; });
  }
}

async function startCourseFromFile(courseJsonPath: string): Promise<void> {
  if (!isDevBuild()) return;
  try {
    const res = await fetch(courseJsonPath);
    const data = (await res.json()) as { levels: string[] };
    if (Array.isArray(data.levels) && data.levels.length > 0) {
      levelPaths = data.levels;
      courseScores = [];
      coursePars = [];
      currentLevelIndex = 0;
      gameState = 'loading';
      // Ensure first two levels are loaded before switching to play
      await Promise.all([
        loadLevel(levelPaths[0]),
        (levelPaths[1] ? fetch(levelPaths[1]).then((r) => r.json()).then((lvl: Level) => { levelCache.set(levelPaths[1], lvl); }).catch(() => {}) : Promise.resolve())
      ]);
      // Set state to play after content is ready
      gameState = 'play';
    }
  } catch (err: unknown) {
    console.error('Failed to start course:', err);
  }
}

// Load courses from Firebase for Course Select screen
async function loadCoursesFromFirebase(): Promise<void> {
  if (!firebaseReady) {
    console.warn('Firebase not ready; cannot load courses from Firebase');
    // Fallback to dev levels only
    courseSelectState.courses = [
      { id: 'dev', title: 'Dev Levels', type: 'dev', levelCount: 8 }
    ];
    return;
  }
  
  try {
    // Load courses from Firebase
    const courses = await firebaseManager.courses.getCourses();
    
    // Convert Firebase courses to course select format
    const courseList: Array<{ id: string; title: string; type: 'dev' | 'user' | 'firebase'; levelCount: number; courseData?: any }> = courses.map(course => ({
      id: course.id,
      title: course.title,
      type: 'firebase',
      levelCount: course.levelIds.length,
      courseData: course
    }));
    
    // Add dev levels as a fallback course
    const devLevelsEntry = await firebaseManager.levels.getAllLevels(undefined);
    const devEntries = devLevelsEntry.filter((e: any) => {
      try { return (e?.data?.meta?.authorId === 'system') || (e?.author === 'Game Developer'); } catch { return false; }
    });
    
    if (devEntries.length > 0) {
      courseList.unshift({
        id: 'dev',
        title: 'Dev Levels',
        type: 'dev' as const,
        levelCount: devEntries.length
      });
    }
    
    courseSelectState.courses = courseList;
    console.log('Loaded', courseList.length, 'courses from Firebase');
    
  } catch (error) {
    console.error('Failed to load courses from Firebase:', error);
    // Fallback to dev levels only
    courseSelectState.courses = [
      { id: 'dev', title: 'Dev Levels', type: 'dev', levelCount: 8 }
    ];
  }
}

// Start Dev Levels course from Firebase public levels (avoids fetching /levels in production)
async function startDevCourseFromFirebase(): Promise<void> {
  if (!firebaseReady) {
    console.warn('Firebase not ready; cannot load Dev Levels from Firebase');
    return;
  }
  const entries = await firebaseManager.levels.getAllLevels(undefined);
  // Heuristic: Dev/bundled levels authored by system
  const devEntries = entries.filter((e: any) => {
    try { return (e?.data?.meta?.authorId === 'system') || (e?.author === 'Game Developer'); } catch { return false; }
  });
  if (devEntries.length === 0) {
    showUiToast('No dev levels found in Firebase', 3000);
    return;
  }
  const devLevels = devEntries.map((entry: any) => adaptFirebaseLevelToMain(entry.data));
  // Start course with dev levels
  levelPaths = devLevels.map((_, i) => `dev:level${i}`);
  devLevels.forEach((level, i) => levelCache.set(`dev:level${i}`, level));
  courseScores = [];
  coursePars = [];
  currentLevelIndex = 0;
  singleLevelMode = false;
  gameState = 'loading';
  await loadLevel(levelPaths[0]);
  gameState = 'play';
}

// Start Firebase course from CourseEntry
async function startFirebaseCourse(courseData: any): Promise<void> {
  if (!firebaseReady) {
    console.warn('Firebase not ready; cannot load Firebase course');
    return;
  }
  
  try {
    // Load levels for this course
    const levelIds = courseData.levelIds || [];
    if (levelIds.length === 0) {
      showUiToast('Course has no levels', 3000);
      return;
    }
    
    // Load all levels once, then find the ones we need in order
    const allLevels = await firebaseManager.levels.getAllLevels(undefined);
    const levels = [];
    
    for (const levelId of levelIds) {
      try {
        const levelEntry = allLevels.find(l => l.name === levelId);
        if (levelEntry) {
          levels.push(adaptFirebaseLevelToMain(levelEntry.data));
        } else {
          console.warn('Level not found:', levelId);
        }
      } catch (e) {
        console.warn('Failed to adapt level', levelId, e);
      }
    }
    
    if (levels.length === 0) {
      showUiToast('Failed to load course levels', 3000);
      return;
    }
    
    // Start course with Firebase levels
    levelPaths = levels.map((_, i) => `course:${courseData.id}:${i}`);
    levels.forEach((level, i) => levelCache.set(`course:${courseData.id}:${i}`, level));
    courseScores = new Array(levels.length).fill(0);
    coursePars = levels.map(level => level.par || 3);
    currentLevelIndex = 0;
    singleLevelMode = false;
    gameState = 'loading';
    await loadLevel(levelPaths[0]);
    gameState = 'play';
    
    console.log(`Started Firebase course "${courseData.title}" with ${levels.length} levels`);
    console.log('Level paths:', levelPaths);
    console.log('Course pars:', coursePars);
    
  } catch (error) {
    console.error('Failed to start Firebase course:', error);
    showUiToast('Failed to load course', 3000);
  }
}

// Main Menu layout helpers (panelized)
function getMainPanelRect() {
  const panelW = Math.min(800, WIDTH - 80);
  const panelH = Math.min(600, HEIGHT - 120);
  const panelX = Math.floor(WIDTH / 2 - panelW / 2);
  const panelY = Math.floor(HEIGHT / 2 - panelH / 2);
  const pad = 20;
  return { x: panelX, y: panelY, w: panelW, h: panelH, pad };
}
function getMainStartRect() {
  const p = getMainPanelRect();
  const w = 200, h = 36;
  const x = p.x + Math.floor((p.w - w) / 2);
  const y = p.y + p.pad + 48 + 220; // push buttons down to keep gap below username
  return { x, y, w, h };
}
function getMainLevelEditorRect() {
  const s = getMainStartRect();
  const w = s.w, h = 32; // secondary action size
  const x = s.x;
  const y = s.y + 50;
  return { x, y, w, h };
}
function getMainOptionsRect() {
  const le = getMainLevelEditorRect();
  const w = le.w, h = 32; // secondary action size
  const x = le.x;
  const y = le.y + 50;
  return { x, y, w, h };
}

// Main Menu: Username input (above Start, below graphic)
function getMainNameRect() {
  const p = getMainPanelRect();
  const w = 300, h = 28;
  const x = p.x + Math.floor((p.w - w) / 2);
  const y = p.y + p.pad + 48 + 170; // push further down, still above Start with comfortable gap
  return { x, y, w, h };
}

// Main Menu: Changelog button (bottom-right inside panel)
function getMainChangelogRect() {
  const p = getMainPanelRect();
  const w = 160, h = 32; // secondary action size
  const x = p.x + p.w - p.pad - w;
  const y = p.y + p.h - p.pad - h;
  return { x, y, w, h };
}

// Course Select layout
function getCourseDevRect() {
  const w = 220, h = 48;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT / 2 - 60;
  return { x, y, w, h };
}
function getCourseUserLevelsRect() {
  const w = 220, h = 48;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT / 2 + 10;
  return { x, y, w, h };
}
function getCourseBackRect() {
  const w = 120, h = 28;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT - 90;
  return { x, y, w, h };
}

// Options: simple audio control button rects
function getOptionsVolMinusRect() {
  const w = 36, h = 28;
  const x = WIDTH / 2 - 180;
  const y = 360;
  return { x, y, w, h };
}
function getOptionsVolPlusRect() {
  const w = 36, h = 28;
  const x = WIDTH / 2 - 180 + 44;
  const y = 360;
  return { x, y, w, h };
}
function getOptionsMuteRect() {
  const w = 90, h = 28;
  const x = WIDTH / 2 - 180 + 100;
  const y = 360;
  return { x, y, w, h };
}
function getOptionsVolSliderRect() {
  const w = 180, h = 8;
  const x = WIDTH / 2 - 180 + 200;
  const y = 344;
  return { x, y, w, h };
}
function getOptionsSlopeToggleRect() {
  const w = 80, h = 28;
  const x = WIDTH / 2 - 180 + 200;
  const y = 404; // positioned below volume label
  return { x, y, w, h };
}

function worldFromEvent(e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  // Use rect size to derive scale; robust to any CSS transform/zoom
  const scaleX = rect.width / WIDTH;
  const scaleY = rect.height / HEIGHT;
  const x = (e.clientX - rect.left) / scaleX;
  const y = (e.clientY - rect.top) / scaleY;
  // Return canvas coordinates; convert to play coords where needed
  return { x, y };
}

canvas.addEventListener('mousedown', (e) => {
  AudioSfx.ensure();
  const p = worldFromEvent(e); // canvas coords
  // Handle Main Menu buttons
  if (gameState === 'menu') {
    // Username input focus
    const nr = getMainNameRect();
    if (p.x >= nr.x && p.x <= nr.x + nr.w && p.y >= nr.y && p.y <= nr.y + nr.h) {
      isEditingUserName = true;
      try { (canvas as any).focus({ preventScroll: true }); } catch {}
      return;
    } else {
      isEditingUserName = false;
    }
    // Start button (disabled unless username non-empty)
    const s = getMainStartRect();
    const canStart = isStartEnabled();
    if (canStart && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
      // Go to Course Select
      gameState = 'course';
      // Initialize course list - load from Firebase
      courseSelectState.courses = [];
      void loadCoursesFromFirebase();
      courseSelectState.selectedCourseIndex = 0; // Start with first course selected
      courseSelectState.scrollOffset = 0;
      // On Start: sync active profile with UsersStore (login by name)
      (async () => {
        try {
          const name = (userProfile.name || '').trim();
          if (!name) { /* nothing to sync */ }
          else if (firebaseReady) {
            await ensureUserSyncedWithFirebase();
          } else {
            // Fallback: try reading localStorage users doc (no await)
            try {
              const raw = localStorage.getItem('vp.users');
              if (raw) {
                const doc = JSON.parse(raw);
                const arr = Array.isArray(doc?.users) ? doc.users : [];
                const match = arr.find((u: any) => (u?.name || '').toLowerCase() === name.toLowerCase());
                if (match && (match.role === 'admin' || match.role === 'user') && typeof match.id === 'string') {
                  // If typed 'admin' but stored record is user, bootstrap elevate in profile (persist will happen once store is ready)
                  const role = (name.toLowerCase() === 'admin') ? 'admin' : match.role;
                  userProfile.role = role as any;
                  userProfile.id = match.id;
                  saveUserProfile();
                } else if (name.toLowerCase() === 'admin') {
                  // Last resort: treat name 'admin' as admin until store init completes
                  userProfile.role = 'admin' as any;
                  saveUserProfile();
                }
              } else if (name.toLowerCase() === 'admin') {
                userProfile.role = 'admin' as any;
                saveUserProfile();
              }
            } catch {}
          }
        } catch (e) {
          console.error('Failed to sync user profile:', e);
        }
      })();
      return;
    }
    // Level Editor button (disabled unless username non-empty)
    const le = getMainLevelEditorRect();
    if (canStart && p.x >= le.x && p.x <= le.x + le.w && p.y >= le.y && p.y <= le.y + le.h) {
      (async () => {
        try {
          if (firebaseReady) await ensureUserSyncedWithFirebase();
        } catch (e) {
          console.error('Failed to sync user before entering editor:', e);
        } finally {
          gameState = 'levelEditor';
          const editorEnv = {
            ctx,
            width: WIDTH,
            height: HEIGHT,
            canvasToPlayCoords: (x: number, y: number) => {
              const pp = canvasToPlayCoords({ x, y });
              return { x: pp.x, y: pp.y };
            },
            worldFromEvent: (ev: MouseEvent) => worldFromEvent(ev),
            isOverlayActive,
            renderGlobalOverlays,
            fairwayRect: () => ({
              x: COURSE_MARGIN,
              y: COURSE_MARGIN,
              w: Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2),
              h: Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2),
            }),
            getGridSize: () => 20,
            setGridSize: () => {},
            getShowGrid: () => true,
            setShowGrid: () => {},
            showToast: (msg: string) => showUiToast(msg),
            showConfirm: (msg: string, title?: string) => showUiConfirm(msg, title),
            showPrompt: (msg: string, def?: string, title?: string) => showUiPrompt(msg, def, title),
      showMetadataForm: (init: any, title?: string) => showUiMetadataForm(init, title),
            showList: (title: string, items: Array<{label: string; value: any}>, startIndex?: number) => showUiList(title, items, startIndex),
            showDnDList: async (title: string, items: Array<{label: string; value: any}>) => {
              const res = await showUiDnDList(title, items as any);
              return res ? res.map(it => ({ label: it.label, value: (it as any).value })) : null;
            },
            showImportReview: (init: any) => showUiImportReview(init),
            showAnnotateScreenshot: (file: File, opts: any) => showAnnotateScreenshot(file, opts),
            showCourseEditor: (courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] }) => showUiCourseEditor(courseData),
            showUiCourseCreator: (courseList: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>) => showUiCourseCreator(courseList),
            getGlobalState: () => ({
              WIDTH,
              HEIGHT,
              COURSE_MARGIN,
              ball,
              hole,
              levelCanvas,
              walls,
              sands,
              sandsPoly,
              waters,
              watersPoly,
              decorations,
              hills,
              bridges,
              posts,
              polyWalls,
              userProfile
            }),
            setGlobalState: (state: any) => {
              if (state.levelCanvas) levelCanvas = state.levelCanvas;
              if (state.walls) walls = state.walls;
              if (state.sands) sands = state.sands;
              if (state.sandsPoly) sandsPoly = state.sandsPoly;
              if (state.waters) waters = state.waters;
              if (state.watersPoly) watersPoly = state.watersPoly;
              if (state.decorations) decorations = state.decorations;
              if (state.hills) hills = state.hills;
              if (state.bridges) bridges = state.bridges;
              if (state.posts) posts = state.posts;
              if (state.polyWalls) polyWalls = state.polyWalls;
              if (state.ball) { ball.x = state.ball.x; ball.y = state.ball.y; ball.vx = state.ball.vx; ball.vy = state.ball.vy; ball.moving = state.ball.moving; }
              if (state.hole) { hole.x = state.hole.x; hole.y = state.hole.y; if (state.hole.r !== undefined) (hole as any).r = state.hole.r; }
            },
            getUserId,
            exitToMenu: () => { try { levelEditor.reset(); } catch {} gameState = 'menu'; },
            testLevel: testLevelFromEditor,
            getUserName: () => { const n = (userProfile?.name || '').trim(); return n || getUserId(); },
            getUserRole: () => userProfile.role
          };
          levelEditor.init(editorEnv);
        }
      })();
      return;
    }
    const o = getMainOptionsRect();
    if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h) {
      previousGameState = 'menu';
      gameState = 'options';
      return;
    }
    const cg = getMainChangelogRect();
    if (p.x >= cg.x && p.x <= cg.x + cg.w && p.y >= cg.y && p.y <= cg.y + cg.h) {
      gameState = 'changelog';
      ensureChangelogLoaded().then(() => {
        // Build wrapped lines once content is loaded
        const cr = getChangelogContentRect();
        ctx.save();
        ctx.font = '14px system-ui, sans-serif';
        changelogLines = wrapChangelog(ctx, (changelogText ?? '').toString(), cr.w);
        ctx.restore();
        changelogScrollY = 0;
      }).catch(() => {});
      return;
    }
  }
  // Handle Course Select interactions
  if ((gameState as any) === 'course') {
    // Check for course item clicks
    for (const hs of courseSelectHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'courseItem' && typeof hs.index === 'number') {
          courseSelectState.selectedCourseIndex = hs.index;
          // Show confirmation before loading course
          const course = courseSelectState.courses[hs.index];
          if (course) {
            uiOverlay = {
              kind: 'confirm',
              title: 'Load Course',
              message: `Load "${course.title}" (${course.levelCount} levels)?`,
              cancelable: true,
              resolve: (confirmed) => {
                uiOverlay = { kind: 'none' };
                if (confirmed) {
                  if (course.type === 'dev') {
                    void startDevCourseFromFirebase();
                  } else if (course.type === 'firebase' && course.courseData) {
                    void startFirebaseCourse(course.courseData);
                  }
                }
              }
            };
          }
          return;
        }
        if (hs.kind === 'btn') {
          if (hs.action === 'back') {
            gameState = 'menu';
            return;
          }
          if (hs.action === 'userLevels') {
            gameState = 'userLevels';
            void loadUserLevelsList();
            return;
          }
          if (hs.action === 'playSelectedCourse') {
            const c = courseSelectState.courses[courseSelectState.selectedCourseIndex];
            if (!c) return;
            uiOverlay = {
              kind: 'confirm',
              title: 'Load Course',
              message: `Load "${c.title}" (${c.levelCount} levels)?`,
              cancelable: true,
              resolve: (confirmed) => {
                uiOverlay = { kind: 'none' };
                if (confirmed) {
                  if (c.type === 'dev') {
                    void startDevCourseFromFirebase();
                  } else if (c.type === 'firebase' && c.courseData) {
                    void startFirebaseCourse(c.courseData);
                  }
                }
              }
            };
            return;
          }
          if (hs.action === 'courseCreator' && userProfile.role === 'admin') {
            // Open Course Creator overlay for admin users
            void showUiCourseCreator([]);
            return;
          }
        }
      }
    }
  }
  // Handle User Levels screen clicks
  if (gameState === 'userLevels') {
    // Check for level item clicks and button clicks
    for (const hs of userLevelsHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'levelItem' && typeof hs.index === 'number') {
          selectedUserLevelIndex = hs.index;
          userLevelsState.selectedLevelIndex = hs.index;
          return;
        }
        if (hs.kind === 'btn') {
          if (hs.action === 'back') {
            gameState = 'course';
            return;
          }
          const sel = filteredUserLevelsList[selectedUserLevelIndex];
          if (!sel) return;
          if (hs.action === 'play') {
            uiOverlay = {
              kind: 'confirm', title: 'Load Level', message: `Load "${sel.name}" by ${sel.author || 'Unknown'}?`, cancelable: true,
              resolve: (ok) => { uiOverlay = { kind: 'none' }; if (ok) void playUserLevel(sel); }
            };
            return;
          }
          if (hs.action === 'edit') {
            void editUserLevel(sel);
            return;
          }
          if (hs.action === 'duplicate') {
            void duplicateUserLevel(sel);
            return;
          }
          if (hs.action === 'delete') {
            void deleteUserLevel(sel);
            return;
          }
        }
        if (hs.kind === 'filter' && hs.filterId) {
          userLevelsState.filterSource = hs.filterId as any;
          levelFilterSource = hs.filterId;
          applyLevelFilters();
          return;
        }
        if (hs.kind === 'search') {
          (async () => {
            const query = await showUiPrompt('Search levels by name or author:', userLevelsState.searchQuery, 'Search Levels');
            if (query !== null) {
              userLevelsState.searchQuery = query;
              levelSearchQuery = query;
              applyLevelFilters();
            }
          })();
          return;
        }
      }
    }
  }
  // Handle Level Editor interactions - delegate to levelEditor module
  if (gameState === 'levelEditor') {
    const editorEnv = {
      ctx,
      width: WIDTH,
      height: HEIGHT,
      canvasToPlayCoords: (x: number, y: number) => {
        const pp = canvasToPlayCoords({ x, y });
        return { x: pp.x, y: pp.y };
      },
      worldFromEvent: (ev: MouseEvent) => worldFromEvent(ev),
      isOverlayActive,
      renderGlobalOverlays,
      fairwayRect: () => ({
        x: COURSE_MARGIN,
        y: COURSE_MARGIN,
        w: Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2),
        h: Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2),
      }),
      getGridSize: () => 20,
      setGridSize: () => {},
      getShowGrid: () => true,
      setShowGrid: () => {},
      showToast: (msg: string) => showUiToast(msg),
      showConfirm: (msg: string, title?: string) => showUiConfirm(msg, title),
      showPrompt: (msg: string, def?: string, title?: string) => showUiPrompt(msg, def, title),
      showMetadataForm: (init: any, title?: string) => showUiMetadataForm(init, title),
      showList: (title: string, items: Array<{label: string; value: any}>, startIndex?: number) => showUiList(title, items, startIndex),
      showDnDList: async (title: string, items: Array<{label: string; value: any}>) => {
        const res = await showUiDnDList(title, items as any);
        return res ? res.map(it => ({ label: it.label, value: (it as any).value })) : null;
      },
      showLoadLevels: (levels: Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }>) => showUiLoadLevels(levels),
      showImportReview: (init: any) => showUiImportReview(init),
      showAnnotateScreenshot: (file: File, opts: any) => showAnnotateScreenshot(file, opts),
      showCourseEditor: (courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] }) => showUiCourseEditor(courseData),
      showUiCourseCreator: (courseList: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>) => showUiCourseCreator(courseList),
      getGlobalState: () => ({
        WIDTH,
        HEIGHT,
        COURSE_MARGIN,
        ball,
        hole,
        levelCanvas,
        walls,
        sands,
        sandsPoly,
        waters,
        watersPoly,
        decorations,
        hills,
        bridges,
        posts,
        polyWalls,
        userProfile
      }),
      setGlobalState: (state: any) => {
        if (state.levelCanvas) levelCanvas = state.levelCanvas;
        if (state.walls) walls = state.walls;
        if (state.sands) sands = state.sands;
        if (state.sandsPoly) sandsPoly = state.sandsPoly;
        if (state.waters) waters = state.waters;
        if (state.watersPoly) watersPoly = state.watersPoly;
        if (state.decorations) decorations = state.decorations;
        if (state.hills) hills = state.hills;
        if (state.bridges) bridges = state.bridges;
        if (state.posts) posts = state.posts;
        if (state.polyWalls) polyWalls = state.polyWalls;
        if (state.ball) { ball.x = state.ball.x; ball.y = state.ball.y; ball.vx = state.ball.vx; ball.vy = state.ball.vy; ball.moving = state.ball.moving; }
        if (state.hole) { hole.x = state.hole.x; hole.y = state.hole.y; if (state.hole.r !== undefined) (hole as any).r = state.hole.r; }
      },
      getUserId,
      exitToMenu: () => { try { levelEditor.reset(); } catch {} gameState = 'menu'; },
      testLevel: testLevelFromEditor,
      getUserName: () => ((userProfile?.name ?? getUserId()) + ''),
      getUserRole: () => userProfile.role
    };
    levelEditor.handleMouseDown(e, editorEnv);
    return;
  }
  // Handle Options Back button
  if (gameState === 'options') {
    const back = getCourseBackRect();
    if (p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h) { gameState = previousGameState; return; }
    // Volume controls
    const vm = getOptionsVolMinusRect();
    if (p.x >= vm.x && p.x <= vm.x + vm.w && p.y >= vm.y && p.y <= vm.y + vm.h) { AudioSfx.setVolume(AudioSfx.volume - 0.1); return; }
    const vp = getOptionsVolPlusRect();
    if (p.x >= vp.x && p.x <= vp.x + vp.w && p.y >= vp.y && p.y <= vp.y + vp.h) { AudioSfx.setVolume(AudioSfx.volume + 0.1); return; }
    const mu = getOptionsMuteRect();
    if (p.x >= mu.x && p.x <= mu.x + mu.w && p.y >= mu.y && p.y <= mu.y + mu.h) { AudioSfx.toggleMute(); return; }
    const vs = getOptionsVolSliderRect();
    if (p.x >= vs.x && p.x <= vs.x + vs.w && p.y >= vs.y - 6 && p.y <= vs.y + vs.h + 6) {
      // begin slider drag
      isOptionsVolumeDragging = true;
      const t = Math.max(0, Math.min(1, (p.x - vs.x) / vs.w));
      AudioSfx.setVolume(t);
      return;
    }
    // Slope arrows toggle
    const tog = getOptionsSlopeToggleRect();
    if (p.x >= tog.x && p.x <= tog.x + tog.w && p.y >= tog.y && p.y <= tog.y + tog.h) { showSlopeArrows = !showSlopeArrows; return; }
    // Users button removed from Options (access via Shift+F after Start)
  }
  
  // Admin Menu actions
  if (gameState === 'adminMenu') {
    for (const hs of adminMenuHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'levelManagement') {
          gameState = 'levelManagement';
          // Load all levels for admin management
          (async () => {
            try {
              if (firebaseReady) {
                // Get raw Firebase levels directly to access authorId
                const { FirebaseDatabase } = await import('./firebase/database.js');
                const publicLevels = await FirebaseDatabase.getLevels();
                const allUserLevels = await FirebaseDatabase.getAllUserLevels();
                const allRawLevels = [...publicLevels, ...allUserLevels];
                console.log('Level Management: All raw Firebase levels with authorId:', allRawLevels);
                
                levelManagementState.levels = allRawLevels.map(level => ({
                  id: level.id,
                  title: level.title,
                  author: level.authorName || 'Unknown',
                  authorId: level.authorId,
                  lastModified: level.lastModified || 0,
                  data: level.data
                }));
                levelManagementState.selectedLevelIndex = -1;
                levelManagementState.scrollOffset = 0;
              }
            } catch (e) {
              console.error('Failed to load levels for management:', e);
              showUiToast('Failed to load levels');
            }
          })();
          return;
        } else if (hs.kind === 'userManagement') {
          gameState = 'users';
          return;
        } else if (hs.kind === 'gameSettings') {
          // Load current game settings from Firebase (if available)
          (async () => {
            try {
              if (firebaseReady) {
                const { FirebaseDatabase } = await import('./firebase/database.js');
                const gs = await FirebaseDatabase.getGameSettings();
                if (gs) {
                  gameSettingsState.slopeAccel = typeof gs.slopeAccel === 'number' ? gs.slopeAccel : physicsSlopeAccel;
                  gameSettingsState.frictionK = typeof gs.frictionK === 'number' ? gs.frictionK : physicsFrictionK;
                  gameSettingsState.sandMultiplier = typeof gs.sandMultiplier === 'number' ? gs.sandMultiplier : physicsSandMultiplier;
                  gameSettingsState.baselineShotPx = typeof gs.baselineShotPx === 'number' ? gs.baselineShotPx : gameSettingsState.baselineShotPx;
                  gameSettingsState.turnPenaltyPerTurn = typeof gs.turnPenaltyPerTurn === 'number' ? gs.turnPenaltyPerTurn : gameSettingsState.turnPenaltyPerTurn;
                  gameSettingsState.hillBump = typeof gs.hillBump === 'number' ? gs.hillBump : gameSettingsState.hillBump;
                  gameSettingsState.bankWeight = typeof gs.bankWeight === 'number' ? gs.bankWeight : gameSettingsState.bankWeight;
                } else {
                  gameSettingsState.slopeAccel = physicsSlopeAccel;
                  gameSettingsState.frictionK = physicsFrictionK;
                  gameSettingsState.sandMultiplier = physicsSandMultiplier;
                  // keep defaults for heuristic coefficients
                }
              } else {
                gameSettingsState.slopeAccel = physicsSlopeAccel;
                gameSettingsState.frictionK = physicsFrictionK;
                gameSettingsState.sandMultiplier = physicsSandMultiplier;
              }
              gameState = 'gameSettings';
            } catch (e) {
              console.error('Failed to load game settings', e);
              showUiToast('Failed to load game settings');
            }
          })();
          return;
        } else if (hs.kind === 'back') {
          gameState = previousGameState;
          return;
        }
      }
    }
  }

  // Game Settings actions
  if (gameState === 'gameSettings') {
    for (const hs of gameSettingsHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        const applySlider = (field: GameSettingsField, x: number) => {
          // map x within slider rect to value
          const s = gameSettingsHotspots.find(h => h.kind === 'slider' && h.field === field)!;
          const t = clamp((x - s.x) / s.w, 0, 1);
          if (field === 'slope') gameSettingsState.slopeAccel = Math.round(200 + t * (2000 - 200));
          if (field === 'friction') gameSettingsState.frictionK = +(0.2 + t * (2.0 - 0.2)).toFixed(2);
          if (field === 'sand') gameSettingsState.sandMultiplier = +(1 + t * (10 - 1)).toFixed(2);
          if (field === 'baseline') gameSettingsState.baselineShotPx = Math.round(200 + t * (500 - 200));
          if (field === 'turnPenalty') gameSettingsState.turnPenaltyPerTurn = +(0.00 + t * (0.30 - 0.00)).toFixed(3);
          if (field === 'hillBump') gameSettingsState.hillBump = +(0.00 + t * (1.00 - 0.00)).toFixed(2);
          if (field === 'bankWeight') gameSettingsState.bankWeight = +(0.00 + t * (0.50 - 0.00)).toFixed(2);
        };
        if (hs.kind === 'minus' && hs.field) {
          if (hs.field === 'slope') gameSettingsState.slopeAccel = clamp(gameSettingsState.slopeAccel - 20, 200, 2000);
          if (hs.field === 'friction') gameSettingsState.frictionK = clamp(+((gameSettingsState.frictionK - 0.05).toFixed(2)), 0.2, 2.0);
          if (hs.field === 'sand') gameSettingsState.sandMultiplier = clamp(+((gameSettingsState.sandMultiplier - 0.2).toFixed(2)), 1.0, 10.0);
          if (hs.field === 'baseline') gameSettingsState.baselineShotPx = clamp(gameSettingsState.baselineShotPx - 5, 200, 500);
          if (hs.field === 'turnPenalty') gameSettingsState.turnPenaltyPerTurn = clamp(+((gameSettingsState.turnPenaltyPerTurn - 0.01).toFixed(3)), 0.00, 0.30);
          if (hs.field === 'hillBump') gameSettingsState.hillBump = clamp(+((gameSettingsState.hillBump - 0.02).toFixed(2)), 0.00, 1.00);
          if (hs.field === 'bankWeight') gameSettingsState.bankWeight = clamp(+((gameSettingsState.bankWeight - 0.01).toFixed(2)), 0.00, 0.50);
          return;
        }
        if (hs.kind === 'plus' && hs.field) {
          if (hs.field === 'slope') gameSettingsState.slopeAccel = clamp(gameSettingsState.slopeAccel + 20, 200, 2000);
          if (hs.field === 'friction') gameSettingsState.frictionK = clamp(+((gameSettingsState.frictionK + 0.05).toFixed(2)), 0.2, 2.0);
          if (hs.field === 'sand') gameSettingsState.sandMultiplier = clamp(+((gameSettingsState.sandMultiplier + 0.2).toFixed(2)), 1.0, 10.0);
          if (hs.field === 'baseline') gameSettingsState.baselineShotPx = clamp(gameSettingsState.baselineShotPx + 5, 200, 500);
          if (hs.field === 'turnPenalty') gameSettingsState.turnPenaltyPerTurn = clamp(+((gameSettingsState.turnPenaltyPerTurn + 0.01).toFixed(3)), 0.00, 0.30);
          if (hs.field === 'hillBump') gameSettingsState.hillBump = clamp(+((gameSettingsState.hillBump + 0.02).toFixed(2)), 0.00, 1.00);
          if (hs.field === 'bankWeight') gameSettingsState.bankWeight = clamp(+((gameSettingsState.bankWeight + 0.01).toFixed(2)), 0.00, 0.50);
          return;
        }
        if (hs.kind === 'slider' && hs.field) {
          applySlider(hs.field, p.x);
          return;
        }
        if (hs.kind === 'save') {
          (async () => {
            try {
              if (!firebaseReady) { showUiToast('Firebase not ready'); return; }
              const { FirebaseDatabase } = await import('./firebase/database.js');
              await FirebaseDatabase.updateGameSettings({
                slopeAccel: gameSettingsState.slopeAccel,
                frictionK: gameSettingsState.frictionK,
                sandMultiplier: gameSettingsState.sandMultiplier,
                baselineShotPx: gameSettingsState.baselineShotPx,
                turnPenaltyPerTurn: gameSettingsState.turnPenaltyPerTurn,
                hillBump: gameSettingsState.hillBump,
                bankWeight: gameSettingsState.bankWeight
              });
              // Apply runtime
              physicsSlopeAccel = gameSettingsState.slopeAccel;
              physicsFrictionK = gameSettingsState.frictionK;
              physicsSandMultiplier = gameSettingsState.sandMultiplier;
              showUiToast('Game settings saved');
            } catch (e) {
              console.error('Failed to save game settings', e);
              showUiToast('Failed to save settings');
            }
          })();
          return;
        }
        if (hs.kind === 'cancel' || hs.kind === 'back') {
          gameState = 'adminMenu';
          return;
        }
      }
    }
  }
  
  // Level Management actions
  if (gameState === 'levelManagement') {
    for (const hs of levelManagementHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'back') {
          gameState = 'adminMenu';
          return;
        } else if (hs.kind === 'levelItem' && hs.levelId) {
          const levelIndex = levelManagementState.levels.findIndex(l => l.id === hs.levelId);
          if (levelIndex >= 0) {
            levelManagementState.selectedLevelIndex = levelIndex;
          }
          return;
        } else if (hs.kind === 'delete' && hs.levelId) {
          const level = levelManagementState.levels.find(l => l.id === hs.levelId);
          if (level && firebaseReady) {
            // Store the level info for the async operation
            const levelToDelete = { 
              id: level.id, 
              title: level.title, 
              author: level.author,
              authorId: level.authorId 
            };
            
            console.log('Level Management: Attempting to delete level:', levelToDelete);
            
            // Use the same pattern as other delete operations in the codebase
            showUiConfirm(`Delete level "${levelToDelete.title}" by ${levelToDelete.author}?`, 'Delete Level')
              .then(confirmed => {
                if (confirmed) {
                  console.log('Level Management: User confirmed deletion, calling Firebase delete');
                  // Pass authorId as the userId parameter for proper Firebase path
                  return firebaseManager.levels.deleteLevel(levelToDelete.id, levelToDelete.authorId)
                    .then(() => {
                      console.log('Level Management: Firebase delete successful, updating state');
                      // Update state after successful deletion
                      levelManagementState.levels = levelManagementState.levels.filter(l => l.id !== levelToDelete.id);
                      levelManagementState.selectedLevelIndex = -1;
                      showUiToast(`Deleted "${levelToDelete.title}"`);
                    });
                } else {
                  console.log('Level Management: User cancelled deletion');
                }
                // If not confirmed, do nothing
                return Promise.resolve();
              })
              .catch(e => {
                console.error('Level Management: Failed to delete level:', e);
                showUiToast('Failed to delete level');
              });
          }
          return;
        }
      }
    }
  }
  // Users admin actions
  if (gameState === 'users') {
    // Blur search unless search box is clicked
    usersSearchActive = false;
    for (const hs of usersUiHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (!firebaseReady) { showUiToast('Firebase services are not ready yet.'); return; }
        if (uiOverlay.kind !== 'none') return; // swallow clicks under overlays
        try {
          switch (hs.kind) {
            case 'back':
              gameState = 'adminMenu';
              break;
            case 'listItem':
              if (typeof hs.index === 'number') {
                usersState.selectedIndex = hs.index;
              }
              break;
            case 'search':
              usersSearchActive = true;
              try { (canvas as any).focus({ preventScroll: true }); } catch {}
              break;
            case 'promote':
            case 'demote':
              if (hs.id) {
                const userId = hs.id;
                (async () => {
                  try { await firebaseManager.users.toggleRole(userId, getUserId()); }
                  catch (e) { showUiToast('Failed to update user role.'); }
                })();
              }
              break;
            case 'enable':
              if (hs.id) {
                const userId = hs.id;
                (async () => {
                  try { await firebaseManager.users.setEnabled(userId, true); }
                  catch (e) { showUiToast('Failed to enable user.'); }
                })();
              }
              break;
            case 'disable':
              if (hs.id) {
                const userId = hs.id;
                (async () => {
                  try { await firebaseManager.users.setEnabled(userId, false); }
                  catch (e) { showUiToast('Failed to disable user.'); }
                })();
              }
              break;
            case 'remove':
              if (hs.id) {
                const id = hs.id;
                (async () => {
                  const ok = await showUiConfirm('Remove this user? This cannot be undone.');
                  if (ok) {
                    try { await firebaseManager.users.removeUser(id); }
                    catch (e) { showUiToast('Failed to remove user.'); }
                  }
                })();
              }
              break;
            default:
              break;
          }
        } catch (e) {
          showUiToast((e as any)?.message || 'Operation failed');
        }
        return;
      }
    }
    return;
  }
  // Handle HUD Menu button first (toggles pause)
  if (!paused) {
    const r = getMenuRect();
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      paused = !paused;
      return;
    }
  }
  if (gameState === 'changelog') {
    const bk = getChangelogBackRect();
    if (p.x >= bk.x && p.x <= bk.x + bk.w && p.y >= bk.y && p.y <= bk.y + bk.h) {
      gameState = 'menu';
      return;
    }
    // drag-to-scroll start
    const cr = getChangelogContentRect();
    if (p.x >= cr.x && p.x <= cr.x + cr.w && p.y >= cr.y && p.y <= cr.y + cr.h) {
      isChangelogDragging = true;
      changelogDragStartY = p.y;
      changelogScrollStartY = changelogScrollY;
      return;
    }
  }
  // Click-to-continue via mousedown for immediate feedback
  if (!paused && gameState === 'sunk') { advanceAfterSunk(); return; }
  // Do not handle summary actions on mousedown to avoid double-trigger with click
  if (!paused && gameState === 'summary') { return; }
  if (paused || gameState !== 'play') return; // disable while paused or not in play state
  if (ball.moving) return;
  const pp = canvasToPlayCoords(p);
  const dx = pp.x - ball.x;
  const dy = pp.y - ball.y;
  const dist2 = dx * dx + dy * dy;
  if (dist2 <= (ball.r + 4) * (ball.r + 4)) {
    isAiming = true;
    aimStart = { x: ball.x, y: ball.y };
    aimCurrent = pp;
  }
});

canvas.addEventListener('mousemove', (e) => {
  const p = worldFromEvent(e); // canvas coords
  // Hover for menus
  if (gameState === 'menu') {
    const s = getMainStartRect();
    const le = getMainLevelEditorRect();
    const o = getMainOptionsRect();
    const nr = getMainNameRect();
    hoverMainStart = p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
    hoverMainLevelEditor = p.x >= le.x && p.x <= le.x + le.w && p.y >= le.y && p.y <= le.y + le.h;
    hoverMainOptions = p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h;
    hoverMainName = p.x >= nr.x && p.x <= nr.x + nr.w && p.y >= nr.y && p.y <= nr.y + nr.h;
    const cg = getMainChangelogRect();
    hoverMainChangelog = p.x >= cg.x && p.x <= cg.x + cg.w && p.y >= cg.y && p.y <= cg.y + cg.h;
    if (hoverMainName || isEditingUserName) {
      canvas.style.cursor = 'text';
    } else {
      const canStart = isStartEnabled();
      const showPointer = (hoverMainOptions || hoverMainChangelog || ((hoverMainStart || hoverMainLevelEditor) && canStart));
      canvas.style.cursor = showPointer ? 'pointer' : 'default';
    }
    return;
  }
  if (gameState === 'levelEditor') {
    // Delegate to editor for hover/drag logic and derive cursor from editor hotspots
    const editorEnv = {
      ctx,
      width: WIDTH,
      height: HEIGHT,
      canvasToPlayCoords: (x: number, y: number) => {
        const pp = canvasToPlayCoords({ x, y });
        return { x: pp.x, y: pp.y };
      },
      worldFromEvent: (ev: MouseEvent) => worldFromEvent(ev),
      isOverlayActive,
      renderGlobalOverlays,
      fairwayRect: () => ({
        x: COURSE_MARGIN,
        y: COURSE_MARGIN,
        w: Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2),
        h: Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2),
      }),
      getGridSize: () => 20,
      setGridSize: () => {},
      getShowGrid: () => true,
      setShowGrid: () => {},
      showToast: (msg: string) => showUiToast(msg),
      showConfirm: (msg: string, title?: string) => showUiConfirm(msg, title),
      showPrompt: (msg: string, def?: string, title?: string) => showUiPrompt(msg, def, title),
      showMetadataForm: (init: any, title?: string) => showUiMetadataForm(init, title),
      showList: (title: string, items: Array<{label: string; value: any}>, startIndex?: number) => showUiList(title, items, startIndex),
      showDnDList: async (title: string, items: Array<{label: string; value: any}>) => {
        const res = await showUiDnDList(title, items as any);
        return res ? res.map(it => ({ label: it.label, value: (it as any).value })) : null;
      },
      showLoadLevels: (levels: Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }>) => showUiLoadLevels(levels),
      showImportReview: (init: any) => showUiImportReview(init),
      showAnnotateScreenshot: (file: File, opts: any) => showAnnotateScreenshot(file, opts),
      showCourseEditor: (courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] }) => showUiCourseEditor(courseData),
      showUiCourseCreator: (courseList: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>) => showUiCourseCreator(courseList),
      getGlobalState: () => ({
        WIDTH,
        HEIGHT,
        COURSE_MARGIN,
        ball,
        hole,
        levelCanvas,
        walls,
        sands,
        sandsPoly,
        waters,
        watersPoly,
        decorations,
        hills,
        bridges,
        posts,
        polyWalls,
        userProfile,
        // expose heuristic coefficients for editor
        baselineShotPx: gameSettingsState.baselineShotPx,
        turnPenaltyPerTurn: gameSettingsState.turnPenaltyPerTurn,
        hillBump: gameSettingsState.hillBump,
        bankWeight: gameSettingsState.bankWeight,
        sandSkimEnabled: sandSkimEnabled,
        showSlopeArrows: showSlopeArrows
      }),
      setGlobalState: (state: any) => {
        if (state.levelCanvas) levelCanvas = state.levelCanvas;
        if (state.walls) walls = state.walls;
        if (state.sands) sands = state.sands;
        if (state.sandsPoly) sandsPoly = state.sandsPoly;
        if (state.waters) waters = state.waters;
        if (state.watersPoly) watersPoly = state.watersPoly;
        if (state.decorations) decorations = state.decorations;
        if (state.hills) hills = state.hills;
        if (state.bridges) bridges = state.bridges;
        if (state.posts) posts = state.posts;
        if (state.polyWalls) polyWalls = state.polyWalls;
        if (state.ball) { ball.x = state.ball.x; ball.y = state.ball.y; ball.vx = state.ball.vx; ball.vy = state.ball.vy; ball.moving = state.ball.moving; }
        if (state.hole) { hole.x = state.hole.x; hole.y = state.hole.y; if (state.hole.r !== undefined) (hole as any).r = state.hole.r; }
      },
      getUserId,
      exitToMenu: () => { try { levelEditor.reset(); } catch {} gameState = 'menu'; },
      testLevel: testLevelFromEditor,
      getUserName: () => ((userProfile?.name ?? getUserId()) + ''),
      getUserRole: () => userProfile.role
    };
    levelEditor.handleMouseMove(e as MouseEvent, editorEnv);
    // Cursor: pointer over UI hotspots, crosshair for placement tools, default otherwise
    const hotspots = levelEditor.getUiHotspots();
    const overUI = hotspots.some(hs => p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h);
    const tool = levelEditor.getSelectedTool();
    const wantsCrosshair = !overUI && (tool === 'tee' || tool === 'cup' || tool === 'post' || tool === 'wall' || tool === 'bridge' || tool === 'water' || tool === 'sand' || tool === 'hill');
    canvas.style.cursor = overUI ? 'pointer' : (wantsCrosshair ? 'crosshair' : 'default');
    return;
  }
  if (gameState === 'changelog') {
    const bk = getChangelogBackRect();
    hoverChangelogBack = p.x >= bk.x && p.x <= bk.x + bk.w && p.y >= bk.y && p.y <= bk.y + bk.h;
    if (isChangelogDragging) {
      const dy = p.y - changelogDragStartY;
      changelogScrollY = changelogScrollStartY - dy;
      clampChangelogScroll();
    }
    canvas.style.cursor = hoverChangelogBack ? 'pointer' : 'default';
    return;
  }
  if (gameState === 'course') {
    // Check for hover over course items and buttons
    let hovering = false;
    for (const hs of courseSelectHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        hovering = true;
        break;
      }
    }
    canvas.style.cursor = hovering ? 'pointer' : 'default';
    return;
  }
  if (gameState === 'userLevels') {
    // Inspect current hotspots to drive hover feedback (buttons, list, filters, search)
    let overAny = false;
    let overBtn: string | null = null;
    hoverUserLevelsRowIndex = null;
    hoverUserLevelsSearch = false;
    hoverUserLevelsFilterId = null;
    for (const hs of userLevelsHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        overAny = true;
        if (hs.kind === 'btn' && hs.action) overBtn = hs.action;
        if (hs.kind === 'levelItem' && typeof hs.index === 'number') hoverUserLevelsRowIndex = hs.index as any;
        if (hs.kind === 'search') hoverUserLevelsSearch = true;
        if (hs.kind === 'filter' && hs.filterId) hoverUserLevelsFilterId = String(hs.filterId);
        break;
      }
    }
    hoverUserLevelsAction = overBtn;
    // Text cursor over search; pointer over actionable; default otherwise
    if (hoverUserLevelsSearch) {
      canvas.style.cursor = 'text';
    } else {
      canvas.style.cursor = overAny ? 'pointer' : 'default';
    }
    return;
  }
  if (gameState === 'summary') {
    const back = getCourseBackRect();
    hoverSummaryBack = p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h;
    canvas.style.cursor = hoverSummaryBack ? 'pointer' : 'default';
    return;
  }
  if (gameState === 'options') {
    const back = getCourseBackRect();
    hoverOptionsBack = p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h;
    const vm = getOptionsVolMinusRect();
    const vp = getOptionsVolPlusRect();
    const mu = getOptionsMuteRect();
    const vs = getOptionsVolSliderRect();
    const tog = getOptionsSlopeToggleRect();
    hoverOptionsVolMinus = p.x >= vm.x && p.x <= vm.x + vm.w && p.y >= vm.y && p.y <= vm.y + vm.h;
    hoverOptionsVolPlus = p.x >= vp.x && p.x <= vp.x + vp.w && p.y >= vp.y && p.y <= vp.y + vp.h;
    hoverOptionsMute = p.x >= mu.x && p.x <= mu.x + mu.w && p.y >= mu.y && p.y <= mu.y + mu.h;
    hoverOptionsVolSlider = p.x >= vs.x && p.x <= vs.x + vs.w && p.y >= vs.y - 6 && p.y <= vs.y + vs.h + 6;
    hoverOptionsSlopeToggle = p.x >= tog.x && p.x <= tog.x + tog.w && p.y >= tog.y && p.y <= tog.y + tog.h;
    if (isOptionsVolumeDragging) {
      const t = Math.max(0, Math.min(1, (p.x - vs.x) / vs.w));
      AudioSfx.setVolume(t);
    }
    canvas.style.cursor = (hoverOptionsBack || hoverOptionsVolMinus || hoverOptionsVolPlus || hoverOptionsMute || hoverOptionsVolSlider || hoverOptionsSlopeToggle || hoverOptionsUsers) ? 'pointer' : 'default';
    return;
  }
  if (gameState === 'users') {
    // Pointer feedback based on hotspots with hover state tracking
    let over = false;
    hoverUsersBtnKind = null; hoverUsersListIndex = null; hoverUsersSearch = false;
    for (const hs of usersUiHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        over = true;
        if (hs.kind === 'listItem' && typeof hs.index === 'number') hoverUsersListIndex = hs.index;
        if (hs.kind === 'search') hoverUsersSearch = true;
        if (hs.kind === 'promote' || hs.kind === 'demote' || hs.kind === 'enable' || hs.kind === 'disable' || hs.kind === 'remove') hoverUsersBtnKind = hs.kind;
        break;
      }
    }
    // Text cursor over search box or while active; else pointer over actionable; default otherwise
    if (hoverUsersSearch || usersSearchActive) {
      canvas.style.cursor = 'text';
    } else {
      canvas.style.cursor = over ? 'pointer' : 'default';
    }
    return;
  }
  
  // Admin Menu hover feedback
  if (gameState === 'adminMenu') {
    let over = false; hoverAdminKind = null;
    for (const hs of adminMenuHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) { over = true; hoverAdminKind = hs.kind; break; }
    }
    canvas.style.cursor = over ? 'pointer' : 'default';
    return;
  }
  if (gameState === 'gameSettings') {
    let over = false;
    for (const hs of gameSettingsHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) { over = true; break; }
    }
    canvas.style.cursor = over ? 'pointer' : 'default';
    return;
  }
  
  // Level Management hover feedback
  if (gameState === 'levelManagement') {
    let over = false; hoverLevelMgmtRowIndex = null; hoverLevelMgmtDeleteIndex = null;
    for (const hs of levelManagementHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        over = true;
        if (hs.kind === 'levelItem' && hs.levelId) {
          const idx = levelManagementState.levels.findIndex(l => l.id === hs.levelId);
          if (idx >= 0) hoverLevelMgmtRowIndex = idx;
        } else if (hs.kind === 'delete' && hs.levelId) {
          const idx = levelManagementState.levels.findIndex(l => l.id === hs.levelId);
          if (idx >= 0) hoverLevelMgmtDeleteIndex = idx;
        }
        break;
      }
    }
    canvas.style.cursor = over ? 'pointer' : 'default';
    return;
  }

  // Course Select hover feedback
  if ((gameState as any) === 'course') {
    let over = false; hoverCourseAction = null;
    for (const hs of courseSelectHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) { over = true; hoverCourseAction = hs.action || null; break; }
    }
    canvas.style.cursor = over ? 'pointer' : 'default';
    return;
  }
  
  // Hover state for Menu button
  const r = getMenuRect();
  const over = !paused && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  hoverMenu = over;
  if (hoverMenu && !isAiming) {
    canvas.style.cursor = 'pointer';
  } else if (!isAiming) {
    canvas.style.cursor = 'default';
  }
  if (!isAiming) return;
  aimCurrent = canvasToPlayCoords(p);
});

canvas.addEventListener('mouseup', (e) => {
  // Always clear options slider drag on mouse up so it doesn't stick
  if (gameState === 'options') {
    isOptionsVolumeDragging = false;
  }
  if (gameState === 'changelog') {
    isChangelogDragging = false;
    return;
  }
  if (gameState === 'levelEditor') {
    // Delegate mouseup to levelEditor
    const editorEnv = {
      ctx,
      width: WIDTH,
      height: HEIGHT,
      canvasToPlayCoords: (x: number, y: number) => {
        const pp = canvasToPlayCoords({ x, y });
        return { x: pp.x, y: pp.y };
      },
      worldFromEvent: (ev: MouseEvent) => worldFromEvent(ev),
      isOverlayActive,
      renderGlobalOverlays,
      fairwayRect: () => ({
        x: COURSE_MARGIN,
        y: COURSE_MARGIN,
        w: Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2),
        h: Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2),
      }),
      getGridSize: () => 20,
      setGridSize: () => {},
      getShowGrid: () => true,
      setShowGrid: () => {},
      showToast: (msg: string) => showUiToast(msg),
      showConfirm: (msg: string, title?: string) => showUiConfirm(msg, title),
      showPrompt: (msg: string, def?: string, title?: string) => showUiPrompt(msg, def, title),
      showMetadataForm: (init: any, title?: string) => showUiMetadataForm(init, title),
      showList: (title: string, items: Array<{label: string; value: any}>, startIndex?: number) => showUiList(title, items, startIndex),
      showDnDList: async (title: string, items: Array<{label: string; value: any}>) => {
        const res = await showUiDnDList(title, items as any);
        return res ? res.map(it => ({ label: it.label, value: (it as any).value })) : null;
      },
      showLoadLevels: (levels: Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }>) => showUiLoadLevels(levels),
      showImportReview: (init: any) => showUiImportReview(init),
      showAnnotateScreenshot: (file: File, opts: any) => showAnnotateScreenshot(file, opts),
      showCourseEditor: (courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] }) => showUiCourseEditor(courseData),
      showUiCourseCreator: (courseList: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>) => showUiCourseCreator(courseList),
      getGlobalState: () => ({
        WIDTH,
        HEIGHT,
        COURSE_MARGIN,
        ball,
        hole,
        levelCanvas,
        walls,
        sands,
        sandsPoly,
        waters,
        watersPoly,
        decorations,
        hills,
        bridges,
        posts,
        polyWalls,
        userProfile,
        // expose heuristic coefficients for editor
        baselineShotPx: gameSettingsState.baselineShotPx,
        turnPenaltyPerTurn: gameSettingsState.turnPenaltyPerTurn,
        hillBump: gameSettingsState.hillBump,
        bankWeight: gameSettingsState.bankWeight
      }),
      setGlobalState: (state: any) => {
        if (state.levelCanvas) levelCanvas = state.levelCanvas;
        if (state.walls) walls = state.walls;
        if (state.sands) sands = state.sands;
        if (state.sandsPoly) sandsPoly = state.sandsPoly;
        if (state.waters) waters = state.waters;
        if (state.watersPoly) watersPoly = state.watersPoly;
        if (state.decorations) decorations = state.decorations;
        if (state.hills) hills = state.hills;
        if (state.bridges) bridges = state.bridges;
        if (state.posts) posts = state.posts;
        if (state.polyWalls) polyWalls = state.polyWalls;
        if (state.ball) { ball.x = state.ball.x; ball.y = state.ball.y; ball.vx = state.ball.vx; ball.vy = state.ball.vy; ball.moving = state.ball.moving; }
        if (state.hole) { hole.x = state.hole.x; hole.y = state.hole.y; if (state.hole.r !== undefined) (hole as any).r = state.hole.r; }
      },
      getUserId,
      exitToMenu: () => { gameState = 'menu'; },
      testLevel: testLevelFromEditor,
      getUserName: () => ((userProfile?.name ?? getUserId()) + ''),
      getUserRole: () => userProfile.role
    };
    levelEditor.handleMouseUp(e as MouseEvent, editorEnv);
    return;
  }
  if (!isAiming || paused || gameState !== 'play') return;
  const p = canvasToPlayCoords(worldFromEvent(e));
  const dx = p.x - aimStart.x;
  const dy = p.y - aimStart.y;
  const drag = Math.hypot(dx, dy);
  const minDrag = 4;
  isAiming = false; // always clear aim so meter hides
  if (drag < minDrag) return; // ignore tiny taps
  // clamp and scale; drag forward to shoot forward
  const maxDrag = 120;
  const clamped = Math.min(drag, maxDrag);
  const power = clamped * 4; // original tuning
  const angle = Math.atan2(dy, dx);
  ball.vx = Math.cos(angle) * power;
  ball.vy = Math.sin(angle) * power;
  // remember position to reset if water
  preShot = { x: aimStart.x, y: aimStart.y };
  ball.moving = true;
  strokes += 1;
  AudioSfx.playPutt();
});

// Click handler to be extra robust for continue actions on banners
canvas.addEventListener('click', (e) => {
  if (paused) return;
  if (gameState === 'changelog') return; // clicks do nothing on the changelog surface
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - lastAdvanceFromSunkMs < CLICK_SWALLOW_MS) {
    // Swallow the click that follows a mousedown-driven advance
    return;
  }
  if (gameState === 'sunk') {
    // Clear any pending summary timer and advance immediately
    if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
    advanceAfterSunk();
  } else if (gameState === 'summary') {
    const p = worldFromEvent(e); // canvas coords
    const back = getCourseBackRect();
    // If clicking the Main Menu button, go to menu instead of restart
    if (p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h) {
      // Reset summary-specific state and return to main menu cleanly
      paused = false;
      isAiming = false;
      ball.vx = 0; ball.vy = 0; ball.moving = false;
      summaryTimer = null;
      transitioning = false;
      holeRecorded = true;
      gameState = 'menu';
      return;
    }
    // Otherwise restart course
    paused = false;
    isAiming = false;
    summaryTimer = null;
    transitioning = false;
    courseScores = [];
    currentLevelIndex = 0;
    gameState = 'play';
    preloadLevelByIndex(1);
    loadLevelByIndex(currentLevelIndex).catch(console.error);
  }
});

// Scroll wheel support (changelog, level management)
canvas.addEventListener('wheel', (e) => {
  if (gameState === 'changelog') {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * 40;
    changelogScrollY += delta;
    clampChangelogScroll();
    return;
  }
  
  if (gameState === 'levelManagement') {
    e.preventDefault();
    const scrollDelta = Math.sign(e.deltaY);
    const visibleItems = Math.floor(400 / 52); // listH / (itemH + itemGap)
    const maxScroll = Math.max(0, levelManagementState.levels.length - visibleItems);
    levelManagementState.scrollOffset = Math.max(0, Math.min(maxScroll, levelManagementState.scrollOffset + scrollDelta));
    return;
  }
  if (gameState === 'users') {
    e.preventDefault();
    const filtered = getFilteredUsers();
    // Mirror layout math from renderer
    const panelH = Math.min(600, HEIGHT - 120);
    const pad = 20;
    const searchH = 28;
    const contentTop = (Math.floor(HEIGHT / 2 - panelH / 2) + pad + searchH + 14);
    const listY = contentTop;
    const listH = Math.max(0, (Math.floor(HEIGHT / 2 - panelH / 2) + panelH - pad - 60) - listY);
    const rowH = 36;
    const maxRows = Math.max(1, Math.floor(listH / rowH));
    const maxScroll = Math.max(0, filtered.length - maxRows);
    const delta = Math.sign(e.deltaY);
    usersState.scrollOffset = Math.max(0, Math.min(maxScroll, usersState.scrollOffset + delta));
    return;
  }
}, { passive: false });

// Dev-only: toggle bank-shot preview (robust across targets with per-event guard)
function handleDevPreviewToggle(e: KeyboardEvent) {
  // Do not process same event twice if attached on multiple targets
  if ((e as any).__devPreviewHandled) return;
  (e as any).__devPreviewHandled = true;
  if (!isDevBuild()) return;
  const key = e.key;
  if (key === 'b' || key === 'B') {
    debugPathPreview = !debugPathPreview;
    try { console.log(`[DEV] Bank-shot preview: ${debugPathPreview ? 'ON' : 'OFF'}`); } catch {}
  }
}
window.addEventListener('keydown', handleDevPreviewToggle);
document.addEventListener('keydown', handleDevPreviewToggle);
// Also listen on canvas and for keyup/keypress variants to improve capture during drags
canvas.addEventListener('keydown', handleDevPreviewToggle as any);
window.addEventListener('keyup', (e) => handleDevPreviewToggle(e as any));
document.addEventListener('keypress', (e) => handleDevPreviewToggle(e as any));
canvas.addEventListener('keypress', (e) => handleDevPreviewToggle(e as any));

// Lightweight diagnostic for any key B receipt (dev only)
function devLogAnyB(e: KeyboardEvent) {
  if (!isDevBuild()) return;
  const k = (e.key || '').toLowerCase();
  if (k === 'b') {
    try { console.log('[DEV] key event for B received:', e.type); } catch {}
  }
}
window.addEventListener('keydown', devLogAnyB);
window.addEventListener('keyup', devLogAnyB);
document.addEventListener('keydown', devLogAnyB);

// Level Editor keyboard shortcuts: delegated to levelEditor module
function handleLevelEditorKeys(e: KeyboardEvent) {
  if (gameState !== 'levelEditor') return;
  // Delegate keys to levelEditor
  const editorEnv = {
    ctx,
    width: WIDTH,
    height: HEIGHT,
    canvasToPlayCoords: (x: number, y: number) => {
      const pp = canvasToPlayCoords({ x, y });
      return { x: pp.x, y: pp.y };
    },
    worldFromEvent: (ev: MouseEvent) => worldFromEvent(ev),
    isOverlayActive,
    renderGlobalOverlays,
    fairwayRect: () => ({
      x: COURSE_MARGIN,
      y: COURSE_MARGIN,
      w: Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2),
      h: Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2),
    }),
    getGridSize: () => 20,
    setGridSize: () => {},
    getShowGrid: () => true,
    setShowGrid: () => {},
    showToast: (msg: string) => showUiToast(msg),
    showConfirm: (msg: string, title?: string) => showUiConfirm(msg, title),
    showPrompt: (msg: string, def?: string, title?: string) => showUiPrompt(msg, def, title),
    showMetadataForm: (init: any, title?: string) => showUiMetadataForm(init, title),
    showList: (title: string, items: Array<{label: string; value: any}>, startIndex?: number) => showUiList(title, items, startIndex),
    showDnDList: async (title: string, items: Array<{label: string; value: any}>) => {
      const res = await showUiDnDList(title, items as any);
      return res ? res.map(it => ({ label: it.label, value: (it as any).value })) : null;
    },
    showLoadLevels: (levels: Array<{ id: string; title: string; author: string; source: 'built-in' | 'cloud' | 'local'; data: any; lastModified?: number }>) => showUiLoadLevels(levels),
    showImportReview: (init: any) => showUiImportReview(init),
    showCourseEditor: (courseData: { id: string; title: string; levelIds: string[]; levelTitles: string[] }) => showUiCourseEditor(courseData),
    showUiCourseCreator: (courseList: Array<{ id: string; title: string; levelIds: string[]; levelTitles: string[] }>) => showUiCourseCreator(courseList),
    getGlobalState: () => ({
      WIDTH,
      HEIGHT,
      COURSE_MARGIN,
      ball,
      hole,
      levelCanvas,
      walls,
      sands,
      sandsPoly,
      waters,
      watersPoly,
      decorations,
      hills,
      bridges,
      posts,
      polyWalls,
      userProfile,
      // expose heuristic coefficients for editor
      baselineShotPx: gameSettingsState.baselineShotPx,
      turnPenaltyPerTurn: gameSettingsState.turnPenaltyPerTurn,
      hillBump: gameSettingsState.hillBump,
      bankWeight: gameSettingsState.bankWeight
    }),
    setGlobalState: (state: any) => {
      if (state.levelCanvas) levelCanvas = state.levelCanvas;
      if (state.walls) walls = state.walls;
      if (state.sands) sands = state.sands;
      if (state.sandsPoly) sandsPoly = state.sandsPoly;
      if (state.waters) waters = state.waters;
      if (state.watersPoly) watersPoly = state.watersPoly;
      if (state.decorations) decorations = state.decorations;
      if (state.hills) hills = state.hills;
      if (state.bridges) bridges = state.bridges;
      if (state.posts) posts = state.posts;
      if (state.polyWalls) polyWalls = state.polyWalls;
      if (state.ball) { ball.x = state.ball.x; ball.y = state.ball.y; ball.vx = state.ball.vx; ball.vy = state.ball.vy; ball.moving = state.ball.moving; }
      if (state.hole) { hole.x = state.hole.x; hole.y = state.hole.y; if (state.hole.r !== undefined) (hole as any).r = state.hole.r; }
    },
    getUserId,
    exitToMenu: () => { gameState = 'menu'; },
    testLevel: testLevelFromEditor,
    getUserName: () => ((userProfile?.name ?? getUserId()) + ''),
    getUserRole: () => userProfile.role
  };
  levelEditor.handleKeyDown(e, editorEnv);
}
window.addEventListener('keydown', handleLevelEditorKeys);

// Username input handling (menu only)
function handleNameEditKey(e: KeyboardEvent) {
  if (gameState !== 'menu' || !isEditingUserName) return;
  const key = e.key;
  if (key === 'Enter') { isEditingUserName = false; e.preventDefault(); return; }
  if (key === 'Escape') { isEditingUserName = false; e.preventDefault(); return; }
  if (key === 'Backspace') {
    if (userProfile.name.length > 0) {
      userProfile.name = userProfile.name.slice(0, -1);
      saveUserProfile();
    }
    e.preventDefault();
    return;
  }
  if (key.length === 1) {
    // Accept a conservative set of characters
    if (/^[A-Za-z0-9 _.'-]$/.test(key) && userProfile.name.length < 24) {
      userProfile.name += key;
      saveUserProfile();
      e.preventDefault();
    }
    return;
  }
}
window.addEventListener('keydown', handleNameEditKey);

// Admin-only: open Users UI with Shift+F after Start (not on Main Menu)
function handleAdminUsersShortcut(e: KeyboardEvent) {
  // Only allow after Start on specific screens (from Select Course onward)
  // Only allow on: course selection, in-game, sunk banner, or summary
  if (!(gameState === 'course' || gameState === 'play' || gameState === 'sunk' || gameState === 'summary')) return;
  // Require Shift+F
  const keyLower = (e.key || '').toLowerCase();
  const isShiftF = !!e.shiftKey && (e.code === 'KeyF' || keyLower === 'f');
  if (!isShiftF) return;
  // Only admins can open Admin Menu
  if (userProfile.role !== 'admin') return;
  // Transition into Admin Menu
  previousGameState = gameState;
  gameState = 'adminMenu';
  try { e.preventDefault(); } catch {}
}
window.addEventListener('keydown', handleAdminUsersShortcut);

// Users Admin: inline search typing handler
function handleUsersSearchKey(e: KeyboardEvent) {
  if (gameState !== 'users' || !usersSearchActive) return;
  if (uiOverlay.kind !== 'none') return; // don't type while overlays active
  const key = (e.key || '');
  const ctrlLike = e.ctrlKey || e.metaKey || e.altKey;
  let s = usersState.search || '';
  if (key === 'Escape') {
    usersSearchActive = false;
    try { e.preventDefault(); e.stopPropagation(); } catch {}
    return;
  }
  if (key === 'Enter') {
    usersSearchActive = false;
    try { e.preventDefault(); e.stopPropagation(); } catch {}
    return;
  }
  if (key === 'Backspace') {
    if (s.length > 0) s = s.slice(0, -1);
    usersState.search = s;
    usersState.scrollOffset = 0;
    usersState.selectedIndex = 0;
    try { e.preventDefault(); e.stopPropagation(); } catch {}
    return;
  }
  if (!ctrlLike && key.length === 1) {
    // Append printable character
    s += key;
    usersState.search = s;
    usersState.scrollOffset = 0;
    usersState.selectedIndex = 0;
    try { e.preventDefault(); e.stopPropagation(); } catch {}
    return;
  }
}
window.addEventListener('keydown', handleUsersSearchKey);

// Hover handling for Pause overlay buttons
canvas.addEventListener('mousemove', (e) => {
  if (!paused) return;
  const p = worldFromEvent(e);
  const pr = getPauseReplayRect();
  const overReplay = p.x >= pr.x && p.x <= pr.x + pr.w && p.y >= pr.y && p.y <= pr.y + pr.h;
  const pc = getPauseCloseRect();
  const overClose = p.x >= pc.x && p.x <= pc.x + pc.w && p.y >= pc.y && p.y <= pc.y + pc.h;
  const pb = getPauseBackRect();
  const overBack = p.x >= pb.x && p.x <= pb.x + pb.w && p.y >= pb.y && p.y <= pb.y + pb.h;
  const po = getPauseOptionsRect();
  const overOptions = p.x >= po.x && p.x <= po.x + po.w && p.y >= po.y && p.y <= po.y + po.h;
  hoverPauseReplay = overReplay;
  hoverPauseClose = overClose;
  hoverPauseBack = overBack;
  hoverPauseOptions = overOptions;
  canvas.style.cursor = (overReplay || overClose || overBack || overOptions) ? 'pointer' : 'default';
});

canvas.addEventListener('mousedown', (e) => {
  if (!paused) return;
  const p = worldFromEvent(e);
  const pr = getPauseReplayRect();
  if (p.x >= pr.x && p.x <= pr.x + pr.w && p.y >= pr.y && p.y <= pr.y + pr.h) {
    // Replay current hole from pause
    paused = false;
    loadLevelByIndex(currentLevelIndex).catch(console.error);
  }
  const pc = getPauseCloseRect();
  if (p.x >= pc.x && p.x <= pc.x + pc.w && p.y >= pc.y && p.y <= pc.y + pc.h) {
    // Close pause
    paused = false;
  }
  const pb = getPauseBackRect();
  if (p.x >= pb.x && p.x <= pb.x + pb.w && p.y >= pb.y && p.y <= pb.y + pb.h) {
    // Back to main menu (reset state)
    paused = false;
    gameState = 'menu';
    isAiming = false;
    ball.vx = 0; ball.vy = 0; ball.moving = false;
  }
  const po = getPauseOptionsRect();
  if (p.x >= po.x && p.x <= po.x + po.w && p.y >= po.y && p.y <= po.y + po.h) {
    // Open Options while paused
    previousGameState = 'play';
    gameState = 'options';
  }
});


function circleRectResolve(bx: number, by: number, br: number, rect: Wall) {
  // Closest point on rect to circle center
  const cx = Math.max(rect.x, Math.min(bx, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(by, rect.y + rect.h));
  const dx = bx - cx;
  const dy = by - cy;
  const dist2 = dx * dx + dy * dy;
  if (dist2 >= br * br) return null;
  // Penetration depth along minimal axis (treat AABB sides)
  // Determine which side is hit by comparing penetration distances
  const leftPen = (bx + br) - rect.x;
  const rightPen = (rect.x + rect.w) - (bx - br);
  const topPen = (by + br) - rect.y;
  const botPen = (rect.y + rect.h) - (by - br);
  const minPen = Math.min(leftPen, rightPen, topPen, botPen);
  if (minPen === leftPen) return { nx: -1, ny: 0, depth: leftPen };
  if (minPen === rightPen) return { nx: 1, ny: 0, depth: rightPen };
  if (minPen === topPen) return { nx: 0, ny: -1, depth: topPen };
  return { nx: 0, ny: 1, depth: botPen };
}

function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function pointInPolygon(px: number, py: number, pts: number[]): boolean {
  // Ray-casting algorithm
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; i += 2) {
    const xi = pts[i], yi = pts[i + 1];
    const xj = pts[j], yj = pts[j + 1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

function circleCircleResolve(bx: number, by: number, br: number, cx: number, cy: number, cr: number) {
  const dx = bx - cx;
  const dy = by - cy;
  const dist2 = dx * dx + dy * dy;
  const rsum = br + cr;
  if (dist2 >= rsum * rsum) return null;
  const dist = Math.max(0.0001, Math.sqrt(dist2));
  const nx = dx / dist;
  const ny = dy / dist;
  const depth = rsum - dist;
  return { nx, ny, depth };
}

function circleSegmentResolve(
  bx: number,
  by: number,
  br: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = bx - x1;
  const wy = by - y1;
  const len2 = vx * vx + vy * vy || 0.0001;
  let t = (wx * vx + wy * vy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = x1 + t * vx;
  const cy = y1 + t * vy;
  const dx = bx - cx;
  const dy = by - cy;
  const dist2 = dx * dx + dy * dy;
  if (dist2 >= br * br) return null;
  const dist = Math.max(0.0001, Math.sqrt(dist2));
  const nx = dx / dist;
  const ny = dy / dist;
  const depth = br - dist;
  return { nx, ny, depth };
}

let lastBounceSfxMs = 0;

function update(dt: number) {
  if (paused) return; // freeze simulation
  if (ball.moving && gameState === 'play') {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Determine if we're on a bridge (overrides underlying terrain effects)
    let onBridge = false;
    for (const b of bridges) { if (pointInRect(ball.x, ball.y, b)) { onBridge = true; break; } }

    // friction (boosted in sand unless on a bridge)
    let inSand = false;
    if (!onBridge) {
      for (const s of sands) { if (pointInRect(ball.x, ball.y, s)) { inSand = true; break; } }
      if (!inSand && sandsPoly.length > 0) {
        for (const sp of sandsPoly) { if (pointInPolygon(ball.x, ball.y, sp.points)) { inSand = true; break; } }
      }
    }
    // Velocity-dependent sand skimming: reduce sand effect at high speeds
    let mul = 1.0;
    if (inSand && !onBridge) {
      let sandMul = physicsSandMultiplier;
      const speedNow = Math.hypot(ball.vx, ball.vy);
      if (sandSkimEnabled && speedNow > sandSkimStart) {
        const t = Math.max(0, Math.min(1, (speedNow - sandSkimStart) / Math.max(1, (sandSkimFull - sandSkimStart))));
        // Interpolate from full sand multiplier at low speed to ~1x at high speed
        sandMul = 1.0 + (physicsSandMultiplier - 1.0) * (1 - t);
      }
      mul = sandMul;
    }
    const k = physicsFrictionK * mul;
    const friction = Math.exp(-k * dt);
    ball.vx *= friction;
    ball.vy *= friction;

    // Hills (slopes): apply directional acceleration inside hill zones
    let slopeAx = 0, slopeAy = 0; // track for stop-condition
    let inSlopeZone = false;
    if (hills.length > 0) {
      for (const h of hills) {
        if (!pointInRect(ball.x, ball.y, h)) continue;
        const s = (h.strength ?? 1) * physicsSlopeAccel;
        const d = h.dir;
        const dirX = (d.includes('E') ? 1 : 0) + (d.includes('W') ? -1 : 0);
        const dirY = (d.includes('S') ? 1 : 0) + (d.includes('N') ? -1 : 0);
        if (dirX === 0 && dirY === 0) continue;
        inSlopeZone = true;
        // Normalize diagonal so total accel magnitude stays consistent
        const inv = (dirX !== 0 && dirY !== 0) ? Math.SQRT1_2 : 1;
        // Constant downhill acceleration so it accelerates with slope and resists uphill
        slopeAx += dirX * s * inv;
        slopeAy += dirY * s * inv;
      }
      // Defer applying slope acceleration until after collision resolution
    }

    // Collide with walls (axis-aligned)
    let collidedThisFrame = false; // detect corner jamming
    let lastCollisionNx = 0, lastCollisionNy = 0; // track the last collision normal
    for (const w of walls) {
      const hit = circleRectResolve(ball.x, ball.y, ball.r, w);
      if (hit) {
        collidedThisFrame = true;
        lastCollisionNx = hit.nx; lastCollisionNy = hit.ny;
        // push out along normal
        ball.x += hit.nx * hit.depth;
        ball.y += hit.ny * hit.depth;
        // reflect velocity on the normal axis
        const vn = ball.vx * hit.nx + ball.vy * hit.ny; // component along normal
        ball.vx -= (1 + restitution) * vn * hit.nx;
        ball.vy -= (1 + restitution) * vn * hit.ny;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - lastBounceSfxMs > 80 && Math.abs(vn) > 50) {
          lastBounceSfxMs = now;
          AudioSfx.playBounce(Math.min(1, Math.abs(vn) / 400));
        }
      }
    }

    // Collide with round posts
    for (const p of posts) {
      const hit = circleCircleResolve(ball.x, ball.y, ball.r, p.x, p.y, p.r);
      if (hit) {
        collidedThisFrame = true;
        lastCollisionNx = hit.nx; lastCollisionNy = hit.ny;
        ball.x += hit.nx * hit.depth;
        ball.y += hit.ny * hit.depth;
        const vn = ball.vx * hit.nx + ball.vy * hit.ny;
        ball.vx -= (1 + restitution) * vn * hit.nx;
        ball.vy -= (1 + restitution) * vn * hit.ny;
      }
    }

    // Collide with polygon walls (treat each edge as a segment)
    for (const poly of polyWalls) {
      const pts = poly.points;
      if (!pts || pts.length < 4) continue;
      for (let i = 0; i < pts.length; i += 2) {
        const j = (i + 2) % pts.length;
        const x1 = pts[i];
        const y1 = pts[i + 1];
        const x2 = pts[j];
        const y2 = pts[j + 1];
        const hit = circleSegmentResolve(ball.x, ball.y, ball.r, x1, y1, x2, y2);
        if (hit) {
          collidedThisFrame = true;
          lastCollisionNx = hit.nx; lastCollisionNy = hit.ny;
          ball.x += hit.nx * hit.depth;
          ball.y += hit.ny * hit.depth;
          const vn = ball.vx * hit.nx + ball.vy * hit.ny;
          ball.vx -= (1 + restitution) * vn * hit.nx;
          ball.vy -= (1 + restitution) * vn * hit.ny;
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          if (now - lastBounceSfxMs > 80 && Math.abs(vn) > 50) {
            lastBounceSfxMs = now;
            AudioSfx.playBounce(Math.min(1, Math.abs(vn) / 400));
          }
        }
      }
    }

    // Fallback canvas bounds (if no outer walls present)
    if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -restitution; }
    if (ball.x + ball.r > WIDTH) { ball.x = WIDTH - ball.r; ball.vx *= -restitution; }
    if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy *= -restitution; }
    if (ball.y + ball.r > HEIGHT) { ball.y = HEIGHT - ball.r; ball.vy *= -restitution; }

    // Note: no extra global damping here; handled above (with sand boost)

    const speed = Math.hypot(ball.vx, ball.vy);
    const disp = Math.hypot(ball.vx * dt, ball.vy * dt);
    // Only allow stop when BOTH are small. Normally disallow stopping on hills,
    // but permit it if we collided this frame (corner jam near walls/posts).
    const hasSlopeAccel = inSlopeZone && (Math.hypot(slopeAx, slopeAy) > 1e-3);
    const allowStopDueToCorner = collidedThisFrame; // unblock endless jitter in concave corners
    // Detect jam case: slope acceleration pushing into the obstacle normal repeatedly
    const slopeMag = Math.hypot(slopeAx, slopeAy);
    // Jam when hill acceleration is pushing INTO the obstacle (opposes the surface normal)
    const pushingIntoObstacle = hasSlopeAccel && collidedThisFrame && ((slopeAx * lastCollisionNx + slopeAy * lastCollisionNy) < 0);
    
    // Debug logging for jam detection
    if (hasSlopeAccel && collidedThisFrame && speed > 10) {
      const dotProduct = slopeAx * lastCollisionNx + slopeAy * lastCollisionNy;
      console.log(`Hill collision: speed=${speed.toFixed(1)}, slopeMag=${slopeMag.toFixed(1)}, dot=${dotProduct.toFixed(2)}, jamFrames=${hillJamFrames}`);
    }
    
    // Position-based jam detection: colliding on a slope without making positional progress
    const moveDist = Math.hypot(ball.x - jamLastX, ball.y - jamLastY);
    if (inSlopeZone && collidedThisFrame) {
      if (moveDist < 1.2) {
        hillJamPosFrames = Math.min(60, hillJamPosFrames + 1);
      } else {
        hillJamPosFrames = 0;
      }
      jamLastX = ball.x; jamLastY = ball.y;
    } else {
      hillJamPosFrames = 0;
      jamLastX = ball.x; jamLastY = ball.y;
    }
    if (hillJamPosFrames >= 6) {
      // Nudge out of obstacle and heavily damp to break the bounce loop
      ball.x += lastCollisionNx * 2;
      ball.y += lastCollisionNy * 2;
      const vnJam = ball.vx * lastCollisionNx + ball.vy * lastCollisionNy;
      ball.vx -= vnJam * lastCollisionNx;
      ball.vy -= vnJam * lastCollisionNy;
      ball.vx *= 0.2;
      ball.vy *= 0.2;
      console.log(`Pos-jam resolved: frames=${hillJamPosFrames}, move=${moveDist.toFixed(2)}`);
      if (Math.hypot(ball.vx, ball.vy) < stopSpeed * 6) {
        ball.vx = 0; ball.vy = 0; ball.moving = false;
        hillJamPosFrames = 0; hillJamFrames = 0;
        return;
      } else {
        hillJamPosFrames = 0;
      }
    }
    
    if (pushingIntoObstacle) {
      hillJamFrames = Math.min(60, hillJamFrames + 1);
      // Much more aggressive damping while jammed
      if (speed < stopSpeed * 5) {
        ball.vx *= 0.3;
        ball.vy *= 0.3;
      }
      // Remove any residual velocity into the obstacle normal at higher speeds
      if (speed < stopSpeed * 6) {
        const vn = ball.vx * lastCollisionNx + ball.vy * lastCollisionNy;
        if (vn > 0) { 
          ball.vx -= vn * lastCollisionNx; 
          ball.vy -= vn * lastCollisionNy; 
        }
      }
      // Emergency stop for persistent jams
      if (hillJamFrames >= 3 && speed < stopSpeed * 8) {
        console.log(`Emergency stop: jamFrames=${hillJamFrames}, speed=${speed.toFixed(1)}`);
        ball.vx = 0; ball.vy = 0; ball.moving = false;
        hillJamFrames = 0;
        return;
      }
    } else {
      hillJamFrames = Math.max(0, hillJamFrames - 1); // decay slowly instead of instant reset
    }

    // After resolving collisions, apply slope acceleration but do not push into the obstacle
    if (inSlopeZone) {
      let ax = slopeAx, ay = slopeAy;
      if (collidedThisFrame) {
        const dotInto = ax * lastCollisionNx + ay * lastCollisionNy;
        if (dotInto < 0) {
          // Remove the inward normal component so we only keep tangential/outward accel
          ax -= dotInto * lastCollisionNx;
          ay -= dotInto * lastCollisionNy;
        }
      }
      ball.vx += ax * dt;
      ball.vy += ay * dt;
    }
    // Add a touch of extra damping when colliding at very low speeds to kill jitter
    if (collidedThisFrame && speed < stopSpeed * 1.2) {
      ball.vx *= 0.6;
      ball.vy *= 0.6;
    }
    if (
      ((!hasSlopeAccel || allowStopDueToCorner) && (speed < stopSpeed && disp < 0.25)) ||
      // Anti-jam: if hill keeps pushing into obstacle briefly and speed is moderate, stop
      (pushingIntoObstacle && hillJamFrames >= 2 && speed < stopSpeed * 6)
    ) {
      ball.vx = 0; ball.vy = 0; ball.moving = false;
      hillJamFrames = 0;
    }
  }

  // Water OOB: only while playing; bridges override water
  if (gameState === 'play') {
    // Rect water check
  for (const w of waters) {
      if (!pointInRect(ball.x, ball.y, w)) continue;
      let onBridge = false;
      for (const b of bridges) { if (pointInRect(ball.x, ball.y, b)) { onBridge = true; break; } }
      if (onBridge) continue;
      strokes += 1;
      splashes.push({ x: ball.x, y: ball.y, age: 0 });
      ball.x = preShot.x; ball.y = preShot.y; ball.vx = 0; ball.vy = 0; ball.moving = false;
      AudioSfx.playSplash();
      break;
    }
    // Polygon water check
    if (watersPoly.length > 0) {
      let inPolyWater = false;
      for (const wp of watersPoly) {
        if (!wp.points || wp.points.length < 6) continue;
        if (pointInPolygon(ball.x, ball.y, wp.points)) { inPolyWater = true; break; }
      }
      if (inPolyWater) {
        let onBridge = false;
        for (const b of bridges) { if (pointInRect(ball.x, ball.y, b)) { onBridge = true; break; } }
        if (!onBridge) {
          strokes += 1;
          splashes.push({ x: ball.x, y: ball.y, age: 0 });
          ball.x = preShot.x; ball.y = preShot.y; ball.vx = 0; ball.vy = 0; ball.moving = false;
          AudioSfx.playSplash();
        }
      }
    }
  }

  // hole capture (simple radius check)
  const dx = ball.x - hole.x;
  const dy = ball.y - hole.y;
  const dist = Math.hypot(dx, dy);
  const capture = hole.r - ball.r * 0.25; // small suction
  if (!paused && gameState === 'play' && dist < capture) {
    // snap into cup
    ball.x = hole.x;
    ball.y = hole.y;
    ball.vx = 0; ball.vy = 0;
    ball.moving = false;
    // transition to sunk (we are already in 'play')
    const isLastHole = courseInfo.index >= courseInfo.total;
    // Always show sunk banner first
    gameState = 'sunk';
    holeRecorded = false;
    if (isLastHole) {
      // record now; stay on sunk banner until user clicks or presses N
      courseScores[currentLevelIndex] = strokes;
      holeRecorded = true;
      // Record score for current user
      if (currentLevelIndex < levelPaths.length) {
        recordScore(levelPaths[currentLevelIndex], strokes);
      }
      if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
    }
    AudioSfx.playSink();
  }
}

function drawAim() {
  const dx = aimCurrent.x - aimStart.x;
  const dy = aimCurrent.y - aimStart.y;
  const len = Math.hypot(dx, dy);
  const max = 120;
  const clamped = Math.min(len, max);
  const ux = (dx / (len || 1));
  const uy = (dy / (len || 1));
  const endX = aimStart.x + ux * clamped;
  const endY = aimStart.y + uy * clamped;

  // arrow (color strengthens with power)
  const t = clamped / max;
  const color = `hsl(${Math.round(120 - 120 * t)}, 90%, 60%)`;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(aimStart.x, aimStart.y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

// Draw a small arrow centered at (cx, cy) pointing along (dx, dy) direction
// Size controls arrow length; alpha/line styles should be set by caller.
function drawSlopeIndicator(ctx: CanvasRenderingContext2D, cx: number, cy: number, dx: number, dy: number, size: number) {
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
  // arrowhead
  const head = Math.max(3, Math.min(6, size * 0.6));
  const px = -uy; // perpendicular
  const py = ux;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * head + px * head * 0.6, tipY - uy * head + py * head * 0.6);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * head - px * head * 0.6, tipY - uy * head - py * head * 0.6);
  ctx.stroke();
}

// Dev-only reflective path preview while aiming (no friction/hills/water)
function drawDebugPreview() {
  if (!isDevBuild() || !debugPathPreview) return;
  if (paused || gameState !== 'play') return;
  if (!isAiming || ball.moving) return;

  // Initial velocity mirrors shot computation on mouseup
  const dx = aimCurrent.x - aimStart.x;
  const dy = aimCurrent.y - aimStart.y;
  const drag = Math.hypot(dx, dy);
  if (drag < 2) return;
  const maxDrag = 120;
  const clamped = Math.min(drag, maxDrag);
  const angle = Math.atan2(dy, dx);
  let vx = Math.cos(angle) * clamped * 4;
  let vy = Math.sin(angle) * clamped * 4;

  // Sim state
  let px = aimStart.x;
  let py = aimStart.y;
  const r = ball.r;
  const dt = 1 / 120;
  const maxTime = 2.0; // seconds
  const maxBounces = 12;
  let t = 0;
  let bouncesCount = 0;

  // Local-only debug variables for collision preview (do not affect gameplay state)
  let lastCollisionNx = 0, lastCollisionNy = 0;
  let collidedThisFrame = false;
  // Disable slope effects in the debug preview; keep names defined to avoid TS errors
  const inSlopeZone = false;
  let slopeAx = 0, slopeAy = 0;
  let hillJamFrames = 0, hillJamPosFrames = 0;
  let jamLastX = px, jamLastY = py;
  const stopSpeed = 8;

  // Collect polyline points (thinned)
  const pts: number[] = [px, py];
  let stepCounter = 0;

  // Helper to resolve against geometry (mirrors update())
  function resolveCollisions() {
    let collided = false;
    // AABB walls
    for (const w of walls) {
      const hit = circleRectResolve(px, py, r, w);
      if (hit) {
        collided = true;
        lastCollisionNx = hit.nx; lastCollisionNy = hit.ny;
        // push out along normal
        px += hit.nx * hit.depth;
        py += hit.ny * hit.depth;
        // reflect velocity on the normal axis
        const vn = vx * hit.nx + vy * hit.ny; // component along normal
        vx -= (1 + restitution) * vn * hit.nx;
        vy -= (1 + restitution) * vn * hit.ny;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - lastBounceSfxMs > 80 && Math.abs(vn) > 50) {
          lastBounceSfxMs = now;
          AudioSfx.playBounce(Math.min(1, Math.abs(vn) / 400));
        }
      }
    }
    // Round posts
    for (const p of posts) {
      const hit = circleCircleResolve(px, py, r, p.x, p.y, p.r);
      if (hit) {
        collided = true;
        lastCollisionNx = hit.nx; lastCollisionNy = hit.ny;
        px += hit.nx * hit.depth;
        py += hit.ny * hit.depth;
        const vn = vx * hit.nx + vy * hit.ny;
        vx -= (1 + restitution) * vn * hit.nx;
        vy -= (1 + restitution) * vn * hit.ny;
      }
    }
    // Polygon walls (each edge as segment)
    for (const poly of polyWalls) {
      const pts = poly.points;
      if (!pts || pts.length < 4) continue;
      for (let i = 0; i < pts.length; i += 2) {
        const j = (i + 2) % pts.length;
        const x1 = pts[i];
        const y1 = pts[i + 1];
        const x2 = pts[j];
        const y2 = pts[j + 1];
        const hit = circleSegmentResolve(px, py, r, x1, y1, x2, y2);
        if (hit) {
          collided = true;
          lastCollisionNx = hit.nx; lastCollisionNy = hit.ny;
          px += hit.nx * hit.depth;
          py += hit.ny * hit.depth;
          const vn = vx * hit.nx + vy * hit.ny;
          vx -= (1 + restitution) * vn * hit.nx;
          vy -= (1 + restitution) * vn * hit.ny;
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          if (now - lastBounceSfxMs > 80 && Math.abs(vn) > 50) {
            lastBounceSfxMs = now;
            AudioSfx.playBounce(Math.min(1, Math.abs(vn) / 400));
          }
        }
      }
    }

    // Fallback canvas bounds (if no outer walls present)
    if (px - r < 0) { px = r; vx *= -restitution; }
    if (px + r > WIDTH) { px = WIDTH - r; vx *= -restitution; }
    if (py - r < 0) { py = r; vy *= -restitution; }
    if (py + r > HEIGHT) { py = HEIGHT - r; vy *= -restitution; }

    // Note: no extra global damping here; handled above (with sand boost)

    const speed = Math.hypot(vx, vy);
    const disp = Math.hypot(vx * dt, vy * dt);
    // Only allow stop when BOTH are small. Normally disallow stopping on hills,
    // but permit it if we collided this frame (corner jam near walls/posts).
    const hasSlopeAccel = inSlopeZone && (Math.hypot(slopeAx, slopeAy) > 1e-3);
    const allowStopDueToCorner = collidedThisFrame; // unblock endless jitter in concave corners
    // Detect jam case: slope acceleration pushing into the obstacle normal repeatedly
    const slopeMag = Math.hypot(slopeAx, slopeAy);
    // Jam when hill acceleration is pushing INTO the obstacle (opposes the surface normal)
    const pushingIntoObstacle = hasSlopeAccel && collidedThisFrame && ((slopeAx * lastCollisionNx + slopeAy * lastCollisionNy) < 0);
    
    // Debug logging for jam detection
    if (hasSlopeAccel && collidedThisFrame && speed > 10) {
      const dotProduct = slopeAx * lastCollisionNx + slopeAy * lastCollisionNy;
      console.log(`Hill collision: speed=${speed.toFixed(1)}, slopeMag=${slopeMag.toFixed(1)}, dot=${dotProduct.toFixed(2)}, jamFrames=${hillJamFrames}`);
    }
    
    // Position-based jam detection: colliding on a slope without making positional progress
    const moveDist = Math.hypot(px - jamLastX, py - jamLastY);
    if (inSlopeZone && collidedThisFrame) {
      if (moveDist < 1.2) {
        hillJamPosFrames = Math.min(60, hillJamPosFrames + 1);
      } else {
        hillJamPosFrames = 0;
      }
      jamLastX = px; jamLastY = py;
    } else {
      hillJamPosFrames = 0;
      jamLastX = px; jamLastY = py;
    }
    if (hillJamPosFrames >= 6) {
      // Nudge out of obstacle and heavily damp to break the bounce loop
      px += lastCollisionNx * 2;
      py += lastCollisionNy * 2;
      const vnJam = vx * lastCollisionNx + vy * lastCollisionNy;
      vx -= vnJam * lastCollisionNx;
      vy -= vnJam * lastCollisionNy;
      vx *= 0.2;
      vy *= 0.2;
      console.log(`Pos-jam resolved: frames=${hillJamPosFrames}, move=${moveDist.toFixed(2)}`);
      if (Math.hypot(vx, vy) < stopSpeed * 6) {
        vx = 0; vy = 0; ball.moving = false;
        hillJamPosFrames = 0; hillJamFrames = 0;
        return;
      } else {
        hillJamPosFrames = 0;
      }
    }
    
    if (pushingIntoObstacle) {
      hillJamFrames = Math.min(60, hillJamFrames + 1);
      // Much more aggressive damping while jammed
      if (speed < stopSpeed * 5) {
        vx *= 0.3;
        vy *= 0.3;
      }
      // Remove any residual velocity into the obstacle normal at higher speeds
      if (speed < stopSpeed * 6) {
        const vn = vx * lastCollisionNx + vy * lastCollisionNy;
        if (vn > 0) { 
          vx -= vn * lastCollisionNx; 
          vy -= vn * lastCollisionNy; 
        }
      }
      // Emergency stop for persistent jams
      if (hillJamFrames >= 3 && speed < stopSpeed * 8) {
        console.log(`Emergency stop: jamFrames=${hillJamFrames}, speed=${speed.toFixed(1)}`);
        vx = 0; vy = 0; ball.moving = false;
        hillJamFrames = 0;
        return;
      }
    } else {
      hillJamFrames = Math.max(0, hillJamFrames - 1); // decay slowly instead of instant reset
    }

    // After resolving collisions, apply slope acceleration but do not push into the obstacle
    if (inSlopeZone) {
      let ax = slopeAx, ay = slopeAy;
      if (collidedThisFrame) {
        const dotInto = ax * lastCollisionNx + ay * lastCollisionNy;
        if (dotInto < 0) {
          // Remove the inward normal component so we only keep tangential/outward accel
          ax -= dotInto * lastCollisionNx;
          ay -= dotInto * lastCollisionNy;
        }
      }
      vx += ax * dt;
      vy += ay * dt;
    }
    // Add a touch of extra damping when colliding at very low speeds to kill jitter
    if (collidedThisFrame && speed < stopSpeed * 1.2) {
      vx *= 0.6;
      vy *= 0.6;
    }
    if (
      ((!hasSlopeAccel || allowStopDueToCorner) && (speed < stopSpeed && disp < 0.25)) ||
      // Anti-jam: if hill keeps pushing into obstacle briefly and speed is moderate, stop
      (pushingIntoObstacle && hillJamFrames >= 2 && speed < stopSpeed * 6)
    ) {
      vx = 0; vy = 0; ball.moving = false;
      hillJamFrames = 0;
    }
  }

  // No water OOB or hole capture logic in debug preview; this is a visual guide only.
}

function draw() {
  // clear
  // background table felt
  ctx.fillStyle = COLORS.table;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // compute fairway rect from level canvas dimensions
  const offsetX = getViewOffsetX();
  const fairX = COURSE_MARGIN;
  const fairY = COURSE_MARGIN;
  const fairW = Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2);
  const fairH = Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2);
  // Main Menu screen
  if (gameState === 'menu') {
    // Panel background and border
    const p = getMainPanelRect();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

    // Title inside panel
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '32px system-ui, sans-serif';
    ctx.fillText('Vector Putt', p.x + p.w / 2, p.y + p.pad);
    // Illustration inside panel
    (function drawMainMenuGraphic() {
      const artWidth = Math.min(420, p.w - p.pad * 2 - 40);
      const artHeight = 140;
      const artX = p.x + Math.floor((p.w - artWidth) / 2);
      const artY = p.y + p.pad + 48;
      // Fairway panel
      ctx.fillStyle = COLORS.fairway;
      ctx.fillRect(artX, artY, artWidth, artHeight);
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.fairwayLine;
      ctx.strokeRect(artX + 1, artY + 1, artWidth - 2, artHeight - 2);
      // Hole cup (right side)
      const cupX = artX + artWidth * 0.75;
      const cupY = artY + artHeight * 0.55;
      const cupR = 10;
      ctx.fillStyle = COLORS.holeFill;
      ctx.beginPath();
      ctx.arc(cupX, cupY, cupR, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.holeRim;
      ctx.stroke();
      // Flagstick
      ctx.fillStyle = COLORS.wallFill;
      const stickW = 3, stickH = 36;
      ctx.fillRect(cupX - stickW / 2, cupY - stickH - cupR, stickW, stickH);
      // Flag (triangle)
      ctx.fillStyle = '#d11e2a';
      ctx.beginPath();
      ctx.moveTo(cupX + 2, cupY - stickH - cupR + 2);
      ctx.lineTo(cupX + 46, cupY - stickH - cupR + 12);
      ctx.lineTo(cupX + 2, cupY - stickH - cupR + 22);
      ctx.closePath();
      ctx.fill();
      // Ball (left)
      const ballX = artX + artWidth * 0.25;
      const ballY = artY + artHeight * 0.6;
      const ballR = 7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2);
      ctx.fill();
      // Ball shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(ballX + 2, ballY + 3, ballR * 0.9, ballR * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Putter (simple shaft + head)
      const shaftX0 = ballX - 34;
      const shaftY0 = ballY - 28;
      const shaftX1 = ballX - 8;
      const shaftY1 = ballY - 6;
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(shaftX0, shaftY0);
      ctx.lineTo(shaftX1, shaftY1);
      ctx.stroke();
      // Head (small rectangle near ball)
      ctx.fillStyle = '#e2e2e2';
      const headW = 16, headH = 6;
      ctx.save();
      ctx.translate(ballX - 16, ballY - 4);
      ctx.rotate(-0.2);
      ctx.fillRect(-headW / 2, -headH / 2, headW, headH);
      ctx.restore();
    })();

    // Dev-only: tiny watermark to confirm dev build is active
    (function drawDevWatermark() {
      if (!isDevBuild()) return;
      ctx.save();
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('DEV', 6, 4);
      ctx.restore();
    })();
    // Username input
    const nr = getMainNameRect();
    ctx.lineWidth = isEditingUserName ? 2 : 1.5;
    ctx.strokeStyle = (hoverMainName || isEditingUserName) ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(nr.x, nr.y, nr.w, nr.h);
    ctx.strokeRect(nr.x, nr.y, nr.w, nr.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const nameText = (userProfile.name || '');
    const placeholder = 'Enter name…';
    const showingPlaceholder = !isEditingUserName && nameText.trim().length === 0;
    ctx.globalAlpha = showingPlaceholder ? 0.6 : 1;
    const displayText = showingPlaceholder ? placeholder : nameText;
    ctx.fillText(displayText, nr.x + 8, nr.y + nr.h/2 + 0.5);
    ctx.globalAlpha = 1;
    // Blinking caret when editing (draw at end of current text)
    if (isEditingUserName) {
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (Math.floor(t / 500) % 2 === 0) {
        const caretX = nr.x + 8 + ctx.measureText(nameText).width;
        const cx = Math.min(nr.x + nr.w - 6, caretX);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, nr.y + 5);
        ctx.lineTo(cx, nr.y + nr.h - 5);
        ctx.stroke();
      }
    }

    // Disabled user hint below input
    {
      const typedName = (userProfile.name || '').trim();
      if (typedName && isNameDisabled(typedName)) {
        ctx.save();
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#d11e2a';
        ctx.globalAlpha = 0.9;
        const msg = 'User is disabled. Ask an admin to re-enable or select a new name.';
        ctx.fillText(msg, WIDTH/2, nr.y + nr.h + 8);
        ctx.restore();
      }
    }

    // Buttons
    const s = getMainStartRect();
    const canStart = isStartEnabled();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = canStart ? (hoverMainStart ? '#ffffff' : '#cfd2cf') : 'rgba(255,255,255,0.15)';
    ctx.fillStyle = hoverMainStart && canStart ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = canStart ? 1 : 0.5;
    ctx.fillText('Start', s.x + s.w/2, s.y + s.h/2 + 0.5);
    ctx.globalAlpha = 1;
    // Level Editor button (between Start and Options)
    const le = getMainLevelEditorRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = canStart ? (hoverMainLevelEditor ? '#ffffff' : '#cfd2cf') : 'rgba(255,255,255,0.15)';
    ctx.fillStyle = hoverMainLevelEditor && canStart ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(le.x, le.y, le.w, le.h);
    ctx.strokeRect(le.x, le.y, le.w, le.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = canStart ? 1 : 0.5;
    ctx.fillText('Level Editor', le.x + le.w/2, le.y + le.h/2 + 0.5);
    ctx.globalAlpha = 1;
    const o = getMainOptionsRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverMainOptions ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverMainOptions ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Options', o.x + o.w/2, o.y + o.h/2 + 0.5);
    // Changelog button bottom-right
    const cg = getMainChangelogRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverMainChangelog ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverMainChangelog ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(cg.x, cg.y, cg.w, cg.h);
    ctx.strokeRect(cg.x, cg.y, cg.w, cg.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Changelog', cg.x + cg.w/2, cg.y + cg.h/2 + 0.5);
    // Version bottom-left (panel)
    const pv = getMainPanelRect();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, pv.x + pv.pad, pv.y + pv.h - pv.pad);
    renderGlobalOverlays();
    return;
  }
  // Level Editor screen
  if (gameState === 'levelEditor') {
    const editorEnv = {
      ctx,
      width: WIDTH,
      height: HEIGHT,
      canvasToPlayCoords: (x: number, y: number) => {
        const pp = canvasToPlayCoords({ x, y });
        return { x: pp.x, y: pp.y };
      },
      worldFromEvent: (ev: MouseEvent) => worldFromEvent(ev),
      isOverlayActive,
      renderGlobalOverlays,
      fairwayRect: () => ({
        x: COURSE_MARGIN,
        y: COURSE_MARGIN,
        w: Math.max(0, Math.min(levelCanvas.width, WIDTH) - COURSE_MARGIN * 2),
        h: Math.max(0, Math.min(levelCanvas.height, HEIGHT) - COURSE_MARGIN * 2),
      }),
      getGridSize: () => 20,
      setGridSize: () => {},
      getShowGrid: () => true,
      setShowGrid: () => {},
      showToast: (msg: string) => showUiToast(msg),
      showConfirm: (msg: string, title?: string) => showUiConfirm(msg, title),
      showPrompt: (msg: string, def?: string, title?: string) => showUiPrompt(msg, def, title),
      showMetadataForm: (init: any, title?: string) => showUiMetadataForm(init, title),
      showImportReview: (init: any) => showUiImportReview(init),
      showAnnotateScreenshot: (file: File, opts: any) => showAnnotateScreenshot(file, opts),
      showList: (title: string, items: Array<{label: string; value: any}>, startIndex?: number) => showUiList(title, items, startIndex),
      getGlobalState: () => ({
        WIDTH,
        HEIGHT,
        COURSE_MARGIN,
        ball,
        hole,
        levelCanvas,
        walls,
        sands,
        sandsPoly,
        waters,
        watersPoly,
        decorations,
        hills,
        bridges,
        posts,
        polyWalls,
        userProfile,
        // expose heuristic coefficients for editor
        baselineShotPx: gameSettingsState.baselineShotPx,
        turnPenaltyPerTurn: gameSettingsState.turnPenaltyPerTurn,
        hillBump: gameSettingsState.hillBump,
        bankWeight: gameSettingsState.bankWeight
      }),
      setGlobalState: (state: any) => {
        if (state.levelCanvas) levelCanvas = state.levelCanvas;
        if (state.walls) walls = state.walls;
        if (state.sands) sands = state.sands;
        if (state.sandsPoly) sandsPoly = state.sandsPoly;
        if (state.waters) waters = state.waters;
        if (state.watersPoly) watersPoly = state.watersPoly;
        if (state.decorations) decorations = state.decorations;
        if (state.hills) hills = state.hills;
        if (state.bridges) bridges = state.bridges;
        if (state.posts) posts = state.posts;
        if (state.polyWalls) polyWalls = state.polyWalls;
        if (state.ball) { ball.x = state.ball.x; ball.y = state.ball.y; ball.vx = state.ball.vx; ball.vy = state.ball.vy; ball.moving = state.ball.moving; }
        if (state.hole) { hole.x = state.hole.x; hole.y = state.hole.y; if (state.hole.r !== undefined) (hole as any).r = state.hole.r; }
      },
      getUserId,
      exitToMenu: () => { gameState = 'menu'; },
      testLevel: testLevelFromEditor,
      getUserName: () => ((userProfile?.name ?? getUserId()) + ''),
      getUserRole: () => userProfile.role
    };
    levelEditor.render(editorEnv);
    renderGlobalOverlays();
    return;
  }
  
  // Admin Menu screen
  if (gameState === 'adminMenu') {
    adminMenuHotspots = [];
    
    // Background panel (centered 800x600)
    const panelW = 800, panelH = 600;
    const panelX = WIDTH/2 - panelW/2, panelY = HEIGHT/2 - panelH/2;
    
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(panelX, panelY, panelW, panelH);
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('Admin Menu', panelX + panelW/2, panelY + 40);
    
    // Menu buttons
    const btnW = 300, btnH = 60, btnGap = 30;
    const startY = panelY + 150;
    
    function drawAdminMenuBtn(label: string, kind: AdminMenuHotspot['kind'], y: number) {
      const btnX = panelX + panelW/2 - btnW/2;
      const isHover = (hoverAdminKind === kind);
      ctx.fillStyle = isHover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(btnX, y, btnW, btnH);
      ctx.strokeStyle = isHover ? '#ffffff' : '#cfd2cf';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(btnX, y, btnW, btnH);
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, btnX + btnW/2, y + btnH/2 + 0.5);
      adminMenuHotspots.push({ kind, x: btnX, y, w: btnW, h: btnH });
    }
    
    drawAdminMenuBtn('Level Management', 'levelManagement', startY);
    drawAdminMenuBtn('User Management', 'userManagement', startY + btnH + btnGap);
    drawAdminMenuBtn('Game Settings', 'gameSettings', startY + (btnH + btnGap) * 2);
    
    // Back button
    const backBtnW = 120, backBtnH = 32;
    const backX = panelX + 30, backY = panelY + panelH - backBtnH - 30;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(backX, backY, backBtnW, backBtnH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1;
    ctx.strokeRect(backX, backY, backBtnW, backBtnH);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Back', backX + backBtnW/2, backY + backBtnH/2);
    adminMenuHotspots.push({ kind: 'back', x: backX, y: backY, w: backBtnW, h: backBtnH });
    
    return;
  }
  
  // Game Settings screen (Admin)
  if (gameState === 'gameSettings') {
    gameSettingsHotspots = [];
    
    // Background panel (centered 800x600)
    const panelW = 800, panelH = 600;
    const panelX = WIDTH/2 - panelW/2, panelY = HEIGHT/2 - panelH/2;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(panelX, panelY, panelW, panelH);
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('Game Settings', panelX + panelW/2, panelY + 30);
    
    // Helper to draw a setting row with -, slider, + controls
    function drawSetting(label: string, field: GameSettingsField, y: number, min: number, max: number, step: number, valueFmt: (v:number)=>string) {
      const labelX = panelX + 40;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      const val = field === 'slope' ? gameSettingsState.slopeAccel
        : (field === 'friction' ? gameSettingsState.frictionK
        : (field === 'sand' ? gameSettingsState.sandMultiplier
        : (field === 'baseline' ? gameSettingsState.baselineShotPx
        : (field === 'turnPenalty' ? gameSettingsState.turnPenaltyPerTurn
        : (field === 'hillBump' ? gameSettingsState.hillBump : gameSettingsState.bankWeight)))));
      ctx.fillText(`${label}: ${valueFmt(val)}`, labelX, y);
      
      const rowY = y + 24;
      const minusW = 32, plusW = 32, h = 28;
      const sliderW = 400;
      const minusX = labelX;
      const sliderX = minusX + minusW + 12;
      const plusX = sliderX + sliderW + 12;
      
      // minus
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(minusX, rowY, minusW, h);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(minusX, rowY, minusW, h);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText('−', minusX + minusW/2, rowY + h/2 + 0.5);
      gameSettingsHotspots.push({ kind: 'minus', field, x: minusX, y: rowY, w: minusW, h });
      
      // slider track
      ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sliderX, rowY + h/2); ctx.lineTo(sliderX + sliderW, rowY + h/2); ctx.stroke();
      // thumb position
      const v = field === 'slope' ? gameSettingsState.slopeAccel
        : (field === 'friction' ? gameSettingsState.frictionK
        : (field === 'sand' ? gameSettingsState.sandMultiplier
        : (field === 'baseline' ? gameSettingsState.baselineShotPx
        : (field === 'turnPenalty' ? gameSettingsState.turnPenaltyPerTurn
        : (field === 'hillBump' ? gameSettingsState.hillBump : gameSettingsState.bankWeight)))));
      const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
      const thumbX = sliderX + t * sliderW;
      ctx.fillStyle = 'rgba(100,150,200,0.9)';
      ctx.beginPath(); ctx.arc(thumbX, rowY + h/2, 6, 0, Math.PI * 2); ctx.fill();
      gameSettingsHotspots.push({ kind: 'slider', field, x: sliderX, y: rowY, w: sliderW, h });
      
      // plus
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(plusX, rowY, plusW, h);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(plusX, rowY, plusW, h);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText('+', plusX + plusW/2, rowY + h/2 + 0.5);
      gameSettingsHotspots.push({ kind: 'plus', field, x: plusX, y: rowY, w: plusW, h });
    }
    
    const baseY = panelY + 100;
    drawSetting('Hill Acceleration (px/s²)', 'slope', baseY, 200, 2000, 20, v => `${Math.round(v)}`);
    drawSetting('Hill Bump', 'hillBump', baseY + 70, 0.00, 1.00, 0.02, (v)=>v.toFixed(2));
    drawSetting('Bank Weight', 'bankWeight', baseY + 140, 0.00, 0.50, 0.01, (v)=>v.toFixed(2));
    drawSetting('Sand Multiplier (×K)', 'sand', baseY + 210, 1.0, 10.0, 0.2, v => v.toFixed(2));
    
    // Buttons
    const btnW = 120, btnH = 32;
    const saveX = panelX + panelW - btnW - 30;
    const backX = saveX - btnW - 14;
    const by = panelY + panelH - btnH - 24;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(backX, by, btnW, btnH);
    ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(backX, by, btnW, btnH);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Back', backX + btnW/2, by + btnH/2 + 0.5);
    gameSettingsHotspots.push({ kind: 'back', x: backX, y: by, w: btnW, h: btnH });
    
    ctx.fillStyle = 'rgba(100,150,200,0.80)';
    ctx.fillRect(saveX, by, btnW, btnH);
    ctx.strokeStyle = 'rgba(100,150,200,1)'; ctx.lineWidth = 1; ctx.strokeRect(saveX, by, btnW, btnH);
    ctx.fillStyle = '#ffffff'; ctx.fillText('Save', saveX + btnW/2, by + btnH/2 + 0.5);
    gameSettingsHotspots.push({ kind: 'save', x: saveX, y: by, w: btnW, h: btnH });
    
    renderGlobalOverlays();
    return;
  }
  
  // Level Management screen
  if (gameState === 'levelManagement') {
    levelManagementHotspots = [];
    
    // Background panel (centered 800x600)
    const panelW = 800, panelH = 600;
    const panelX = WIDTH/2 - panelW/2, panelY = HEIGHT/2 - panelH/2;
    
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('Level Management', panelX + panelW/2, panelY + 30);
    
    // Level count
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`${levelManagementState.levels.length} levels total`, panelX + panelW/2, panelY + 70);
    
    // Scrollable level list
    const listX = panelX + 30, listY = panelY + 110;
    const listW = panelW - 60, listH = 400;
    const itemH = 50, itemGap = 2;
    const visibleItems = Math.floor(listH / (itemH + itemGap));
    const maxScroll = Math.max(0, levelManagementState.levels.length - visibleItems);
    levelManagementState.scrollOffset = Math.max(0, Math.min(maxScroll, levelManagementState.scrollOffset));
    
    // List background
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(listX, listY, listW, listH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1;
    ctx.strokeRect(listX, listY, listW, listH);
    
    // Render visible levels
    for (let i = 0; i < visibleItems && i + levelManagementState.scrollOffset < levelManagementState.levels.length; i++) {
      const levelIndex = i + levelManagementState.scrollOffset;
      const level = levelManagementState.levels[levelIndex];
      const itemY = listY + i * (itemH + itemGap);
      const isSelected = levelIndex === levelManagementState.selectedLevelIndex;
      const isHoverRow = hoverLevelMgmtRowIndex === levelIndex;
      // Item background
      ctx.fillStyle = isSelected ? 'rgba(100,150,255,0.3)' : (isHoverRow ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)');
      ctx.fillRect(listX + 2, itemY, listW - 4, itemH);
      
      // Level info
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(level.title, listX + 10, itemY + 8);
      
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#cccccc';
      ctx.fillText(`by ${level.author} • ${new Date(level.lastModified).toLocaleDateString()}`, listX + 10, itemY + 26);
      
      // Delete button
      const delBtnW = 60, delBtnH = 24;
      const delBtnX = listX + listW - delBtnW - 10, delBtnY = itemY + 13;
      const delHover = hoverLevelMgmtDeleteIndex === levelIndex;
      ctx.fillStyle = delHover ? 'rgba(255,100,100,0.95)' : 'rgba(255,100,100,0.8)';
      ctx.fillRect(delBtnX, delBtnY, delBtnW, delBtnH);
      ctx.strokeStyle = delHover ? '#ff8080' : '#ff6666';
      ctx.lineWidth = 1;
      ctx.strokeRect(delBtnX, delBtnY, delBtnW, delBtnH);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Delete', delBtnX + delBtnW/2, delBtnY + delBtnH/2);
      
      // Add hotspots
      levelManagementHotspots.push({ 
        kind: 'levelItem', 
        x: listX + 2, y: itemY, w: listW - delBtnW - 20, h: itemH,
        levelId: level.id
      });
      levelManagementHotspots.push({ 
        kind: 'delete', 
        x: delBtnX, y: delBtnY, w: delBtnW, h: delBtnH,
        levelId: level.id
      });
    }
    
    // Scrollbar if needed
    if (levelManagementState.levels.length > visibleItems) {
      const scrollbarX = listX + listW - 12;
      const scrollbarW = 8;
      const scrollbarH = listH;
      const thumbH = Math.max(20, (visibleItems / levelManagementState.levels.length) * scrollbarH);
      const thumbY = listY + (levelManagementState.scrollOffset / maxScroll) * (scrollbarH - thumbH);
      
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(scrollbarX, listY, scrollbarW, scrollbarH);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(scrollbarX, thumbY, scrollbarW, thumbH);
    }
    
    // Back button
    const backBtnW = 120, backBtnH = 40;
    const backX = panelX + 30, backY = panelY + panelH - backBtnH - 30;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(backX, backY, backBtnW, backBtnH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1;
    ctx.strokeRect(backX, backY, backBtnW, backBtnH);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Back', backX + backBtnW/2, backY + backBtnH/2);
    levelManagementHotspots.push({ kind: 'back', x: backX, y: backY, w: backBtnW, h: backBtnH });
    
    renderGlobalOverlays();
    return;
  }
  
  // Users admin screen
  if (gameState === 'users') {
    usersUiHotspots = [];
    // Panel dimensions
    const panelW = Math.min(800, WIDTH - 80);
    const panelH = Math.min(600, HEIGHT - 120);
    const margin = 20;
    const pad = 20;
    let px = Math.floor(WIDTH / 2 - panelW / 2);
    let py = Math.floor(HEIGHT / 2 - panelH / 2);
    px = Math.max(margin, Math.min(WIDTH - panelW - margin, px));
    py = Math.max(margin, Math.min(HEIGHT - panelH - margin, py));

    // Panel background
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);

    // Header
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Users', px + pad, py + pad);

    // Search box (top-right)
    const searchW = 220, searchH = 28;
    const searchX = px + panelW - pad - searchW;
    const searchY = py + pad;
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(searchX, searchY, searchW, searchH);
    ctx.strokeStyle = (hoverUsersSearch || usersSearchActive) ? '#ffffff' : '#888888';
    ctx.strokeRect(searchX + 0.5, searchY + 0.5, searchW - 1, searchH - 1);
    ctx.fillStyle = usersState.search ? '#ffffff' : '#888888';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const searchText = usersState.search || 'Search users…';
    ctx.fillText(searchText, searchX + 10, searchY + searchH/2 + 0.5);
    // Caret when active
    if (usersSearchActive) {
      const tw = ctx.measureText(usersState.search || '').width;
      const cx = searchX + 10 + tw + 1;
      const cy1 = searchY + 6, cy2 = searchY + searchH - 6;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy1); ctx.lineTo(cx, cy2); ctx.stroke();
    }
    usersUiHotspots.push({ kind: 'search', x: searchX, y: searchY, w: searchW, h: searchH });

    // Layout areas
    const contentTop = searchY + searchH + 14;
    const listW = Math.floor(panelW * 0.55);
    const rightW = panelW - listW - pad * 3;
    const listX = px + pad;
    const listY = contentTop;
    const listH = py + panelH - pad - 60 - listY; // leave action row
    const rightX = listX + listW + pad;
    const rightY = listY;
    const rightH = listH;

    // Fetch and filter users
    const allUsers = (firebaseReady ? firebaseManager.users.getAll() : []).slice();
    allUsers.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
    const q = (usersState.search || '').trim().toLowerCase();
    const filtered = q ? allUsers.filter((u: any) => (u.name || '').toLowerCase().includes(q)) : allUsers;
    const rowH = 36;
    const maxRows = Math.floor(listH / rowH);
    const maxScroll = Math.max(0, filtered.length - maxRows);
    usersState.scrollOffset = Math.max(0, Math.min(usersState.scrollOffset, maxScroll));
    if (usersState.selectedIndex >= filtered.length) usersState.selectedIndex = Math.max(0, filtered.length - 1);

    // List panel
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(listX, listY, listW, listH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1;
    ctx.strokeRect(listX, listY, listW, listH);

    // List rows
    const start = usersState.scrollOffset;
    const end = Math.min(filtered.length, start + maxRows);
    ctx.font = '14px system-ui, sans-serif';
    for (let i = start; i < end; i++) {
      const u = filtered[i];
      const y = listY + (i - start) * rowH;
      const isSel = i === usersState.selectedIndex;
      const isHover = (hoverUsersListIndex === i);
      ctx.fillStyle = isSel ? 'rgba(100,150,200,0.30)' : (isHover ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)');
      ctx.fillRect(listX + 1, y + 1, listW - 2, rowH - 2);
      // name
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(u.name || '(unnamed)', listX + 10, y + rowH/2);
      // role pill
      const role = u.role || 'user';
      ctx.fillStyle = role === 'admin' ? '#ffd700' : '#cfd2cf';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(role, listX + listW - 14, y + rowH/2);
      usersUiHotspots.push({ kind: 'listItem', index: i, x: listX, y, w: listW, h: rowH });
      ctx.font = '14px system-ui, sans-serif'; // restore
    }
    // Scrollbar
    if (filtered.length > maxRows) {
      const trackX = listX + listW - 10;
      const trackW = 6;
      const trackY = listY;
      const trackH = listH;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(trackX, trackY, trackW, trackH);
      const thumbH = Math.max(20, (maxRows / filtered.length) * trackH);
      const thumbY = trackY + (usersState.scrollOffset / maxScroll) * (trackH - thumbH);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(trackX, thumbY, trackW, thumbH);
    }

    // Right: details and actions
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(rightX, rightY, rightW, rightH);
    ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(rightX, rightY, rightW, rightH);
    ctx.fillStyle = '#ffffff'; ctx.font = '16px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('Selected', rightX + 12, rightY + 10);
    const sel = filtered[usersState.selectedIndex];
    if (sel) {
      ctx.font = '20px system-ui, sans-serif'; ctx.fillText(sel.name || '(unnamed)', rightX + 12, rightY + 36);
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(`Role: ${sel.role}`, rightX + 12, rightY + 64);
      ctx.fillText(`Status: ${sel.enabled ? 'Active' : 'Disabled'}`, rightX + 12, rightY + 84);

      // Action buttons (responsive grid within right panel)
      const aY = rightY + 120;
      const gap = 10;
      const innerPad = 12;
      const availableW = Math.max(0, rightW - innerPad * 2);
      const minBtnW = 110;
      // Determine column count to fit within available width (max 3)
      let cols = Math.min(3, Math.max(1, Math.floor((availableW + gap) / (minBtnW + gap))));
      // Compute button width from columns
      const aW = Math.floor((availableW - gap * (cols - 1)) / cols);
      const aH = 32;
      const font = '14px system-ui, sans-serif';
      const buttons: Array<{ label: string; kind: UsersHotspot['kind']; id: string }> = [];
      if (sel.role === 'admin') buttons.push({ label: 'Demote', kind: 'demote', id: sel.id });
      else buttons.push({ label: 'Promote', kind: 'promote', id: sel.id });
      buttons.push({ label: sel.enabled ? 'Disable' : 'Enable', kind: sel.enabled ? 'disable' : 'enable', id: sel.id });
      buttons.push({ label: 'Delete', kind: 'remove', id: sel.id });
      buttons.forEach((b, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = rightX + innerPad + col * (aW + gap);
        const y = aY + row * (aH + gap);
        const isHover = hoverUsersBtnKind === b.kind;
        ctx.fillStyle = isHover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
        ctx.fillRect(x, y, aW, aH);
        ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(x, y, aW, aH);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font;
        ctx.fillText(b.label, x + aW/2, y + aH/2 + 0.5);
        usersUiHotspots.push({ kind: b.kind, id: b.id, x, y, w: aW, h: aH });
      });
    } else {
      ctx.font = '14px system-ui, sans-serif'; ctx.fillText('No user selected', rightX + 12, rightY + 36);
    }

    // Back button (bottom-right)
    const backW = 120, backH = 32;
    const backX = px + panelW - pad - backW;
    const backY = py + panelH - pad - backH;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(backX, backY, backW, backH);
    ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(backX, backY, backW, backH);
    ctx.fillStyle = '#ffffff'; ctx.font = '16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Back', backX + backW/2, backY + backH/2 + 0.5);
    usersUiHotspots.push({ kind: 'back', x: backX, y: backY, w: backW, h: backH });

    renderGlobalOverlays();
    return;
  }
  // Course Select screen - redesigned to match Course Editor UI
  if (gameState === 'course') {
    courseSelectHotspots = [];
    
    // Panel dimensions matching Course Editor
    const panelW = Math.min(800, WIDTH - 80);
    const panelH = Math.min(600, HEIGHT - 120);
    const margin = 20;
    const pad = 20;
    
    let px = Math.floor(WIDTH / 2 - panelW / 2);
    let py = Math.floor(HEIGHT / 2 - panelH / 2);
    px = Math.max(margin, Math.min(WIDTH - panelW - margin, px));
    py = Math.max(margin, Math.min(HEIGHT - panelH - margin, py));
    
    // Panel background
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Select Course', px + pad, py + pad);
    
    let contentY = py + pad + 32;
    
    // Split layout: left list, right preview/metadata
    const listW = Math.floor(panelW * 0.55);
    const rightW = panelW - pad * 3 - listW;
    const listX = px + pad;
    const listStartY = contentY;
    const listEndY = py + panelH - 80; // Leave space for buttons
    const listHeight = listEndY - listStartY;
    const rowHeight = 40;
    const maxVisibleRows = Math.floor(listHeight / rowHeight);
    
    const courses = courseSelectState.courses;
    const scrollOffset = courseSelectState.scrollOffset;
    const visibleCourses = courses.slice(scrollOffset, scrollOffset + maxVisibleRows);
    
    // Draw scrollbar if needed
    if (courses.length > maxVisibleRows) {
      const scrollbarX = listX + listW - 12;
      const scrollbarY = listStartY;
      const scrollbarH = listHeight;
      const scrollbarW = 16;
      
      // Scrollbar track
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(scrollbarX, scrollbarY, scrollbarW, scrollbarH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1;
      ctx.strokeRect(scrollbarX + 0.5, scrollbarY + 0.5, scrollbarW - 1, scrollbarH - 1);
      
      // Scrollbar thumb
      const thumbHeight = Math.max(20, (maxVisibleRows / courses.length) * scrollbarH);
      const thumbY = scrollbarY + (scrollOffset / (courses.length - maxVisibleRows)) * (scrollbarH - thumbHeight);
      ctx.fillStyle = 'rgba(136, 212, 255, 0.6)';
      ctx.fillRect(scrollbarX + 2, thumbY, scrollbarW - 4, thumbHeight);
      ctx.strokeStyle = '#88d4ff';
      ctx.strokeRect(scrollbarX + 2.5, thumbY + 0.5, scrollbarW - 5, thumbHeight - 1);
    }
    
    // Render course rows
    for (let i = 0; i < visibleCourses.length; i++) {
      const actualIndex = scrollOffset + i;
      const course = visibleCourses[i];
      const rowY = listStartY + i * rowHeight;
      const rowX = listX;
      const rowW = listW - (courses.length > maxVisibleRows ? 24 : 0);
      const isSelected = (courseSelectState.selectedCourseIndex === actualIndex);
      
      // Row background
      ctx.fillStyle = isSelected ? 'rgba(136, 212, 255, 0.2)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(rowX, rowY, rowW, rowHeight - 2);
      
      // Row border
      ctx.strokeStyle = isSelected ? '#88d4ff' : '#cfd2cf';
      ctx.lineWidth = 1;
      ctx.strokeRect(rowX + 0.5, rowY + 0.5, rowW - 1, rowHeight - 2 - 1);
      
      // Course text
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const courseText = `${course.title} (${course.levelCount} levels)`;
      ctx.fillText(courseText, rowX + 12, rowY + (rowHeight - 2) / 2);
      
      // Add hotspot for course selection
      courseSelectHotspots.push({ kind: 'courseItem', index: actualIndex, x: rowX, y: rowY, w: rowW, h: rowHeight - 2 });
    }
    // Right preview/metadata panel
    const rightX = listX + listW + pad;
    const rightY = listStartY;
    const rightH = listHeight;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(rightX, rightY, rightW, rightH);
    ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(rightX, rightY, rightW, rightH);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Selected Course', rightX + 12, rightY + 10);
    const selCourse = courses[courseSelectState.selectedCourseIndex] || null;
    if (selCourse) {
      ctx.font = '20px system-ui, sans-serif'; ctx.fillText(selCourse.title || 'Untitled', rightX + 12, rightY + 36);
      ctx.font = '14px system-ui, sans-serif';
      const createdAny: any = (selCourse as any);
      const createdVal = createdAny?.createdAt ?? createdAny?.courseData?.createdAt;
      const lastVal = createdAny?.lastModified ?? createdAny?.courseData?.lastModified;
      const createdAt = (typeof createdVal === 'number') ? new Date(createdVal).toLocaleString() : '—';
      const lastMod = (typeof lastVal === 'number') ? new Date(lastVal).toLocaleString() : '—';
      ctx.fillText(`Levels: ${selCourse.levelCount ?? (selCourse.courseData?.levelIds?.length || '—')}`, rightX + 12, rightY + 64);
      ctx.fillText(`Created: ${createdAt}`, rightX + 12, rightY + 84);
      ctx.fillText(`Last Edited: ${lastMod}`, rightX + 12, rightY + 104);
      // Preview thumbnail (from first level)
      const pvY = rightY + 130; const pvH = 140; const pvW = rightW - 24; const pvX = rightX + 12;
      const thumbData = courseThumbnailCache.get(selCourse.id) || getCourseThumbnail(selCourse) || '';
      if (thumbData) {
        let img = courseImageCache.get(selCourse.id);
        if (!img) { img = new Image(); img.src = thumbData; courseImageCache.set(selCourse.id, img); }
        if (img.complete && (img as any).naturalWidth) {
          ctx.drawImage(img as any, pvX, pvY, pvW, pvH);
          ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(pvX + 0.5, pvY + 0.5, pvW - 1, pvH - 1);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(pvX, pvY, pvW, pvH);
          ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(pvX + 0.5, pvY + 0.5, pvW - 1, pvH - 1);
          ctx.fillStyle = '#bbbbbb'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px system-ui, sans-serif';
          ctx.fillText('Generating preview…', pvX + pvW/2, pvY + pvH/2);
        }
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(pvX, pvY, pvW, pvH);
        ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(pvX + 0.5, pvY + 0.5, pvW - 1, pvH - 1);
        ctx.fillStyle = '#bbbbbb'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('Generating preview…', pvX + pvW/2, pvY + pvH/2);
      }
      // Action button: Play Course
      const btnW = 140, btnH = 32; const btnY = rightY + rightH - btnH - 12; const btnX = rightX + 12;
      const hoverPlayCourse = hoverCourseAction === 'playSelectedCourse';
      ctx.fillStyle = hoverPlayCourse ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)'; ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(btnX, btnY, btnW, btnH);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '16px system-ui, sans-serif';
      ctx.fillText('Play Course', btnX + btnW/2, btnY + btnH/2 + 0.5);
      courseSelectHotspots.push({ kind: 'btn', action: 'playSelectedCourse', x: btnX, y: btnY, w: btnW, h: btnH });
    } else {
      ctx.font = '14px system-ui, sans-serif'; ctx.fillText('No course selected', rightX + 12, rightY + 36);
    }
    
    // Bottom buttons
    const buttonY = py + panelH - 60;
    const buttonH = 28;
    const buttonGap = 12;
    
    // User Made Levels button (bottom right)
    const userLevelsBtnW = 140;
    const userLevelsX = px + panelW - pad - userLevelsBtnW;
    const hoverUL = hoverCourseAction === 'userLevels';
    ctx.fillStyle = hoverUL ? 'rgba(33, 150, 243, 0.40)' : 'rgba(33, 150, 243, 0.30)';
    ctx.fillRect(userLevelsX, buttonY, userLevelsBtnW, buttonH);
    ctx.strokeStyle = hoverUL ? '#4aa3f5' : '#2196f3';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(userLevelsX + 0.5, buttonY + 0.5, userLevelsBtnW - 1, buttonH - 1);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('User Made Levels', userLevelsX + userLevelsBtnW / 2, buttonY + buttonH / 2);
    courseSelectHotspots.push({ kind: 'btn', action: 'userLevels', x: userLevelsX, y: buttonY, w: userLevelsBtnW, h: buttonH });
    
    // Course Creator button (for admin users, left of User Made Levels)
    let backX = userLevelsX - buttonGap;
    if (userProfile.role === 'admin') {
      const creatorBtnW = 120;
      const creatorX = backX - creatorBtnW;
      
      const hoverCC = hoverCourseAction === 'courseCreator';
      ctx.fillStyle = hoverCC ? 'rgba(255, 152, 0, 0.40)' : 'rgba(255, 152, 0, 0.30)';
      ctx.fillRect(creatorX, buttonY, creatorBtnW, buttonH);
      ctx.strokeStyle = hoverCC ? '#ffac26' : '#ff9800';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(creatorX + 0.5, buttonY + 0.5, creatorBtnW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Course Creator', creatorX + creatorBtnW / 2, buttonY + buttonH / 2);
      courseSelectHotspots.push({ kind: 'btn', action: 'courseCreator', x: creatorX, y: buttonY, w: creatorBtnW, h: buttonH });
      
      backX = creatorX - buttonGap;
    }
    
    // Back button (left of other buttons)
    const backBtnW = 80;
    backX -= backBtnW;
    
    const hoverBack = hoverCourseAction === 'back';
    ctx.fillStyle = hoverBack ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(backX, buttonY, backBtnW, buttonH);
    ctx.strokeStyle = hoverBack ? '#ffffff' : '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(backX + 0.5, buttonY + 0.5, backBtnW - 1, buttonH - 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Back', backX + backBtnW / 2, buttonY + buttonH / 2);
    courseSelectHotspots.push({ kind: 'btn', action: 'back', x: backX, y: buttonY, w: backBtnW, h: buttonH });
    
    // Version bottom-left
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
    renderGlobalOverlays();
    return;
  }
  // User Levels screen - centered panel design
  if (gameState === 'userLevels') {
    // Clear hotspots for this frame
    userLevelsHotspots = [];
    
    // Dark background (standardized per UI_Design.md)
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    // Main panel (centered, responsive to small screens)
    const panelW = Math.min(800, WIDTH - 80);
    const panelH = Math.min(600, HEIGHT - 120);
    const panelX = (WIDTH - panelW) / 2;
    const panelY = (HEIGHT - panelH) / 2;
    
    // Panel background (standard)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, Math.max(0, panelW - 1), Math.max(0, panelH - 1));
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Level Browser', panelX + panelW/2, panelY + 20);
    
    // Search and filter bar
    const searchY = panelY + 60;
    const searchX = panelX + 20;
    const searchW = 300;
    const searchH = 32;
    
    // Search box
    // Hover styling parity with Load Levels overlay
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(searchX, searchY, searchW, searchH);
    ctx.strokeStyle = hoverUserLevelsSearch ? '#cfd2cf' : '#888888';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(searchX + 0.5, searchY + 0.5, searchW - 1, searchH - 1);
    
    // Search text (placeholder parity)
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const searchText = userLevelsState.searchQuery || 'Search title or author…';
    ctx.globalAlpha = userLevelsState.searchQuery ? 1.0 : 0.6;
    ctx.fillText(searchText, searchX + 12, searchY + searchH/2);
    ctx.globalAlpha = 1.0;
    
    // Add search hotspot
    userLevelsHotspots.push({ kind: 'search', x: searchX, y: searchY, w: searchW, h: searchH });
    
    // Filter buttons
    const filterOptions = [
      { id: 'all', label: 'All' },
      { id: 'bundled', label: 'Built-in' },
      { id: 'filesystem', label: 'User' },
      { id: 'localStorage', label: 'Local' }
    ];
    
    let filterX = searchX + searchW + 20;
    const filterW = 70;
    const filterH = 32;
    
    for (const filter of filterOptions) {
      const isActive = userLevelsState.filterSource === filter.id;
      const isHover = hoverUserLevelsFilterId === filter.id;
      
      ctx.fillStyle = isActive ? 'rgba(100, 150, 200, 0.8)' : (isHover ? 'rgba(255,255,255,0.15)' : 'rgba(255, 255, 255, 0.1)');
      ctx.fillRect(filterX, searchY, filterW, filterH);
      ctx.strokeStyle = isActive ? 'rgba(100, 150, 200, 0.8)' : '#cfd2cf';
      ctx.lineWidth = 1;
      ctx.strokeRect(filterX + 0.5, searchY + 0.5, filterW - 1, filterH - 1);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(filter.label, filterX + filterW/2, searchY + filterH/2);
      
      // Add filter hotspot
      userLevelsHotspots.push({ kind: 'filter', filterId: filter.id, x: filterX, y: searchY, w: filterW, h: filterH });
      
      filterX += filterW + 8;
    }
    
    // Results count
    ctx.fillStyle = '#cccccc';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${filteredUserLevelsList.length} of ${userLevelsList.length} levels`, searchX, searchY + filterH + 15);
    
    // Split layout
    const listY = searchY + filterH + 35;
    const listW = Math.floor(panelW * 0.55);
    const rightW = panelW - 20 * 3 - listW;
    const listH = panelH - (listY - panelY) - 60; // Leave space for back button
    const itemH = 50;
    const maxVisible = Math.floor(listH / itemH);
    
    if (filteredUserLevelsList.length === 0) {
      // Empty state
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(panelX + 20, listY, listW - 20, listH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX + 20, listY, listW - 20, listH);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const emptyMessage = userLevelsState.searchQuery || userLevelsState.filterSource !== 'all' 
        ? 'No levels match your search/filter'
        : 'No user levels found';
      ctx.fillText(emptyMessage, panelX + panelW/2, listY + listH/2 - 20);
      
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#cccccc';
      if (!userLevelsState.searchQuery && userLevelsState.filterSource === 'all') {
        ctx.fillText('Create levels in the Level Editor to see them here', panelX + panelW/2, listY + listH/2 + 10);
      } else {
        ctx.fillText('Try adjusting your search terms or filters', panelX + panelW/2, listY + listH/2 + 10);
      }
    } else {
      // Level list with scrolling - use scrollOffset from userLevelsState
      const scrollOffset = userLevelsState.scrollOffset || 0;
      const startIndex = Math.max(0, Math.min(filteredUserLevelsList.length - maxVisible, scrollOffset));
      const endIndex = Math.min(filteredUserLevelsList.length, startIndex + maxVisible);
      const needsScrollbar = filteredUserLevelsList.length > maxVisible;
      const scW = needsScrollbar ? 8 : 0;
      const scPad = needsScrollbar ? 6 : 0; // gap between items and scrollbar
      const rowW = (listW - 20) - (scW + scPad);
      
      for (let i = startIndex; i < endIndex; i++) {
        const level = filteredUserLevelsList[i];
        const itemY = listY + (i - startIndex) * itemH;
        const isSelected = i === selectedUserLevelIndex;
        const isHover = hoverUserLevelsRowIndex === i;
        
        // Item background
        ctx.fillStyle = isSelected ? 'rgba(100, 150, 200, 0.3)' : (isHover ? 'rgba(255,255,255,0.10)' : 'rgba(255, 255, 255, 0.05)');
        ctx.fillRect(panelX + 20, itemY, rowW, itemH - 2);
        
        // Item border
        ctx.strokeStyle = isSelected ? 'rgba(100, 150, 200, 0.8)' : (isHover ? 'rgba(255,255,255,0.2)' : 'rgba(255, 255, 255, 0.1)');
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX + 20, itemY, rowW, itemH - 2);
        
        // Level name
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(level.name, panelX + 35, itemY + 8);
        
        // Author and source
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = '#aaaaaa';
        const sourceLabel = level.source === 'bundled' ? 'built-in' : 
                           level.source === 'filesystem' ? 'user' : 
                           level.source === 'firebase' ? 'cloud' : 'local';
        ctx.fillText(`by ${level.author} • ${sourceLabel}`, panelX + 35, itemY + 28);
        
        // Add level item hotspot
        userLevelsHotspots.push({ kind: 'levelItem', index: i, x: panelX + 20, y: itemY, w: rowW, h: itemH - 2 });
      }
      
      // Scroll indicator aligned to the right edge of the reserved list area
      if (needsScrollbar) {
        const scrollBarW = scW;
        const scrollBarH = listH;
        const scrollBarX = panelX + 20 + rowW + 2; // 2px gap after item area
        
        // Track
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(scrollBarX, listY, scrollBarW, scrollBarH);
        
        // Thumb
        const thumbH = Math.max(20, scrollBarH * maxVisible / filteredUserLevelsList.length);
        const thumbY = listY + (startIndex / Math.max(1, filteredUserLevelsList.length - maxVisible)) * (scrollBarH - thumbH);
        ctx.fillStyle = 'rgba(100, 150, 200, 0.8)';
        ctx.fillRect(scrollBarX, thumbY, scrollBarW, thumbH);
      }
    }
    
    // Right preview/metadata pane
    const rightX = panelX + 20 + listW;
    const rightY = listY;
    const rightH = listH;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(rightX, rightY, rightW, rightH);
    ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(rightX, rightY, rightW, rightH);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Selected Level', rightX + 12, rightY + 10);
    const sel = filteredUserLevelsList[selectedUserLevelIndex];
    if (sel) {
      ctx.font = '20px system-ui, sans-serif'; ctx.fillText(sel.name || 'Untitled', rightX + 12, rightY + 36);
      // Thumbnail (slightly shorter to leave room for metadata)
      const thumbY = rightY + 64; const thumbH = 100; const thumbW = rightW - 24; const thumbX = rightX + 12;
      const dataUrl = getLevelThumbnail(sel);
      if (dataUrl) {
        if (!sel.thumbnailImage) { const img = new Image(); img.src = dataUrl; sel.thumbnailImage = img; }
        if (sel.thumbnailImage && (sel.thumbnailImage.complete || (sel.thumbnailImage as any).naturalWidth)) {
          ctx.drawImage(sel.thumbnailImage as any, thumbX, thumbY, thumbW, thumbH);
          ctx.strokeStyle = '#cfd2cf'; ctx.strokeRect(thumbX + 0.5, thumbY + 0.5, thumbW - 1, thumbH - 1);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
          ctx.strokeStyle = '#cfd2cf'; ctx.strokeRect(thumbX + 0.5, thumbY + 0.5, thumbW - 1, thumbH - 1);
          ctx.fillStyle = '#bbbbbb'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px system-ui, sans-serif';
          ctx.fillText('Generating preview…', thumbX + thumbW/2, thumbY + thumbH/2);
        }
      }
      // Reserve space for action buttons first, then render metadata above to avoid overlap
      // Metadata (word-wrapped for Description/Tags) — use full pane height (buttons moved to panel bottom)
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '14px system-ui, sans-serif'; ctx.fillStyle = '#ffffff';
      const meta = (sel as any).data?.meta || {};
      const createdAt = meta.created ? new Date(meta.created).toLocaleString() : '—';
      const lastMod = meta.lastModified ? new Date(meta.lastModified).toLocaleString() : (meta.modified || '—');
      const par = (sel as any).data?.par; const parText = (typeof par === 'number') ? String(par) : '—';
      const desc = (meta.description || '').toString();
      const tags = Array.isArray(meta.tags) ? meta.tags.join(', ') : ((meta.tags || '').toString());
      const maxWidth = rightW - 24;
      const elide = (s: string): string => {
        if (!s) return s;
        if (ctx.measureText(s).width <= maxWidth) return s;
        let t = s;
        while (t.length > 3 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
        return t + '…';
      };
      const wrapLabelValue = (label: string, value: string): string[] => {
        if (!value) return [label];
        const words = value.split(/\s+/);
        const lines: string[] = [];
        let current = label + (label ? ' ' : '');
        for (const w of words) {
          const test = (current ? current : '') + (current && !current.endsWith(' ') ? '' : '') + w;
          if (ctx.measureText(test).width <= maxWidth) {
            current = test;
          } else {
            if (current) lines.push(current);
            // indent continuation lines to align after the label
            const indent = ''.padEnd(label.length, ' ');
            current = indent + w;
          }
        }
        if (current) lines.push(current);
        return lines;
      };
      const lines: string[] = [];
      lines.push(elide(`Author: ${sel.author || meta.authorName || 'Unknown'}`));
      lines.push(elide(`Par: ${parText}`));
      lines.push(elide(`Created: ${createdAt}`));
      lines.push(elide(`Last Edited: ${lastMod}`));
      if (desc) lines.push(...wrapLabelValue('Description:', desc));
      if (tags) lines.push(...wrapLabelValue('Tags:', tags));
      const yStart = thumbY + thumbH + 10;
      const yMax = rightY + rightH - 12;
      const lineH = 16; // tighter lines to fit more metadata
      let yMeta = yStart;
      const maxLines = Math.max(0, Math.floor((yMax - yMeta) / lineH));
      for (let i = 0; i < Math.min(maxLines, lines.length); i++) {
        ctx.fillText(lines[i], rightX + 12, yMeta); yMeta += lineH;
      }
      // Note: action buttons are now drawn at the panel bottom (outside the right pane)
    } else {
      ctx.font = '14px system-ui, sans-serif'; ctx.fillText('No level selected', rightX + 12, rightY + 36);
    }
    
    // Bottom controls: Back (left) and actions (right)
    const backBtnW = 100;
    const backBtnH = 32;
    const backBtnX = panelX + 20;
    const backBtnY = panelY + panelH - backBtnH - 20;
    
    ctx.fillStyle = 'rgba(100, 150, 200, 0.8)';
    ctx.fillRect(backBtnX, backBtnY, backBtnW, backBtnH);
    ctx.strokeStyle = 'rgba(100, 150, 200, 1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(backBtnX, backBtnY, backBtnW, backBtnH);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Back', backBtnX + backBtnW/2, backBtnY + backBtnH/2);
    
    // Add back button hotspot
    userLevelsHotspots.push({ kind: 'btn', action: 'back', x: backBtnX, y: backBtnY, w: backBtnW, h: backBtnH });

    // Action buttons (moved to bottom-right area)
    const actions: Array<{ label: string; action: string }> = [
      { label: 'Play', action: 'play' },
      { label: 'Edit', action: 'edit' },
      { label: 'Duplicate', action: 'duplicate' },
      { label: 'Delete', action: 'delete' }
    ];
    const btnW = 120, btnH = 32, gap = 12;
    const totalW = actions.length * btnW + (actions.length - 1) * gap;
    let startX = panelX + panelW - 20 - totalW;
    const y = backBtnY + Math.max(0, Math.floor((backBtnH - btnH) / 2));
    for (const a of actions) {
      const isHover = hoverUserLevelsAction === a.action;
      ctx.fillStyle = isHover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(startX, y, btnW, btnH);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(startX, y, btnW, btnH);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(a.label, startX + btnW/2, y + btnH/2 + 0.5);
      userLevelsHotspots.push({ kind: 'btn', action: a.action, x: startX, y, w: btnW, h: btnH });
      startX += btnW + gap;
    }
    
    // Instructions (positioned above the bottom button row to avoid overlap)
    ctx.fillStyle = '#888888';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('↑↓ Navigate • Enter Play • Esc Back', panelX + panelW - 20, backBtnY - 8);
    
    renderGlobalOverlays();
    return;
  }
  // Main Menu
  if ((gameState as any) === 'menu') {
    // Legacy duplicate menu path; the panelized Main Menu draws earlier in draw().
    // Intentionally skip to avoid double-draw with old layout.
    renderGlobalOverlays();
    return;
  }
  // Loading overlay (coarse)
  if (gameState === 'loading') {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText('Loading…', WIDTH/2, HEIGHT/2);
    renderGlobalOverlays();
    return;
  }
  // Options screen: centered panel per UI_Design.md
  if (gameState === 'options') {
    // Dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Standard panel
    const panelW = Math.min(800, WIDTH - 80);
    const panelH = Math.min(600, HEIGHT - 120);
    const panelX = (WIDTH - panelW) / 2;
    const panelY = (HEIGHT - panelH) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, Math.max(0, panelW - 1), Math.max(0, panelH - 1));

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Options', panelX + panelW / 2, panelY + 20);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Controls', panelX + 40, panelY + 70);
    ctx.font = '14px system-ui, sans-serif';
    const lines = [
      'Mouse: Click-drag from ball to aim; release to shoot',
      'N: Next from Hole Sunk banner',
      'Space: Replay current hole (from banner)',
      'R: Restart current hole',
      'P / Esc: Pause / Resume',
      'Enter: Restart course from Summary',
      'Esc: Back to Main Menu'
    ];
    let oy = panelY + 100;
    for (const line of lines) { ctx.fillText('• ' + line, panelX + 40, oy); oy += 22; }
    // Audio section
    oy += 8;
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Audio', panelX + 40, oy); oy += 24;
    ctx.font = '14px system-ui, sans-serif';
    const volPct = Math.round(AudioSfx.volume * 100);
    ctx.fillText(`SFX Volume: ${AudioSfx.muted ? 'Muted' : volPct + '%'}`, panelX + 40, oy);
    oy += 64;
    // Slope arrows toggle
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '16px system-ui, sans-serif'; ctx.fillStyle = '#ffffff';
    ctx.fillText('Slope Arrows:', panelX + 40, oy);
    const tog = getOptionsSlopeToggleRect();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(tog.x, tog.y, tog.w, tog.h);
    ctx.lineWidth = 1.5; ctx.strokeStyle = hoverOptionsSlopeToggle ? '#ffffff' : '#cfd2cf';
    ctx.strokeRect(tog.x, tog.y, tog.w, tog.h);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(showSlopeArrows ? 'On' : 'Off', tog.x + tog.w/2, tog.y + tog.h/2 + 0.5);
    oy += 60; // spacing before buttons
    // Buttons
    const vm = getOptionsVolMinusRect();
    const vp = getOptionsVolPlusRect();
    const mu = getOptionsMuteRect();
    const vs = getOptionsVolSliderRect();
    ctx.lineWidth = 1.5;
    // - button
    ctx.strokeStyle = hoverOptionsVolMinus ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverOptionsVolMinus ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(vm.x, vm.y, vm.w, vm.h); ctx.strokeRect(vm.x, vm.y, vm.w, vm.h);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('-', vm.x + vm.w/2, vm.y + vm.h/2 + 0.5);
    // + button
    ctx.strokeStyle = hoverOptionsVolPlus ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverOptionsVolPlus ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(vp.x, vp.y, vp.w, vp.h); ctx.strokeRect(vp.x, vp.y, vp.w, vp.h);
    ctx.fillStyle = '#ffffff'; ctx.fillText('+', vp.x + vp.w/2, vp.y + vp.h/2 + 0.5);
    // slider
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vs.x, vs.y + vs.h/2);
    ctx.lineTo(vs.x + vs.w, vs.y + vs.h/2);
    ctx.stroke();
    // knob
    const knobT = AudioSfx.volume;
    const knobX = vs.x + knobT * vs.w;
    ctx.fillStyle = hoverOptionsVolSlider ? '#ffffff' : '#cfd2cf';
    ctx.beginPath();
    ctx.arc(knobX, vs.y + vs.h/2, 6, 0, Math.PI * 2);
    ctx.fill();
    // mute toggle
    ctx.strokeStyle = hoverOptionsMute ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverOptionsMute ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(mu.x, mu.y, mu.w, mu.h); ctx.strokeRect(mu.x, mu.y, mu.w, mu.h);
    ctx.fillStyle = '#ffffff'; ctx.fillText(AudioSfx.muted ? 'Unmute' : 'Mute', mu.x + mu.w/2, mu.y + mu.h/2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    // Back button
    const back = getCourseBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverOptionsBack ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverOptionsBack ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(back.x, back.y, back.w, back.h);
    ctx.strokeRect(back.x, back.y, back.w, back.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(previousGameState === 'play' || paused ? 'Back to Game' : 'Back', back.x + back.w/2, back.y + back.h/2 + 0.5);
    // Version
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
    renderGlobalOverlays();
    return;
  }
  // Changelog screen
  if (gameState === 'changelog') {
    // Panel metrics
    const panelW = Math.min(800, WIDTH - 80);
    const panelH = Math.min(600, HEIGHT - 120);
    const pad = 20;
    let px = Math.floor(WIDTH / 2 - panelW / 2);
    let py = Math.floor(HEIGHT / 2 - panelH / 2);
    px = Math.max(20, Math.min(WIDTH - panelW - 20, px));
    py = Math.max(20, Math.min(HEIGHT - panelH - 20, py));

    // Panel background + border
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);

    // Header
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText('Changelog', px + pad, py + pad);
    // content area
    const cr = getChangelogContentRect();
    ctx.font = '14px system-ui, sans-serif';
    if (changelogText === null) {
      ctx.textAlign = 'center';
      ctx.fillText('Loading…', px + panelW/2, py + panelH/2);
    } else {
      if (changelogLines.length === 0) {
        ctx.textAlign = 'left';
        changelogLines = wrapChangelog(ctx, (changelogText ?? '').toString(), cr.w);
      }
      clampChangelogScroll();
      if (changelogLines.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cr.x, cr.y, cr.w, cr.h);
        ctx.clip();
        let y = cr.y - changelogScrollY;
        ctx.textAlign = 'left';
        for (const line of changelogLines) {
          ctx.fillText(line, cr.x, y);
          y += 20;
        }
        ctx.restore();
      }

      // simple scrollbar
      const contentHeight = changelogLines.length * 20;
      if (contentHeight > cr.h && changelogLines.length > 0) {
        const trackX = cr.x + cr.w + 6;
        const trackY = cr.y;
        const trackW = 6;
        const trackH = cr.h;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(trackX, trackY, trackW, trackH);
        const thumbH = Math.max(20, (cr.h / contentHeight) * trackH);
        const maxScroll = contentHeight - cr.h;
        const thumbY = trackY + (maxScroll ? (changelogScrollY / maxScroll) * (trackH - thumbH) : 0);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(trackX, thumbY, trackW, thumbH);
      }
    }
    // Back button
    const bk = getChangelogBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverChangelogBack ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverChangelogBack ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(bk.x, bk.y, bk.w, bk.h);
    ctx.strokeRect(bk.x, bk.y, bk.w, bk.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Back', bk.x + bk.w/2, bk.y + bk.h/2 + 0.5);
    // Version bottom-left (panel)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, px + pad, py + panelH - pad);
    renderGlobalOverlays();
    return;
  }
  // translate to center the whole level content horizontally
  ctx.save();
  ctx.translate(offsetX, 0);
  // fairway area with multiple horizontal bands (retro look)
  ctx.fillStyle = COLORS.fairway;
  ctx.fillRect(fairX, fairY, fairW, fairH);
  ctx.fillStyle = COLORS.fairwayBand;
  const bands = 4;
  const stepH = Math.floor(fairH / (bands * 2));
  for (let i = 0; i < bands; i++) {
    const y = fairY + stepH * (2 * i + 1);
    const h = stepH;
    if (y + h <= fairY + fairH) ctx.fillRect(fairX, y, fairW, h);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.fairwayLine;
  ctx.strokeRect(fairX + 1, fairY + 1, fairW - 2, fairH - 2);

  // terrain zones (draw before walls)
  for (const r of waters) {
    ctx.fillStyle = COLORS.waterFill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.waterStroke;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  // polygon water
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
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.waterStroke;
      ctx.stroke();
    }
  }
  // splash ripples on water
  if (splashes.length > 0) {
    const newFx: SplashFx[] = [];
    for (const fx of splashes) {
      fx.age += 1 / 60; // approx frame-based age; stable enough
      const t = Math.min(1, fx.age / 0.7);
      // draw 3 rings with staggered start and different widths
      const ringCount = 3;
      for (let i = 0; i < ringCount; i++) {
        const offset = i * 0.12; // stagger each ring a bit
        const tt = Math.min(1, Math.max(0, (fx.age - offset) / 0.6));
        if (tt <= 0) continue;
        const alpha = (1 - tt) * 0.9 * (1 - i * 0.12);
        const radius = 8 + (36 + i * 16) * tt;
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.8, 2.2 * (1 - tt));
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (t < 1) newFx.push(fx);
    }
    splashes = newFx;
  }
  for (const r of sands) {
    ctx.fillStyle = COLORS.sandFill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.sandStroke;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  // polygon sand
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
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.sandStroke;
      ctx.stroke();
    }
  }
  // bridges (fairway rectangles spanning water)
  for (const r of bridges) {
    ctx.fillStyle = COLORS.fairway;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.fairwayLine;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  // hills (visualize gradient underlay)
  for (const h of hills) {
    const grad = (() => {
      const d = h.dir;
      let x0 = h.x, y0 = h.y, x1 = h.x + h.w, y1 = h.y + h.h;
      if (d === 'N') { x0 = h.x; y0 = h.y + h.h; x1 = h.x; y1 = h.y; }
      else if (d === 'S') { x0 = h.x; y0 = h.y; x1 = h.x; y1 = h.y + h.h; }
      else if (d === 'W') { x0 = h.x + h.w; y0 = h.y; x1 = h.x; y1 = h.y; }
      else if (d === 'E') { x0 = h.x; y0 = h.y; x1 = h.x + h.w; y1 = h.y; }
      else if (d === 'NE') { x0 = h.x; y0 = h.y + h.h; x1 = h.x + h.w; y1 = h.y; }
      else if (d === 'NW') { x0 = h.x + h.w; y0 = h.y + h.h; x1 = h.x; y1 = h.y; }
      else if (d === 'SE') { x0 = h.x; y0 = h.y; x1 = h.x + h.w; y1 = h.y + h.h; }
      else /* SW */ { x0 = h.x + h.w; y0 = h.y; x1 = h.x; y1 = h.y + h.h; }
      return ctx.createLinearGradient(x0, y0, x1, y1);
    })();
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(h.x, h.y, h.w, h.h);

  }

  // decorations (non-colliding visuals) — clip to fairway so they don't draw on mustard HUD/table
  ctx.save();
  ctx.beginPath();
  ctx.rect(fairX, fairY, fairW, fairH);
  ctx.clip();
  for (const d of decorations) {
    if (d.kind === 'flowers') {
      const step = 16;
      for (let y = d.y; y < d.y + d.h; y += step) {
        for (let x = d.x; x < d.x + d.w; x += step) {
          // simple flower: 4 petals + center
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
  // Remove clip so subsequent layers (walls, HUD) are not clipped out
  ctx.restore();

  // walls (beveled look: face + highlight) — shadow drawn in editor within rotation; omitted here to avoid duplicates
  for (const w of walls) {
    // face
    ctx.fillStyle = COLORS.wallFill;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    // inner stroke
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.wallStroke;
    ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    // top/left highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(w.x + 1, w.y + 1);
    ctx.lineTo(w.x + w.w - 1, w.y + 1);
    ctx.moveTo(w.x + 1, w.y + 1);
    ctx.lineTo(w.x + 1, w.y + w.h - 1);
    ctx.stroke();
  }

  // polygon walls (render simple beveled stroke; shadow omitted here to avoid duplicates)
  ctx.lineWidth = 2;
  for (const poly of polyWalls) {
    const pts = poly.points;
    if (!pts || pts.length < 6) continue;
    // face
    ctx.fillStyle = COLORS.wallFill;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fill();
    // rim
    ctx.strokeStyle = COLORS.wallStroke;
    ctx.stroke();
  }

  // round posts (pillars) — shadow omitted here to avoid duplicates
  for (const p of posts) {
    // face
    ctx.fillStyle = COLORS.wallFill;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    // rim
    ctx.strokeStyle = COLORS.wallStroke; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 1, 0, Math.PI * 2); ctx.stroke();
  }

  // Hill direction arrows overlay (high-visibility, masked): draw above geometry
  if (showSlopeArrows && hills.length > 0) {
    // Ensure offscreen layer exists and matches canvas size (play coords after translate)
    if (!arrowsLayer) {
      arrowsLayer = document.createElement('canvas');
      arrowsCtx = arrowsLayer.getContext('2d');
    }
    if (!arrowsCtx) {
      // Fallback: skip if context creation failed
    } else {
      if (arrowsLayer.width !== WIDTH || arrowsLayer.height !== HEIGHT) {
        arrowsLayer.width = WIDTH; arrowsLayer.height = HEIGHT;
      }
      // Clear
      arrowsCtx.clearRect(0, 0, arrowsLayer.width, arrowsLayer.height);
      // Draw arrows into offscreen
      const ac = arrowsCtx;
      for (const h of hills) {
        const dirX = (h.dir?.includes('E') ? 1 : 0) + (h.dir?.includes('W') ? -1 : 0);
        const dirY = (h.dir?.includes('S') ? 1 : 0) + (h.dir?.includes('N') ? -1 : 0);
        if (dirX === 0 && dirY === 0) continue;
        const s = Math.max(0.5, Math.min(1.5, (h.strength ?? 1)));
        const step = Math.max(18, Math.min(28, 24 / s));
        const inset = 6;
        const innerW = Math.max(0, (h.w - inset * 2));
        const innerH = Math.max(0, (h.h - inset * 2));
        const cols = Math.max(1, Math.floor(innerW / step));
        const rows = Math.max(1, Math.floor(innerH / step));
        const cellW = cols > 0 ? innerW / cols : innerW;
        const cellH = rows > 0 ? innerH / rows : innerH;
        for (let r = 0; r < rows; r++) {
          const yy = h.y + inset + r * cellH + cellH * 0.5;
          if (yy <= h.y + inset || yy >= h.y + h.h - inset) continue;
          for (let c = 0; c < cols; c++) {
            const xx = h.x + inset + c * cellW + cellW * 0.5;
            if (xx <= h.x + inset || xx >= h.x + h.w - inset) continue;
            // Outline
            // Understroke for contrast
            ac.strokeStyle = 'rgba(0,30,0,0.55)';
            ac.lineWidth = 3;
            const sizeAdj = 9 * (1 + Math.max(0, Math.min(1, (h.falloff ?? 1)))) * 0.15 + 9; // subtle size scale with falloff
            drawSlopeIndicator(ac as any, xx, yy, dirX, dirY, sizeAdj);
            // Tinted green arrow with strength-based alpha
            const alpha = Math.max(0.28, Math.min(0.65, 0.30 + (s - 1) * 0.22));
            ac.strokeStyle = `rgba(180,255,180,${alpha})`;
            ac.lineWidth = 1.8;
            drawSlopeIndicator(ac as any, xx, yy, dirX, dirY, sizeAdj);
          }
        }
      }

      // Apply mask: keep only fairway, subtract geometry (but not bridges)
      // Keep fairway
      ac.globalCompositeOperation = 'destination-in';
      ac.fillStyle = '#000';
      ac.fillRect(fairX, fairY, fairW, fairH);
      // Cut out walls (bridges are not subtracted so arrows remain visible over them)
      ac.globalCompositeOperation = 'destination-out';
      ac.fillStyle = '#000';
      for (const w of walls) { ac.fillRect(w.x, w.y, w.w, w.h); }
      // Poly walls
      for (const poly of polyWalls) {
        const pts = poly.points; if (!pts || pts.length < 6) continue;
        ac.beginPath(); ac.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ac.lineTo(pts[i], pts[i + 1]);
        ac.closePath(); ac.fill();
      }
      // Posts
      for (const p of posts) { ac.beginPath(); ac.arc(p.x, p.y, p.r + 1, 0, Math.PI * 2); ac.fill(); }
      // Water rects and polys
      for (const w of waters) { ac.fillRect(w.x, w.y, w.w, w.h); }
      for (const wp of watersPoly) {
        const pts = wp.points; if (!pts || pts.length < 6) continue;
        ac.beginPath(); ac.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ac.lineTo(pts[i], pts[i + 1]);
        ac.closePath(); ac.fill();
      }
      // Restore normal comp and draw to main
      ac.globalCompositeOperation = 'source-over';
      ctx.drawImage(arrowsLayer, 0, 0);
    }
  }

  // impact flashes (bounces)
  if (bounces.length > 0) {
    const next: BounceFx[] = [];
    for (const fx of bounces) {
      fx.age += 1 / 60;
      const t = Math.min(1, fx.age / 0.25);
      const alpha = 1 - t;
      const len = 18 + 10 * (1 - t);
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = 2 * (1 - t);
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y);
      ctx.lineTo(fx.x + fx.nx * len, fx.y + fx.ny * len);
      ctx.stroke();
      if (t < 1) next.push(fx);
    }
    bounces = next;
  }

  // hole cup (draw after walls so it is visible)
  ctx.fillStyle = COLORS.holeFill;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.holeRim;
  ctx.stroke();

  // ball
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  // simple shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(ball.x + 2, ball.y + 3, ball.r * 0.9, ball.r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isAiming) {
    drawDebugPreview();
    drawAim();
  }
  // end translation for level content; HUD is drawn in canvas coords
  ctx.restore();

  // HUD (single row across the top with standardized dark strip)
  // Background strip + bottom border per UI_Design.md
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, WIDTH, HUD_HEIGHT);
  ctx.strokeStyle = '#cfd2cf';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HUD_HEIGHT + 0.5);
  ctx.lineTo(WIDTH, HUD_HEIGHT + 0.5);
  ctx.stroke();
  // HUD text styling
  ctx.fillStyle = '#ffffff';
  ctx.font = '16px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  const rrHUD = getMenuRect();
  const toBirdieRaw = (courseInfo.par - 1) - strokes;
  const toBirdie = toBirdieRaw >= 0 ? toBirdieRaw : null;
  const speed = Math.hypot(ball.vx, ball.vy).toFixed(1);
  const leftTextBase = `Hole ${courseInfo.index}/${courseInfo.total}`;
  const leftText = courseInfo.title ? `${leftTextBase} — ${courseInfo.title}` : leftTextBase;
  const totalSoFar = courseScores.reduce((a, b) => a + b, 0) + (gameState === 'sunk' ? 0 : 0);
  const bestText = (!singleLevelMode && bestScoreForCurrentLevel != null) ? `   Best ${bestScoreForCurrentLevel}` : '';
  const centerText = `Par ${courseInfo.par}   Strokes ${strokes}   Total ${totalSoFar}${bestText}`;
  const rightText = `To Birdie: ${toBirdie === null ? '—' : toBirdie}   Speed ${speed}`;
  
  // left: show username, then Hole label shifted to the right
  ctx.textAlign = 'left';
  const leftBaseX = rrHUD.x + rrHUD.w + 12;
  let ulabel = (userProfile.name || '').trim();
  if (!ulabel) ulabel = 'Player';
  if (ulabel.length > 18) ulabel = ulabel.slice(0, 17) + '…';
  ctx.fillText(ulabel, leftBaseX, 6);
  const holeX = leftBaseX + ctx.measureText(ulabel).width + 16;
  ctx.fillText(leftText, holeX, 6);
  // center
  ctx.textAlign = 'center';
  ctx.fillText(centerText, WIDTH / 2, 6);
  // right
  ctx.textAlign = 'right';
  ctx.fillText(rightText, WIDTH - 12, 6);
  
  // Test mode indicator
  if (isTestingLevel) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff6b35';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('TEST MODE - Press Esc to return to editor', WIDTH / 2, 26);
    ctx.fillStyle = COLORS.hudText;
    ctx.font = '16px system-ui, sans-serif';
  }
  
  // restore defaults used later
  ctx.textAlign = 'start';

  // HUD Menu button
  const rr = rrHUD;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = hoverMenu ? '#ffffff' : '#cfd2cf';
  ctx.fillStyle = hoverMenu ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
  ctx.strokeRect(rr.x, rr.y, rr.w, rr.h);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Menu', rr.x + rr.w/2, rr.y + rr.h/2 + 0.5);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'top';

  // Dev-only: small badge to confirm preview toggle state (shows during play/HUD)
  (function drawDevBadge() {
    if (!isDevBuild() || !debugPathPreview) return;
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const label = 'Preview ON (B)';
    const pad = 4;
    const w = ctx.measureText(label).width + pad * 2;
    const h = 18;
    const x = 10;
    const y = HEIGHT - 10;
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + pad, y - 4);
    ctx.restore();
  })();

  // Post-hole banner
  if (gameState === 'sunk') {
    const label = (() => {
      const diff = strokes - courseInfo.par;
      // Classic golf terms, extended beyond basics
      if (diff <= -4) return 'Condor';
      if (diff === -3) return 'Albatross';
      if (diff === -2) return 'Eagle';
      if (diff === -1) return 'Birdie';
      if (diff === 0) return 'Par';
      if (diff === 1) return 'Bogey';
      if (diff === 2) return 'Double Bogey';
      if (diff === 3) return 'Triple Bogey';
      return `${diff} Over`;
    })();
    const text = `${label}!  Strokes ${strokes}  (Par ${courseInfo.par})`;
    ctx.font = '28px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, HEIGHT/2 - 40, WIDTH, 80);
    // color-coded label: better score = green, worse = red, even = white
    const diff = strokes - courseInfo.par;
    const labelColor = diff < 0 ? '#6eff6e' : (diff > 0 ? '#ff6e6e' : '#ffffff');
    ctx.fillStyle = labelColor;
    ctx.fillText(text, WIDTH/2, HEIGHT/2);
    ctx.font = '14px system-ui, sans-serif';
    const isLastHole = courseInfo.index >= courseInfo.total;
    const hint = isLastHole ? 'Click or N: Summary   Space: Replay' : 'Click or N: Next   Space: Replay';
    ctx.fillText(hint, WIDTH/2, HEIGHT/2 + 24);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
  }
  // Course summary overlay (only on final hole and after recording)
  if (gameState === 'summary' && currentLevelIndex >= levelPaths.length - 1 && holeRecorded) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillText('Course Summary', WIDTH/2, 40);
    const total = courseScores.reduce((a, b) => a + (b ?? 0), 0);
    const parTotal = coursePars.reduce((a, b) => a + (b ?? 0), 0);
    const totalDelta = total - parTotal;
    ctx.font = '16px system-ui, sans-serif';
    let y = 80;
    for (let i = 0; i < levelPaths.length; i++) {
      const s = courseScores[i] ?? 0;
      const p = coursePars[i] ?? 0;
      const d = s - p;
      const deltaText = d === 0 ? 'E' : (d > 0 ? `+${d}` : `${d}`);
      const line = `Hole ${i+1}: ${s} (Par ${p}, ${deltaText})`;
      const color = d === 0 ? '#ffffff' : (d > 0 ? '#ff9a9a' : '#9aff9a');
      ctx.fillStyle = color;
      ctx.fillText(line, WIDTH/2, y);
      ctx.fillStyle = '#ffffff';
      y += 22;
    }
    y += 10;
    ctx.font = '18px system-ui, sans-serif';
    const totalDeltaText = totalDelta === 0 ? 'E' : (totalDelta > 0 ? `+${totalDelta}` : `${totalDelta}`);
    const totalColor = totalDelta === 0 ? '#ffffff' : (totalDelta > 0 ? '#ff9a9a' : '#9aff9a');
    ctx.fillStyle = totalColor;
    ctx.fillText(`Total: ${total} (Par ${parTotal}, ${totalDeltaText})`, WIDTH/2, y);
    ctx.fillStyle = '#ffffff';
    y += 28;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Click or Press Enter to Restart Game', WIDTH/2, y);
    // Back to Main Menu button (bottom center)
    const back = getCourseBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverSummaryBack ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverSummaryBack ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(back.x, back.y, back.w, back.h);
    ctx.strokeRect(back.x, back.y, back.w, back.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Main Menu', back.x + back.w/2, back.y + back.h/2 + 0.5);
    // restore defaults
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
  }
  
  // Pause overlay (render last so it sits on top)
  if (paused) {
    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Centered panel per UI_Design.md
    const pr = getPausePanelRect();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pr.x + 0.5, pr.y + 0.5, pr.w - 1, pr.h - 1);
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Pause Menu', pr.x + pr.w/2, pr.y + 20);
    // Info + shortcuts
    ctx.font = '16px system-ui, sans-serif';
    const lines = [
      `Hole ${courseInfo.index}/${courseInfo.total}  Par ${courseInfo.par}  Strokes ${strokes}`,
      `To Birdie: ${toBirdie === null ? '—' : toBirdie}`,
      'Shortcuts:',
      '  P/Esc Pause-Resume   R Restart',
      '  N Next (from banner)   Space Replay',
      '  Enter Summary→Restart'
    ];
    let y = pr.y + 70;
    for (const line of lines) { ctx.fillText(line, pr.x + pr.w/2, y); y += 22; }
    // Pause overlay Options button (above bottom row)
    const po = getPauseOptionsRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverPauseOptions ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverPauseOptions ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(po.x, po.y, po.w, po.h);
    ctx.strokeRect(po.x, po.y, po.w, po.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Options', po.x + po.w/2, po.y + po.h/2 + 0.5);
    // Pause overlay Replay button
    const prb = getPauseReplayRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverPauseReplay ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverPauseReplay ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(prb.x, prb.y, prb.w, prb.h);
    ctx.strokeRect(prb.x, prb.y, prb.w, prb.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Replay', prb.x + prb.w/2, prb.y + prb.h/2 + 0.5);
    // Pause overlay Back to Main Menu
    const pb = getPauseBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverPauseBack ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverPauseBack ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
    ctx.strokeRect(pb.x, pb.y, pb.w, pb.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Back to Main Menu', pb.x + pb.w/2, pb.y + pb.h/2 + 0.5);
    // Pause overlay Close button
    const pc = getPauseCloseRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverPauseClose ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverPauseClose ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(pc.x, pc.y, pc.w, pc.h);
    ctx.strokeRect(pc.x, pc.y, pc.w, pc.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Close', pc.x + pc.w/2, pc.y + pc.h/2 + 0.5);
    // Version inside panel bottom-left
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, pr.x + 12, pr.y + pr.h - 12);
    // restore defaults
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
  }
  
  // Global UI: Toasts and Modal Overlays (render last so they sit on top)
  renderGlobalOverlays();
}

// Extracted: render toasts and modal overlays on top of everything
function renderGlobalOverlays(): void {
  // Draw toasts (top-right stack) and cull expired
  {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    uiToasts = uiToasts.filter(t => t.expiresAt > now);
    let ty = 12;
    for (const t of uiToasts) {
      const padX = 12, padY = 8, boxH = 24;
      ctx.font = '14px system-ui, sans-serif';
      const textW = Math.min(WIDTH - 40, ctx.measureText(t.message).width);
      const boxW = Math.min(WIDTH - 40, Math.max(140, textW + padX * 2));
      const x = WIDTH - boxW - 12;
      const y = ty;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, y, boxW, boxH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.message, x + padX, y + boxH / 2 + 0.5);
      ty += boxH + 8;
    }
  }

  // Modal overlays (confirm, prompt, list, dndList)
  if (isOverlayActive() && uiOverlay.kind !== 'toast') {
    overlayHotspots = [];
    // dim background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // panel metrics
    let panelW = Math.min(640, WIDTH - 80);
    const pad = 16;
    let panelH = 160;
    const hasTitle = !!uiOverlay.title;
    const titleH = hasTitle ? 28 : 0;
    const standardW = Math.min(800, WIDTH - 80);
    const standardH = Math.min(600, HEIGHT - 120);
    if (uiOverlay.kind === 'prompt') { panelW = standardW; panelH = standardH; }
    if (uiOverlay.kind === 'list') { panelW = standardW; panelH = standardH; }
    if (uiOverlay.kind === 'loadLevels') { panelW = standardW; panelH = standardH; }
    if (uiOverlay.kind === 'metadata') { panelW = standardW; panelH = standardH; }
    if (uiOverlay.kind === 'importReview') { panelW = standardW; panelH = standardH; }
    if (uiOverlay.kind === 'annotateScreenshot') { 
      panelW = Math.min(WIDTH - 40, 1200); 
      panelH = Math.min(HEIGHT - 40, 800); 
    }
    if (uiOverlay.kind === 'dndList') {
      const items = uiOverlay.listItems ?? [];
      const visible = Math.min(items.length, 10);
      panelH = 120 + visible * 32 + 56; // title+list+buttons
      panelH = Math.min(panelH, HEIGHT - 120);
    }
    // Persisted or centered position
    let px = (typeof uiOverlay.posX === 'number') ? uiOverlay.posX : Math.floor(WIDTH / 2 - panelW / 2);
    let py = (typeof uiOverlay.posY === 'number') ? uiOverlay.posY : Math.floor(HEIGHT / 2 - panelH / 2);
    // Clamp to viewport bounds (leave margins so outline remains visible)
    const margin = 20;
    px = Math.max(margin, Math.min(WIDTH - panelW - margin, px));
    py = Math.max(margin, Math.min(HEIGHT - panelH - margin, py));
    // Update stored position to clamped values to avoid drift
    uiOverlay.posX = px;
    uiOverlay.posY = py;
    // panel background and border per UI_Design.md
    const isCoursePanels = (uiOverlay.kind === 'courseEditor' || uiOverlay.kind === 'courseCreator');
    const panelBg = isCoursePanels ? 'rgba(0,0,0,0.85)' : 'rgba(20,30,40,0.95)';
    const panelBorder = isCoursePanels ? '#cfd2cf' : 'rgba(100,150,200,0.5)';
    ctx.fillStyle = panelBg;
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = panelBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    let cy = py + pad;
    // title
    if (hasTitle) {
      const centerTitle = !isCoursePanels; // center titles for standard panels
      ctx.font = '24px system-ui, sans-serif';
      ctx.textAlign = centerTitle ? 'center' : 'left';
      if (centerTitle) ctx.fillText(uiOverlay.title!, px + panelW / 2, cy);
      else ctx.fillText(uiOverlay.title!, px + pad, cy);
      cy += titleH;
      // Reset alignment for body content to left to avoid off-center text
      ctx.textAlign = 'left';
    }
    // Title bar drag handle (top region)
    const dragH = Math.max(24, titleH || 0);
    overlayHotspots.push({ kind: 'drag', x: px, y: py, w: panelW, h: dragH });
    // message (simple line-break support)
    if (uiOverlay.message) {
      ctx.font = '14px system-ui, sans-serif';
      const lines = String(uiOverlay.message).split('\n');
      for (const ln of lines) { ctx.fillText(ln, px + pad, cy); cy += 20; }
      cy += 6;
    }
    // kind-specific content
    if (uiOverlay.kind === 'confirm') {
      // Buttons: OK (index 0) and Cancel (index 1)
      const bw = 110, bh = 30, gap = 12;
      const by = py + panelH - pad - bh;
      const okx = px + panelW - pad - bw * 2 - gap;
      const cx = px + panelW - pad - bw;
      // Danger styling for destructive confirms (Delete/Remove)
      const danger = /delete|remove|permanent/i.test(String(uiOverlay.title || '')) || /delete|remove|permanent/i.test(String(uiOverlay.message || ''));
      const okLabel = danger ? 'Delete' : 'OK';
      // OK
      ctx.fillStyle = danger ? 'rgba(255,0,0,0.20)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(okx, by, bw, bh);
      ctx.strokeStyle = danger ? '#ff5555' : '#cfd2cf';
      ctx.lineWidth = 1.5; ctx.strokeRect(okx, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText(okLabel, okx + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 0, x: okx, y: by, w: bw, h: bh });
      // Cancel
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(cx, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(cx, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Cancel', cx + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 1, x: cx, y: by, w: bw, h: bh });
    } else if (uiOverlay.kind === 'prompt') {
      // Input field
      const ih = 28;
      const iw = panelW - pad * 2;
      const ix = px + pad;
      const iy = cy;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(ix, iy, iw, ih);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
      const txt = uiOverlay.inputText ?? '';
      ctx.fillText(txt, ix + 8, iy + ih / 2 + 0.5);
      // Blinking caret at end of text
      {
        const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        if (Math.floor(now / 500) % 2 === 0) {
          const caretX = ix + 8 + ctx.measureText(String(txt)).width + 2;
          const caretTop = iy + 6;
          const caretBottom = iy + ih - 6;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(caretX, caretTop); ctx.lineTo(caretX, caretBottom); ctx.stroke();
        }
      }
      overlayHotspots.push({ kind: 'input', x: ix, y: iy, w: iw, h: ih });
      // Buttons
      const bw = 110, bh = 30, gap = 12;
      const by = py + panelH - pad - bh;
      const okx = px + panelW - pad - bw * 2 - gap;
      const cx = px + panelW - pad - bw;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(okx, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(okx, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
      const okLabel = (uiOverlay as any).okLabel || ((uiOverlay.title === 'Save' || uiOverlay.title === 'Save As' || uiOverlay.title === 'Metadata') ? 'Save' : 'OK');
      ctx.fillText(okLabel, okx + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 0, x: okx, y: by, w: bw, h: bh });
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(cx, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(cx, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Cancel', cx + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 1, x: cx, y: by, w: bw, h: bh });
    } else if (uiOverlay.kind === 'list') {
      // List items
      const items = uiOverlay.listItems ?? [];
      const rowH = 28;
      const maxRows = Math.max(1, Math.floor((panelH - (cy - py) - 80) / rowH));
      const visible = Math.min(items.length, maxRows);
      ctx.font = '14px system-ui, sans-serif';
      for (let i = 0; i < visible; i++) {
        const item = items[i];
        const iy = cy + i * rowH;
        const ix = px + pad;
        const iw = panelW - pad * 2;
        const selected = (uiOverlay.listIndex ?? 0) === i;
        ctx.fillStyle = selected ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.25)';
        ctx.fillRect(ix, iy, iw, rowH - 2);
        ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, rowH - 2 - 1);
        ctx.fillStyle = item.disabled ? '#a0a0a0' : '#ffffff';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(item.label, ix + 8, iy + (rowH - 2) / 2 + 0.5);
        overlayHotspots.push({ kind: 'listItem', index: i, x: ix, y: iy, w: iw, h: rowH - 2 });
      }
      // Cancel button
      const bw = 120, bh = 30;
      const by = py + panelH - pad - bh;
      const bx = px + panelW - pad - bw;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Cancel', bx + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', x: bx, y: by, w: bw, h: bh });
    } else if (uiOverlay.kind === 'dndList') {
      // DnD List items
      const items = uiOverlay.listItems ?? [];
      const rowH = 32;
      const maxRows = Math.min(10, Math.floor((panelH - (cy - py) - 80) / rowH));
      const scroll = Math.max(0, Math.min((items.length - maxRows), Math.floor(uiOverlay.dndScroll ?? 0)));
      ctx.font = '14px system-ui, sans-serif';
      for (let vi = 0; vi < Math.min(items.length - scroll, maxRows); vi++) {
        const i = scroll + vi;
        const item = items[i];
        const iy = cy + vi * rowH;
        const ix = px + pad;
        const iw = panelW - pad * 2;
        const selected = (uiOverlay.listIndex ?? 0) === i;
        const isHoverRow = (uiOverlay as any).hoverDnDIndex === i;
        ctx.fillStyle = selected ? 'rgba(255,255,255,0.12)' : (isHoverRow ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.25)');
        ctx.fillRect(ix, iy, iw, rowH - 4);
        ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, rowH - 4 - 1);
        ctx.fillStyle = item.disabled ? '#a0a0a0' : '#ffffff';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(item.label, ix + 8, iy + (rowH - 4) / 2 + 0.5);
        overlayHotspots.push({ kind: 'listItem', index: i, x: ix, y: iy, w: iw, h: rowH - 4 });

        // If this row is currently being dragged, show a subtle grabbed outline
        if (typeof uiOverlay.dndDragIndex === 'number' && uiOverlay.dndDragIndex === i) {
          try { (ctx as any).setLineDash?.([4, 2]); } catch {}
          ctx.strokeStyle = '#88d4ff';
          ctx.lineWidth = 1;
          ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, rowH - 4 - 1);
          try { (ctx as any).setLineDash?.([]); } catch {}
        }
      }
      // If dragging, draw insertion indicator
      if (typeof uiOverlay.dndDragIndex === 'number' && typeof uiOverlay.dndTargetIndex === 'number') {
        const vi = uiOverlay.dndTargetIndex - scroll;
        if (vi >= 0 && vi <= maxRows) {
          const y = cy + vi * rowH;
          ctx.strokeStyle = '#88d4ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px + pad, y);
          ctx.lineTo(px + panelW - pad, y);
          ctx.stroke();

          // End caps to better indicate the insertion slot
          ctx.beginPath();
          ctx.moveTo(px + pad, y - 6);
          ctx.lineTo(px + pad, y + 6);
          ctx.moveTo(px + panelW - pad, y - 6);
          ctx.lineTo(px + panelW - pad, y + 6);
          ctx.stroke();
        }
        // Ghost preview of dragged item
        const dragIdx = uiOverlay.dndDragIndex;
        const dragItem = items[dragIdx];
        if (dragItem) {
          const ghostY = (uiOverlay.dndPointerY ?? (cy)) - rowH / 2;
          const gx = px + pad + 4;
          const gw = panelW - pad * 2 - 8;
          const gh = rowH - 6;
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = 'rgba(136,212,255,0.25)';
          ctx.fillRect(gx, ghostY, gw, gh);
          ctx.strokeStyle = '#88d4ff'; ctx.lineWidth = 1;
          ctx.strokeRect(gx + 0.5, ghostY + 0.5, gw - 1, gh - 1);
          ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
          ctx.fillText(String(dragItem.label || ''), gx + 8, ghostY + gh / 2 + 0.5);
          ctx.globalAlpha = 1.0;
        }
      }
      // Buttons: Save (index 0) and Cancel (index 1)
      const bw = 120, bh = 30, gap = 12;
      const by = py + panelH - pad - bh;
      const saveX = px + panelW - pad - bw * 2 - gap;
      const cancelX = px + panelW - pad - bw;
      // Save
      const saveHover = (uiOverlay as any).hoverDnDBtn === 'save';
      ctx.fillStyle = saveHover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(saveX, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(saveX, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Save', saveX + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 0, x: saveX, y: by, w: bw, h: bh });
      // Cancel
      const cancelHover = (uiOverlay as any).hoverDnDBtn === 'cancel';
      ctx.fillStyle = cancelHover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(cancelX, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(cancelX, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Cancel', cancelX + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 1, x: cancelX, y: by, w: bw, h: bh });
    } else if (uiOverlay.kind === 'metadata') {
      // Build a simple 2-column form inside a panel
      const labels = ['Title','Author','Par','Description','Tags'];
      const values = [uiOverlay.metaTitle||'', uiOverlay.metaAuthor||'', uiOverlay.metaPar||'3', uiOverlay.metaDescription||'', uiOverlay.metaTags||''];
      const rows = labels.length;
      const lh = 28;
      const lw = 110;
      const iw = panelW - pad * 3 - lw;
      for (let i = 0; i < rows; i++) {
        const iy = cy + i * (lh + 10);
        // Label
        ctx.fillStyle = '#ffffff'; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(labels[i], px + pad, iy + lh/2);
        // Input
        const ix = px + pad + lw;
        const ih = (i === 3) ? 60 : lh; // bigger for Description
        const multi = i === 3;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(ix, iy, iw, ih);
        ctx.strokeStyle = (uiOverlay.metaFocus === ['title','author','par','description','tags'][i]) ? '#ffffff' : '#cfd2cf';
        ctx.lineWidth = 1.2; ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '14px system-ui, sans-serif';
        const text = values[i];
        const ty = multi ? iy + 6 : iy + (ih/2 - 8);
        ctx.fillText(text, ix + 8, ty + 0.5);
        overlayHotspots.push({ kind: 'input', index: i, x: ix, y: iy, w: iw, h: ih });
        if (multi) { cy += 32; }
        // Blinking caret for focused single-line fields
        if (!multi && uiOverlay.metaFocus === ['title','author','par','description','tags'][i]) {
          const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          if (Math.floor(now / 500) % 2 === 0) {
            const caretX = ix + 8 + ctx.measureText(String(text)).width + 2;
            const caretTop = iy + 6;
            const caretBottom = iy + ih - 6;
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(caretX, caretTop); ctx.lineTo(caretX, caretBottom); ctx.stroke();
          }
        }
      }
      cy += rows * 4;
      // Buttons: Save (index 0) and Cancel (index 1)
      const bw = 120, bh = 30, gap = 12;
      const by = py + panelH - pad - bh;
      const okx = px + panelW - pad - bw * 2 - gap;
      const cxBtn = px + panelW - pad - bw;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(okx, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(okx, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Save', okx + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 0, x: okx, y: by, w: bw, h: bh });
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(cxBtn, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(cxBtn, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Cancel', cxBtn + bw / 2, by + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', index: 1, x: cxBtn, y: by, w: bw, h: bh });
    } else if (uiOverlay.kind === 'importReview') {
      // Import Review overlay UI
      const o: any = uiOverlay as any;
      const padSm = 10;
      const sectionW = panelW - pad * 2;
      let y = cy;
      // Build/cached preview canvas for the imageData
      if (!o.imageCanvas && o.imageData) {
        try {
          const cv = document.createElement('canvas');
          cv.width = o.imageData.width; cv.height = o.imageData.height;
          const c2d = cv.getContext('2d')!;
          c2d.putImageData(o.imageData, 0, 0);
          o.imageCanvas = cv;
        } catch {}
      }
      const imgCv = o.imageCanvas as HTMLCanvasElement | undefined;
      const imgW = imgCv ? imgCv.width : 0;
      const imgH = imgCv ? imgCv.height : 0;
      // Preview rect (keep aspect)
      const prevH = Math.min(360, panelH - (cy - py) - 160);
      const prevW = Math.min(sectionW, Math.round(prevH * (imgW && imgH ? (imgW / imgH) : 1.6)));
      const prevX = px + pad;
      const prevY = y;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(prevX, prevY, prevW, prevH);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(prevX + 0.5, prevY + 0.5, prevW - 1, prevH - 1);
      if (imgCv) {
        // Draw scaled
        const scale = Math.min(prevW / imgW, prevH / imgH);
        const dw = Math.floor(imgW * scale), dh = Math.floor(imgH * scale);
        const dx = prevX + Math.floor((prevW - dw) / 2);
        const dy = prevY + Math.floor((prevH - dh) / 2);
        ctx.drawImage(imgCv, dx, dy, dw, dh);
        // Overlay polys (previewPolys if present; else currentPolys)
        const polys = (o.previewPolys || o.currentPolys) || { wallsPoly: [], sandPoly: [], waterPoly: [] };
        const drawPoly = (pts: number[], stroke: string) => {
          if (!pts || pts.length < 4) return;
          ctx.beginPath();
          for (let i = 0; i + 1 < pts.length; i += 2) {
            const x = dx + Math.round(pts[i] * scale);
            const y = dy + Math.round(pts[i + 1] * scale);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2;
          try { (ctx as any).setLineDash?.([4, 3]); } catch {}
          ctx.stroke();
          try { (ctx as any).setLineDash?.([]); } catch {}
        };
        const showWalls = (o.showWalls !== false);
        const showSand = (o.showSand !== false);
        const showWater = (o.showWater !== false);
        if (showWalls) for (const p of (polys.wallsPoly || [])) drawPoly(p.points, '#e2e2e2');
        if (showSand) for (const p of (polys.sandPoly || [])) drawPoly(p.points, '#d4b36a');
        if (showWater) for (const p of (polys.waterPoly || [])) drawPoly(p.points, '#1f6dff');
      }
      y += prevH + 12;

      // Brief detection counts feedback
      {
        const polys = (o.previewPolys || o.currentPolys) || { wallsPoly: [], sandPoly: [], waterPoly: [] };
        const wCount = (polys.wallsPoly || []).length | 0;
        const sCount = (polys.sandPoly || []).length | 0;
        const waCount = (polys.waterPoly || []).length | 0;
        const info = `Detected — Walls: ${wCount}  Sand: ${sCount}  Water: ${waCount}`;
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(info, px + pad, y - 4);
        if (wCount + sCount + waCount === 0) {
          ctx.fillText('No features detected. Try Looser and Recompute.', px + pad, y + 14);
        }
      }

      // Controls row: toggles
      const btnH = 28; const btnW = 110; let bx = px + pad;
      const drawToggle = (label: string, on: boolean, action: string) => {
        ctx.fillStyle = on ? 'rgba(100,150,200,0.5)' : 'rgba(255,255,255,0.10)';
        ctx.fillRect(bx, y, btnW, btnH);
        ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, btnW - 1, btnH - 1);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
        ctx.fillText(label, bx + btnW / 2, y + btnH / 2 + 0.5);
        overlayHotspots.push({ kind: 'btn', action, x: bx, y, w: btnW, h: btnH });
        bx += btnW + padSm;
      };
      drawToggle('Walls', (o.showWalls !== false), 'toggle_walls');
      drawToggle('Sand', (o.showSand !== false), 'toggle_sand');
      drawToggle('Water', (o.showWater !== false), 'toggle_water');

      // Threshold presets and recompute
      const rx = px + panelW - pad - (btnW * 3 + padSm * 2);
      const by = y;
      const drawBtn = (label: string, action: string, x: number) => {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(x, by, btnW, btnH);
        ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.2; ctx.strokeRect(x + 0.5, by + 0.5, btnW - 1, btnH - 1);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
        ctx.fillText(label, x + btnW / 2, by + btnH / 2 + 0.5);
        overlayHotspots.push({ kind: 'btn', action, x, y: by, w: btnW, h: btnH });
      };
      drawBtn('Looser', 'looser', rx);
      drawBtn('Stricter', 'stricter', rx + btnW + padSm);
      drawBtn('Recompute', 'recompute', rx + (btnW + padSm) * 2);

      // Accept/Cancel
      const bw = 120, bh = 30, gap = 12;
      const by2 = py + panelH - pad - bh;
      const okx = px + panelW - pad - bw * 2 - gap;
      const cxBtn = px + panelW - pad - bw;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(okx, by2, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(okx, by2, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Accept', okx + bw / 2, by2 + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', action: 'accept', x: okx, y: by2, w: bw, h: bh });
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(cxBtn, by2, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(cxBtn, by2, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Cancel', cxBtn + bw / 2, by2 + bh / 2 + 0.5);
      overlayHotspots.push({ kind: 'btn', action: 'cancel', x: cxBtn, y: by2, w: bw, h: bh });
    } else if (uiOverlay.kind === 'loadLevels') {
      // Level Load overlay: filters + scrollable list + Load/Cancel
      const all = uiOverlay.loadLevels ?? [];
      const padSm = 10;
      // Filters row
      const filters: Array<{ id: 'all'|'built-in'|'user'|'local'; label: string }>= [
        { id: 'all', label: 'All' },
        { id: 'built-in', label: 'Bundled' },
        { id: 'user', label: 'User' },
        { id: 'local', label: 'Local' }
      ];
      const active = uiOverlay.loadFilter || 'all';
      let fx = px + pad;
      const fy = cy;
      const fH = 28;
      for (const f of filters) {
        const fw = 100;
        const isActive = (active === f.id);
        const isHover = (uiOverlay.hoverFilter === f.id);
        ctx.fillStyle = isActive ? 'rgba(100,150,200,0.8)' : (isHover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.1)');
        ctx.fillRect(fx, fy, fw, fH);
        ctx.strokeStyle = isActive ? 'rgba(100,150,200,0.8)' : '#cfd2cf'; ctx.lineWidth = 1; ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fH - 1);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
        ctx.fillText(f.label, fx + fw/2, fy + fH/2 + 0.5);
        overlayHotspots.push({ kind: 'btn', action: `filter_${f.id}`, x: fx, y: fy, w: fw, h: fH });
        fx += fw + padSm;
      }
      // Search box on the right side of the filters row
      const searchW = 240;
      const searchX = px + panelW - pad - searchW;
      const searchY = fy;
      const searchH = fH;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(searchX, searchY, searchW, searchH);
      const searchFocused = !!uiOverlay.loadSearchFocus;
      const searchHover = !!uiOverlay.hoverSearch;
      ctx.strokeStyle = searchFocused ? '#ffffff' : (searchHover ? '#cfd2cf' : '#888888');
      ctx.lineWidth = 1.2; ctx.strokeRect(searchX + 0.5, searchY + 0.5, searchW - 1, searchH - 1);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
      const q = (uiOverlay.loadSearch || '').toString();
      const placeholder = 'Search title or author…';
      const textToShow = q.length ? q : placeholder;
      ctx.globalAlpha = q.length ? 1.0 : 0.6;
      ctx.fillText(textToShow, searchX + 8, searchY + searchH/2 + 0.5);
      ctx.globalAlpha = 1.0;
      overlayHotspots.push({ kind: 'input', id: 'loadSearch', x: searchX, y: searchY, w: searchW, h: searchH });
      // Blinking caret when search is focused
      if (searchFocused) {
        const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        if (Math.floor(now / 500) % 2 === 0) {
          const caretX = searchX + 8 + ctx.measureText(q).width + 2;
          const caretTop = searchY + 6;
          const caretBottom = searchY + searchH - 6;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(caretX, caretTop); ctx.lineTo(caretX, caretBottom); ctx.stroke();
        }
      }
      // Inline hint
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('Type to search • Enter to load • Esc to cancel', px + pad, fy + fH + 10);
      cy += fH + 12;

      // Filter items
      const filteredBySource = all.filter((it) => {
        if (active === 'all') return true;
        return it.source === active;
      });
      const query = (uiOverlay.loadSearch || '').toLowerCase().trim();
      const filtered = query ? filteredBySource.filter((it) => {
        const t = (it.title || '').toLowerCase();
        const a = (it.author || '').toLowerCase();
        return t.includes(query) || a.includes(query);
      }) : filteredBySource;

      // Layout: list on left, details on right
      const listW = Math.floor(panelW * 0.58);
      const detailW = panelW - listW - pad * 3;
      const listX = px + pad;
      const listY = cy;
      const rowH = 40; // UI_Design.md standard list row height
      const listH = panelH - (cy - py) - 80;
      const maxRows = Math.max(1, Math.floor(listH / rowH));
      const scroll = Math.max(0, Math.min(Math.max(0, filtered.length - maxRows), uiOverlay.scrollOffset ?? 0));
      ctx.font = '16px system-ui, sans-serif';
      // Clamp selection to available items
      if ((uiOverlay.selectedLevelIndex ?? 0) > Math.max(0, filtered.length - 1)) {
        uiOverlay.selectedLevelIndex = Math.max(0, filtered.length - 1);
      }
      const selIdx = Math.max(0, Math.min(filtered.length - 1, uiOverlay.selectedLevelIndex ?? 0));
      for (let vi = 0; vi < Math.min(filtered.length - scroll, maxRows); vi++) {
        const i = scroll + vi;
        const item = filtered[i];
        const iy = listY + vi * rowH;
        const selected = selIdx === i;
        const isHoverRow = (uiOverlay.hoverLevelIndex === i);
        ctx.fillStyle = selected ? 'rgba(100,150,200,0.30)' : (isHoverRow ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)');
        ctx.fillRect(listX, iy, listW, rowH - 2);
        ctx.strokeStyle = selected ? 'rgba(100,150,200,0.8)' : (isHoverRow ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)');
        ctx.lineWidth = 1;
        ctx.strokeRect(listX + 0.5, iy + 0.5, listW - 1, rowH - 2 - 1);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const label = `${item.title} — ${item.author}`;
        ctx.fillText(label, listX + 10, iy + (rowH - 2)/2 + 0.5);
        overlayHotspots.push({ kind: 'levelItem', index: i, x: listX, y: iy, w: listW, h: rowH - 2 });
      }

      // Right-side details
      const detX = listX + listW + pad;
      const detY = listY;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(detX, detY, detailW, listH);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(detX + 0.5, detY + 0.5, detailW - 1, listH - 1);
      // Selected details text
      const idx = uiOverlay.selectedLevelIndex ?? 0;
      if (filtered[idx]) {
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const sel = filtered[idx];
        ctx.fillText(sel.title, detX + 10, detY + 10);
        ctx.fillStyle = '#aaaaaa';
        const meta2 = `by ${sel.author} • ${sel.source}${sel.lastModified ? ' • ' + new Date(sel.lastModified).toLocaleString() : ''}`;
        ctx.fillText(meta2, detX + 10, detY + 34);
      }

      // Buttons: Load and Cancel per UI_Design.md (standard height 28px)
      const bw = 110, bh = 28, gap = 12;
      const by = py + panelH - pad - bh;
      const loadX = px + panelW - pad - bw * 2 - gap;
      const cancelX = px + panelW - pad - bw;
      const canLoad = filtered.length > 0;
      const loadHover = uiOverlay.hoverBtn === 'load';
      ctx.fillStyle = canLoad ? (loadHover ? 'rgba(120,170,220,0.95)' : 'rgba(100,150,200,0.80)') : 'rgba(100,100,100,0.20)';
      ctx.fillRect(loadX, by, bw, bh);
      ctx.strokeStyle = canLoad ? (loadHover ? 'rgba(120,170,220,0.95)' : 'rgba(100,150,200,0.80)') : '#666666'; ctx.lineWidth = 1.5; ctx.strokeRect(loadX, by, bw, bh);
      ctx.fillStyle = canLoad ? '#ffffff' : '#999999'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Load', loadX + bw/2, by + bh/2 + 0.5);
      if (canLoad) overlayHotspots.push({ kind: 'btn', action: 'load', x: loadX, y: by, w: bw, h: bh });

      const cancelHover = uiOverlay.hoverBtn === 'cancel';
      ctx.fillStyle = cancelHover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(cancelX, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(cancelX, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.font = '14px system-ui, sans-serif'; ctx.fillText('Cancel', cancelX + bw/2, by + bh/2 + 0.5);
      overlayHotspots.push({ kind: 'btn', action: 'cancel', x: cancelX, y: by, w: bw, h: bh });

    } else if (uiOverlay.kind === 'courseEditor') {
      // Course Editor UI - single screen with center-listed levels
      const courseData = uiOverlay.courseData;
      if (!courseData) return;
      
      // Adjust panel size for Course Editor
      const editorPanelW = Math.min(800, WIDTH - 80);
      const editorPanelH = Math.min(600, HEIGHT - 120);
      
      // Recalculate position for larger panel
      px = Math.floor(WIDTH / 2 - editorPanelW / 2);
      py = Math.floor(HEIGHT / 2 - editorPanelH / 2);
      px = Math.max(margin, Math.min(WIDTH - editorPanelW - margin, px));
      py = Math.max(margin, Math.min(HEIGHT - editorPanelH - margin, py));
      
      // Redraw panel with new dimensions
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(px, py, editorPanelW, editorPanelH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.5, py + 0.5, editorPanelW - 1, editorPanelH - 1);
      
      // Title area
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const titleText = uiOverlay.courseEditingTitle ? 'Edit Course Name:' : uiOverlay.title || 'Edit Course';
      ctx.fillText(titleText, px + pad, py + pad);
      
      let contentY = py + pad + 32;
      
      // Course title editing area
      if (uiOverlay.courseEditingTitle) {
        const inputH = 32;
        const inputW = editorPanelW - pad * 2;
        const inputX = px + pad;
        
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(inputX, contentY, inputW, inputH);
        ctx.strokeStyle = '#88d4ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(inputX + 0.5, contentY + 0.5, inputW - 1, inputH - 1);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const editText = uiOverlay.courseNewTitle || '';
        ctx.fillText(editText, inputX + 8, contentY + inputH / 2);
        
        // Cursor
        const textWidth = ctx.measureText(editText).width;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(inputX + 8 + textWidth + 2, contentY + 6);
        ctx.lineTo(inputX + 8 + textWidth + 2, contentY + inputH - 6);
        ctx.stroke();
        
        contentY += inputH + 16;
      }
      
      // Level list area
      const listStartY = contentY;
      const listEndY = py + editorPanelH - 80; // Leave space for buttons
      const listHeight = listEndY - listStartY;
      const rowHeight = 40;
      const maxVisibleRows = Math.floor(listHeight / rowHeight);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      // Render level rows with scrolling support
      const levels = courseData.levelIds || [];
      const levelTitles = courseData.levelTitles || [];
      const scrollOffset = uiOverlay.scrollOffset ?? 0;
      const visibleLevels = levels.slice(scrollOffset, scrollOffset + maxVisibleRows);
      
      // Draw scrollbar if needed
      if (levels.length > maxVisibleRows) {
        const scrollbarX = px + editorPanelW - 20;
        const scrollbarY = listStartY;
        const scrollbarH = listHeight;
        const scrollbarW = 16;
        
        // Scrollbar track
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(scrollbarX, scrollbarY, scrollbarW, scrollbarH);
        ctx.strokeStyle = '#cfd2cf';
        ctx.lineWidth = 1;
        ctx.strokeRect(scrollbarX + 0.5, scrollbarY + 0.5, scrollbarW - 1, scrollbarH - 1);
        
        // Scrollbar thumb
        const thumbHeight = Math.max(20, (maxVisibleRows / levels.length) * scrollbarH);
        const thumbY = scrollbarY + (scrollOffset / (levels.length - maxVisibleRows)) * (scrollbarH - thumbHeight);
        ctx.fillStyle = 'rgba(136, 212, 255, 0.6)';
        ctx.fillRect(scrollbarX + 2, thumbY, scrollbarW - 4, thumbHeight);
        ctx.strokeStyle = '#88d4ff';
        ctx.strokeRect(scrollbarX + 2.5, thumbY + 0.5, scrollbarW - 5, thumbHeight - 1);
      }
      
      const dragState = uiOverlay.dragState;
      const isDragging = dragState?.isDragging;
      const dragIndex = dragState?.dragIndex;
      const targetIndex = dragState?.targetIndex;
      
      for (let i = 0; i < visibleLevels.length; i++) {
        const actualIndex = scrollOffset + i;
        const rowY = listStartY + i * rowHeight;
        const rowX = px + pad;
        const rowW = editorPanelW - pad * 2 - (levels.length > maxVisibleRows ? 24 : 0); // Account for scrollbar
        const isSelected = (uiOverlay.selectedLevelIndex === actualIndex);
        const isBeingDragged = isDragging && dragIndex === actualIndex;
        
        // Draw drop indicator line if dragging
        if (isDragging && typeof targetIndex === 'number') {
          if (targetIndex === actualIndex) {
            // Draw drop line above this row
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(rowX, rowY - 1);
            ctx.lineTo(rowX + rowW, rowY - 1);
            ctx.stroke();
          } else if (targetIndex === actualIndex + 1) {
            // Draw drop line below this row
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(rowX, rowY + rowHeight - 2);
            ctx.lineTo(rowX + rowW, rowY + rowHeight - 2);
            ctx.stroke();
          }
        }
        
        // Row background
        ctx.fillStyle = isBeingDragged ? 'rgba(255,255,255,0.1)' : (isSelected ? 'rgba(136, 212, 255, 0.2)' : 'rgba(255,255,255,0.05)');
        ctx.fillRect(rowX, rowY, rowW, rowHeight - 2);
        
        // Row border
        ctx.strokeStyle = isBeingDragged ? '#ffaa00' : (isSelected ? '#88d4ff' : '#cfd2cf');
        ctx.lineWidth = isBeingDragged ? 2 : 1;
        ctx.strokeRect(rowX + 0.5, rowY + 0.5, rowW - 1, rowHeight - 2 - 1);
        
        // Level text
        ctx.fillStyle = isBeingDragged ? '#cccccc' : '#ffffff';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const levelTitle = levelTitles[actualIndex] || levels[actualIndex] || 'level';
        ctx.fillText(levelTitle, rowX + 12, rowY + (rowHeight - 2) / 2);
        
        // Add hotspot for level selection
        overlayHotspots.push({ kind: 'levelItem', index: actualIndex, x: rowX, y: rowY, w: rowW, h: rowHeight - 2 });
      }
      
      
      // Control buttons (left side)
      const buttonY = py + editorPanelH - 60;
      const buttonH = 28;
      const buttonGap = 8;
      let buttonX = px + pad;
      
      // Rename Course button
      const renameBtnW = 120;
      ctx.fillStyle = 'rgba(255,165,0,0.2)';
      ctx.fillRect(buttonX, buttonY, renameBtnW, buttonH);
      ctx.strokeStyle = '#ffa500';
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, renameBtnW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📝 Rename Course', buttonX + renameBtnW / 2, buttonY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'renameCourse', x: buttonX, y: buttonY, w: renameBtnW, h: buttonH });
      buttonX += renameBtnW + buttonGap;
      
      // Add Level button
      const addBtnW = 100;
      ctx.fillStyle = 'rgba(0,255,0,0.2)';
      ctx.fillRect(buttonX, buttonY, addBtnW, buttonH);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, addBtnW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('➕ Add Level', buttonX + addBtnW / 2, buttonY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'addLevel', x: buttonX, y: buttonY, w: addBtnW, h: buttonH });
      buttonX += addBtnW + buttonGap;
      
      // Remove Level button
      const removeBtnW = 120;
      const hasSelection = (uiOverlay.selectedLevelIndex ?? -1) >= 0;
      ctx.fillStyle = hasSelection ? 'rgba(255,0,0,0.2)' : 'rgba(100,100,100,0.2)';
      ctx.fillRect(buttonX, buttonY, removeBtnW, buttonH);
      ctx.strokeStyle = hasSelection ? '#ff0000' : '#666666';
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, removeBtnW - 1, buttonH - 1);
      ctx.fillStyle = hasSelection ? '#ffffff' : '#999999';
      ctx.fillText('➖ Remove Level', buttonX + removeBtnW / 2, buttonY + buttonH / 2);
      if (hasSelection) {
        overlayHotspots.push({ kind: 'btn', action: 'removeLevel', x: buttonX, y: buttonY, w: removeBtnW, h: buttonH });
      }
      buttonX += removeBtnW + buttonGap;
      
      // Delete Course button
      const deleteBtnW = 120;
      ctx.fillStyle = 'rgba(139,0,0,0.3)';
      ctx.fillRect(buttonX, buttonY, deleteBtnW, buttonH);
      ctx.strokeStyle = '#8b0000';
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, deleteBtnW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('🗑️ Delete Course', buttonX + deleteBtnW / 2, buttonY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'deleteCourse', x: buttonX, y: buttonY, w: deleteBtnW, h: buttonH });
      
      // Save/Cancel buttons (bottom right)
      const saveCancelY = buttonY;
      const saveCancelW = 80;
      const saveCancelGap = 12;
      
      // Save button
      const saveX = px + editorPanelW - pad - saveCancelW * 2 - saveCancelGap;
      ctx.fillStyle = 'rgba(0,128,0,0.3)';
      ctx.fillRect(saveX, saveCancelY, saveCancelW, buttonH);
      ctx.strokeStyle = '#008000';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(saveX + 0.5, saveCancelY + 0.5, saveCancelW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Save', saveX + saveCancelW / 2, saveCancelY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'save', x: saveX, y: saveCancelY, w: saveCancelW, h: buttonH });
      
      // Cancel button
      const cancelX = px + editorPanelW - pad - saveCancelW;
      ctx.fillStyle = 'rgba(128,128,128,0.3)';
      ctx.fillRect(cancelX, saveCancelY, saveCancelW, buttonH);
      ctx.strokeStyle = '#808080';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cancelX + 0.5, saveCancelY + 0.5, saveCancelW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Cancel', cancelX + saveCancelW / 2, saveCancelY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'cancel', x: cancelX, y: saveCancelY, w: saveCancelW, h: buttonH });
    } else if (uiOverlay.kind === 'courseCreator') {
      // Course Creator UI - matches Edit Course design
      const courses = uiOverlay.courseList || [];
      
      // Adjust panel size for Course Creator
      const editorPanelW = Math.min(800, WIDTH - 80);
      const editorPanelH = Math.min(600, HEIGHT - 120);
      
      // Recalculate position for larger panel
      px = Math.floor(WIDTH / 2 - editorPanelW / 2);
      py = Math.floor(HEIGHT / 2 - editorPanelH / 2);
      px = Math.max(margin, Math.min(WIDTH - editorPanelW - margin, px));
      py = Math.max(margin, Math.min(HEIGHT - editorPanelH - margin, py));
      
      // Redraw panel with new dimensions
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(px, py, editorPanelW, editorPanelH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.5, py + 0.5, editorPanelW - 1, editorPanelH - 1);
      
      // Title area
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(uiOverlay.title || 'Course Creator', px + pad, py + pad);
      
      let contentY = py + pad + 32;
      
      // Course list area
      const listStartY = contentY;
      const listEndY = py + editorPanelH - 80; // Leave space for buttons
      const listHeight = listEndY - listStartY;
      const rowHeight = 40;
      const maxVisibleRows = Math.floor(listHeight / rowHeight);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      // Render course rows with scrolling support
      const totalItems = courses.length + 1; // +1 for "New Course" item
      const scrollOffset = uiOverlay.courseScrollOffset ?? 0;
      const visibleItems = [];
      
      // Add existing courses
      for (let i = scrollOffset; i < Math.min(courses.length, scrollOffset + maxVisibleRows); i++) {
        if (i >= 0) visibleItems.push({ type: 'course', index: i, data: courses[i] });
      }
      
      // Add "New Course" item if it should be visible
      const newCourseIndex = courses.length;
      if (newCourseIndex >= scrollOffset && visibleItems.length < maxVisibleRows) {
        visibleItems.push({ type: 'newCourse', index: newCourseIndex, data: null });
      }
      
      // Draw scrollbar if needed
      if (totalItems > maxVisibleRows) {
        const scrollbarX = px + editorPanelW - 20;
        const scrollbarY = listStartY;
        const scrollbarH = listHeight;
        const scrollbarW = 16;
        
        // Scrollbar track
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(scrollbarX, scrollbarY, scrollbarW, scrollbarH);
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 1;
        ctx.strokeRect(scrollbarX + 0.5, scrollbarY + 0.5, scrollbarW - 1, scrollbarH - 1);
        
        // Scrollbar thumb
        const thumbHeight = Math.max(20, (maxVisibleRows / totalItems) * scrollbarH);
        const thumbY = scrollbarY + (scrollOffset / (totalItems - maxVisibleRows)) * (scrollbarH - thumbHeight);
        ctx.fillStyle = 'rgba(136, 212, 255, 0.6)';
        ctx.fillRect(scrollbarX + 2, thumbY, scrollbarW - 4, thumbHeight);
        ctx.strokeStyle = '#88d4ff';
        ctx.strokeRect(scrollbarX + 2.5, thumbY + 0.5, scrollbarW - 5, thumbHeight - 1);
      }
      
      for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        const rowY = listStartY + i * rowHeight;
        const rowX = px + pad;
        const rowW = editorPanelW - pad * 2 - (totalItems > maxVisibleRows ? 24 : 0); // Account for scrollbar
        const isSelected = (uiOverlay.selectedCourseIndex === item.index);
        
        // Row background
        ctx.fillStyle = isSelected ? 'rgba(136, 212, 255, 0.2)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(rowX, rowY, rowW, rowHeight - 2);
        
        // Row border
        ctx.strokeStyle = isSelected ? '#88d4ff' : '#cfd2cf';
        ctx.lineWidth = 1;
        ctx.strokeRect(rowX + 0.5, rowY + 0.5, rowW - 1, rowHeight - 2 - 1);
        
        // Item text
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        
        let itemText = '';
        if (item.type === 'course' && item.data) {
          const course = item.data;
          itemText = `${course.title} (${course.levelIds.length} levels)`;
        } else if (item.type === 'newCourse') {
          itemText = '➕ New Course…';
          ctx.fillStyle = '#90EE90'; // Light green for new course option
        }
        
        ctx.fillText(itemText, rowX + 12, rowY + (rowHeight - 2) / 2);
        
        // Add hotspot for item selection
        overlayHotspots.push({ kind: 'listItem', index: item.index, x: rowX, y: rowY, w: rowW, h: rowHeight - 2 });
      }
      
      // Control buttons (bottom area)
      const buttonY = py + editorPanelH - 60;
      const buttonH = 28;
      const buttonGap = 8;
      let buttonX = px + pad;
      
      // Edit Course button (only enabled if a course is selected)
      const editBtnW = 120;
      const hasSelection = (uiOverlay.selectedCourseIndex ?? -1) >= 0 && (uiOverlay.selectedCourseIndex ?? -1) < courses.length;
      ctx.fillStyle = hasSelection ? 'rgba(0,128,255,0.2)' : 'rgba(100,100,100,0.2)';
      ctx.fillRect(buttonX, buttonY, editBtnW, buttonH);
      ctx.strokeStyle = hasSelection ? '#0080ff' : '#666666';
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, editBtnW - 1, buttonH - 1);
      ctx.fillStyle = hasSelection ? '#ffffff' : '#999999';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📝 Edit Course', buttonX + editBtnW / 2, buttonY + buttonH / 2);
      if (hasSelection) {
        overlayHotspots.push({ kind: 'btn', action: 'editCourse', x: buttonX, y: buttonY, w: editBtnW, h: buttonH });
      }
      buttonX += editBtnW + buttonGap;
      
      // New Course button
      const newBtnW = 120;
      ctx.fillStyle = 'rgba(0,255,0,0.2)';
      ctx.fillRect(buttonX, buttonY, newBtnW, buttonH);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, newBtnW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('➕ New Course', buttonX + newBtnW / 2, buttonY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'newCourse', x: buttonX, y: buttonY, w: newBtnW, h: buttonH });
      buttonX += newBtnW + buttonGap;
      
      // Delete Course button
      const deleteBtnW = 120;
      ctx.fillStyle = hasSelection ? 'rgba(139,0,0,0.3)' : 'rgba(100,100,100,0.2)';
      ctx.fillRect(buttonX, buttonY, deleteBtnW, buttonH);
      ctx.strokeStyle = hasSelection ? '#8b0000' : '#666666';
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, deleteBtnW - 1, buttonH - 1);
      ctx.fillStyle = hasSelection ? '#ffffff' : '#999999';
      ctx.fillText('🗑️ Delete Course', buttonX + deleteBtnW / 2, buttonY + buttonH / 2);
      if (hasSelection) {
        overlayHotspots.push({ kind: 'btn', action: 'deleteCourse', x: buttonX, y: buttonY, w: deleteBtnW, h: buttonH });
      }
      
      // Cancel button (bottom right)
      const cancelBtnY = buttonY;
      const cancelBtnW = 80;
      const cancelX = px + editorPanelW - pad - cancelBtnW;
      ctx.fillStyle = 'rgba(128,128,128,0.3)';
      ctx.fillRect(cancelX, cancelBtnY, cancelBtnW, buttonH);
      ctx.strokeStyle = '#808080';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cancelX + 0.5, cancelBtnY + 0.5, cancelBtnW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Cancel', cancelX + cancelBtnW / 2, cancelBtnY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'cancel', x: cancelX, y: cancelBtnY, w: cancelBtnW, h: buttonH });
    } else if (uiOverlay.kind === 'annotateScreenshot') {
      // Annotation overlay for manual screenshot tracing
      const pad = 20;
      
      // Tool palette on the left
      const toolsW = 150;
      const toolsX = px + pad;
      const toolsY = py + titleH + pad;
      const toolsH = panelH - titleH - pad * 3 - 40; // Leave space for buttons
      
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(toolsX, toolsY, toolsW, toolsH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(toolsX + 0.5, toolsY + 0.5, toolsW - 1, toolsH - 1);
      
      // Tool buttons with counts
      const data = uiOverlay.annotationData;
      const tools = [
        { id: 'select', label: '🖱️ Select/Edit', color: '#FFFFFF' },
        { id: 'walls', label: `🧱 Walls (${data?.walls?.length || 0})`, color: '#888888' },
        { id: 'water', label: `💧 Water (${data?.water?.length || 0})`, color: '#4169E1' },
        { id: 'sand', label: `🏖️ Sand (${data?.sand?.length || 0})`, color: '#F4A460' },
        { id: 'hills', label: `⛰️ Hills (${data?.hills?.length || 0})`, color: '#8B4513' },
        { id: 'posts', label: `📍 Posts (${data?.posts?.length || 0})`, color: '#FFD700' },
        { id: 'fairway', label: `🟢 Fairway ${data?.fairway ? '✓' : ''}`, color: '#228B22' },
        { id: 'tee', label: `🏌️ Tee ${data?.tee ? '✓' : ''}`, color: '#00FF00' },
        { id: 'cup', label: `🕳️ Cup ${data?.cup ? '✓' : ''}`, color: '#000000' }
      ];
      
      let toolY = toolsY + 10;
      const toolH = 30;
      const currentTool = uiOverlay.currentTool || 'walls';
      
      for (const tool of tools) {
        const isSelected = currentTool === tool.id;
        ctx.fillStyle = isSelected ? 'rgba(100,150,200,0.4)' : 'rgba(255,255,255,0.1)';
        ctx.fillRect(toolsX + 5, toolY, toolsW - 10, toolH);
        ctx.strokeStyle = isSelected ? '#64a8c8' : '#cfd2cf';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(toolsX + 5.5, toolY + 0.5, toolsW - 11, toolH - 1);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tool.label, toolsX + 10, toolY + toolH / 2);
        
        overlayHotspots.push({ kind: 'btn', action: `tool_${tool.id}`, x: toolsX + 5, y: toolY, w: toolsW - 10, h: toolH });
        toolY += toolH + 5;
      }
      
      // Clear/Undo button
      toolY += 10; // Add some spacing
      const clearH = 25;
      ctx.fillStyle = 'rgba(255,100,100,0.3)';
      ctx.fillRect(toolsX + 5, toolY, toolsW - 10, clearH);
      ctx.strokeStyle = '#ff6464';
      ctx.lineWidth = 1;
      ctx.strokeRect(toolsX + 5.5, toolY + 0.5, toolsW - 11, clearH - 1);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🗑️ Clear All', toolsX + toolsW / 2, toolY + clearH / 2);
      
      overlayHotspots.push({ kind: 'btn', action: 'clear_all', x: toolsX + 5, y: toolY, w: toolsW - 10, h: clearH });
      
      // Delete Selected button (only show if something is selected)
      if (uiOverlay.selectedItem) {
        toolY += clearH + 5;
        const deleteH = 25;
        ctx.fillStyle = 'rgba(255,50,50,0.4)';
        ctx.fillRect(toolsX + 5, toolY, toolsW - 10, deleteH);
        ctx.strokeStyle = '#ff3232';
        ctx.lineWidth = 1;
        ctx.strokeRect(toolsX + 5.5, toolY + 0.5, toolsW - 11, deleteH - 1);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('❌ Delete Selected', toolsX + toolsW / 2, toolY + deleteH / 2);
        
        overlayHotspots.push({ kind: 'btn', action: 'delete_selected', x: toolsX + 5, y: toolY, w: toolsW - 10, h: deleteH });
      }
      
      // Canvas area on the right
      const canvasX = toolsX + toolsW + pad;
      const canvasY = toolsY;
      const canvasW = panelW - toolsW - pad * 3;
      const canvasH = toolsH;
      
      // Draw the screenshot image if available
      if (uiOverlay.annotationCanvas) {
        const canvas = uiOverlay.annotationCanvas;
        const scale = Math.min(canvasW / canvas.width, canvasH / canvas.height);
        const drawW = canvas.width * scale;
        const drawH = canvas.height * scale;
        const drawX = canvasX + (canvasW - drawW) / 2;
        const drawY = canvasY + (canvasH - drawH) / 2;
        
        ctx.drawImage(canvas, drawX, drawY, drawW, drawH);
        
        // Store canvas info for mouse handling
        (uiOverlay as any).canvasInfo = { x: drawX, y: drawY, w: drawW, h: drawH, scale };
        
        // Draw annotations on top of the image
        if (uiOverlay.annotationData) {
          const data = uiOverlay.annotationData;
          const scale = (uiOverlay as any).canvasInfo.scale;
          
          // Helper function to convert image coordinates to screen coordinates
          const toScreen = (x: number, y: number) => ({
            x: drawX + x * scale,
            y: drawY + y * scale
          });
          
          // Draw completed polygons
          const drawPolygon = (points: Array<{ x: number; y: number }>, color: string, alpha: number = 0.3) => {
            if (points.length < 2) return;
            
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            const first = toScreen(points[0].x, points[0].y);
            ctx.moveTo(first.x, first.y);
            
            for (let i = 1; i < points.length; i++) {
              const p = toScreen(points[i].x, points[i].y);
              ctx.lineTo(p.x, p.y);
            }
            
            if (points.length >= 3) {
              ctx.closePath();
              ctx.fill();
            }
            ctx.stroke();
            ctx.restore();
          };
          
          // Draw walls (gray)
          for (let i = 0; i < data.walls.length; i++) {
            const wall = data.walls[i];
            const isSelected = uiOverlay.selectedItem?.type === 'walls' && uiOverlay.selectedItem?.index === i;
            drawPolygon(wall.points, '#888888', isSelected ? 0.6 : 0.4);
            if (isSelected) {
              // Draw selection outline
              ctx.save();
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([8, 4]);
              ctx.beginPath();
              const first = toScreen(wall.points[0].x, wall.points[0].y);
              ctx.moveTo(first.x, first.y);
              for (let j = 1; j < wall.points.length; j++) {
                const p = toScreen(wall.points[j].x, wall.points[j].y);
                ctx.lineTo(p.x, p.y);
              }
              ctx.closePath();
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.restore();
            }
          }
          
          // Draw water (blue)
          for (let i = 0; i < data.water.length; i++) {
            const water = data.water[i];
            const isSelected = uiOverlay.selectedItem?.type === 'water' && uiOverlay.selectedItem?.index === i;
            drawPolygon(water.points, '#4169E1', isSelected ? 0.6 : 0.4);
            if (isSelected) {
              // Draw selection outline
              ctx.save();
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([8, 4]);
              ctx.beginPath();
              const first = toScreen(water.points[0].x, water.points[0].y);
              ctx.moveTo(first.x, first.y);
              for (let j = 1; j < water.points.length; j++) {
                const p = toScreen(water.points[j].x, water.points[j].y);
                ctx.lineTo(p.x, p.y);
              }
              ctx.closePath();
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.restore();
            }
          }
          
          // Draw sand (tan)
          for (let i = 0; i < data.sand.length; i++) {
            const sand = data.sand[i];
            const isSelected = uiOverlay.selectedItem?.type === 'sand' && uiOverlay.selectedItem?.index === i;
            drawPolygon(sand.points, '#F4A460', isSelected ? 0.6 : 0.4);
            if (isSelected) {
              // Draw selection outline
              ctx.save();
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([8, 4]);
              ctx.beginPath();
              const first = toScreen(sand.points[0].x, sand.points[0].y);
              ctx.moveTo(first.x, first.y);
              for (let j = 1; j < sand.points.length; j++) {
                const p = toScreen(sand.points[j].x, sand.points[j].y);
                ctx.lineTo(p.x, p.y);
              }
              ctx.closePath();
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.restore();
            }
          }
          
          // Draw hills (brown)
          for (let i = 0; i < data.hills.length; i++) {
            const hill = data.hills[i];
            const isSelected = uiOverlay.selectedItem?.type === 'hills' && uiOverlay.selectedItem?.index === i;
            drawPolygon(hill.points, '#8B4513', isSelected ? 0.6 : 0.4);
            if (isSelected) {
              // Draw selection outline
              ctx.save();
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([8, 4]);
              ctx.beginPath();
              const first = toScreen(hill.points[0].x, hill.points[0].y);
              ctx.moveTo(first.x, first.y);
              for (let j = 1; j < hill.points.length; j++) {
                const p = toScreen(hill.points[j].x, hill.points[j].y);
                ctx.lineTo(p.x, p.y);
              }
              ctx.closePath();
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.restore();
            }
          }
          
          // Draw fairway (green)
          if (data.fairway) {
            const isSelected = uiOverlay.selectedItem?.type === 'fairway';
            drawPolygon(data.fairway.points, '#228B22', isSelected ? 0.4 : 0.2);
            if (isSelected) {
              // Draw selection outline
              ctx.save();
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([8, 4]);
              ctx.beginPath();
              const first = toScreen(data.fairway.points[0].x, data.fairway.points[0].y);
              ctx.moveTo(first.x, first.y);
              for (let j = 1; j < data.fairway.points.length; j++) {
                const p = toScreen(data.fairway.points[j].x, data.fairway.points[j].y);
                ctx.lineTo(p.x, p.y);
              }
              ctx.closePath();
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.restore();
            }
          }
          
          // Draw posts (yellow circles)
          for (let i = 0; i < data.posts.length; i++) {
            const post = data.posts[i];
            const isSelected = uiOverlay.selectedItem?.type === 'posts' && uiOverlay.selectedItem?.index === i;
            const p = toScreen(post.x, post.y);
            
            ctx.fillStyle = '#FFD700';
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, post.r * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            if (isSelected) {
              // Draw selection ring
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([6, 3]);
              ctx.beginPath();
              ctx.arc(p.x, p.y, (post.r + 4) * scale, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          
          // Draw tee (bright green circle)
          if (data.tee) {
            const isSelected = uiOverlay.selectedItem?.type === 'tee';
            const p = toScreen(data.tee.x, data.tee.y);
            ctx.fillStyle = '#00FF00';
            ctx.strokeStyle = '#00FF00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, data.tee.r * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            if (isSelected) {
              // Draw selection ring
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([6, 3]);
              ctx.beginPath();
              ctx.arc(p.x, p.y, (data.tee.r + 4) * scale, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          
          // Draw cup (black circle)
          if (data.cup) {
            const isSelected = uiOverlay.selectedItem?.type === 'cup';
            const p = toScreen(data.cup.x, data.cup.y);
            ctx.fillStyle = '#000000';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, data.cup.r * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            if (isSelected) {
              // Draw selection ring
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 3;
              ctx.setLineDash([6, 3]);
              ctx.beginPath();
              ctx.arc(p.x, p.y, (data.cup.r + 4) * scale, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          
          // Draw current path being drawn
          if (uiOverlay.isDrawing && uiOverlay.currentPath && uiOverlay.currentPath.length > 0) {
            const currentTool = uiOverlay.currentTool || 'walls';
            const toolColors: Record<string, string> = {
              walls: '#888888',
              water: '#4169E1',
              sand: '#F4A460',
              hills: '#8B4513',
              fairway: '#228B22'
            };
            
            const color = toolColors[currentTool] || '#888888';
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]); // Dashed line for current path
            
            ctx.beginPath();
            const first = toScreen(uiOverlay.currentPath[0].x, uiOverlay.currentPath[0].y);
            ctx.moveTo(first.x, first.y);
            
            for (let i = 1; i < uiOverlay.currentPath.length; i++) {
              const p = toScreen(uiOverlay.currentPath[i].x, uiOverlay.currentPath[i].y);
              ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.setLineDash([]); // Reset line dash
            
            // Draw points
            ctx.fillStyle = color;
            for (const point of uiOverlay.currentPath) {
              const p = toScreen(point.x, point.y);
              ctx.beginPath();
              ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        
        // Canvas border
        ctx.strokeStyle = '#cfd2cf';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(drawX - 1, drawY - 1, drawW + 2, drawH + 2);
        
        // Add canvas as hotspot for drawing
        overlayHotspots.push({ kind: 'canvas', x: drawX, y: drawY, w: drawW, h: drawH });
      } else {
        // Placeholder
        ctx.fillStyle = 'rgba(100,100,100,0.3)';
        ctx.fillRect(canvasX, canvasY, canvasW, canvasH);
        ctx.strokeStyle = '#cfd2cf';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(canvasX + 0.5, canvasY + 0.5, canvasW - 1, canvasH - 1);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Loading image...', canvasX + canvasW / 2, canvasY + canvasH / 2);
      }
      
      // Instructions
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const instrY = py + panelH - 75;
      
      const selectedTool = uiOverlay.currentTool || 'walls';
      const isDrawing = uiOverlay.isDrawing;
      
      if (isDrawing) {
        ctx.fillText(`Drawing ${selectedTool} polygon... Click to add points, Enter to complete, Esc to cancel`, px + pad, instrY);
        const pointCount = uiOverlay.currentPath?.length || 0;
        ctx.fillText(`Current polygon: ${pointCount} points (minimum 3 needed to complete)`, px + pad, instrY + 15);
      } else if (selectedTool === 'select') {
        if (uiOverlay.selectedItem) {
          const item = uiOverlay.selectedItem;
          ctx.fillText(`Selected: ${item.type} ${item.type === 'posts' ? item.index + 1 : ''} • Delete key or button to remove • Esc to deselect`, px + pad, instrY);
        } else {
          ctx.fillText('SELECT mode: Click on any annotation to select it for editing or deletion', px + pad, instrY);
        }
        ctx.fillText('Switch tools to draw new elements • Yellow highlight shows selected item', px + pad, instrY + 15);
      } else {
        if (selectedTool === 'tee' || selectedTool === 'cup' || selectedTool === 'posts') {
          ctx.fillText(`${selectedTool.toUpperCase()} tool: Click once on the image to place`, px + pad, instrY);
        } else if (selectedTool === 'walls') {
          ctx.fillText('WALLS tool: Draw multiple polygons for complex boundaries (outer walls, inner walls, etc.)', px + pad, instrY);
        } else {
          ctx.fillText(`${selectedTool.toUpperCase()} tool: Click to start drawing polygon, Enter to complete, Esc to cancel`, px + pad, instrY);
        }
        ctx.fillText('Use Select tool to edit existing annotations • Accept when done • Esc to cancel', px + pad, instrY + 15);
      }
      
      // Bottom buttons
      const buttonY = py + panelH - 35;
      const buttonH = 25;
      const buttonGap = 10;
      
      // Accept button
      const acceptW = 80;
      const acceptX = px + panelW - pad - acceptW - buttonGap - 80; // Leave space for Cancel
      ctx.fillStyle = 'rgba(0,128,0,0.3)';
      ctx.fillRect(acceptX, buttonY, acceptW, buttonH);
      ctx.strokeStyle = '#008000';
      ctx.lineWidth = 1;
      ctx.strokeRect(acceptX + 0.5, buttonY + 0.5, acceptW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Accept', acceptX + acceptW / 2, buttonY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'accept', x: acceptX, y: buttonY, w: acceptW, h: buttonH });
      
      // Cancel button
      const cancelW = 80;
      const cancelX = px + panelW - pad - cancelW;
      ctx.fillStyle = 'rgba(128,0,0,0.3)';
      ctx.fillRect(cancelX, buttonY, cancelW, buttonH);
      ctx.strokeStyle = '#800000';
      ctx.lineWidth = 1;
      ctx.strokeRect(cancelX + 0.5, buttonY + 0.5, cancelW - 1, buttonH - 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Cancel', cancelX + cancelW / 2, buttonY + buttonH / 2);
      overlayHotspots.push({ kind: 'btn', action: 'cancel', x: cancelX, y: buttonY, w: cancelW, h: buttonH });
    }
  }
}

// Support wheel scrolling for DnD list, Course Editor, Course Creator, and Course Select
function handleOverlayWheel(e: WheelEvent) {
  if (!isOverlayActive()) return;
  
  if (uiOverlay.kind === 'dndList') {
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    const scrollDelta = e.deltaY > 0 ? 1 : -1;
    const items = uiOverlay.listItems ?? [];
    const maxScroll = Math.max(0, items.length - 8); // Assume 8 visible items
    uiOverlay.dndScroll = Math.max(0, Math.min(maxScroll, (uiOverlay.dndScroll ?? 0) + scrollDelta));
    return;
  }
  
  if (uiOverlay.kind === 'courseEditor') {
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    const scrollDelta = e.deltaY > 0 ? 1 : -1;
    const levels = uiOverlay.courseData?.levelIds || [];
    const rowHeight = 40;
    const listHeight = Math.min(600, HEIGHT - 120) - 200; // Panel height minus title/buttons
    const maxVisibleRows = Math.floor(listHeight / rowHeight);
    const maxScroll = Math.max(0, levels.length - maxVisibleRows);
    uiOverlay.scrollOffset = Math.max(0, Math.min(maxScroll, (uiOverlay.scrollOffset ?? 0) + scrollDelta));
    return;
  }
  
  if (uiOverlay.kind === 'courseCreator') {
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    const scrollDelta = e.deltaY > 0 ? 1 : -1;
    const courses = uiOverlay.courseList || [];
    const totalItems = courses.length + 1; // +1 for "New Course" item
    const rowHeight = 40;
    const listHeight = Math.min(600, HEIGHT - 120) - 200; // Panel height minus title/buttons
    const maxVisibleRows = Math.floor(listHeight / rowHeight);
    const maxScroll = Math.max(0, totalItems - maxVisibleRows);
    uiOverlay.courseScrollOffset = Math.max(0, Math.min(maxScroll, (uiOverlay.courseScrollOffset ?? 0) + scrollDelta));
    return;
  }
  if (uiOverlay.kind === 'loadLevels') {
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    const scrollDelta = e.deltaY > 0 ? 1 : -1;
    const all = uiOverlay.loadLevels ?? [];
    // Estimate rows similar to renderer
    const rowH = 34;
    const listH = Math.min(600, HEIGHT - 120) - 200;
    const maxRows = Math.max(1, Math.floor(listH / rowH));
    const filteredLen = all.filter(it => (uiOverlay.loadFilter === 'all') ? true : it.source === uiOverlay.loadFilter).length;
    const maxScroll = Math.max(0, filteredLen - maxRows);
    uiOverlay.scrollOffset = Math.max(0, Math.min(maxScroll, (uiOverlay.scrollOffset ?? 0) + scrollDelta));
    return;
  }
}

// Course Select wheel scrolling
function handleCourseSelectWheel(e: WheelEvent) {
  if (gameState !== 'course') return;
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  
  const scrollDelta = e.deltaY > 0 ? 1 : -1;
  const courses = courseSelectState.courses;
  const rowHeight = 40;
  const listHeight = Math.min(600, HEIGHT - 120) - 200; // Panel height minus title/buttons
  const maxVisibleRows = Math.floor(listHeight / rowHeight);
  const maxScroll = Math.max(0, courses.length - maxVisibleRows);
  courseSelectState.scrollOffset = Math.max(0, Math.min(maxScroll, courseSelectState.scrollOffset + scrollDelta));
}
try { canvas.addEventListener('wheel', handleOverlayWheel as any, { capture: true, passive: false }); } catch {}
try { canvas.addEventListener('wheel', handleCourseSelectWheel as any, { capture: true, passive: false }); } catch {}

// User Levels wheel scrolling
function handleUserLevelsWheel(e: WheelEvent) {
  if (gameState !== 'userLevels') return;
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  
  const scrollDelta = e.deltaY > 0 ? 1 : -1;
  const rowHeight = 40;
  const listHeight = Math.min(600, HEIGHT - 120) - 160; // Panel height minus title/search/filters
  const maxVisibleRows = Math.floor(listHeight / rowHeight);
  const maxScroll = Math.max(0, filteredUserLevelsList.length - maxVisibleRows);
  
  if (userLevelsState) {
    userLevelsState.scrollOffset = Math.max(0, Math.min(maxScroll, userLevelsState.scrollOffset + scrollDelta));
  }
}
try { canvas.addEventListener('wheel', handleUserLevelsWheel as any, { capture: true, passive: false }); } catch {}

// Test function to diagnose overlay rendering
function testOverlay() {
  console.log('testOverlay: Setting test overlay');
  uiOverlay = {
    kind: 'confirm',
    title: 'Test Overlay',
    message: 'This is a test overlay to diagnose rendering issues',
    cancelable: true,
    resolve: (result) => {
      console.log('Test overlay resolved with:', result);
      uiOverlay = { kind: 'none' };
    }
  };
  console.log('testOverlay: Set uiOverlay to:', JSON.stringify(uiOverlay, (key, value) => key === 'resolve' ? '[Function]' : value));
}

// Add test key handler
window.addEventListener('keydown', (e) => {
  // Press Shift+T to test overlay rendering (avoid conflicts while typing names)
  const activeEl = (document && document.activeElement) as HTMLElement | null;
  const isTyping = !!activeEl && (
    activeEl.tagName === 'INPUT' ||
    activeEl.tagName === 'TEXTAREA' ||
    activeEl.isContentEditable === true
  );
  if (
    e.code === 'KeyT' &&
    e.shiftKey &&
    !e.ctrlKey && !e.metaKey && !e.altKey &&
    !isOverlayActive() &&
    !isTyping
  ) {
    console.log('Shift+T pressed, showing test overlay');
    testOverlay();
  }
});

function loop(t: number) {
  const dt = Math.min(1, (t - lastTime) / 1000); // clamp dt to avoid jumps
  lastTime = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Load level JSON and init positions (run once on startup)
async function loadLevel(path: string) {
  let lvl: Level;
  if (levelCache.has(path)) {
    lvl = levelCache.get(path)!;
  } else {
    // Handle synthetic dev paths by loading from Firebase rather than network
    if (path.startsWith('dev:')) {
      if (!firebaseReady) throw new Error('Firebase not ready to load dev level');
      const id = path.slice(4);
      const fbData = await firebaseManager.levels.loadLevel(id, undefined);
      if (!fbData) throw new Error(`Dev level not found in Firebase: ${id}`);
      lvl = adaptFirebaseLevelToMain(fbData);
      levelCache.set(path, lvl);
    } else {
      const res = await fetch(path);
      lvl = (await res.json()) as Level;
      levelCache.set(path, lvl);
    }
  }
  // For Firebase courses, calculate course info from current state
  if (!singleLevelMode && levelPaths.length > 0) {
    courseInfo = { 
      index: currentLevelIndex + 1, 
      total: levelPaths.length, 
      par: lvl.par, 
      title: lvl.course?.title 
    };
  } else {
    courseInfo = { index: lvl.course?.index || 1, total: lvl.course?.total || 1, par: lvl.par, title: lvl.course?.title };
  }
  levelCanvas = { width: (lvl.canvas?.width ?? WIDTH), height: (lvl.canvas?.height ?? HEIGHT) };
  walls = lvl.walls ?? [];
  sands = lvl.sand ?? [];
  sandsPoly = (lvl as any).sandsPoly || (lvl.sandPoly ?? []);
  waters = lvl.water ?? [];
  watersPoly = (lvl as any).watersPoly || (lvl.waterPoly ?? []);
  decorations = lvl.decorations ?? [];
  // Ensure decorations sit on the table outside the fairway if placed near edges
  snapDecorationsToTable();
  hills = lvl.hills ?? [];
  bridges = lvl.bridges ?? [];
  posts = lvl.posts ?? [];
  polyWalls = lvl.wallsPoly ?? [];
  ball.x = lvl.tee.x; ball.y = lvl.tee.y; ball.vx = 0; ball.vy = 0; ball.moving = false;
  hole.x = lvl.cup.x; hole.y = lvl.cup.y; (hole as any).r = lvl.cup.r;
  strokes = 0;
  gameState = 'play';
  // Update current level tracking and fetch best score (course mode only)
  currentLevelPath = path;
  bestScoreForCurrentLevel = null;
  if (!singleLevelMode) {
    (async () => {
      try { bestScoreForCurrentLevel = await getBestScore(path); } catch {}
    })();
  }
  const idx = levelPaths.indexOf(path);
  if (!singleLevelMode && idx >= 0) {
    currentLevelIndex = idx;
    // record par for this hole so summary can show deltas
    coursePars[currentLevelIndex] = lvl.par;
  } else {
    currentLevelIndex = 0;
    if (singleLevelMode) {
      // Clamp course info to a one-hole session
      courseInfo = { index: 1, total: 1, par: lvl.par, title: lvl.course.title };
      coursePars = [lvl.par];
      courseScores = [];
    }
  }
  preShot = { x: ball.x, y: ball.y };
  if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
  // Preload the subsequent level to avoid first-transition delay
  if (!singleLevelMode) preloadLevelByIndex(currentLevelIndex + 1);

  // Safety: nudge ball out if tee overlaps a wall
  for (let i = 0; i < 8; i++) {
    let fixed = false;
    for (const w of walls) {
      const hit = circleRectResolve(ball.x, ball.y, ball.r, w);
      if (hit) {
        ball.x += hit.nx * (hit.depth + 0.5);
        ball.y += hit.ny * (hit.depth + 0.5);
        fixed = true;
      }
    }
    if (!fixed) break;
  }
}

function snapDecorationsToTable(): void {
  if (!decorations || decorations.length === 0) return;
  const fairX = COURSE_MARGIN;
  const fairY = COURSE_MARGIN;
  const fairW = WIDTH - COURSE_MARGIN * 2;
  const fairH = HEIGHT - COURSE_MARGIN * 2;
  const snapGap = 4; // pixels outside the fairway after snapping
  const near = 10;   // threshold to consider a decoration "near" the fairway edge (or overlapping)

  for (const d of decorations) {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    const insideX = cx >= fairX && cx <= fairX + fairW;
    const insideY = cy >= fairY && cy <= fairY + fairH;
    const overlaps = insideX && insideY;

    // Distance from center to each fairway edge
    const distLeft = Math.abs(cx - fairX);
    const distRight = Math.abs(fairX + fairW - cx);
    const distTop = Math.abs(cy - fairY);
    const distBottom = Math.abs(fairY + fairH - cy);
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    // Only snap if overlapping the fairway or very near an edge
    if (!overlaps && minDist > near) continue;

    if (minDist === distLeft) {
      d.x = fairX - d.w - snapGap;
    } else if (minDist === distRight) {
      d.x = fairX + fairW + snapGap;
    } else if (minDist === distTop) {
      d.y = fairY - d.h - snapGap;
    } else {
      d.y = fairY + fairH + snapGap;
    }
    // Clamp to canvas bounds
    if (d.x < 0) d.x = 0;
    if (d.y < 0) d.y = 0;
    if (d.x + d.w > WIDTH) d.x = WIDTH - d.w;
    if (d.y + d.h > HEIGHT) d.y = HEIGHT - d.h;
  }
}

function loadLevelByIndex(i: number) {
  const clamped = ((i % levelPaths.length) + levelPaths.length) % levelPaths.length;
  return loadLevel(levelPaths[clamped]);
}

// Preload helper (non-blocking)
function preloadLevelByIndex(i: number): void {
  const clamped = ((i % levelPaths.length) + levelPaths.length) % levelPaths.length;
  const path = levelPaths[clamped];
  if (levelCache.has(path)) return;
  // Do not attempt network fetch for synthetic dev paths; cache should be pre-seeded
  if (path.startsWith('dev:')) return;
  fetch(path)
    .then((res) => res.json())
    .then((lvl: Level) => { levelCache.set(path, lvl); })
    .catch(() => {});

}

// Attempt to load course definition first; fallback to static list
async function boot() {
  // Load user profile first to ensure user ID persists between sessions
  loadUserProfile();
  
  try {
    // Avoid 404s in production: only attempt to read local course.json in dev
    const envAny: any = (typeof import.meta !== 'undefined' ? (import.meta as any).env : null);
    if (envAny?.DEV) {
      const res = await fetch('/levels/course.json');
      if (res.ok) {
        const data = (await res.json()) as { levels: string[] };
        if (Array.isArray(data.levels) && data.levels.length > 0) {
          levelPaths = data.levels;
        }
      }
    }
  } catch {}
  courseScores = [];
  currentLevelIndex = 0;
  // Stay on main menu; optionally warm the first level in the background
  preloadLevelByIndex(0);
  preloadLevelByIndex(1);
}
boot().catch(console.error);

// Restart flow after sink
window.addEventListener('keydown', (e) => {
  // Return to Level Editor when testing levels
  if (gameState === 'play' && isTestingLevel && e.code === 'Escape') {
    returnToEditor();
    e.preventDefault();
    return;
  }
  
  if (gameState === 'course') {
    // Arrow key navigation for course select
    if (e.code === 'ArrowDown') {
      const courses = courseSelectState.courses;
      if (courseSelectState.selectedCourseIndex < courses.length - 1) {
        courseSelectState.selectedCourseIndex++;
        // Auto-scroll to keep selection visible
        const rowHeight = 40;
        const listHeight = Math.min(600, HEIGHT - 120) - 200;
        const maxVisibleRows = Math.floor(listHeight / rowHeight);
        const maxScroll = Math.max(0, courses.length - maxVisibleRows);
        if (courseSelectState.selectedCourseIndex >= courseSelectState.scrollOffset + maxVisibleRows) {
          courseSelectState.scrollOffset = Math.min(maxScroll, courseSelectState.selectedCourseIndex - maxVisibleRows + 1);
        }
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'ArrowUp') {
      if (courseSelectState.selectedCourseIndex > 0) {
        courseSelectState.selectedCourseIndex--;
        // Auto-scroll to keep selection visible
        if (courseSelectState.selectedCourseIndex < courseSelectState.scrollOffset) {
          courseSelectState.scrollOffset = courseSelectState.selectedCourseIndex;
        }
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Load selected course with confirmation
      const course = courseSelectState.courses[courseSelectState.selectedCourseIndex];
      if (course) {
        uiOverlay = {
          kind: 'confirm',
          title: 'Load Course',
          message: `Load "${course.title}" (${course.levelCount} levels)?`,
          cancelable: true,
          resolve: (confirmed) => {
            uiOverlay = { kind: 'none' };
            if (confirmed) {
              if (course.type === 'dev') {
                void startDevCourseFromFirebase();
              } else if (course.type === 'firebase' && course.courseData) {
                void startFirebaseCourse(course.courseData);
              }
            }
          }
        };
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      gameState = 'menu';
      e.preventDefault();
      return;
    }
  }
  if (gameState === 'userLevels') {
    // Arrow key navigation for user levels
    if (e.code === 'ArrowDown') {
      if (selectedUserLevelIndex < filteredUserLevelsList.length - 1) {
        selectedUserLevelIndex++;
        userLevelsState.selectedLevelIndex = selectedUserLevelIndex;
        // Auto-scroll to keep selection visible
        const itemH = 50;
        const listH = 600 - 160; // Panel height minus title/search/filters/buttons
        const maxVisible = Math.floor(listH / itemH);
        const currentScrollOffset = userLevelsState.scrollOffset || 0;
        
        // Scroll down if selection goes below visible area
        if (selectedUserLevelIndex >= currentScrollOffset + maxVisible) {
          userLevelsState.scrollOffset = selectedUserLevelIndex - maxVisible + 1;
        }
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'ArrowUp') {
      if (selectedUserLevelIndex > 0) {
        selectedUserLevelIndex--;
        userLevelsState.selectedLevelIndex = selectedUserLevelIndex;
        // Auto-scroll to keep selection visible
        const currentScrollOffset = userLevelsState.scrollOffset || 0;
        
        // Scroll up if selection goes above visible area
        if (selectedUserLevelIndex < currentScrollOffset) {
          userLevelsState.scrollOffset = selectedUserLevelIndex;
        }
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Load selected level with confirmation
      const level = filteredUserLevelsList[selectedUserLevelIndex];
      if (level) {
        uiOverlay = {
          kind: 'confirm',
          title: 'Load Level',
          message: `Load "${level.name}" by ${level.author || 'Unknown'}?`,
          cancelable: true,
          resolve: (confirmed) => {
            uiOverlay = { kind: 'none' };
            if (confirmed) {
              void playUserLevel(level);
            }
          }
        };
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      gameState = 'course';
      e.preventDefault();
      return;
    }
  }
  if (gameState === 'changelog') {
    if (e.code === 'ArrowDown' || e.code === 'PageDown') { changelogScrollY += (e.code === 'PageDown' ? 200 : 40); clampChangelogScroll(); }
    if (e.code === 'ArrowUp' || e.code === 'PageUp') { changelogScrollY -= (e.code === 'PageUp' ? 200 : 40); clampChangelogScroll(); }
    if (e.code === 'Escape') { gameState = 'menu'; }
    return;
  }
  // Legacy userLevels handlers (keeping E and Delete keys)
  if (gameState === 'userLevels') {
    if (e.code === 'KeyE' && filteredUserLevelsList.length > 0) {
      void editUserLevel(filteredUserLevelsList[selectedUserLevelIndex]);
      e.preventDefault();
    }
    if (e.code === 'Delete' && filteredUserLevelsList.length > 0) {
      void deleteUserLevel(filteredUserLevelsList[selectedUserLevelIndex]);
      e.preventDefault();
    }
    if (e.code === 'KeyD' && filteredUserLevelsList.length > 0) {
      void duplicateUserLevel(filteredUserLevelsList[selectedUserLevelIndex]);
      e.preventDefault();
    }
    if (e.code === 'Slash') {
      // Open search prompt
      (async () => {
        const query = await showUiPrompt('Search levels by name or author:', levelSearchQuery, 'Search Levels');
        if (query !== null) {
          levelSearchQuery = query;
          applyLevelFilters();
        }
      })();
      e.preventDefault();
    }
    if (e.code === 'Escape') {
      gameState = 'course';
      e.preventDefault();
    }
    return;
  }
  if (gameState === 'sunk') {
    if (e.code === 'Space' || e.code === 'Enter') {
      if (currentLevelIndex + 1 < levelPaths.length) {
        currentLevelIndex++;
        gameState = 'play';
        loadLevelByIndex(currentLevelIndex);
        preloadLevelByIndex(currentLevelIndex + 1);
      } else {
        gameState = 'summary';
      }
    }
    if (e.code === 'Escape') {
      paused = !paused;
    }
    return;
  }
  if (gameState === 'play') {
    if (e.code === 'Escape') {
      paused = !paused;
    }
    return;
  }
  if (gameState === 'options') {
    if (e.code === 'Escape') {
      if (paused && (previousGameState === 'play' || previousGameState === 'sunk')) {
        gameState = previousGameState;
      } else {
        gameState = 'menu';
      }
    }
    return;
  }
  if (gameState === 'summary') {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      courseScores = [];
      currentLevelIndex = 0;
      gameState = 'play';
      loadLevelByIndex(currentLevelIndex).catch(console.error);
    }
    if (e.code === 'Escape' || e.code === 'KeyM') {
      gameState = 'menu';
    }
    return;
  }
});
