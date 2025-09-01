import CHANGELOG_RAW from '../CHANGELOG.md?raw';
import firebaseManager from './firebase';
import { levelEditor } from './editor/levelEditor';

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
type UiOverlayKind = 'none' | 'toast' | 'confirm' | 'prompt' | 'list';
type UiToast = { id: number; message: string; expiresAt: number };
type UiListItem = { id?: string; label: string; value?: any; disabled?: boolean };
type UiOverlayState = {
  kind: UiOverlayKind;
  // Shared
  title?: string;
  message?: string;
  // Prompt
  inputText?: string;
  inputPlaceholder?: string;
  // List
  listItems?: UiListItem[];
  listIndex?: number;
  // Resolution
  resolve?: (value: any) => void;
  reject?: (reason?: any) => void;
  cancelable?: boolean;
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

function showUiPrompt(message: string, def = '', title = 'Input'): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    uiOverlay = { kind: 'prompt', title, message, inputText: def, cancelable: true, resolve };
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

// Overlay input handling
function handleOverlayKey(e: KeyboardEvent) {
  if (!isOverlayActive()) return;
  try { e.preventDefault(); } catch {}
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
  } else if (k === 'list') {
    const items = uiOverlay.listItems ?? [];
    if (e.code === 'ArrowDown') { uiOverlay.listIndex = Math.min(items.length - 1, (uiOverlay.listIndex ?? 0) + 1); return; }
    if (e.code === 'ArrowUp') { uiOverlay.listIndex = Math.max(0, (uiOverlay.listIndex ?? 0) - 1); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const idx = uiOverlay.listIndex ?? 0;
      uiOverlay.resolve?.(items[idx] ?? null); uiOverlay = { kind: 'none' }; return;
    }
    if (e.code === 'Escape') { uiOverlay.resolve?.(null); uiOverlay = { kind: 'none' }; return; }
  }
}
window.addEventListener('keydown', handleOverlayKey);

type OverlayHotspot = { kind: 'btn' | 'listItem' | 'input'; index?: number; x: number; y: number; w: number; h: number };
let overlayHotspots: OverlayHotspot[] = [];

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
    }
  }
}
canvas.addEventListener('mousedown', handleOverlayMouseDown, { capture: true });

// Type adapter to convert between Firebase and main app Level formats
function adaptFirebaseLevelToMain(firebaseLevel: any): Level {
  const level = { ...firebaseLevel };
  
  // Convert polygon points from Firebase format {x,y}[] to main app format number[]
  if (level.wallsPoly) {
    level.wallsPoly = level.wallsPoly.map((poly: any) => ({
      points: poly.points ? poly.points.flatMap((p: any) => [p.x, p.y]) : []
    }));
  }
  if (level.waterPoly) {
    level.waterPoly = level.waterPoly.map((poly: any) => ({
      points: poly.points ? poly.points.flatMap((p: any) => [p.x, p.y]) : []
    }));
  }
  if (level.sandPoly) {
    level.sandPoly = level.sandPoly.map((poly: any) => ({
      points: poly.points ? poly.points.flatMap((p: any) => [p.x, p.y]) : []
    }));
  }
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


function applyLevelToGlobals(parsed: Level): void {
  // Apply to globals for rendering
  levelCanvas = { width: parsed.canvas?.width ?? WIDTH, height: parsed.canvas?.height ?? HEIGHT };
  walls = parsed.walls ?? [];
  sands = parsed.sand ?? [];
  sandsPoly = (parsed as any).sandsPoly || (parsed.sandPoly ?? []);
  waters = parsed.water ?? [];
  watersPoly = (parsed as any).watersPoly || (parsed.waterPoly ?? []);
  decorations = parsed.decorations ?? [];
  hills = parsed.hills ?? [];
  bridges = parsed.bridges ?? [];
  posts = parsed.posts ?? [];
  polyWalls = parsed.wallsPoly ?? [];
  ball.x = parsed.tee.x; ball.y = parsed.tee.y; ball.vx = 0; ball.vy = 0; ball.moving = false;
  hole.x = parsed.cup.x; hole.y = parsed.cup.y; (hole as any).r = parsed.cup.r;
}

function canModifyLevel(level: Level): boolean {
  const authorId = (level as any)?.meta?.authorId;
  const isOwner = authorId && authorId === getUserId();
  const isAdmin = userProfile.role === 'admin';
  return !!(isOwner || isAdmin);
}






// Deprecated: legacy cross-id level migration is no longer supported
async function migrateLevelsToNewUserId(_oldUserId: string, _newUserId: string): Promise<void> {
  // No-op
}

// Deprecated: legacy single-slot editor level migration
async function migrateSingleSlotIfNeeded(): Promise<void> {
  // No-op
}

// Users Admin UI hotspots (rebuilt every frame while in users screen)
type UsersHotspot = { kind: 'back' | 'addUser' | 'addAdmin' | 'export' | 'import' | 'promote' | 'demote' | 'enable' | 'disable' | 'remove'; x: number; y: number; w: number; h: number; id?: string };
let usersUiHotspots: UsersHotspot[] = [];







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
let gameState: 'menu' | 'course' | 'options' | 'users' | 'changelog' | 'loading' | 'play' | 'sunk' | 'summary' | 'levelEditor' | 'userLevels' = 'menu';
let levelPaths = ['/levels/level1.json', '/levels/level2.json', '/levels/level3.json'];
let currentLevelIndex = 0;
let paused = false;
// When true, we are playing a single, ad-hoc level (e.g., user-made or editor test)
let singleLevelMode = false;
// Track current level path and best score for HUD display (course mode only)
let currentLevelPath: string | null = null;
let bestScoreForCurrentLevel: number | null = null;
const APP_VERSION = '0.3.24';
const restitution = 0.9; // wall bounce energy retention
const frictionK = 1.2; // base exponential damping (reduced for less "sticky" green)
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
const SLOPE_ACCEL = 520; // tuned base acceleration applied by hills (px/s^2)
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
// UI: Replay button on Pause overlay
function getPauseReplayRect() {
  const w = 120, h = 28;
  // Positioned near bottom center (left of close button)
  const gap = 16;
  const totalW = w * 2 + gap;
  const x = WIDTH / 2 - totalW / 2;
  const y = HEIGHT - 90;
  return { x, y, w, h };
}
// UI: Close button on Pause overlay
function getPauseCloseRect() {
  const w = 120, h = 28;
  const gap = 16;
  const pr = getPauseReplayRect();
  const x = pr.x + pr.w + gap;
  const y = pr.y;
  return { x, y, w, h };
}
// UI: Back to Main Menu button on Pause overlay (centered above bottom buttons)
function getPauseBackRect() {
  const w = 180, h = 28;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT - 130;
  return { x, y, w, h };
}
// UI: Options button on Pause overlay (above bottom row)
function getPauseOptionsRect() {
  const w = 140, h = 28;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT - 160;
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
let hoverPauseOptions = false;
let hoverOptionsVolSlider = false;
let hoverOptionsUsers = false; // admin-only users button

// User Levels state
interface UserLevelEntry {
  name: string;
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
  
  try {
    // Switch to Level Editor and load the level
    gameState = 'levelEditor';
    showUiToast(`Opening ${level.name} in Level Editor...`);
    console.log(`Editing user level: ${level.name}`);
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
          
          if (levelToDelete) {
            // Use the level title as the levelId for deletion (Firebase expects the slug/key, not the full ID)
            await firebaseManager.levels.deleteLevel(level.name, userId);
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

let previousGameState: 'menu' | 'course' | 'options' | 'users' | 'changelog' | 'loading' | 'play' | 'sunk' | 'summary' | 'levelEditor' = 'menu';

// Changelog screen state and helpers
let changelogText: string | null = (typeof CHANGELOG_RAW === 'string' && CHANGELOG_RAW.trim().length > 0) ? CHANGELOG_RAW : null;
let changelogLines: string[] = [];
let changelogScrollY = 0;
let isChangelogDragging = false;
let changelogDragStartY = 0;
let changelogScrollStartY = 0;

function getChangelogBackRect() {
  const w = 120, h = 28;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT - 90;
  return { x, y, w, h };
}

// Changelog content viewport
function getChangelogContentRect() {
  const left = 60;
  const top = 100;
  const right = WIDTH - 60;
  const bottom = HEIGHT - 140;
  return { x: left, y: top, w: right - left, h: bottom - top };
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
    console.error('Failed to load course', err);
  }
}

// Main Menu layout helpers
function getMainStartRect() {
  const w = 160, h = 36;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT / 2 + 4; // moved down slightly to give the hint more room
  return { x, y, w, h };
}
function getMainLevelEditorRect() {
  const w = 160, h = 36;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT / 2 + 54; // between Start and Options
  return { x, y, w, h };
}
function getMainOptionsRect() {
  const w = 160, h = 36;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT / 2 + 104; // moved down to sit below Level Editor
  return { x, y, w, h };
}

// Main Menu: Username input (above Start, below graphic)
function getMainNameRect() {
  const w = 260, h = 28;
  const s = getMainStartRect();
  const x = WIDTH / 2 - w / 2;
  const y = s.y - 46; // increased gap to give disabled-user hint more room
  return { x, y, w, h };
}

// Main Menu: Changelog button (bottom-right)
function getMainChangelogRect() {
  const w = 160, h = 36;
  const x = WIDTH - 12 - w;
  const y = HEIGHT - 12 - h;
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
            migrateSingleSlotIfNeeded,
            exitToMenu: () => { gameState = 'menu'; },
            testLevel: testLevelFromEditor
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
  // Handle Course Select buttons
  if (gameState === 'course') {
    const dev = getCourseDevRect();
    if (p.x >= dev.x && p.x <= dev.x + dev.w && p.y >= dev.y && p.y <= dev.y + dev.h) {
      gameState = 'play';
      loadLevelByIndex(1);
      preloadLevelByIndex(2);
      return;
    }
    const userLevels = getCourseUserLevelsRect();
    if (p.x >= userLevels.x && p.x <= userLevels.x + userLevels.w && p.y >= userLevels.y && p.y <= userLevels.y + userLevels.h) {
      gameState = 'userLevels';
      void loadUserLevelsList();
      return;
    }
    const back = getCourseBackRect();
    if (p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h) {
      gameState = 'menu';
      return;
    }
  }
  // Handle User Levels screen clicks
  if (gameState === 'userLevels') {
    const back = getCourseBackRect();
    if (p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h) {
      gameState = 'course';
      return;
    }
    
    // Handle search bar clicks
    const searchBarX = WIDTH/2 - 200;
    const searchBarY = 70;
    const searchBarW = 300;
    const searchBarH = 24;
    
    if (p.x >= searchBarX && p.x <= searchBarX + searchBarW && p.y >= searchBarY && p.y <= searchBarY + searchBarH) {
      // Focus search bar - show prompt for search input
      (async () => {
        const query = await showUiPrompt('Search levels by name or author:', levelSearchQuery, 'Search Levels');
        if (query !== null) {
          levelSearchQuery = query;
          applyLevelFilters();
        }
      })();
      return;
    }
    
    // Handle filter button clicks
    const filterY = searchBarY;
    const filterButtonW = 60;
    const filterButtonH = 24;
    const filterSpacing = 4;
    let filterX = searchBarX + searchBarW + 20;
    
    const filterOptions = [
      { id: 'all', label: 'All' },
      { id: 'bundled', label: 'Built-in' },
      { id: 'filesystem', label: 'User' },
      { id: 'localStorage', label: 'Local' }
    ];
    
    for (const filter of filterOptions) {
      if (p.x >= filterX && p.x <= filterX + filterButtonW && p.y >= filterY && p.y <= filterY + filterButtonH) {
        levelFilterSource = filter.id;
        applyLevelFilters();
        return;
      }
      filterX += filterButtonW + filterSpacing;
    }

    // Handle level list clicks
    if (filteredUserLevelsList.length > 0) {
      const listY = 130;
      const itemHeight = 60; // Updated to match rendering
      const maxVisible = 7; // Updated to match rendering
      const startIndex = Math.max(0, selectedUserLevelIndex - Math.floor(maxVisible / 2));
      const endIndex = Math.min(filteredUserLevelsList.length, startIndex + maxVisible);
      
      for (let i = startIndex; i < endIndex; i++) {
        const y = listY + (i - startIndex) * itemHeight;
        const cardX = 40, cardW = WIDTH - 80;
        
        if (p.x >= cardX && p.x <= cardX + cardW && p.y >= y && p.y <= y + itemHeight) {
          
          if (i === selectedUserLevelIndex) {
            // Double-click behavior: play the level
            void playUserLevel(filteredUserLevelsList[i]);
          } else {
            // Single click: select the level
            selectedUserLevelIndex = i;
          }
          return;
        }
      }
      
      // Handle action button clicks when a level is selected
      if (selectedUserLevelIndex >= startIndex && selectedUserLevelIndex < endIndex) {
        const level = filteredUserLevelsList[selectedUserLevelIndex];
        const isOwner = (level.author || '').toLowerCase() === (userProfile?.name || '').toLowerCase();
        const isAdmin = userProfile?.role === 'admin';
        const canEdit = isOwner || isAdmin;
        
        const selectedY = listY + (selectedUserLevelIndex - startIndex) * itemHeight;
        const buttonY = selectedY + 6;
        const buttonH = 12;
        const cardX = 40, cardW = WIDTH - 80;
        let buttonX = cardX + cardW - 12;
        
        // Play button (always available)
        const playW = 40;
        buttonX -= playW;
        if (p.x >= buttonX && p.x <= buttonX + playW && p.y >= buttonY && p.y <= buttonY + buttonH) {
          void playUserLevel(level);
          return;
        }
        
        // Duplicate button
        const dupW = 35;
        buttonX -= dupW + 4;
        if (p.x >= buttonX && p.x <= buttonX + dupW && p.y >= buttonY && p.y <= buttonY + buttonH) {
          void duplicateUserLevel(level);
          return;
        }
        
        // Edit button (if can edit)
        if (canEdit) {
          const editW = 30;
          buttonX -= editW + 4;
          if (p.x >= buttonX && p.x <= buttonX + editW && p.y >= buttonY && p.y <= buttonY + buttonH) {
            void editUserLevel(level);
            return;
          }
        }
        
        // Delete button (if can edit)
        if (canEdit) {
          const delW = 30;
          buttonX -= delW + 4;
          if (p.x >= buttonX && p.x <= buttonX + delW && p.y >= buttonY && p.y <= buttonY + buttonH) {
            void deleteUserLevel(level);
            return;
          }
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
      migrateSingleSlotIfNeeded,
      exitToMenu: () => { gameState = 'menu'; },
      testLevel: testLevelFromEditor
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
    // Users button removed from Options (access via Shift+F after Start)
  }
  // Users admin actions
  if (gameState === 'users') {
    for (const hs of usersUiHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (!firebaseReady) { showUiToast('Firebase services are not ready yet.'); return; }
        try {
          switch (hs.kind) {
            case 'back':
              gameState = previousGameState;
              break;
            case 'addUser': {
              (async () => {
                const name = await showUiPrompt('Enter new user name', '', 'Add User');
                if (name && name.trim()) {
                  const trimmedName = name.trim();
                  const existing = firebaseManager.users.getAll().find(u => u.name === trimmedName);
                  if (existing) {
                    showUiToast(`User "${trimmedName}" already exists.`);
                  } else {
                    await firebaseManager.users.addUser(trimmedName, 'user');
                    showUiToast(`User "${trimmedName}" created.`);
                  }
                }
              })();
              break;
            }
            case 'addAdmin': {
              (async () => {
                const name = await showUiPrompt('Enter new admin name', '', 'Add Admin');
                if (name && name.trim()) {
                  const trimmedName = name.trim();
                  const existing = firebaseManager.users.getAll().find(u => u.name === trimmedName);
                  if (existing) {
                    showUiToast(`User "${trimmedName}" already exists.`);
                  } else {
                    await firebaseManager.users.addUser(trimmedName, 'admin');
                    showUiToast(`Admin "${trimmedName}" created.`);
                  }
                }
              })();
              break;
            }
            case 'export': {
              (async () => {
                const json = firebaseManager.users.exportToJsonString(true);
                await showUiPrompt('Users JSON — copy:', json, 'Export Users');
              })();
              break;
            }
            case 'import': {
              (async () => {
                const text = await showUiPrompt('Paste Users JSON to import', '', 'Import Users');
                if (text && text.trim()) {
                  try { await firebaseManager.users.importFromJsonString(text.trim()); showUiToast('Users imported.'); }
                  catch (e) { showUiToast('Failed to import users.'); }
                }
              })();
              break;
            }
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
                const id = hs.id; // capture before async to preserve narrowing
                (async () => {
                  const ok = await showUiConfirm('Remove this user? This cannot be undone.');
                  if (ok) {
                    try { await firebaseManager.users.removeUser(id); }
                    catch (e) { showUiToast('Failed to remove user.'); }
                  }
                })();
              }
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
      migrateSingleSlotIfNeeded,
      exitToMenu: () => { gameState = 'menu'; },
      testLevel: testLevelFromEditor
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
    const dev = getCourseDevRect();
    const userLevels = getCourseUserLevelsRect();
    const back = getCourseBackRect();
    hoverCourseDev = p.x >= dev.x && p.x <= dev.x + dev.w && p.y >= dev.y && p.y <= dev.y + dev.h;
    hoverCourseUserLevels = p.x >= userLevels.x && p.x <= userLevels.x + userLevels.w && p.y >= userLevels.y && p.y <= userLevels.y + userLevels.h;
    hoverCourseBack = p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h;
    canvas.style.cursor = (hoverCourseDev || hoverCourseUserLevels || hoverCourseBack) ? 'pointer' : 'default';
    return;
  }
  if (gameState === 'userLevels') {
    const back = getCourseBackRect();
    hoverUserLevelsBack = p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h;
    canvas.style.cursor = hoverUserLevelsBack ? 'pointer' : 'default';
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
    hoverOptionsVolMinus = p.x >= vm.x && p.x <= vm.x + vm.w && p.y >= vm.y && p.y <= vm.y + vm.h;
    hoverOptionsVolPlus = p.x >= vp.x && p.x <= vp.x + vp.w && p.y >= vp.y && p.y <= vp.y + vp.h;
    hoverOptionsMute = p.x >= mu.x && p.x <= mu.x + mu.w && p.y >= mu.y && p.y <= mu.y + mu.h;
    hoverOptionsVolSlider = p.x >= vs.x && p.x <= vs.x + vs.w && p.y >= vs.y - 6 && p.y <= vs.y + vs.h + 6;
    // Users button removed from Options; no hover
    hoverOptionsUsers = false;
    if (isOptionsVolumeDragging) {
      const t = Math.max(0, Math.min(1, (p.x - vs.x) / vs.w));
      AudioSfx.setVolume(t);
    }
    canvas.style.cursor = (hoverOptionsBack || hoverOptionsVolMinus || hoverOptionsVolPlus || hoverOptionsMute || hoverOptionsVolSlider || hoverOptionsUsers) ? 'pointer' : 'default';
    return;
  }
  if (gameState === 'users') {
    // Pointer feedback based on hotspots
    let over = false;
    for (const hs of usersUiHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) { over = true; break; }
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
      migrateSingleSlotIfNeeded,
      exitToMenu: () => { gameState = 'menu'; },
      testLevel: testLevelFromEditor
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
  // clamp and scale; pull back to shoot forward
  const maxDrag = 120;
  const clamped = Math.min(drag, maxDrag);
  const power = clamped * 4; // original tuning
  const angle = Math.atan2(dy, dx);
  ball.vx = Math.cos(angle) * power * -1;
  ball.vy = Math.sin(angle) * power * -1;
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

// Scroll wheel support (changelog)
canvas.addEventListener('wheel', (e) => {
  if (gameState !== 'changelog') return;
  e.preventDefault();
  const delta = Math.sign(e.deltaY) * 40;
  changelogScrollY += delta;
  clampChangelogScroll();
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
    migrateSingleSlotIfNeeded,
    exitToMenu: () => { gameState = 'menu'; },
    testLevel: testLevelFromEditor
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
  // Only admins can open Users UI
  if (userProfile.role !== 'admin') return;
  // Transition into Users UI
  previousGameState = gameState;
  gameState = 'users';
  try { e.preventDefault(); } catch {}
}
window.addEventListener('keydown', handleAdminUsersShortcut);

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

    // friction (boosted in sand)
    let inSand = false;
    for (const s of sands) { if (pointInRect(ball.x, ball.y, s)) { inSand = true; break; } }
    if (!inSand && sandsPoly.length > 0) {
      for (const sp of sandsPoly) { if (pointInPolygon(ball.x, ball.y, sp.points)) { inSand = true; break; } }
    }
    const k = frictionK * (inSand ? 4.2 : 1.0);
    const friction = Math.exp(-k * dt);
    ball.vx *= friction;
    ball.vy *= friction;

    // Hills (slopes): apply directional acceleration inside hill zones
    if (hills.length > 0) {
      let ax = 0, ay = 0;
      for (const h of hills) {
        if (!pointInRect(ball.x, ball.y, h)) continue;
        const s = (h.strength ?? 1) * SLOPE_ACCEL;
        const d = h.dir;
        const dirX = (d.includes('E') ? 1 : 0) + (d.includes('W') ? -1 : 0);
        const dirY = (d.includes('S') ? 1 : 0) + (d.includes('N') ? -1 : 0);
        // normalize diagonal so total accel magnitude stays consistent
        const inv = (dirX !== 0 && dirY !== 0) ? Math.SQRT1_2 : 1;
        // Edge-weighted falloff: stronger near exit edge, lighter near entrance
        const ex = dirX === 0 ? 1 : (dirX > 0 ? (ball.x - h.x) / h.w : (h.x + h.w - ball.x) / h.w);
        const ey = dirY === 0 ? 1 : (dirY > 0 ? (ball.y - h.y) / h.h : (h.y + h.h - ball.y) / h.h);
        const baseFall = Math.max(0, Math.min(1, (dirX !== 0 && dirY !== 0) ? Math.min(ex, ey) : (dirX !== 0 ? ex : ey)));
        const expo = h.falloff ?? 1.2;
        const fall = Math.pow(baseFall, expo);
        ax += dirX * s * inv * fall;
        ay += dirY * s * inv * fall;
      }
      ball.vx += ax * dt;
      ball.vy += ay * dt;
    }

    // Collide with walls (axis-aligned)
    for (const w of walls) {
      const hit = circleRectResolve(ball.x, ball.y, ball.r, w);
      if (hit) {
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
    if (speed < stopSpeed || disp < 0.25) {
      ball.vx = 0; ball.vy = 0; ball.moving = false;
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
  let vx = Math.cos(angle) * clamped * 4 * -1;
  let vy = Math.sin(angle) * clamped * 4 * -1;

  // Sim state
  let px = aimStart.x;
  let py = aimStart.y;
  const r = ball.r;
  const dt = 1 / 120;
  const maxTime = 2.0; // seconds
  const maxBounces = 12;
  let t = 0;
  let bouncesCount = 0;

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
        px += hit.nx * hit.depth;
        py += hit.ny * hit.depth;
        const vn = vx * hit.nx + vy * hit.ny;
        vx -= (1 + restitution) * vn * hit.nx;
        vy -= (1 + restitution) * vn * hit.ny;
        collided = true;
      }
    }
    // Round posts
    for (const p of posts) {
      const hit = circleCircleResolve(px, py, r, p.x, p.y, p.r);
      if (hit) {
        px += hit.nx * hit.depth;
        py += hit.ny * hit.depth;
        const vn = vx * hit.nx + vy * hit.ny;
        vx -= (1 + restitution) * vn * hit.nx;
        vy -= (1 + restitution) * vn * hit.ny;
        collided = true;
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
          px += hit.nx * hit.depth;
          py += hit.ny * hit.depth;
          const vn = vx * hit.nx + vy * hit.ny;
          vx -= (1 + restitution) * vn * hit.nx;
          vy -= (1 + restitution) * vn * hit.ny;
          collided = true;
        }
      }
    }
    // Canvas bounds fallback
    if (px - r < 0) { px = r; vx *= -restitution; collided = true; }
    if (px + r > WIDTH) { px = WIDTH - r; vx *= -restitution; collided = true; }
    if (py - r < 0) { py = r; vy *= -restitution; collided = true; }
    if (py + r > HEIGHT) { py = HEIGHT - r; vy *= -restitution; collided = true; }
    return collided;
  }

  while (t < maxTime && bouncesCount <= maxBounces) {
    px += vx * dt;
    py += vy * dt;
    const collided = resolveCollisions();
    if (collided) {
      bouncesCount++;
      pts.push(px, py);
    } else if ((stepCounter++ & 7) === 0) {
      // thin sampling to keep path light
      pts.push(px, py);
    }
    // Stop if we reach cup
    const dxh = px - hole.x;
    const dyh = py - hole.y;
    const dist = Math.hypot(dxh, dyh);
    if (dist < hole.r - r * 0.25) {
      pts.push(hole.x, hole.y);
      break;
    }
    t += dt;
  }

  // Render polyline
  if (pts.length >= 4) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // dev aid: mark that we rendered this frame (console can be chatty; keep light)
    try { if ((typeof performance !== 'undefined') && Math.floor(performance.now() / 500) % 2 === 0) console.debug('[DEV] Preview render tick'); } catch {}
  }
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
    // Title top center
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '32px system-ui, sans-serif';
    ctx.fillText('Vector Putt', WIDTH/2, 52);
    // Simple vector mini-golf illustration
    (function drawMainMenuGraphic() {
      const artWidth = Math.min(420, WIDTH - 120);
      const artHeight = 140;
      const artX = WIDTH / 2 - artWidth / 2;
      const artY = 110;
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
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
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
    ctx.fillStyle = hoverMainStart && canStart ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
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
    ctx.fillStyle = hoverMainLevelEditor && canStart ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
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
    ctx.fillStyle = hoverMainOptions ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Options', o.x + o.w/2, o.y + o.h/2 + 0.5);
    // Changelog button bottom-right
    const cg = getMainChangelogRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverMainChangelog ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverMainChangelog ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(cg.x, cg.y, cg.w, cg.h);
    ctx.strokeRect(cg.x, cg.y, cg.w, cg.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Changelog', cg.x + cg.w/2, cg.y + cg.h/2 + 0.5);
    // Version bottom-left
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
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
      migrateSingleSlotIfNeeded,
      exitToMenu: () => { gameState = 'menu'; },
      testLevel: testLevelFromEditor
    };
    levelEditor.render(editorEnv);
    renderGlobalOverlays();
    return;
  }
  // Users admin screen
  if (gameState === 'users') {
    usersUiHotspots = [];
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('User Management', WIDTH/2, 60);
    
    // Active user info panel
    const activeName = (userProfile.name || '').trim() || '(unnamed)';
    const infoPanel = { x: WIDTH/2 - 200, y: 100, w: 400, h: 32 };
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(infoPanel.x, infoPanel.y, infoPanel.w, infoPanel.h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(infoPanel.x, infoPanel.y, infoPanel.w, infoPanel.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`Active: ${activeName} (${userProfile.role})`, infoPanel.x + infoPanel.w/2, infoPanel.y + infoPanel.h/2);

    // Action buttons - consistent with main menu style
    const btnY = 150;
    const btnW = 140, btnH = 36, btnGap = 16;
    const totalBtnWidth = btnW * 4 + btnGap * 3;
    let btnX = WIDTH/2 - totalBtnWidth/2;
    
    function drawActionBtn(label: string, kind: UsersHotspot['kind'], isHovered = false) {
      ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(btnX, btnY, btnW, btnH);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, btnX + btnW/2, btnY + btnH/2 + 0.5);
      usersUiHotspots.push({ kind, x: btnX, y: btnY, w: btnW, h: btnH });
      btnX += btnW + btnGap;
    }
    
    drawActionBtn('Add User', 'addUser');
    drawActionBtn('Add Admin', 'addAdmin');
    drawActionBtn('Export JSON', 'export');
    drawActionBtn('Import JSON', 'import');

    // Users list - card-based layout
    const list = firebaseReady ? firebaseManager.users.getAll() : [];
    const cardY = 210;
    const cardW = 680, cardH = 50;
    const cardX = WIDTH/2 - cardW/2;
    
    // Header
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Name', cardX + 20, cardY - 10);
    ctx.fillText('Role', cardX + 200, cardY - 10);
    ctx.fillText('Status', cardX + 300, cardY - 10);
    ctx.fillText('Actions', cardX + 400, cardY - 10);
    
    // User cards
    let currentY = cardY;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      
      // Card background
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(cardX, currentY, cardW, cardH);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(cardX, currentY, cardW, cardH);
      
      // User info
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(u.name, cardX + 20, currentY + cardH/2);
      
      // Role with color coding
      ctx.fillStyle = u.role === 'admin' ? '#ffd700' : '#ffffff';
      ctx.fillText(u.role, cardX + 200, currentY + cardH/2);
      
      // Status with color coding
      ctx.fillStyle = u.enabled ? '#90ee90' : '#ff6b6b';
      ctx.fillText(u.enabled ? 'Active' : 'Disabled', cardX + 300, currentY + cardH/2);
      
      // Action buttons
      const actionBtnW = 60, actionBtnH = 24;
      let actionX = cardX + 400;
      const actionY = currentY + (cardH - actionBtnH)/2;
      
      function drawUserActionBtn(label: string, kind: UsersHotspot['kind'], id: string, color = '#ffffff') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(actionX, actionY, actionBtnW, actionBtnH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(actionX, actionY, actionBtnW, actionBtnH);
        ctx.fillStyle = color;
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, actionX + actionBtnW/2, actionY + actionBtnH/2);
        usersUiHotspots.push({ kind, id, x: actionX, y: actionY, w: actionBtnW, h: actionBtnH });
        actionX += actionBtnW + 8;
      }
      
      // Role toggle
      if (u.role === 'admin') {
        drawUserActionBtn('Demote', 'demote', u.id, '#ffd700');
      } else {
        drawUserActionBtn('Promote', 'promote', u.id, '#90ee90');
      }
      
      // Enable/Disable
      if (u.enabled) {
        drawUserActionBtn('Disable', 'disable', u.id, '#ff6b6b');
      } else {
        drawUserActionBtn('Enable', 'enable', u.id, '#90ee90');
      }
      
      // Remove
      drawUserActionBtn('Remove', 'remove', u.id, '#ff6b6b');
      
      currentY += cardH + 8;
    }

    // Back button - consistent with other screens
    const back = getCourseBackRect();
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(back.x, back.y, back.w, back.h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(back.x, back.y, back.w, back.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Back', back.x + back.w/2, back.y + back.h/2 + 0.5);
    usersUiHotspots.push({ kind: 'back', x: back.x, y: back.y, w: back.w, h: back.h });
    
    renderGlobalOverlays();
    return;
  }
  // Course Select screen
  if (gameState === 'course') {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Select Course', WIDTH/2, 60);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Choose a course to play', WIDTH/2, 86);
    // Dev Levels option
    const dev = getCourseDevRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverCourseDev ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverCourseDev ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(dev.x, dev.y, dev.w, dev.h);
    ctx.strokeRect(dev.x, dev.y, dev.w, dev.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Dev Levels', dev.x + dev.w/2, dev.y + dev.h/2 + 0.5);
    // User Made Levels option
    const userLevels = getCourseUserLevelsRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverCourseUserLevels ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverCourseUserLevels ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(userLevels.x, userLevels.y, userLevels.w, userLevels.h);
    ctx.strokeRect(userLevels.x, userLevels.y, userLevels.w, userLevels.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('User Made Levels', userLevels.x + userLevels.w/2, userLevels.y + userLevels.h/2 + 0.5);
    // Back button
    const back = getCourseBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverCourseBack ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverCourseBack ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(back.x, back.y, back.w, back.h);
    ctx.strokeRect(back.x, back.y, back.w, back.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Back', back.x + back.w/2, back.y + back.h/2 + 0.5);
    // Version bottom-left
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
    renderGlobalOverlays();
    return;
  }
  // User Levels screen
  if (gameState === 'userLevels') {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Level Browser', WIDTH/2, 40);
    
    // Search bar
    const searchBarX = WIDTH/2 - 200;
    const searchBarY = 70;
    const searchBarW = 300;
    const searchBarH = 24;
    
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(searchBarX, searchBarY, searchBarW, searchBarH);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(searchBarX, searchBarY, searchBarW, searchBarH);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const searchText = levelSearchQuery || 'Search levels...';
    const searchColor = levelSearchQuery ? '#ffffff' : '#888888';
    ctx.fillStyle = searchColor;
    ctx.fillText(searchText, searchBarX + 8, searchBarY + searchBarH/2);
    
    // Filter buttons
    const filterY = searchBarY;
    const filterButtonW = 60;
    const filterButtonH = 24;
    const filterSpacing = 4;
    let filterX = searchBarX + searchBarW + 20;
    
    const filterOptions = [
      { id: 'all', label: 'All' },
      { id: 'bundled', label: 'Built-in' },
      { id: 'filesystem', label: 'User' },
      { id: 'localStorage', label: 'Local' }
    ];
    
    for (const filter of filterOptions) {
      const isActive = levelFilterSource === filter.id;
      
      ctx.fillStyle = isActive ? 'rgba(33, 150, 243, 0.8)' : 'rgba(255,255,255,0.1)';
      ctx.fillRect(filterX, filterY, filterButtonW, filterButtonH);
      ctx.strokeStyle = isActive ? 'rgba(33, 150, 243, 1)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(filterX, filterY, filterButtonW, filterButtonH);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(filter.label, filterX + filterButtonW/2, filterY + filterButtonH/2);
      
      filterX += filterButtonW + filterSpacing;
    }
    
    // Results count
    ctx.fillStyle = '#cccccc';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${filteredUserLevelsList.length} of ${userLevelsList.length} levels`, WIDTH/2, 104);
    
    if (filteredUserLevelsList.length === 0) {
      // Empty state with better styling
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(WIDTH/2 - 200, 140, 400, 120);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(WIDTH/2 - 200, 140, 400, 120);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px system-ui, sans-serif';
      const emptyMessage = levelSearchQuery || levelFilterSource !== 'all' 
        ? 'No levels match your search/filter'
        : 'No user levels found';
      ctx.fillText(emptyMessage, WIDTH/2, 170);
      
      if (!levelSearchQuery && levelFilterSource === 'all') {
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#cccccc';
        ctx.fillText('Create levels in the Level Editor to see them here', WIDTH/2, 200);
        ctx.fillText('Click Level Editor from the main menu to get started', WIDTH/2, 220);
      } else {
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#cccccc';
        ctx.fillText('Try adjusting your search terms or filters', WIDTH/2, 200);
      }
    } else {
      // Instructions with better styling
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#cccccc';
      ctx.fillText('Click to select • Double-click to play • Keyboard: ↑↓ Navigate • Enter Play • E Edit • Del Delete • D Duplicate • / Search', WIDTH/2, 118);
      
      // Level list with improved design and thumbnails
      const listY = 130;
      const itemHeight = 60; // Increased height for thumbnails
      const maxVisible = 7; // Reduced to fit larger items
      const startIndex = Math.max(0, selectedUserLevelIndex - Math.floor(maxVisible / 2));
      const endIndex = Math.min(filteredUserLevelsList.length, startIndex + maxVisible);
      
      for (let i = startIndex; i < endIndex; i++) {
        const level = filteredUserLevelsList[i];
        const y = listY + (i - startIndex) * itemHeight;
        const isSelected = i === selectedUserLevelIndex;
        const isOwner = (level.author || '').toLowerCase() === (userProfile?.name || '').toLowerCase();
        const isAdmin = userProfile?.role === 'admin';
        const canEdit = isOwner || isAdmin;
        
        // Card-style background
        const cardX = 40, cardW = WIDTH - 80;
        ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(cardX, y, cardW, itemHeight - 2);
        
        // Border
        ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cardX, y, cardW, itemHeight - 2);
        
        // Thumbnail
        const thumbnailSize = 48;
        const thumbnailX = cardX + 8;
        const thumbnailY = y + (itemHeight - thumbnailSize) / 2;
        
        try {
          const thumbnailDataUrl = getLevelThumbnail(level);
          if (thumbnailDataUrl) {
            // Create image element if not cached
            if (!level.thumbnailImage) {
              level.thumbnailImage = new Image();
              level.thumbnailImage.src = thumbnailDataUrl;
            }
            
            // Draw thumbnail if image is loaded
            if (level.thumbnailImage.complete) {
              ctx.save();
              ctx.beginPath();
              ctx.rect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
              ctx.clip();
              ctx.drawImage(level.thumbnailImage, thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
              ctx.restore();
              
              // Thumbnail border
              ctx.strokeStyle = 'rgba(255,255,255,0.3)';
              ctx.lineWidth = 1;
              ctx.strokeRect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
            } else {
              // Loading placeholder
              ctx.fillStyle = 'rgba(255,255,255,0.1)';
              ctx.fillRect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
              ctx.strokeStyle = 'rgba(255,255,255,0.2)';
              ctx.lineWidth = 1;
              ctx.strokeRect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
              ctx.fillStyle = '#888888';
              ctx.font = '10px system-ui, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('...', thumbnailX + thumbnailSize/2, thumbnailY + thumbnailSize/2);
            }
          } else {
            // No thumbnail available
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
          }
        } catch (error) {
          // Error placeholder
          ctx.fillStyle = 'rgba(255,0,0,0.1)';
          ctx.fillRect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
          ctx.strokeStyle = 'rgba(255,0,0,0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(thumbnailX, thumbnailY, thumbnailSize, thumbnailSize);
        }
        
        // Level name (moved right to accommodate thumbnail)
        const textX = thumbnailX + thumbnailSize + 12;
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(level.name, textX, y + 8);
        
        // Author and source with better formatting
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = '#aaaaaa';
        const sourceLabel = level.source === 'bundled' ? 'bundled' : 
                           level.source === 'filesystem' ? 'user' : 'local';
        const sourceColor = level.source === 'bundled' ? '#4CAF50' : 
                           level.source === 'filesystem' ? '#2196F3' : '#FF9800';
        
        ctx.fillText(`by ${level.author}`, textX, y + 28);
        
        // Source badge
        const badgeX = textX + ctx.measureText(`by ${level.author} `).width;
        ctx.fillStyle = sourceColor;
        ctx.fillRect(badgeX, y + 26, ctx.measureText(sourceLabel).width + 8, 14);
        ctx.fillStyle = '#000000';
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(sourceLabel, badgeX + (ctx.measureText(sourceLabel).width + 8) / 2, y + 36);
        
        // Quick-play indicator
        if (isSelected) {
          ctx.fillStyle = '#4CAF50';
          ctx.font = '10px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('Double-click to quick-play', textX, y + 44);
        }
        
        // Action buttons (if selected)
        if (isSelected) {
          const buttonY = y + 6;
          const buttonH = 12;
          let buttonX = cardX + cardW - 12;
          
          // Play button (always available)
          const playW = 40;
          buttonX -= playW;
          ctx.fillStyle = 'rgba(76, 175, 80, 0.8)';
          ctx.fillRect(buttonX, buttonY, playW, buttonH);
          ctx.fillStyle = '#ffffff';
          ctx.font = '10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('PLAY', buttonX + playW/2, buttonY + buttonH - 2);
          
          // Duplicate button
          const dupW = 35;
          buttonX -= dupW + 4;
          ctx.fillStyle = 'rgba(255, 152, 0, 0.8)';
          ctx.fillRect(buttonX, buttonY, dupW, buttonH);
          ctx.fillStyle = '#ffffff';
          ctx.fillText('DUP', buttonX + dupW/2, buttonY + buttonH - 2);
          
          // Edit button (if can edit)
          if (canEdit) {
            const editW = 30;
            buttonX -= editW + 4;
            ctx.fillStyle = 'rgba(33, 150, 243, 0.8)';
            ctx.fillRect(buttonX, buttonY, editW, buttonH);
            ctx.fillStyle = '#ffffff';
            ctx.fillText('EDIT', buttonX + editW/2, buttonY + buttonH - 2);
          }
          
          // Delete button (if can edit)
          if (canEdit) {
            const delW = 30;
            buttonX -= delW + 4;
            ctx.fillStyle = 'rgba(244, 67, 54, 0.8)';
            ctx.fillRect(buttonX, buttonY, delW, buttonH);
            ctx.fillStyle = '#ffffff';
            ctx.fillText('DEL', buttonX + delW/2, buttonY + buttonH - 2);
          }
          
          // Permission hint for non-owners
          if (!canEdit) {
            ctx.textAlign = 'right';
            ctx.fillStyle = '#666666';
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillText('(owner/admin only)', cardX + cardW - 12, y + 30);
          }
        }
      }
      
      // Modern scroll indicator
      if (filteredUserLevelsList.length > maxVisible) {
        const scrollBarHeight = maxVisible * itemHeight;
        const scrollBarY = listY;
        const scrollBarX = WIDTH - 16;
        const thumbHeight = Math.max(20, scrollBarHeight * maxVisible / filteredUserLevelsList.length);
        const thumbY = scrollBarY + (selectedUserLevelIndex / filteredUserLevelsList.length) * (scrollBarHeight - thumbHeight);
        
        // Track
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(scrollBarX, scrollBarY, 6, scrollBarHeight);
        
        // Thumb
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(scrollBarX, thumbY, 6, thumbHeight);
      }
    }
    
    // Back button
    const back = getCourseBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverUserLevelsBack ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverUserLevelsBack ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(back.x, back.y, back.w, back.h);
    ctx.strokeRect(back.x, back.y, back.w, back.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Back', back.x + back.w/2, back.y + back.h/2 + 0.5);
    
    // Version bottom-left
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
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
  // Options screen: show controls and Back button
  if (gameState === 'options') {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Options', WIDTH/2, 60);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Controls', WIDTH/2 - 180, 110);
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
    let oy = 140;
    for (const line of lines) { ctx.fillText('• ' + line, WIDTH/2 - 180, oy); oy += 22; }
    // Audio section
    oy += 8;
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Audio', WIDTH/2 - 180, oy); oy += 24;
    ctx.font = '14px system-ui, sans-serif';
    const volPct = Math.round(AudioSfx.volume * 100);
    ctx.fillText(`SFX Volume: ${AudioSfx.muted ? 'Muted' : volPct + '%'}`, WIDTH/2 - 180, oy);
    oy += 100; // create clear space before buttons
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
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Changelog', WIDTH/2, 52);
    // content area
    const cr = getChangelogContentRect();
    ctx.font = '14px system-ui, sans-serif';
    if (changelogText === null) {
      ctx.textAlign = 'center';
      ctx.fillText('Loading…', WIDTH/2, HEIGHT/2);
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
    ctx.fillStyle = hoverChangelogBack ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(bk.x, bk.y, bk.w, bk.h);
    ctx.strokeRect(bk.x, bk.y, bk.w, bk.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Back', bk.x + bk.w/2, bk.y + bk.h/2 + 0.5);
    // Version bottom-left
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
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
      ctx.lineWidth = 2;
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
      ctx.lineWidth = 2;
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
  // hills (visualize with directional gradient overlay)
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

  // HUD (single row across the top on mustard background)
  ctx.fillStyle = COLORS.hudText;
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
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#ffffff';
    // Title near top center
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Pause Menu', WIDTH/2, 60);
    // Controls list in middle
    ctx.font = '16px system-ui, sans-serif';
    const lines = [
      `Hole ${courseInfo.index}/${courseInfo.total}  Par ${courseInfo.par}  Strokes ${strokes}`,
      `To Birdie: ${toBirdie === null ? '—' : toBirdie}`,
      'Shortcuts:',
      '  P/Esc Pause-Resume   R Restart',
      '  N Next (from banner)   Space Replay',
      '  Enter Summary→Restart'
    ];
    let y = 110;
    for (const line of lines) { ctx.fillText(line, WIDTH/2, y); y += 22; }
    // Pause overlay Options button (above bottom row)
    const po = getPauseOptionsRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverPauseOptions ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverPauseOptions ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(po.x, po.y, po.w, po.h);
    ctx.strokeRect(po.x, po.y, po.w, po.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Options', po.x + po.w/2, po.y + po.h/2 + 0.5);
    // Pause overlay Replay button
    const pr = getPauseReplayRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverPauseReplay ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverPauseReplay ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
    ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Replay', pr.x + pr.w/2, pr.y + pr.h/2 + 0.5);
    // Pause overlay Back to Main Menu
    const pb = getPauseBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverPauseBack ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverPauseBack ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
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
    ctx.fillStyle = hoverPauseClose ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(pc.x, pc.y, pc.w, pc.h);
    ctx.strokeRect(pc.x, pc.y, pc.w, pc.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Close', pc.x + pc.w/2, pc.y + pc.h/2 + 0.5);
    // Version bottom-left small
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
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

  // Modal overlays (confirm, prompt, list)
  if (isOverlayActive() && uiOverlay.kind !== 'toast') {
    overlayHotspots = [];
    // dim background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // panel metrics
    const panelW = Math.min(640, WIDTH - 80);
    const pad = 16;
    let panelH = 160;
    const hasTitle = !!uiOverlay.title;
    const titleH = hasTitle ? 28 : 0;
    if (uiOverlay.kind === 'prompt') panelH = 200;
    if (uiOverlay.kind === 'list') {
      const items = uiOverlay.listItems ?? [];
      const visible = Math.min(items.length, 10);
      panelH = 100 + visible * 28 + 56; // title+list+buttons
      panelH = Math.min(panelH, HEIGHT - 120);
    }
    const px = Math.floor(WIDTH / 2 - panelW / 2);
    const py = Math.floor(HEIGHT / 2 - panelH / 2);
    // panel background
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#cfd2cf';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let cy = py + pad;
    // title
    if (hasTitle) {
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText(uiOverlay.title!, px + pad, cy);
      cy += titleH;
    }
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
      // OK
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(okx, by, bw, bh);
      ctx.strokeStyle = '#cfd2cf'; ctx.lineWidth = 1.5; ctx.strokeRect(okx, by, bw, bh);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('OK', okx + bw / 2, by + bh / 2 + 0.5);
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
      ctx.fillText('OK', okx + bw / 2, by + bh / 2 + 0.5);
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
      const maxRows = Math.min(10, Math.floor((panelH - (cy - py) - 80) / rowH));
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
    }
  }
}

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
  const res = await fetch(path);
    lvl = (await res.json()) as Level;
    levelCache.set(path, lvl);
  }
  courseInfo = { index: lvl.course.index, total: lvl.course.total, par: lvl.par, title: lvl.course.title };
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
  
  if (gameState === 'changelog') {
    if (e.code === 'ArrowDown' || e.code === 'PageDown') { changelogScrollY += (e.code === 'PageDown' ? 200 : 40); clampChangelogScroll(); }
    if (e.code === 'ArrowUp' || e.code === 'PageUp') { changelogScrollY -= (e.code === 'PageUp' ? 200 : 40); clampChangelogScroll(); }
    if (e.code === 'Escape') { gameState = 'menu'; }
    return;
  }
  if (gameState === 'userLevels') {
    if (e.code === 'ArrowUp') {
      selectedUserLevelIndex = Math.max(0, selectedUserLevelIndex - 1);
      e.preventDefault();
    }
    if (e.code === 'ArrowDown') {
      selectedUserLevelIndex = Math.min(filteredUserLevelsList.length - 1, selectedUserLevelIndex + 1);
      e.preventDefault();
    }
    if (e.code === 'Enter' && filteredUserLevelsList.length > 0) {
      void playUserLevel(filteredUserLevelsList[selectedUserLevelIndex]);
      e.preventDefault();
    }
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
