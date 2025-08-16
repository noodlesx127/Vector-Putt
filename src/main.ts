import CHANGELOG_RAW from '../CHANGELOG.md?raw';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Fixed logical size
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

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

// Game state
let lastTime = performance.now();
let gameState: 'menu' | 'course' | 'options' | 'changelog' | 'loading' | 'play' | 'sunk' | 'summary' = 'menu';
let levelPaths = ['/levels/level1.json', '/levels/level2.json', '/levels/level3.json'];
let currentLevelIndex = 0;
let paused = false;
const APP_VERSION = '0.3.7';
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
  hudBg: '#0d1f10'
} as const;
const COURSE_MARGIN = 40; // inset for fairway rect
const HUD_HEIGHT = 32;
const SLOPE_ACCEL = 520; // tuned base acceleration applied by hills (px/s^2)
const levelCache = new Map<string, Level>();

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
  bridges?: Rect[];
  posts?: Circle[];
  wallsPoly?: Poly[];
  decorations?: Decoration[];
  hills?: Slope[];
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
let bridges: Rect[] = [];
let posts: Circle[] = [];
let polyWalls: Poly[] = [];
let decorations: Decoration[] = [];
let hills: Slope[] = [];
// Logical level canvas size from level JSON; defaults to actual canvas size
let levelCanvas = { width: WIDTH, height: HEIGHT };

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

// Aim state
let isAiming = false;
let aimStart = { x: 0, y: 0 };
let aimCurrent = { x: 0, y: 0 };

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
let hoverMenu = false;
let hoverPauseReplay = false;
let hoverPauseClose = false;
let hoverPauseBack = false;
let hoverMainStart = false;
let hoverMainOptions = false;
let hoverMainChangelog = false;
let hoverCourseDev = false;
let hoverCourseBack = false;
let hoverChangelogBack = false;
let hoverSummaryBack = false;
let hoverOptionsBack = false;
let transitioning = false; // prevent double-advance while changing holes
let lastAdvanceFromSunkMs = 0; // used to swallow trailing click after mousedown
const CLICK_SWALLOW_MS = 180; // shorten delay for snappier feel

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
  const y = HEIGHT / 2 - 10;
  return { x, y, w, h };
}
function getMainOptionsRect() {
  const w = 160, h = 36;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT / 2 + 40;
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
  const p = worldFromEvent(e); // canvas coords
  // Handle Main Menu buttons
  if (gameState === 'menu') {
    const s = getMainStartRect();
    if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
      // Go to Course Select
      gameState = 'course';
      return;
    }
    const o = getMainOptionsRect();
    if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h) {
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
  // Handle Options Back button
  if (gameState === 'options') {
    const back = getCourseBackRect();
    if (p.x >= back.x && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h) {
      gameState = 'menu';
      return;
    }
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
    const o = getMainOptionsRect();
    hoverMainStart = p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
    hoverMainOptions = p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h;
    const cg = getMainChangelogRect();
    hoverMainChangelog = p.x >= cg.x && p.x <= cg.x + cg.w && p.y >= cg.y && p.y <= cg.y + cg.h;
    canvas.style.cursor = (hoverMainStart || hoverMainOptions || hoverMainChangelog) ? 'pointer' : 'default';
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
    canvas.style.cursor = hoverOptionsBack ? 'pointer' : 'default';
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
  hoverPauseReplay = overReplay;
  hoverPauseClose = overClose;
  hoverPauseBack = overBack;
  canvas.style.cursor = (overReplay || overClose || overBack) ? 'pointer' : 'default';
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
  for (const w of waters) {
      if (!pointInRect(ball.x, ball.y, w)) continue;
      let onBridge = false;
      for (const b of bridges) { if (pointInRect(ball.x, ball.y, b)) { onBridge = true; break; } }
      if (onBridge) continue;
      // penalty is +1 stroke; reset to pre-shot position
      strokes += 1;
      ball.x = preShot.x; ball.y = preShot.y;
      ball.vx = 0; ball.vy = 0; ball.moving = false;
      break;
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
    if (gameState !== 'sunk' && gameState !== 'summary') {
      const isLastHole = courseInfo.index >= courseInfo.total;
      // Always show sunk banner first
      gameState = 'sunk';
      holeRecorded = false;
      if (isLastHole) {
        // record now; stay on sunk banner until user clicks or presses N
        courseScores[currentLevelIndex] = strokes;
        holeRecorded = true;
        if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
      }
    }
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
    // Buttons
    const s = getMainStartRect();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hoverMainStart ? '#ffffff' : '#cfd2cf';
    ctx.fillStyle = hoverMainStart ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Start', s.x + s.w/2, s.y + s.h/2 + 0.5);
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
    ctx.fillText('Back', back.x + back.w/2, back.y + back.h/2 + 0.5);
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
    ctx.fillStyle = '#1f6dff';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  for (const r of sands) {
    ctx.fillStyle = '#d4b36a';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  // polygon sand
  if (sandsPoly.length > 0) {
    ctx.fillStyle = '#d4b36a';
    for (const sp of sandsPoly) {
      const pts = sp.points;
      if (!pts || pts.length < 6) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fill();
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

  if (isAiming) drawAim();
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
  const centerText = `Par ${courseInfo.par}   Strokes ${strokes}   Total ${totalSoFar}`;
  const rightText = `To Birdie: ${toBirdie === null ? '—' : toBirdie}   Speed ${speed}`;
  // left
  ctx.textAlign = 'left';
  ctx.fillText(leftText, rrHUD.x + rrHUD.w + 12, 6);
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

  // Post-hole banner
  if (gameState === 'sunk') {
    const label = (() => {
      const diff = strokes - courseInfo.par;
      if (diff <= -2) return 'Eagle';
      if (diff === -1) return 'Birdie';
      if (diff === 0) return 'Par';
      if (diff === 1) return 'Bogey';
      return `${diff} Over`;
    })();
    const text = `${label}!  Strokes ${strokes}  (Par ${courseInfo.par})`;
    ctx.font = '28px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, HEIGHT/2 - 40, WIDTH, 80);
    ctx.fillStyle = '#ffffff';
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
      ctx.fillText(line, WIDTH/2, y);
      y += 22;
    }
    y += 10;
    ctx.font = '18px system-ui, sans-serif';
    const totalDeltaText = totalDelta === 0 ? 'E' : (totalDelta > 0 ? `+${totalDelta}` : `${totalDelta}`);
    ctx.fillText(`Total: ${total} (Par ${parTotal}, ${totalDeltaText})`, WIDTH/2, y);
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
      gameState = 'menu';
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
