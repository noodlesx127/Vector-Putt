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
let gameState: 'play' | 'sunk' | 'summary' = 'play';
let levelPaths = ['/levels/level1.json', '/levels/level2.json', '/levels/level3.json'];
let currentLevelIndex = 0;
let paused = false;
const APP_VERSION = '0.2.0';
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
  hudText: '#ffffff',
  hudBg: '#0d1f10'       // solid dark strip for HUD
} as const;
const COURSE_MARGIN = 40; // inset for fairway rect
const HUD_HEIGHT = 32;
const SLOPE_ACCEL = 600; // base acceleration applied by hills (px/s^2)
const levelCache = new Map<string, Level>();

type Wall = { x: number; y: number; w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };
type Decoration = { x: number; y: number; w: number; h: number; kind: 'flowers' };
type Slope = { x: number; y: number; w: number; h: number; dir: 'N'|'S'|'E'|'W'|'NE'|'NW'|'SE'|'SW'; strength?: number };
type Level = {
  canvas: { width: number; height: number };
  course: { index: number; total: number; title?: string };
  par: number;
  tee: { x: number; y: number };
  cup: { x: number; y: number; r: number };
  walls: Wall[];
  sand?: Rect[];
  water?: Rect[];
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
let waters: Rect[] = [];
let decorations: Decoration[] = [];
let hills: Slope[] = [];
let courseInfo: { index: number; total: number; par: number; title?: string } = { index: 1, total: 1, par: 3 };
let strokes = 0;
let preShot = { x: 0, y: 0 }; // position before current shot, for water reset
let courseScores: number[] = []; // strokes per completed hole
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
  const y = HEIGHT - 60;
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
let hoverMenu = false;
let hoverPauseReplay = false;
let hoverPauseClose = false;
let transitioning = false; // prevent double-advance while changing holes
let lastAdvanceFromSunkMs = 0; // used to swallow trailing click after mousedown
const CLICK_SWALLOW_MS = 180; // shorten delay for snappier feel

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

function worldFromEvent(e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  // Use rect size to derive scale; robust to any CSS transform/zoom
  const scaleX = rect.width / WIDTH;
  const scaleY = rect.height / HEIGHT;
  const x = (e.clientX - rect.left) / scaleX;
  const y = (e.clientY - rect.top) / scaleY;
  return { x, y };
}

canvas.addEventListener('mousedown', (e) => {
  const p = worldFromEvent(e);
  // Handle HUD Menu button first (toggles pause)
  if (!paused) {
    const r = getMenuRect();
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      paused = !paused;
      return;
    }
  }
  // Click-to-continue via mousedown for immediate feedback
  if (!paused && gameState === 'sunk') { advanceAfterSunk(); return; }
  // If on summary screen, clicking restarts the course
  if (!paused && gameState === 'summary') {
    courseScores = [];
    currentLevelIndex = 0;
    gameState = 'play';
    loadLevelByIndex(currentLevelIndex).catch(console.error);
    return;
  }
  if (paused || gameState !== 'play') return; // disable while paused or not in play state
  if (ball.moving) return;
  const dx = p.x - ball.x;
  const dy = p.y - ball.y;
  const dist2 = dx * dx + dy * dy;
  if (dist2 <= (ball.r + 4) * (ball.r + 4)) {
    isAiming = true;
    aimStart = { x: ball.x, y: ball.y };
    aimCurrent = p;
  }
});

canvas.addEventListener('mousemove', (e) => {
  const p = worldFromEvent(e);
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
  aimCurrent = p;
});

canvas.addEventListener('mouseup', (e) => {
  if (!isAiming || paused || gameState !== 'play') return;
  const p = worldFromEvent(e);
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
canvas.addEventListener('click', () => {
  if (paused) return;
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
    // Restart course
    courseScores = [];
    currentLevelIndex = 0;
    gameState = 'play';
    preloadLevelByIndex(1);
    loadLevelByIndex(currentLevelIndex).catch(console.error);
  }
});

// Hover handling for Pause overlay buttons
canvas.addEventListener('mousemove', (e) => {
  if (!paused) return;
  const p = worldFromEvent(e);
  const pr = getPauseReplayRect();
  const overReplay = p.x >= pr.x && p.x <= pr.x + pr.w && p.y >= pr.y && p.y <= pr.y + pr.h;
  const pc = getPauseCloseRect();
  const overClose = p.x >= pc.x && p.x <= pc.x + pc.w && p.y >= pc.y && p.y <= pc.y + pc.h;
  hoverPauseReplay = overReplay;
  hoverPauseClose = overClose;
  canvas.style.cursor = (overReplay || overClose) ? 'pointer' : 'default';
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

function update(dt: number) {
  if (paused) return; // freeze simulation
  if (ball.moving && gameState === 'play') {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // friction (boosted in sand)
    let inSand = false;
    for (const s of sands) { if (pointInRect(ball.x, ball.y, s)) { inSand = true; break; } }
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
        const dx = (d.includes('E') ? 1 : 0) + (d.includes('W') ? -1 : 0);
        const dy = (d.includes('S') ? 1 : 0) + (d.includes('N') ? -1 : 0);
        // normalize diagonal so total accel magnitude stays consistent
        const inv = (dx !== 0 && dy !== 0) ? Math.SQRT1_2 : 1;
        ax += dx * s * inv;
        ay += dy * s * inv;
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

  // Water OOB: if ball center is inside any water rect, apply penalty and reset
  for (const w of waters) {
    if (pointInRect(ball.x, ball.y, w)) {
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
  if (!paused && dist < capture) {
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
  // fairway area
  ctx.fillStyle = COLORS.fairway;
  ctx.fillRect(COURSE_MARGIN, COURSE_MARGIN, WIDTH - COURSE_MARGIN * 2, HEIGHT - COURSE_MARGIN * 2);
  // subtle horizontal shading band
  ctx.fillStyle = COLORS.fairwayBand;
  const bandH = Math.floor((HEIGHT - COURSE_MARGIN * 2) * 0.22);
  ctx.fillRect(COURSE_MARGIN, COURSE_MARGIN + bandH, WIDTH - COURSE_MARGIN * 2, bandH);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.fairwayLine;
  ctx.strokeRect(COURSE_MARGIN + 1, COURSE_MARGIN + 1, WIDTH - COURSE_MARGIN * 2 - 2, HEIGHT - COURSE_MARGIN * 2 - 2);

  // terrain zones (draw before walls)
  for (const r of waters) {
    ctx.fillStyle = '#1f6dff';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  for (const r of sands) {
    ctx.fillStyle = '#d4b36a';
    ctx.fillRect(r.x, r.y, r.w, r.h);
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

  // decorations (non-colliding visuals) — clip to avoid drawing under HUD bar
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HUD_HEIGHT, WIDTH, HEIGHT - HUD_HEIGHT);
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

  // walls
  ctx.fillStyle = COLORS.wallFill;
  ctx.strokeStyle = COLORS.wallStroke;
  for (const w of walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeRect(w.x, w.y, w.w, w.h);
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

  // HUD (single row across the top)
  // background strip to avoid visual clutter from decorations
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(0, 0, WIDTH, HUD_HEIGHT);
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
    ctx.font = '16px system-ui, sans-serif';
    let y = 80;
    for (let i = 0; i < levelPaths.length; i++) {
      const s = courseScores[i] ?? 0;
      const line = `Hole ${i+1}: ${s} strokes`;
      ctx.fillText(line, WIDTH/2, y);
      y += 22;
    }
    y += 10;
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(`Total: ${total}`, WIDTH/2, y);
    y += 28;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Click or Press Enter to Restart Game', WIDTH/2, y);
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
      `Version: ${APP_VERSION}`,
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
  walls = lvl.walls ?? [];
  sands = lvl.sand ?? [];
  waters = lvl.water ?? [];
  decorations = lvl.decorations ?? [];
  hills = lvl.hills ?? [];
  ball.x = lvl.tee.x; ball.y = lvl.tee.y; ball.vx = 0; ball.vy = 0; ball.moving = false;
  hole.x = lvl.cup.x; hole.y = lvl.cup.y; (hole as any).r = lvl.cup.r;
  strokes = 0;
  gameState = 'play';
  currentLevelIndex = Math.max(0, levelPaths.indexOf(path));
  preShot = { x: ball.x, y: ball.y };
  if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }

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
  await loadLevelByIndex(0);
}
boot().catch(console.error);

// Restart flow after sink
window.addEventListener('keydown', (e) => {
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
    paused = !paused;
  } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && gameState === 'summary') {
    // restart course (keyboard)
    courseScores = [];
    currentLevelIndex = 0;
    gameState = 'play';
    loadLevelByIndex(currentLevelIndex).catch(console.error);
  }
});
