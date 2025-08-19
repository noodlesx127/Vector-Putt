import CHANGELOG_RAW from '../CHANGELOG.md?raw';
import usersStore from './UsersStore';

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
} // Added closing brace here

// Multilevel persistence (vp.levels.v1)
type SavedLevelV1 = { id: string; level: Level };
type LevelsDocV1 = { version: 1; levels: SavedLevelV1[] };
const LS_LEVELS_KEY = 'vp.levels.v1';

function newLevelId(): string {
  return 'lvl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function readLevelsDoc(): LevelsDocV1 {
  try {
    const s = localStorage.getItem(LS_LEVELS_KEY);
    if (!s) return { version: 1, levels: [] };
    const doc = JSON.parse(s) as LevelsDocV1;
    if (!doc || (doc as any).version !== 1 || !Array.isArray((doc as any).levels)) return { version: 1, levels: [] };
    // sanitize entries
    const levels: SavedLevelV1[] = (doc as any).levels
      .filter((e: any) => e && typeof e.id === 'string' && e.level && typeof e.level === 'object')
      .map((e: any) => ({ id: String(e.id), level: e.level as Level }));
    return { version: 1, levels };
  } catch {
    return { version: 1, levels: [] };
  }
}

function writeLevelsDoc(doc: LevelsDocV1): void {
  try { localStorage.setItem(LS_LEVELS_KEY, JSON.stringify(doc)); } catch {}
}

function assembleEditorLevel(): Level {
  const lvl: Level = {
    canvas: { width: levelCanvas.width, height: levelCanvas.height },
    course: editorLevelData?.course ?? { index: 1, total: 1, title: (editorLevelData?.course?.title || 'Untitled') },
    par: editorLevelData?.par ?? 3,
    tee: { x: Math.round(ball.x), y: Math.round(ball.y) },
    cup: { x: Math.round(hole.x), y: Math.round(hole.y), r: (hole as any).r ?? 8 },
    walls: walls ?? [],
    wallsPoly: polyWalls ?? [],
    posts: posts ?? [],
    bridges: bridges ?? [],
    water: waters ?? [],
    waterPoly: watersPoly ?? [],
    sand: sands ?? [],
    sandPoly: sandsPoly ?? [],
    hills: hills ?? [],
    decorations: decorations ?? [],
    meta: {
      authorId: editorLevelData?.meta?.authorId,
      authorName: editorLevelData?.meta?.authorName,
      created: editorLevelData?.meta?.created,
      modified: new Date().toISOString(),
    }
  } as Level;
  return lvl;
}

function applyLevelToGlobals(parsed: Level): void {
  // Apply to globals for rendering
  levelCanvas = { width: parsed.canvas?.width ?? WIDTH, height: parsed.canvas?.height ?? HEIGHT };
  walls = parsed.walls ?? [];
  sands = parsed.sand ?? [];
  sandsPoly = parsed.sandPoly ?? [];
  waters = parsed.water ?? [];
  watersPoly = parsed.waterPoly ?? [];
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

function saveEditorLevel(): void {
  // Overwrite if we have a saved id and permissions, otherwise Save As
  if (editorCurrentSavedId) {
    const doc = readLevelsDoc();
    const idx = doc.levels.findIndex(l => l.id === editorCurrentSavedId);
    if (idx >= 0) {
      const existing = doc.levels[idx].level;
      if (!canModifyLevel(existing)) {
        try { alert('You can only overwrite your own levels or if you are an admin. Use Save As to create a copy.'); } catch {}
        saveEditorLevelAs();
        return;
      }
      // overwrite, preserve created/author, update modified
      const newLevel = assembleEditorLevel();
      newLevel.meta = {
        authorId: existing.meta?.authorId,
        authorName: existing.meta?.authorName,
        created: existing.meta?.created || new Date().toISOString(),
        modified: new Date().toISOString(),
      };
      // Keep title
      if (!newLevel.course) newLevel.course = { index: 1, total: 1 } as any;
      if (!newLevel.course.title) newLevel.course.title = existing.course?.title || 'Untitled';
      doc.levels[idx].level = newLevel;
      writeLevelsDoc(doc);
      editorLevelData = newLevel;
      return;
    }
  }
  saveEditorLevelAs();
}

function saveEditorLevelAs(): void {
  console.log('saveEditorLevelAs: Starting function');
  const defaultTitle = editorLevelData?.course?.title || 'Untitled';
  const title = safePrompt('Enter a title for this level:', defaultTitle).trim();
  if (!title) {
    console.log('saveEditorLevelAs: No title provided');
    return;
  }
  console.log('saveEditorLevelAs: Title provided:', title);
  const doc = readLevelsDoc();
  const id = newLevelId();
  const lvl = assembleEditorLevel();
  // Set title and ownership
  if (!lvl.course) (lvl as any).course = { index: 1, total: 1 } as any;
  (lvl.course as any).title = title;
  const uid = getUserId();
  lvl.meta = {
    authorId: uid,
    authorName: userProfile.name || 'unknown',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };
  doc.levels.push({ id, level: lvl });
  writeLevelsDoc(doc);
  editorCurrentSavedId = id;
  editorLevelData = lvl;
}

function openLoadPicker(): void {
  console.log('openLoadPicker: Starting function');
  const doc = readLevelsDoc();
  console.log('openLoadPicker: Found', doc.levels.length, 'levels');
  if (doc.levels.length === 0) { 
    console.log('openLoadPicker: No levels, showing alert');
    try { alert('No saved levels found. Use Save As to create one.'); } catch (e) { console.error('Alert failed:', e); }
    return;
  }
  const lines = doc.levels.map((e, i) => {
    const lvl = e.level;
    const t = lvl.course?.title || 'Untitled';
    const a = lvl.meta?.authorName || 'unknown';
    const badge = (lvl.meta?.authorId === getUserId()) ? ' (you)' : (userProfile.role === 'admin' ? ' (admin can edit)' : '');
    return `${i+1}. ${t} — ${a}${badge}`;
  }).join('\n');
  const answer = safePrompt(`Load which level?\n${lines}\n\nEnter number:`, '1').trim();
  const n = parseInt(answer, 10);
  if (!n || n < 1 || n > doc.levels.length) return;
  const chosen = doc.levels[n-1];
  const lvl = chosen.level;
  editorLevelData = lvl;
  editorCurrentSavedId = chosen.id;
  applyLevelToGlobals(lvl);
}

function openDeletePicker(): void {
  console.log('openDeletePicker: Starting function');
  const doc = readLevelsDoc();
  console.log('openDeletePicker: Found', doc.levels.length, 'levels');
  if (doc.levels.length === 0) { 
    console.log('openDeletePicker: No levels, showing alert');
    try { alert('No saved levels to delete.'); } catch (e) { console.error('Alert failed:', e); }
    return;
  }
  const lines = doc.levels.map((e, i) => {
    const lvl = e.level; const t = lvl.course?.title || 'Untitled'; const a = lvl.meta?.authorName || 'unknown';
    return `${i+1}. ${t} — ${a}`;
  }).join('\n');
  const answer = safePrompt(`Delete which level?\n${lines}\n\nEnter number:`, '').trim();
  const n = parseInt(answer, 10);
  if (!n || n < 1 || n > doc.levels.length) return;
  const idx = n-1; const entry = doc.levels[idx];
  if (!canModifyLevel(entry.level)) { try { alert('You can only delete your own levels or if you are an admin.'); } catch {} return; }
  const ok = safeConfirm(`Really delete "${entry.level.course?.title || 'Untitled'}"? This cannot be undone.`);
  if (!ok) return;
  doc.levels.splice(idx, 1);
  writeLevelsDoc(doc);
  if (editorCurrentSavedId === entry.id) editorCurrentSavedId = null;
}

function newEditorLevel(): void {
  console.log('newEditorLevel: Starting function');
  const proceed = safeConfirm('Start a new level? Unsaved changes will be lost.');
  if (!proceed) {
    console.log('newEditorLevel: User cancelled or confirm failed');
    return;
  }
  console.log('newEditorLevel: Creating new level');
  editorCurrentSavedId = null;
  // Build a minimal default level (reuse logic from enterLevelEditor)
  const defaultCupR = hole.r || 8;
  editorLevelData = {
    canvas: { width: WIDTH, height: HEIGHT },
    course: { index: 1, total: 1, title: 'Untitled' },
    par: 3,
    tee: { x: COURSE_MARGIN + 60, y: Math.floor(HEIGHT / 2) },
    cup: { x: WIDTH - COURSE_MARGIN - 60, y: Math.floor(HEIGHT / 2), r: defaultCupR },
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
  applyLevelToGlobals(editorLevelData);
}

function migrateSingleSlotIfNeeded(): void {
  try {
    const doc = readLevelsDoc();
    if (doc.levels.length > 0) return;
    const raw = localStorage.getItem('vp.editor.level');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Level;
    if (!parsed || !parsed.tee || !parsed.cup) return;
    // Set ownership if missing
    const uid = getUserId();
    parsed.meta = {
      authorId: parsed.meta?.authorId || uid,
      authorName: parsed.meta?.authorName || (userProfile.name || 'unknown'),
      created: parsed.meta?.created || new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    if (!parsed.course) (parsed as any).course = { index: 1, total: 1 } as any;
    if (!parsed.course.title) (parsed.course as any).title = 'Untitled (migrated)';
    doc.levels.push({ id: newLevelId(), level: parsed });
    writeLevelsDoc(doc);
  } catch {}
}

function safePrompt(message: string, def: string): string {
  try {
    console.log('Attempting prompt:', message);
    const v = prompt(message, def);
    console.log('Prompt result:', v);
    return typeof v === 'string' ? v : '';
  } catch (e) {
    console.error('Prompt failed:', e);
    return def || '';
  }
}
function safeConfirm(message: string): boolean {
  try {
    console.log('Attempting confirm:', message);
    const result = !!confirm(message);
    console.log('Confirm result:', result);
    return result;
  } catch (e) {
    console.error('Confirm failed:', e);
    return false; // Changed from true to false for safety
  }
}

// Users Admin UI hotspots (rebuilt every frame while in users screen)
type UsersHotspot = { kind: 'back' | 'addUser' | 'addAdmin' | 'export' | 'import' | 'promote' | 'demote' | 'enable' | 'disable' | 'remove'; x: number; y: number; w: number; h: number; id?: string };
let usersUiHotspots: UsersHotspot[] = [];

// Level Editor UI hotspots and state
type EditorTool = 'select' | 'tee' | 'cup' | 'wall' | 'wallsPoly' | 'post' | 'bridge' | 'water' | 'waterPoly' | 'sand' | 'sandPoly' | 'hill';
type EditorAction = 'save' | 'saveAs' | 'load' | 'new' | 'delete' | 'gridToggle' | 'gridMinus' | 'gridPlus' | 'back';
type EditorMenuId = 'file' | 'objects' | 'decorations' | 'tools';
type EditorMenuItem = 
  | { kind: 'tool'; tool: EditorTool }
  | { kind: 'action'; action: EditorAction }
  | { kind: 'decoration'; decoration: string };
type EditorHotspot =
  | { kind: 'tool'; tool: EditorTool; x: number; y: number; w: number; h: number }
  | { kind: 'action'; action: EditorAction; x: number; y: number; w: number; h: number }
  | { kind: 'menu'; menu: EditorMenuId; x: number; y: number; w: number; h: number }
  | { kind: 'menuItem'; menu: EditorMenuId; item: EditorMenuItem; x: number; y: number; w: number; h: number };
let editorUiHotspots: EditorHotspot[] = [];
let selectedEditorTool: EditorTool = 'select';
let editorShowGrid = true;
let editorGridSize = 20; // px
let editorLevelData: Level | null = null; // working level for the editor
let editorCurrentSavedId: string | null = null; // current saved entry id when editing
let openEditorMenu: EditorMenuId | null = null; // current open dropdown in menubar

// Menubar keyboard focus state: which item is highlighted in the open dropdown
let editorMenuActiveItemIndex: number = 0;

// Define menu structures
const EDITOR_MENUS: Record<EditorMenuId, { title: string; items: Array<{ label: string; item: EditorMenuItem; separator?: boolean }> }> = {
  file: {
    title: 'File',
    items: [
      { label: 'New', item: { kind: 'action', action: 'new' } },
      { label: 'Save', item: { kind: 'action', action: 'save' } },
      { label: 'Save As', item: { kind: 'action', action: 'saveAs' } },
      { label: 'Level Load', item: { kind: 'action', action: 'load' } },
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
      { label: 'Flowers', item: { kind: 'decoration', decoration: 'flowers' } }
    ]
  },
  tools: {
    title: 'Editor Tools',
    items: [
      { label: 'Select Tool', item: { kind: 'tool', tool: 'select' } },
      { label: editorShowGrid ? 'Grid On' : 'Grid Off', item: { kind: 'action', action: 'gridToggle' }, separator: true },
      { label: `Grid - (${editorGridSize}px)`, item: { kind: 'action', action: 'gridMinus' } },
      { label: `Grid + (${editorGridSize}px)`, item: { kind: 'action', action: 'gridPlus' } }
    ]
  }
};

// Level Editor drag state for rectangle placements
let isEditorDragging = false;
let editorDragTool: EditorTool | null = null;
let editorDragStart = { x: 0, y: 0 }; // play coords (snapped & clamped)
let editorDragCurrent = { x: 0, y: 0 }; // play coords (snapped & clamped)

function enterLevelEditor(): void {
  // Try to initialize from saved local storage once per session
  // Run single-slot migration on first use
  try { migrateSingleSlotIfNeeded(); } catch {}
  if (editorLevelData === null) {
    try {
      const raw = localStorage.getItem('vp.editor.level');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.tee && parsed.cup) {
          editorLevelData = parsed as Level;
        }
      }
    } catch {}
  }
  if (editorLevelData === null) {
    // Build a minimal default level
    const defaultCupR = hole.r || 8;
    editorLevelData = {
      canvas: { width: WIDTH, height: HEIGHT },
      course: { index: 1, total: 1, title: 'Untitled' },
      par: 3,
      tee: { x: COURSE_MARGIN + 60, y: Math.floor(HEIGHT / 2) },
      cup: { x: WIDTH - COURSE_MARGIN - 60, y: Math.floor(HEIGHT / 2), r: defaultCupR },
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
  levelCanvas = {
    width: editorLevelData.canvas?.width ?? WIDTH,
    height: editorLevelData.canvas?.height ?? HEIGHT
  };
  walls = editorLevelData.walls ?? [];
  sands = editorLevelData.sand ?? [];
  sandsPoly = editorLevelData.sandPoly ?? [];
  waters = editorLevelData.water ?? [];
  watersPoly = editorLevelData.waterPoly ?? [];
  decorations = editorLevelData.decorations ?? [];
  hills = editorLevelData.hills ?? [];
  bridges = editorLevelData.bridges ?? [];
  posts = editorLevelData.posts ?? [];
  polyWalls = editorLevelData.wallsPoly ?? [];
  // Use tee/cup as ball/hole preview locations
  ball.x = editorLevelData.tee.x; ball.y = editorLevelData.tee.y; ball.vx = 0; ball.vy = 0; ball.moving = false;
  hole.x = editorLevelData.cup.x; hole.y = editorLevelData.cup.y; (hole as any).r = editorLevelData.cup.r;
}

function saveEditorLevelToLocal(): void {
  // Assemble a Level object from current editor state and save to localStorage
  const lvl: Level = {
    canvas: { width: levelCanvas.width, height: levelCanvas.height },
    course: editorLevelData?.course ?? { index: 1, total: 1, title: 'Untitled' },
    par: editorLevelData?.par ?? 3,
    tee: { x: Math.round(ball.x), y: Math.round(ball.y) },
    cup: { x: Math.round(hole.x), y: Math.round(hole.y), r: (hole as any).r ?? 8 },
    walls: walls ?? [],
    wallsPoly: polyWalls ?? [],
    posts: posts ?? [],
    bridges: bridges ?? [],
    water: waters ?? [],
    waterPoly: watersPoly ?? [],
    sand: sands ?? [],
    sandPoly: sandsPoly ?? [],
    hills: hills ?? [],
    decorations: decorations ?? []
  } as Level;
  try { localStorage.setItem('vp.editor.level', JSON.stringify(lvl)); } catch {}
  editorLevelData = lvl;
}

function loadEditorLevelFromLocal(): void {
  try {
    const raw = localStorage.getItem('vp.editor.level');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Level;
    if (!parsed || !parsed.tee || !parsed.cup) return;
    editorLevelData = parsed;
    // Apply to globals for rendering
    levelCanvas = { width: parsed.canvas?.width ?? WIDTH, height: parsed.canvas?.height ?? HEIGHT };
    walls = parsed.walls ?? [];
    sands = parsed.sand ?? [];
    sandsPoly = parsed.sandPoly ?? [];
    waters = parsed.water ?? [];
    watersPoly = parsed.waterPoly ?? [];
    decorations = parsed.decorations ?? [];
    hills = parsed.hills ?? [];
    bridges = parsed.bridges ?? [];
    posts = parsed.posts ?? [];
    polyWalls = parsed.wallsPoly ?? [];
    ball.x = parsed.tee.x; ball.y = parsed.tee.y; ball.vx = 0; ball.vy = 0; ball.moving = false;
    hole.x = parsed.cup.x; hole.y = parsed.cup.y; (hole as any).r = parsed.cup.r;
  } catch {}
}

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
let gameState: 'menu' | 'course' | 'options' | 'users' | 'changelog' | 'loading' | 'play' | 'sunk' | 'summary' | 'levelEditor' = 'menu';
let levelPaths = ['/levels/level1.json', '/levels/level2.json', '/levels/level3.json'];
let currentLevelIndex = 0;
let paused = false;
const APP_VERSION = '0.3.23';
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
  try {
    const s = localStorage.getItem('vp.user');
    if (!s) return;
    const o = JSON.parse(s);
    if (o && typeof o.name === 'string') userProfile.name = o.name;
    if (o && (o.role === 'admin' || o.role === 'user')) userProfile.role = o.role;
    if (o && typeof o.id === 'string') userProfile.id = o.id;
  } catch {}
}

function saveUserProfile(): void {
  try { localStorage.setItem('vp.user', JSON.stringify(userProfile)); } catch {}
}

function loadUserScores(): void {
  try {
    const s = localStorage.getItem('vp.scores');
    if (s) userScores = JSON.parse(s);
  } catch {}
}

function saveUserScores(): void {
  try { localStorage.setItem('vp.scores', JSON.stringify(userScores)); } catch {}
}

function recordScore(levelPath: string, score: number): void {
  const userId = getUserId();
  if (!userScores[userId]) userScores[userId] = {};
  if (!userScores[userId][levelPath]) {
    userScores[userId][levelPath] = { bestScore: score, attempts: 1, lastPlayed: new Date().toISOString() };
  } else {
    const existing = userScores[userId][levelPath];
    existing.attempts++;
    existing.lastPlayed = new Date().toISOString();
    if (score < existing.bestScore) {
      existing.bestScore = score;
    }
  }
  saveUserScores();
}

function getBestScore(levelPath: string): number | null {
  const userId = getUserId();
  return userScores[userId]?.[levelPath]?.bestScore ?? null;
}

try { loadUserProfile(); loadUserScores(); } catch {}
// Initialize UsersStore (async); fall back gracefully if it fails
let usersStoreReady = false;
(async () => {
  try {
    await usersStore.init();
    usersStoreReady = true;
  } catch (e) {
    console.error('Failed to initialize UsersStore', e);
  }
})();

// Helper: is the typed name blocked due to a disabled user record?
function isNameDisabled(name: string): boolean {
  const n = (name || '').trim();
  if (!n) return false;
  try {
    if (usersStoreReady) {
      const all = usersStore.getAll();
      const match = all.find(u => (u.name || '').toLowerCase() === n.toLowerCase());
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

// Selection system for Level Editor
type SelectableObject = 
  | { type: 'tee'; object: { x: number; y: number } }
  | { type: 'cup'; object: { x: number; y: number; r: number } }
  | { type: 'wall'; object: Wall; index: number }
  | { type: 'post'; object: Circle; index: number }
  | { type: 'decoration'; object: Decoration; index: number }
  | { type: 'water'; object: Rect; index: number }
  | { type: 'sand'; object: Rect; index: number }
  | { type: 'bridge'; object: Rect; index: number }
  | { type: 'hill'; object: Slope; index: number };

let selectedObjects: SelectableObject[] = [];
let selectionBoxStart: { x: number; y: number } | null = null;
let isSelectionDragging = false;
let isDragMoving = false;
let dragMoveStart: { x: number; y: number } | null = null;
let dragMoveOffset: { x: number; y: number } = { x: 0, y: 0 };
let isResizing = false;
let resizeHandle: string | null = null; // 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
let resizeStartBounds: { x: number; y: number; w: number; h: number } | null = null;
let resizeStartMouse: { x: number; y: number } | null = null;

// Selection helper functions
function clearSelection(): void {
  selectedObjects = [];
}

function getObjectBounds(obj: SelectableObject): { x: number; y: number; w: number; h: number } {
  switch (obj.type) {
    case 'tee':
    case 'cup':
      return { x: obj.object.x - 10, y: obj.object.y - 10, w: 20, h: 20 };
    case 'post':
      return { x: obj.object.x - obj.object.r, y: obj.object.y - obj.object.r, w: obj.object.r * 2, h: obj.object.r * 2 };
    case 'wall':
    case 'water':
    case 'sand':
    case 'bridge':
      return { x: obj.object.x, y: obj.object.y, w: obj.object.w, h: obj.object.h };
    case 'decoration':
      return { x: obj.object.x - 15, y: obj.object.y - 15, w: 30, h: 30 };
    case 'hill':
      return { x: obj.object.x - 5, y: obj.object.y - 5, w: obj.object.w + 10, h: obj.object.h + 10 };
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function isPointInObject(px: number, py: number, obj: SelectableObject): boolean {
  const bounds = getObjectBounds(obj);
  return px >= bounds.x && px <= bounds.x + bounds.w && py >= bounds.y && py <= bounds.y + bounds.h;
}

function findObjectAtPoint(px: number, py: number): SelectableObject | null {
  // Check tee
  const teeObj: SelectableObject = { type: 'tee', object: { x: ball.x, y: ball.y } };
  if (isPointInObject(px, py, teeObj)) return teeObj;
  
  // Check cup
  const cupObj: SelectableObject = { type: 'cup', object: { x: hole.x, y: hole.y, r: (hole as any).r ?? 8 } };
  if (isPointInObject(px, py, cupObj)) return cupObj;
  
  // Check posts
  for (let i = 0; i < posts.length; i++) {
    const obj: SelectableObject = { type: 'post', object: posts[i], index: i };
    if (isPointInObject(px, py, obj)) return obj;
  }
  
  // Check walls
  for (let i = 0; i < walls.length; i++) {
    const obj: SelectableObject = { type: 'wall', object: walls[i], index: i };
    if (isPointInObject(px, py, obj)) return obj;
  }
  
  // Check water
  for (let i = 0; i < waters.length; i++) {
    const obj: SelectableObject = { type: 'water', object: waters[i], index: i };
    if (isPointInObject(px, py, obj)) return obj;
  }
  
  // Check sand
  for (let i = 0; i < sands.length; i++) {
    const obj: SelectableObject = { type: 'sand', object: sands[i], index: i };
    if (isPointInObject(px, py, obj)) return obj;
  }
  
  // Check bridges
  for (let i = 0; i < bridges.length; i++) {
    const obj: SelectableObject = { type: 'bridge', object: bridges[i], index: i };
    if (isPointInObject(px, py, obj)) return obj;
  }
  
  // Check decorations
  for (let i = 0; i < decorations.length; i++) {
    const obj: SelectableObject = { type: 'decoration', object: decorations[i], index: i };
    if (isPointInObject(px, py, obj)) return obj;
  }
  
  // Check hills
  for (let i = 0; i < hills.length; i++) {
    const obj: SelectableObject = { type: 'hill', object: hills[i], index: i };
    if (isPointInObject(px, py, obj)) return obj;
  }
  
  return null;
}

function moveSelectedObjects(dx: number, dy: number): void {
  for (const obj of selectedObjects) {
    switch (obj.type) {
      case 'tee':
        const newTeePos = clampToFairway(ball.x + dx, ball.y + dy);
        ball.x = newTeePos.x;
        ball.y = newTeePos.y;
        if (editorLevelData) {
          editorLevelData.tee.x = newTeePos.x;
          editorLevelData.tee.y = newTeePos.y;
        }
        break;
      case 'cup':
        const newCupPos = clampToFairway(hole.x + dx, hole.y + dy);
        hole.x = newCupPos.x;
        hole.y = newCupPos.y;
        if (editorLevelData) {
          editorLevelData.cup.x = newCupPos.x;
          editorLevelData.cup.y = newCupPos.y;
        }
        break;
      case 'post':
        const newPostPos = clampToFairway(obj.object.x + dx, obj.object.y + dy);
        obj.object.x = newPostPos.x;
        obj.object.y = newPostPos.y;
        break;
      case 'wall':
      case 'water':
      case 'sand':
      case 'bridge':
        const newRectPos = clampToFairway(obj.object.x + dx, obj.object.y + dy);
        obj.object.x = newRectPos.x;
        obj.object.y = newRectPos.y;
        break;
      case 'decoration':
        const newDecPos = clampToFairway(obj.object.x + dx, obj.object.y + dy);
        obj.object.x = newDecPos.x;
        obj.object.y = newDecPos.y;
        break;
      case 'hill':
        const newHillPos = clampToFairway(obj.object.x + dx, obj.object.y + dy);
        obj.object.x = newHillPos.x;
        obj.object.y = newHillPos.y;
        break;
    }
  }
}

function getResizeHandles(bounds: { x: number; y: number; w: number; h: number }): Array<{ handle: string; x: number; y: number; w: number; h: number; cursor: string }> {
  const handleSize = 8;
  const hs = handleSize / 2;
  return [
    { handle: 'nw', x: bounds.x - hs, y: bounds.y - hs, w: handleSize, h: handleSize, cursor: 'nw-resize' },
    { handle: 'n', x: bounds.x + bounds.w / 2 - hs, y: bounds.y - hs, w: handleSize, h: handleSize, cursor: 'n-resize' },
    { handle: 'ne', x: bounds.x + bounds.w - hs, y: bounds.y - hs, w: handleSize, h: handleSize, cursor: 'ne-resize' },
    { handle: 'e', x: bounds.x + bounds.w - hs, y: bounds.y + bounds.h / 2 - hs, w: handleSize, h: handleSize, cursor: 'e-resize' },
    { handle: 'se', x: bounds.x + bounds.w - hs, y: bounds.y + bounds.h - hs, w: handleSize, h: handleSize, cursor: 'se-resize' },
    { handle: 's', x: bounds.x + bounds.w / 2 - hs, y: bounds.y + bounds.h - hs, w: handleSize, h: handleSize, cursor: 's-resize' },
    { handle: 'sw', x: bounds.x - hs, y: bounds.y + bounds.h - hs, w: handleSize, h: handleSize, cursor: 'sw-resize' },
    { handle: 'w', x: bounds.x - hs, y: bounds.y + bounds.h / 2 - hs, w: handleSize, h: handleSize, cursor: 'w-resize' }
  ];
}

function findResizeHandle(px: number, py: number): string | null {
  if (selectedObjects.length !== 1) return null; // Only resize single selections
  const obj = selectedObjects[0];
  
  // Only resizable objects (not tee/cup/decoration/post)
  if (obj.type === 'tee' || obj.type === 'cup' || obj.type === 'decoration' || obj.type === 'post') return null;
  
  const bounds = getObjectBounds(obj);
  const handles = getResizeHandles(bounds);
  
  for (const handle of handles) {
    if (px >= handle.x && px <= handle.x + handle.w && py >= handle.y && py <= handle.y + handle.h) {
      return handle.handle;
    }
  }
  return null;
}

function applyResize(handle: string, startBounds: { x: number; y: number; w: number; h: number }, dx: number, dy: number): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = startBounds;
  const minSize = editorGridSize; // Minimum size is one grid step
  
  switch (handle) {
    case 'nw':
      const newX = x + dx;
      const newY = y + dy;
      w = Math.max(minSize, w - dx);
      h = Math.max(minSize, h - dy);
      x = x + startBounds.w - w;
      y = y + startBounds.h - h;
      break;
    case 'n':
      h = Math.max(minSize, h - dy);
      y = y + startBounds.h - h;
      break;
    case 'ne':
      w = Math.max(minSize, w + dx);
      h = Math.max(minSize, h - dy);
      y = y + startBounds.h - h;
      break;
    case 'e':
      w = Math.max(minSize, w + dx);
      break;
    case 'se':
      w = Math.max(minSize, w + dx);
      h = Math.max(minSize, h + dy);
      break;
    case 's':
      h = Math.max(minSize, h + dy);
      break;
    case 'sw':
      w = Math.max(minSize, w - dx);
      h = Math.max(minSize, h + dy);
      x = x + startBounds.w - w;
      break;
    case 'w':
      w = Math.max(minSize, w - dx);
      x = x + startBounds.w - w;
      break;
  }
  
  // Snap to grid
  x = Math.round(x / editorGridSize) * editorGridSize;
  y = Math.round(y / editorGridSize) * editorGridSize;
  w = Math.round(w / editorGridSize) * editorGridSize;
  h = Math.round(h / editorGridSize) * editorGridSize;
  
  // Ensure minimum size after snapping
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);
  
  // Clamp to fairway bounds
  const clamped = clampToFairway(x, y);
  const clampedEnd = clampToFairway(x + w, y + h);
  x = clamped.x;
  y = clamped.y;
  w = clampedEnd.x - x;
  h = clampedEnd.y - y;
  
  return { x, y, w, h };
}

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
let transitioning = false; // prevent double-advance while changing holes
let lastAdvanceFromSunkMs = 0; // used to swallow trailing click after mousedown
const CLICK_SWALLOW_MS = 180; // shorten delay for snappier feel

let previousGameState: 'menu' | 'course' | 'options' | 'users' | 'changelog' | 'loading' | 'play' | 'sunk' | 'summary' | 'levelEditor' = 'menu';

// (duplicate block removed)

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
  } else {
    const next = currentLevelIndex + 1;
    // kick off preload of the following level to reduce perceived delay later
    preloadLevelByIndex(next + 1);
    currentLevelIndex = next;
    loadLevelByIndex(currentLevelIndex)
      .then(() => { transitioning = false; })
      .catch((err) => { console.error(err); transitioning = false; });
  }
}

async function startCourseFromFile(courseJsonPath: string): Promise<void> {
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
  } catch (err) {
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
  const y = HEIGHT / 2 - 10;
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
      try {
        const name = (userProfile.name || '').trim();
        if (!name) { /* nothing to sync */ }
        else if (usersStoreReady) {
          const all = usersStore.getAll();
          const match = all.find(u => (u.name || '').toLowerCase() === name.toLowerCase());
          if (match) {
            // If typed 'admin' but record isn't admin yet, promote it
            if (name.toLowerCase() === 'admin' && match.role !== 'admin') {
              try { usersStore.toggleRole(match.id); match.role = 'admin'; } catch {}
            }
            userProfile.role = match.role as any;
            userProfile.id = match.id;
            saveUserProfile();
          } else {
            // Create a new user in the store (admin if name is 'admin')
            const defaultRole = (name.toLowerCase() === 'admin') ? 'admin' : 'user';
            const rec = usersStore.addUser(name, defaultRole as any);
            userProfile.role = rec.role as any;
            userProfile.id = rec.id;
            saveUserProfile();
          }
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
      } catch {}
      return;
    }
    // Level Editor button (disabled unless username non-empty)
    const le = getMainLevelEditorRect();
    if (canStart && p.x >= le.x && p.x <= le.x + le.w && p.y >= le.y && p.y <= le.y + le.h) {
      gameState = 'levelEditor';
      enterLevelEditor();
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
      startCourseFromFile('/levels/course.json').catch(console.error);
      return;
    }
    const back = getCourseBackRect();
    if (p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h) {
      gameState = 'menu';
      return;
    }
  }
  // Handle Level Editor menubar interactions
  if (gameState === 'levelEditor') {
    // Check menubar hotspots
    for (const hs of editorUiHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) {
        if (hs.kind === 'menu') {
          // Toggle menu open/close
          if (openEditorMenu === hs.menu) {
            openEditorMenu = null;
          } else {
            openEditorMenu = hs.menu;
            editorMenuActiveItemIndex = 0;
          }
          return;
        } else if (hs.kind === 'menuItem') {
          // Handle menu item selection
          const item = hs.item;
          
          if (item.kind === 'tool') {
            selectedEditorTool = item.tool;
          } else if (item.kind === 'action') {
            if (item.action === 'gridToggle') { editorShowGrid = !editorShowGrid; }
            else if (item.action === 'gridMinus') {
              const step = editorGridSize >= 20 ? 10 : 5;
              editorGridSize = Math.max(5, editorGridSize - step);
            }
            else if (item.action === 'gridPlus') {
              const step = editorGridSize >= 20 ? 10 : 5;
              editorGridSize = Math.min(80, editorGridSize + step);
            }
            else if (item.action === 'save') { saveEditorLevel(); }
            else if (item.action === 'saveAs') { saveEditorLevelAs(); }
            else if (item.action === 'load') { openLoadPicker(); }
            else if (item.action === 'new') { newEditorLevel(); }
            else if (item.action === 'delete') { openDeletePicker(); }
            else if (item.action === 'back') { gameState = 'menu'; }
          } else if (item.kind === 'decoration') {
            // Handle decoration placement (flowers)
            selectedEditorTool = 'select'; // Switch to select for decoration placement
          }
          
          // Close menu after selection
          openEditorMenu = null;
          return;
        } else if (hs.kind === 'tool') {
          selectedEditorTool = hs.tool;
          return;
        } else if (hs.kind === 'action') {
          if (hs.action === 'gridToggle') { editorShowGrid = !editorShowGrid; return; }
          if (hs.action === 'gridMinus') {
            const step = editorGridSize >= 20 ? 10 : 5;
            editorGridSize = Math.max(5, editorGridSize - step);
            return;
          }
          if (hs.action === 'gridPlus') {
            const step = editorGridSize >= 20 ? 10 : 5;
            editorGridSize = Math.min(80, editorGridSize + step);
            return;
          }
          if (hs.action === 'save') { saveEditorLevel(); return; }
          if (hs.action === 'saveAs') { saveEditorLevelAs(); return; }
          if (hs.action === 'load') { openLoadPicker(); return; }
          if (hs.action === 'new') { newEditorLevel(); return; }
          if (hs.action === 'delete') { openDeletePicker(); return; }
          if (hs.action === 'back') { gameState = 'menu'; return; }
          return;
        }
      }
    }
    
    // Close any open menu if clicking outside
    if (openEditorMenu) {
      openEditorMenu = null;
      return;
    }
    // Select Tool logic
    if (selectedEditorTool === 'select') {
      const pp = canvasToPlayCoords(p);
      
      // Check for resize handle first (single selection only)
      const handle = findResizeHandle(pp.x, pp.y);
      if (handle && selectedObjects.length === 1) {
        // Start resize operation
        isResizing = true;
        resizeHandle = handle;
        resizeStartBounds = getObjectBounds(selectedObjects[0]);
        resizeStartMouse = { x: pp.x, y: pp.y };
        return;
      }
      
      const clickedObject = findObjectAtPoint(pp.x, pp.y);
      
      if (clickedObject) {
        // Check if object is already selected
        const isAlreadySelected = selectedObjects.some(obj => 
          obj.type === clickedObject.type && 
          (obj.type === 'tee' || obj.type === 'cup' || 
           ('index' in obj && 'index' in clickedObject && obj.index === clickedObject.index))
        );
        
        if (!e.ctrlKey && !e.shiftKey) {
          // Single selection - clear others unless already selected
          if (!isAlreadySelected) {
            clearSelection();
            selectedObjects.push(clickedObject);
          }
        } else if (e.ctrlKey || e.shiftKey) {
          // Multi-selection
          if (isAlreadySelected) {
            // Deselect
            selectedObjects = selectedObjects.filter(obj => 
              !(obj.type === clickedObject.type && 
                (obj.type === 'tee' || obj.type === 'cup' || 
                 ('index' in obj && 'index' in clickedObject && obj.index === clickedObject.index)))
            );
          } else {
            // Add to selection
            selectedObjects.push(clickedObject);
          }
        }
        
        // Start drag move if object is selected
        if (selectedObjects.length > 0) {
          isDragMoving = true;
          dragMoveStart = { x: pp.x, y: pp.y };
        }
      } else {
        // Click on empty area - start selection box or clear selection
        if (!e.ctrlKey && !e.shiftKey) {
          clearSelection();
        }
        
        // Start selection box
        isSelectionDragging = true;
        selectionBoxStart = { x: pp.x, y: pp.y };
      }
      return;
    }
    
    // Placement on canvas (click anywhere not on UI/back)
    if (selectedEditorTool === 'tee' || selectedEditorTool === 'cup') {
      const pp = canvasToPlayCoords(p);
      // snap to grid
      let sx = Math.round(pp.x / editorGridSize) * editorGridSize;
      let sy = Math.round(pp.y / editorGridSize) * editorGridSize;
      const clamped = clampToFairway(sx, sy);
      sx = clamped.x; sy = clamped.y;
      if (selectedEditorTool === 'tee') {
        ball.x = sx; ball.y = sy; ball.vx = 0; ball.vy = 0; ball.moving = false;
        if (!editorLevelData) editorLevelData = { tee: { x: sx, y: sy }, cup: { x: hole.x, y: hole.y, r: (hole as any).r ?? 8 }, par: 3, course: { index: 1, total: 1 } } as unknown as Level;
        editorLevelData.tee = { x: sx, y: sy } as any;
      } else if (selectedEditorTool === 'cup') {
        hole.x = sx; hole.y = sy;
        const r = (hole as any).r ?? 8;
        if (!editorLevelData) editorLevelData = { tee: { x: ball.x, y: ball.y }, cup: { x: sx, y: sy, r }, par: 3, course: { index: 1, total: 1 } } as unknown as Level;
        editorLevelData.cup = { x: sx, y: sy, r } as any;
      }
      return;
    }
    // Post placement (single click)
    if (selectedEditorTool === 'post') {
      const pp = canvasToPlayCoords(p);
      let sx = Math.round(pp.x / editorGridSize) * editorGridSize;
      let sy = Math.round(pp.y / editorGridSize) * editorGridSize;
      const clamped = clampToFairway(sx, sy);
      sx = clamped.x; sy = clamped.y;
      const r = 8;
      posts.push({ x: sx, y: sy, r });
      if (editorLevelData) {
        if (!Array.isArray(editorLevelData.posts)) (editorLevelData as any).posts = [];
        (editorLevelData.posts as any).push({ x: sx, y: sy, r });
      }
      return;
    }
    // Rectangle tools: begin drag on mousedown
    const rectTools: EditorTool[] = ['wall', 'bridge', 'water', 'sand', 'hill'];
    if (rectTools.includes(selectedEditorTool)) {
      const pp = canvasToPlayCoords(p);
      let sx = Math.round(pp.x / editorGridSize) * editorGridSize;
      let sy = Math.round(pp.y / editorGridSize) * editorGridSize;
      const clamped = clampToFairway(sx, sy);
      sx = clamped.x; sy = clamped.y;
      isEditorDragging = true;
      editorDragTool = selectedEditorTool;
      editorDragStart = { x: sx, y: sy };
      editorDragCurrent = { x: sx, y: sy };
      return;
    }
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
        if (!usersStoreReady) { try { alert('Users store is not ready yet.'); } catch {} return; }
        try {
          switch (hs.kind) {
            case 'back':
              gameState = previousGameState;
              break;
            case 'addUser': {
              const name = prompt('Enter new user name');
              if (name && name.trim()) usersStore.addUser(name.trim(), 'user');
              break;
            }
            case 'addAdmin': {
              const name = prompt('Enter new admin name');
              if (name && name.trim()) usersStore.addUser(name.trim(), 'admin');
              break;
            }
            case 'export': {
              const json = usersStore.exportToJsonString(true);
              prompt('Users JSON — copy to clipboard:', json);
              break;
            }
            case 'import': {
              const text = prompt('Paste Users JSON to import');
              if (text && text.trim()) usersStore.importFromJsonString(text.trim());
              break;
            }
            case 'promote':
            case 'demote':
              if (hs.id) usersStore.toggleRole(hs.id, getUserId());
              break;
            case 'enable':
              if (hs.id) usersStore.setEnabled(hs.id, true);
              break;
            case 'disable':
              if (hs.id) usersStore.setEnabled(hs.id, false);
              break;
            case 'remove':
              if (hs.id) {
                const ok = confirm('Remove this user? This cannot be undone.');
                if (ok) usersStore.removeUser(hs.id);
              }
              break;
          }
        } catch (e) {
          try { alert((e as any)?.message || 'Operation failed'); } catch {}
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
    // Any menubar/UI element hover?
    let overUI = false;
    for (const hs of editorUiHotspots) {
      if (p.x >= hs.x && p.x <= hs.x + hs.w && p.y >= hs.y && p.y <= hs.y + hs.h) { overUI = true; break; }
    }
    // Update drag current if dragging a rectangle
    if (isEditorDragging) {
      const pp = canvasToPlayCoords(p);
      let sx = Math.round(pp.x / editorGridSize) * editorGridSize;
      let sy = Math.round(pp.y / editorGridSize) * editorGridSize;
      const clamped = clampToFairway(sx, sy);
      editorDragCurrent = { x: clamped.x, y: clamped.y };
    }
    
    // Handle Select Tool dragging
    if (selectedEditorTool === 'select') {
      const pp = canvasToPlayCoords(p);
      
      if (isResizing && resizeHandle && resizeStartBounds && resizeStartMouse) {
        // Handle resize operation
        const dx = pp.x - resizeStartMouse.x;
        const dy = pp.y - resizeStartMouse.y;
        const newBounds = applyResize(resizeHandle, resizeStartBounds, dx, dy);
        
        // Apply resize to the selected object
        const obj = selectedObjects[0];
        if (obj.type === 'wall' || obj.type === 'water' || obj.type === 'sand' || obj.type === 'bridge' || obj.type === 'hill') {
          obj.object.x = newBounds.x;
          obj.object.y = newBounds.y;
          obj.object.w = newBounds.w;
          obj.object.h = newBounds.h;
        }
      } else if (isDragMoving && dragMoveStart) {
        // Move selected objects
        const dx = pp.x - dragMoveStart.x;
        const dy = pp.y - dragMoveStart.y;
        // Snap to grid
        const snappedDx = Math.round(dx / editorGridSize) * editorGridSize;
        const snappedDy = Math.round(dy / editorGridSize) * editorGridSize;
        dragMoveOffset = { x: snappedDx, y: snappedDy };
      } else if (isSelectionDragging && selectionBoxStart) {
        // Update selection box end point
        dragMoveOffset = { x: pp.x - selectionBoxStart.x, y: pp.y - selectionBoxStart.y };
      }
    }
    const rectTools: EditorTool[] = ['wall', 'bridge', 'water', 'sand', 'hill'];
    const wantsCrosshair = !overUI && (
      selectedEditorTool === 'tee' || selectedEditorTool === 'cup' || selectedEditorTool === 'post' || rectTools.includes(selectedEditorTool)
    );
    let cursor = 'default';
    if (overUI) {
      cursor = 'pointer';
    } else if (wantsCrosshair) {
      cursor = 'crosshair';
    } else if (selectedEditorTool === 'select') {
      if (isResizing) {
        // Show resize cursor during resize
        const handles = getResizeHandles(resizeStartBounds || { x: 0, y: 0, w: 0, h: 0 });
        const activeHandle = handles.find(h => h.handle === resizeHandle);
        cursor = activeHandle ? activeHandle.cursor : 'default';
      } else if (isDragMoving) {
        cursor = 'move';
      } else {
        // Check for resize handle hover
        const pp = canvasToPlayCoords(p);
        const handle = findResizeHandle(pp.x, pp.y);
        if (handle && selectedObjects.length === 1) {
          const bounds = getObjectBounds(selectedObjects[0]);
          const handles = getResizeHandles(bounds);
          const handleInfo = handles.find(h => h.handle === handle);
          cursor = handleInfo ? handleInfo.cursor : 'default';
        } else if (selectedObjects.length > 0 && findObjectAtPoint(pp.x, pp.y)) {
          cursor = 'move';
        }
      }
    }
    canvas.style.cursor = cursor;
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
    const back = getCourseBackRect();
    hoverCourseDev = p.x >= dev.x && p.x <= dev.x + dev.w && p.y >= dev.y && p.y <= dev.y + dev.h;
    hoverCourseBack = p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h;
    canvas.style.cursor = (hoverCourseDev || hoverCourseBack) ? 'pointer' : 'default';
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
  }
  if (gameState === 'options') {
    isOptionsVolumeDragging = false;
  }
  if (gameState === 'levelEditor') {
    // finalize rectangle placement if dragging
    if (isEditorDragging && editorDragTool) {
      const x0 = editorDragStart.x;
      const y0 = editorDragStart.y;
      const x1 = editorDragCurrent.x;
      const y1 = editorDragCurrent.y;
      let rx = Math.min(x0, x1);
      let ry = Math.min(y0, y1);
      let rw = Math.abs(x1 - x0);
      let rh = Math.abs(y1 - y0);
      // Ignore tiny drags (accidental clicks)
      if (rw >= editorGridSize || rh >= editorGridSize) {
        if (editorDragTool === 'wall') {
          const r = { x: rx, y: ry, w: rw, h: rh };
          walls.push(r);
          if (editorLevelData) { if (!Array.isArray(editorLevelData.walls)) (editorLevelData as any).walls = []; (editorLevelData.walls as any).push(r); }
        } else if (editorDragTool === 'bridge') {
          const r = { x: rx, y: ry, w: rw, h: rh };
          bridges.push(r);
          if (editorLevelData) { if (!Array.isArray(editorLevelData.bridges)) (editorLevelData as any).bridges = []; (editorLevelData.bridges as any).push(r); }
        } else if (editorDragTool === 'water') {
          const r = { x: rx, y: ry, w: rw, h: rh };
          waters.push(r);
          if (editorLevelData) { if (!Array.isArray(editorLevelData.water)) (editorLevelData as any).water = []; (editorLevelData.water as any).push(r); }
        } else if (editorDragTool === 'sand') {
          const r = { x: rx, y: ry, w: rw, h: rh };
          sands.push(r);
          if (editorLevelData) { if (!Array.isArray(editorLevelData.sand)) (editorLevelData as any).sand = []; (editorLevelData.sand as any).push(r); }
        } else if (editorDragTool === 'hill') {
          const r = { x: rx, y: ry, w: rw, h: rh, dir: 'N' as const };
          hills.push(r);
          if (editorLevelData) { if (!Array.isArray(editorLevelData.hills)) (editorLevelData as any).hills = []; (editorLevelData.hills as any).push(r); }
        }
      }
    }
    // Handle Select Tool mouseup
    if (selectedEditorTool === 'select') {
      if (isDragMoving && dragMoveStart && selectedObjects.length > 0) {
        // Apply the drag movement to selected objects
        moveSelectedObjects(dragMoveOffset.x, dragMoveOffset.y);
      } else if (isSelectionDragging && selectionBoxStart) {
        // Complete selection box - find objects within the box
        const pp = canvasToPlayCoords(worldFromEvent(e));
        const boxX1 = Math.min(selectionBoxStart.x, pp.x);
        const boxY1 = Math.min(selectionBoxStart.y, pp.y);
        const boxX2 = Math.max(selectionBoxStart.x, pp.x);
        const boxY2 = Math.max(selectionBoxStart.y, pp.y);
        
        // Clear selection if not holding Ctrl/Shift
        if (!e.ctrlKey && !e.shiftKey) {
          clearSelection();
        }
        
        // Add objects within selection box
        const allObjects = [
          { type: 'tee' as const, object: { x: ball.x, y: ball.y } },
          { type: 'cup' as const, object: { x: hole.x, y: hole.y, r: (hole as any).r ?? 8 } },
          ...posts.map((p, i) => ({ type: 'post' as const, object: p, index: i })),
          ...walls.map((w, i) => ({ type: 'wall' as const, object: w, index: i })),
          ...waters.map((w, i) => ({ type: 'water' as const, object: w, index: i })),
          ...sands.map((s, i) => ({ type: 'sand' as const, object: s, index: i })),
          ...bridges.map((b, i) => ({ type: 'bridge' as const, object: b, index: i })),
          ...decorations.map((d, i) => ({ type: 'decoration' as const, object: d, index: i })),
          ...hills.map((h, i) => ({ type: 'hill' as const, object: h, index: i }))
        ];
        
        for (const obj of allObjects) {
          const bounds = getObjectBounds(obj);
          const objCenterX = bounds.x + bounds.w / 2;
          const objCenterY = bounds.y + bounds.h / 2;
          
          if (objCenterX >= boxX1 && objCenterX <= boxX2 && objCenterY >= boxY1 && objCenterY <= boxY2) {
            // Check if not already selected
            const isAlreadySelected = selectedObjects.some(selected => 
              selected.type === obj.type && 
              (selected.type === 'tee' || selected.type === 'cup' || 
               ('index' in selected && 'index' in obj && selected.index === obj.index))
            );
            if (!isAlreadySelected) {
              selectedObjects.push(obj);
            }
          }
        }
      }
      
      // Clear drag states
      isDragMoving = false;
      isSelectionDragging = false;
      isResizing = false;
      dragMoveStart = null;
      selectionBoxStart = null;
      resizeHandle = null;
      resizeStartBounds = null;
      resizeStartMouse = null;
      dragMoveOffset = { x: 0, y: 0 };
    }
    
    // clear drag state
    isEditorDragging = false;
    editorDragTool = null;
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

// Level Editor keyboard shortcuts: grid and nudge
function handleLevelEditorKeys(e: KeyboardEvent) {
  if (gameState !== 'levelEditor') return;
  
  // Menu keyboard handling
  if (e.altKey) {
    // Menu mnemonics: Alt+F, Alt+O, Alt+D, Alt+E
    if (e.key === 'f' || e.key === 'F') {
      openEditorMenu = openEditorMenu === 'file' ? null : 'file';
      editorMenuActiveItemIndex = 0;
      e.preventDefault();
      return;
    }
    if (e.key === 'o' || e.key === 'O') {
      openEditorMenu = openEditorMenu === 'objects' ? null : 'objects';
      editorMenuActiveItemIndex = 0;
      e.preventDefault();
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      openEditorMenu = openEditorMenu === 'decorations' ? null : 'decorations';
      editorMenuActiveItemIndex = 0;
      e.preventDefault();
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      openEditorMenu = openEditorMenu === 'tools' ? null : 'tools';
      editorMenuActiveItemIndex = 0;
      e.preventDefault();
      return;
    }
  }
  
  // Menu navigation when a menu is open
  if (openEditorMenu) {
    const menu = EDITOR_MENUS[openEditorMenu];
    if (e.key === 'ArrowDown') {
      editorMenuActiveItemIndex = Math.min(menu.items.length - 1, editorMenuActiveItemIndex + 1);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      editorMenuActiveItemIndex = Math.max(0, editorMenuActiveItemIndex - 1);
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      // Execute the active menu item
      const activeItem = menu.items[editorMenuActiveItemIndex];
      if (activeItem) {
        const item = activeItem.item;
        if (item.kind === 'tool') {
          selectedEditorTool = item.tool;
        } else if (item.kind === 'action') {
          if (item.action === 'gridToggle') { editorShowGrid = !editorShowGrid; }
          else if (item.action === 'gridMinus') {
            const step = editorGridSize >= 20 ? 10 : 5;
            editorGridSize = Math.max(5, editorGridSize - step);
          }
          else if (item.action === 'gridPlus') {
            const step = editorGridSize >= 20 ? 10 : 5;
            editorGridSize = Math.min(80, editorGridSize + step);
          }
          else if (item.action === 'save') { saveEditorLevel(); }
          else if (item.action === 'saveAs') { saveEditorLevelAs(); }
          else if (item.action === 'load') { openLoadPicker(); }
          else if (item.action === 'new') { newEditorLevel(); }
          else if (item.action === 'delete') { openDeletePicker(); }
          else if (item.action === 'back') { gameState = 'menu'; }
        } else if (item.kind === 'decoration') {
          selectedEditorTool = 'select';
        }
        openEditorMenu = null;
      }
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      openEditorMenu = null;
      e.preventDefault();
      return;
    }
  }
  
  // Existing keyboard shortcuts (preserve legacy behavior)
  if (e.key === 'g' || e.key === 'G') { editorShowGrid = !editorShowGrid; e.preventDefault(); return; }
  if (e.key === '-' || e.code === 'Minus' || e.key === '_') { editorGridSize = Math.max(5, editorGridSize - (editorGridSize >= 20 ? 10 : 5)); e.preventDefault(); return; }
  if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') { editorGridSize = Math.min(80, editorGridSize + (editorGridSize >= 20 ? 10 : 5)); e.preventDefault(); return; }
  
  // Delete key to remove selected objects
  if (e.key === 'Delete' && selectedEditorTool === 'select' && selectedObjects.length > 0) {
    for (const obj of selectedObjects) {
      switch (obj.type) {
        case 'post':
          posts.splice(obj.index, 1);
          if (editorLevelData && editorLevelData.posts) {
            (editorLevelData.posts as any).splice(obj.index, 1);
          }
          break;
        case 'wall':
          walls.splice(obj.index, 1);
          if (editorLevelData && editorLevelData.walls) {
            (editorLevelData.walls as any).splice(obj.index, 1);
          }
          break;
        case 'water':
          waters.splice(obj.index, 1);
          if (editorLevelData && editorLevelData.water) {
            (editorLevelData.water as any).splice(obj.index, 1);
          }
          break;
        case 'sand':
          sands.splice(obj.index, 1);
          if (editorLevelData && editorLevelData.sand) {
            (editorLevelData.sand as any).splice(obj.index, 1);
          }
          break;
        case 'bridge':
          bridges.splice(obj.index, 1);
          if (editorLevelData && editorLevelData.bridges) {
            (editorLevelData.bridges as any).splice(obj.index, 1);
          }
          break;
        case 'decoration':
          decorations.splice(obj.index, 1);
          if (editorLevelData && editorLevelData.decorations) {
            (editorLevelData.decorations as any).splice(obj.index, 1);
          }
          break;
        case 'hill':
          hills.splice(obj.index, 1);
          if (editorLevelData && editorLevelData.hills) {
            (editorLevelData.hills as any).splice(obj.index, 1);
          }
          break;
        // Note: tee and cup cannot be deleted as they are required level elements
      }
    }
    clearSelection();
    e.preventDefault();
    return;
  }
  
  // Arrow key nudges for tee/cup/selection (only if no menu is open)
  if (!openEditorMenu) {
    let dx = 0, dy = 0;
    if (e.code === 'ArrowLeft') dx = -editorGridSize;
    else if (e.code === 'ArrowRight') dx = editorGridSize;
    else if (e.code === 'ArrowUp') dy = -editorGridSize;
    else if (e.code === 'ArrowDown') dy = editorGridSize;
    if (dx === 0 && dy === 0) return;
    if (selectedEditorTool === 'select' && selectedObjects.length > 0) {
      // Move all selected objects
      moveSelectedObjects(dx, dy);
      e.preventDefault(); return;
    }
    if (selectedEditorTool === 'tee') {
      const clamped = clampToFairway(ball.x + dx, ball.y + dy);
      ball.x = clamped.x; ball.y = clamped.y;
      ball.vx = 0; ball.vy = 0; ball.moving = false;
      if (editorLevelData) {
        editorLevelData.tee.x = clamped.x;
        editorLevelData.tee.y = clamped.y;
      }
      e.preventDefault(); return;
    }
    if (selectedEditorTool === 'cup') {
      const clamped = clampToFairway(hole.x + dx, hole.y + dy);
      hole.x = clamped.x; hole.y = clamped.y;
      if (editorLevelData) {
        editorLevelData.cup.x = clamped.x;
        editorLevelData.cup.y = clamped.y;
      }
      e.preventDefault(); return;
    }
  }
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
    return;
  }
  // Level Editor screen
  if (gameState === 'levelEditor') {
    // Update dynamic menu labels
    // tools.items indices:
    // 0 = Select Tool (static label)
    // 1 = Grid toggle, 2 = Grid -, 3 = Grid +
    EDITOR_MENUS.tools.items[1].label = editorShowGrid ? 'Grid On' : 'Grid Off';
    EDITOR_MENUS.tools.items[2].label = `Grid - (${editorGridSize}px)`;
    EDITOR_MENUS.tools.items[3].label = `Grid + (${editorGridSize}px)`;
    
    // Build menubar hotspots (rebuilt each frame)
    editorUiHotspots = [];

    // Canvas preview: fairway + grid + tee/cup markers
    ctx.fillStyle = COLORS.fairway;
    ctx.fillRect(fairX, fairY, fairW, fairH);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.fairwayLine;
    ctx.strokeRect(fairX + 1, fairY + 1, Math.max(0, fairW - 2), Math.max(0, fairH - 2));
    if (editorShowGrid && editorGridSize > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(fairX, fairY, fairW, fairH);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = fairX; x <= fairX + fairW; x += editorGridSize) {
        ctx.moveTo(Math.round(x) + 0.5, fairY);
        ctx.lineTo(Math.round(x) + 0.5, fairY + fairH);
      }
      for (let y = fairY; y <= fairY + fairH; y += editorGridSize) {
        ctx.moveTo(fairX, Math.round(y) + 0.5);
        ctx.lineTo(fairX + fairW, Math.round(y) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Existing geometry preview (terrain before walls)
    // Water (rectangles)
    for (const r of waters) {
      ctx.fillStyle = COLORS.waterFill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.waterStroke;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    // Water (polygons)
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
    // Sand (rectangles)
    for (const r of sands) {
      ctx.fillStyle = COLORS.sandFill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.sandStroke;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    // Sand (polygons)
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
    for (const r of bridges) {
      ctx.fillStyle = COLORS.fairway;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.fairwayLine;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    // Hills (directional gradient overlay)
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
    // Decorations (clip to fairway)
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
    // Walls (rectangles)
    for (const w of walls) {
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
    // Tee marker (ball position)
    {
      const r = 6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(ball.x + 2, ball.y + 3, r * 0.9, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Cup marker (hole)
    {
      const r = (hole as any).r ?? 8;
      ctx.fillStyle = COLORS.holeFill;
      ctx.beginPath(); ctx.arc(hole.x, hole.y, r, 0, Math.PI*2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = COLORS.holeRim; ctx.stroke();
      ctx.fillStyle = COLORS.wallFill;
      const stickW = 3, stickH = 24;
      ctx.fillRect(hole.x - stickW/2, hole.y - stickH - r, stickW, stickH);
    }

    // Drag outline preview (rectangle tools)
    if (isEditorDragging && editorDragTool && (
      editorDragTool === 'wall' || editorDragTool === 'bridge' || editorDragTool === 'water' || editorDragTool === 'sand' || editorDragTool === 'hill'
    )) {
      const x0 = editorDragStart.x;
      const y0 = editorDragStart.y;
      const x1 = editorDragCurrent.x;
      const y1 = editorDragCurrent.y;
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0);
      const rh = Math.abs(y1 - y0);
      if (rw > 0 || rh > 0) {
        ctx.save();
        // Clip to fairway to respect clamping visuals
        ctx.beginPath(); ctx.rect(fairX, fairY, fairW, fairH); ctx.clip();
        // Subtle translucent fill to preview area; color hint by tool
        const tool = editorDragTool;
        if (tool === 'water') {
          ctx.globalAlpha = 0.35; ctx.fillStyle = COLORS.waterFill; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        } else if (tool === 'sand') {
          ctx.globalAlpha = 0.35; ctx.fillStyle = COLORS.sandFill; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        } else if (tool === 'bridge') {
          ctx.globalAlpha = 0.20; ctx.fillStyle = COLORS.fairway; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        } else if (tool === 'wall') {
          ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff'; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        } else /* hill */ {
          ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff'; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
        }
        // Dashed outline border for clarity
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Selection Tool visuals
    if (selectedEditorTool === 'select') {
      // Draw selection outlines for selected objects
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00aaff';
      
      for (const obj of selectedObjects) {
        const bounds = getObjectBounds(obj);
        // Draw selection outline with movement offset if dragging
        const offsetX = isDragMoving ? dragMoveOffset.x : 0;
        const offsetY = isDragMoving ? dragMoveOffset.y : 0;
        const displayBounds = { 
          x: bounds.x + offsetX, 
          y: bounds.y + offsetY, 
          w: bounds.w, 
          h: bounds.h 
        };
        
        // If resizing, show the updated bounds instead
        if (isResizing && resizeStartBounds && resizeStartMouse && selectedObjects.length === 1 && selectedObjects[0] === obj) {
          // Use the real-time resized bounds for visual feedback
          displayBounds.x = obj.object.x;
          displayBounds.y = obj.object.y;
          if ('w' in obj.object && 'h' in obj.object) {
            displayBounds.w = obj.object.w;
            displayBounds.h = obj.object.h;
          }
        }
        
        ctx.strokeRect(displayBounds.x, displayBounds.y, displayBounds.w, displayBounds.h);
        
        // Draw resize handles for single selection of resizable objects
        if (selectedObjects.length === 1 && obj === selectedObjects[0] && 
            (obj.type === 'wall' || obj.type === 'water' || obj.type === 'sand' || obj.type === 'bridge' || obj.type === 'hill')) {
          const handles = getResizeHandles(displayBounds);
          ctx.setLineDash([]);
          
          for (const handle of handles) {
            // Handle background
            ctx.fillStyle = '#00aaff';
            ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
            
            // Handle border
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
          }
          
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#00aaff';
        } else {
          // For multi-selection or non-resizable objects, just show corner indicators
          const handleSize = 6;
          ctx.setLineDash([]);
          ctx.fillStyle = '#00aaff';
          const corners = [
            { x: displayBounds.x - handleSize/2, y: displayBounds.y - handleSize/2 },
            { x: displayBounds.x + displayBounds.w - handleSize/2, y: displayBounds.y - handleSize/2 },
            { x: displayBounds.x - handleSize/2, y: displayBounds.y + displayBounds.h - handleSize/2 },
            { x: displayBounds.x + displayBounds.w - handleSize/2, y: displayBounds.y + displayBounds.h - handleSize/2 }
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
      
      // Draw selection box if dragging
      if (isSelectionDragging && selectionBoxStart) {
        const boxX = Math.min(selectionBoxStart.x, selectionBoxStart.x + dragMoveOffset.x);
        const boxY = Math.min(selectionBoxStart.y, selectionBoxStart.y + dragMoveOffset.y);
        const boxW = Math.abs(dragMoveOffset.x);
        const boxH = Math.abs(dragMoveOffset.y);
        
        // Selection box background
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = '#00aaff';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.globalAlpha = 1;
        
        // Selection box outline
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#00aaff';
        ctx.strokeRect(boxX, boxY, boxW, boxH);
      }
      
      ctx.restore();
    }

    // Menubar (drawn last over preview)
    {
      const menubarX = 0;
      const menubarY = 0;
      const menubarW = WIDTH;
      const menubarH = 28;
      
      // Menubar background
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(menubarX, menubarY, menubarW, menubarH);
      ctx.strokeStyle = '#cfd2cf';
      ctx.lineWidth = 1;
      ctx.strokeRect(menubarX, menubarY, menubarW, menubarH - 1);
      
      // Menu headers
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      
      const menuIds: EditorMenuId[] = ['file', 'objects', 'decorations', 'tools'];
      let x = 8;
      const y = menubarH / 2;
      
      for (const menuId of menuIds) {
        const menu = EDITOR_MENUS[menuId];
        const textW = ctx.measureText(menu.title).width;
        const menuW = textW + 16;
        
        const isOpen = openEditorMenu === menuId;
        ctx.fillStyle = isOpen ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)';
        ctx.fillRect(x, 2, menuW, menubarH - 4);
        
        if (isOpen) {
          ctx.strokeStyle = '#ffffff';
          ctx.strokeRect(x, 2, menuW, menubarH - 4);
        }
        
        ctx.fillStyle = '#ffffff';
        ctx.fillText(menu.title, x + 8, y);
        
        editorUiHotspots.push({ kind: 'menu', menu: menuId, x, y: 0, w: menuW, h: menubarH });
        x += menuW;
      }
      
      // Dropdown menus
      if (openEditorMenu) {
        const menu = EDITOR_MENUS[openEditorMenu];
        
        // Find the header position for this menu
        let headerX = 8;
        for (const menuId of menuIds) {
          if (menuId === openEditorMenu) break;
          const m = EDITOR_MENUS[menuId];
          const textW = ctx.measureText(m.title).width;
          headerX += textW + 16;
        }
        
        // Calculate dropdown dimensions
        let maxWidth = 0;
        for (const item of menu.items) {
          const w = ctx.measureText(item.label).width;
          if (w > maxWidth) maxWidth = w;
        }
        const dropdownW = Math.max(120, maxWidth + 24);
        const itemH = 22;
        const dropdownH = menu.items.length * itemH + 4;
        const dropdownX = headerX;
        const dropdownY = menubarH;
        
        // Dropdown background
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(dropdownX, dropdownY, dropdownW, dropdownH);
        ctx.strokeStyle = '#cfd2cf';
        ctx.lineWidth = 1;
        ctx.strokeRect(dropdownX, dropdownY, dropdownW, dropdownH);
        
        // Menu items
        let itemY = dropdownY + 2;
        for (let i = 0; i < menu.items.length; i++) {
          const menuItem = menu.items[i];
          const isActive = i === editorMenuActiveItemIndex;
          const isSelected = (() => {
            if (menuItem.item.kind === 'tool') return selectedEditorTool === menuItem.item.tool;
            return false;
          })();
          
          // Item background
          if (isActive || isSelected) {
            ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)';
            ctx.fillRect(dropdownX + 1, itemY, dropdownW - 2, itemH);
          }
          
          // Separator line
          if (menuItem.separator && i > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(dropdownX + 6, itemY - 1);
            ctx.lineTo(dropdownX + dropdownW - 6, itemY - 1);
            ctx.stroke();
          }
          
          // Item text
          ctx.fillStyle = '#ffffff';
          ctx.fillText(menuItem.label, dropdownX + 8, itemY + itemH / 2);
          
          // Add hotspot for menu item
          editorUiHotspots.push({
            kind: 'menuItem',
            menu: openEditorMenu,
            item: menuItem.item,
            x: dropdownX,
            y: itemY,
            w: dropdownW,
            h: itemH
          });
          
          itemY += itemH;
        }
      }

      // Version bottom-left
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
    }
    return;
  }
  // Users admin screen
  if (gameState === 'users') {
    usersUiHotspots = [];
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Users (Admin)', WIDTH/2, 60);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '14px system-ui, sans-serif';
    // Active profile info
    const activeName = (userProfile.name || '').trim() || '(unnamed)';
    ctx.fillText(`Active: ${activeName} (${userProfile.role})`, WIDTH/2 - 220, 96);
    // Top action buttons
    const topY = 120;
    const btnW = 120, btnH = 26, gap = 12;
    let bx = WIDTH/2 - (btnW*4 + gap*3)/2;
    function drawTopBtn(label: string, kind: UsersHotspot['kind']) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#cfd2cf';
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(bx, topY, btnW, btnH); ctx.strokeRect(bx, topY, btnW, btnH);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + btnW/2, topY + btnH/2 + 0.5);
      usersUiHotspots.push({ kind, x: bx, y: topY, w: btnW, h: btnH });
      bx += btnW + gap;
    }
    drawTopBtn('Add User', 'addUser');
    drawTopBtn('Add Admin', 'addAdmin');
    drawTopBtn('Export JSON', 'export');
    drawTopBtn('Import JSON', 'import');

    // Table header
    const tableX = WIDTH/2 - 340;
    const tableY = topY + 46;
    const rowH = 28;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Name', tableX + 10, tableY);
    ctx.fillText('Role', tableX + 250, tableY);
    ctx.fillText('Enabled', tableX + 330, tableY);
    ctx.fillText('Actions', tableX + 430, tableY);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.moveTo(tableX, tableY + 10); ctx.lineTo(tableX + 680, tableY + 10); ctx.stroke();

    // Rows
    const list = usersStoreReady ? usersStore.getAll() : [];
    let ry = tableY + 26;
    const actionW = 86, actionH = 22, actionGap = 8;
    for (const u of list) {
      // name and meta
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(u.name, tableX + 10, ry);
      ctx.fillText(u.role, tableX + 250, ry);
      ctx.fillText(u.enabled ? 'Yes' : 'No', tableX + 330, ry);
      // actions: promote/demote, enable/disable, remove
      let ax = tableX + 430;
      function drawRowBtn(label: string, kind: UsersHotspot['kind'], id: string) {
        ctx.lineWidth = 1.2; ctx.strokeStyle = '#cfd2cf'; ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(ax, ry - actionH/2, actionW, actionH); ctx.strokeRect(ax, ry - actionH/2, actionW, actionH);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(label, ax + actionW/2, ry + 0.5);
        usersUiHotspots.push({ kind, id, x: ax, y: ry - actionH/2, w: actionW, h: actionH });
        ax += actionW + actionGap;
      }
      if (u.role === 'admin') drawRowBtn('Demote', 'demote', u.id); else drawRowBtn('Promote', 'promote', u.id);
      if (u.enabled) drawRowBtn('Disable', 'disable', u.id); else drawRowBtn('Enable', 'enable', u.id);
      drawRowBtn('Remove', 'remove', u.id);
      ry += rowH;
    }

    // Back button
    const back = getCourseBackRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#cfd2cf';
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(back.x, back.y, back.w, back.h);
    ctx.strokeRect(back.x, back.y, back.w, back.h);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Back', back.x + back.w/2, back.y + back.h/2 + 0.5);
    usersUiHotspots.push({ kind: 'back', x: back.x, y: back.y, w: back.w, h: back.h });
    // Version
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`v${APP_VERSION}`, 12, HEIGHT - 12);
    return;
  }
  // Course Select screen
  if (gameState === 'course') {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('Select Course', WIDTH/2, 60);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Dev Levels (test course)', WIDTH/2, 86);
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

  // walls (beveled look: shadow + face + highlight)
  for (const w of walls) {
    // drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(w.x + 2, w.y + 2, w.w, w.h);
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

  // polygon walls (render simple beveled stroke)
  ctx.lineWidth = 2;
  for (const poly of polyWalls) {
    const pts = poly.points;
    if (!pts || pts.length < 6) continue;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(pts[0] + 2, pts[1] + 2);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + 2, pts[i + 1] + 2);
    ctx.closePath();
    ctx.fill();
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

  // round posts (pillars)
  for (const p of posts) {
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(p.x + 2, p.y + 2, p.r, 0, Math.PI * 2); ctx.fill();
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
  const bestScore = currentLevelIndex < levelPaths.length ? getBestScore(levelPaths[currentLevelIndex]) : null;
  const bestText = bestScore !== null ? `   Best: ${bestScore}` : '';
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
}

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
  sandsPoly = lvl.sandPoly ?? [];
  waters = lvl.water ?? [];
  watersPoly = lvl.waterPoly ?? [];
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
  currentLevelIndex = Math.max(0, levelPaths.indexOf(path));
  // record par for this hole so summary can show deltas
  coursePars[currentLevelIndex] = lvl.par;
  preShot = { x: ball.x, y: ball.y };
  if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
  // Preload the subsequent level to avoid first-transition delay
  preloadLevelByIndex(currentLevelIndex + 1);

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
  try {
    const res = await fetch('/levels/course.json');
    if (res.ok) {
      const data = (await res.json()) as { levels: string[] };
      if (Array.isArray(data.levels) && data.levels.length > 0) {
        levelPaths = data.levels;
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
  if (gameState === 'changelog') {
    if (e.code === 'ArrowDown' || e.code === 'PageDown') { changelogScrollY += (e.code === 'PageDown' ? 200 : 40); clampChangelogScroll(); }
    if (e.code === 'ArrowUp' || e.code === 'PageUp') { changelogScrollY -= (e.code === 'PageUp' ? 200 : 40); clampChangelogScroll(); }
    if (e.code === 'Home') { changelogScrollY = 0; }
    if (e.code === 'End') { const r = getChangelogContentRect(); changelogScrollY = Math.max(0, changelogLines.length * 20 - r.h); }
  }
  if (e.code === 'Space' && gameState === 'sunk') {
    // Restart current hole immediately (snappy)
    loadLevelByIndex(currentLevelIndex).catch(console.error);
  } else if (e.code === 'KeyR') {
    loadLevelByIndex(currentLevelIndex).catch(console.error);
  } else if (e.code === 'KeyN') {
    // Continue from sunk banner or during play
    if (gameState === 'sunk') {
      if (!holeRecorded) { courseScores[currentLevelIndex] = strokes; holeRecorded = true; }
      const isLastHole = courseInfo.index >= courseInfo.total;
      if (isLastHole) {
        if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
        // Only show summary when on last hole
        gameState = 'summary';
      } else {
        const next = currentLevelIndex + 1;
        preloadLevelByIndex(next + 1);
        currentLevelIndex = next;
        loadLevelByIndex(currentLevelIndex).catch(console.error);
      }
    } else if (gameState === 'play') {
      // Ignore N during play to avoid accidental hole skip triggering summary logic
    }
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (gameState === 'play' || gameState === 'sunk') {
    paused = !paused;
    } else if (gameState === 'options') {
      // Return to previous state (pause or menu) from Options
      if (paused && (previousGameState === 'play' || previousGameState === 'sunk')) {
        gameState = previousGameState;
      } else {
        gameState = 'menu';
      }
    }
  } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && gameState === 'summary') {
    // restart course (keyboard)
    courseScores = [];
    currentLevelIndex = 0;
    gameState = 'play';
    loadLevelByIndex(currentLevelIndex).catch(console.error);
  } else if ((e.code === 'Escape' || e.code === 'KeyM') && gameState === 'summary') {
    // go back to main menu from summary
    gameState = 'menu';
  }
});
