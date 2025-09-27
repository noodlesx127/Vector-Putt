// Level heuristics: grid build + A* path and par estimation
// This module is intentionally dependency-light and does not import editor types
// to avoid runtime cycles. It accepts a generic Level-like object.

export type Rect = { x: number; y: number; w: number; h: number };
export type Poly = { points: number[] };

export type Fairway = { x: number; y: number; w: number; h: number };

export type LevelLike = {
  tee: { x: number; y: number };
  cup: { x: number; y: number; r?: number };
  walls?: Rect[];
  wallsPoly?: Poly[];
  water?: Rect[];
  waterPoly?: Poly[];
  sand?: Rect[];
  sandPoly?: Poly[];
  hills?: Array<{ x: number; y: number; w: number; h: number; dir?: string; strength?: number; falloff?: number }>;
  bridges?: Rect[];
  posts?: Array<{ x: number; y: number; r: number }>; // NEW: treat posts as blockers
};

type GridCell = {
  cost: number;
  blocked: boolean;
  // Optional terrain annotations for more accurate path costs
  isSand?: boolean;
  // Hill vector field (downhill direction, unit-ish) and strength (0..~2)
  hillVX?: number;
  hillVY?: number;
  hillStrength?: number;
};

function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// Debug helper for editor: compute world-space path and simple terrain tags for path cells
export type PathDebug = {
  found: boolean;
  pathCells: Array<{ c: number; r: number }>; // grid cells
  worldPoints: Array<{ x: number; y: number }>; // polyline through cell centers
  cellSize: number;
  cols: number;
  rows: number;
  sandAt: Array<boolean>; // parallel to pathCells
  hillAt: Array<boolean>; // parallel to pathCells
};

export function computePathDebug(
  level: LevelLike,
  fairway: Fairway,
  cellSize: number
): PathDebug {
  const { grid, cols, rows } = buildGrid(level, fairway, cellSize);
  const toCell = (x: number, y: number) => ({ c: clamp(Math.floor((x - fairway.x) / cellSize), 0, cols - 1), r: clamp(Math.floor((y - fairway.y) / cellSize), 0, rows - 1) });
  const toWorld = (c: number, r: number) => ({ x: fairway.x + c * cellSize + cellSize / 2, y: fairway.y + r * cellSize + cellSize / 2 });

  const start = toCell(level.tee.x, level.tee.y);
  const goal = toCell(level.cup.x, level.cup.y);
  const { found, path } = aStar(grid, cols, rows, start, goal);
  if (!found) {
    return { found: false, pathCells: [], worldPoints: [], cellSize, cols, rows, sandAt: [], hillAt: [] };
  }

  const sands = level.sand || [];
  const sandsPoly = level.sandPoly || [];
  const hills = level.hills || [];

  const pointInRectLocal = (px: number, py: number, r: Rect) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

  const worldPoints: Array<{ x: number; y: number }> = [];
  const sandAt: boolean[] = [];
  const hillAt: boolean[] = [];
  for (const p of path) {
    const w = toWorld(p.c, p.r);
    worldPoints.push(w);
    // classify terrain for this cell center
    let inSand = false;
    for (const s of sands) { if (pointInRectLocal(w.x, w.y, s)) { inSand = true; break; } }
    if (!inSand) for (const sp of sandsPoly) { if (pointInPoly(w.x, w.y, sp.points)) { inSand = true; break; } }
    let inHill = false;
    for (const h of hills) { if (pointInRectLocal(w.x, w.y, h as any)) { inHill = true; break; } }
    sandAt.push(inSand);
    hillAt.push(inHill);
  }

  return { found: true, pathCells: path, worldPoints, cellSize, cols, rows, sandAt, hillAt };
}

export function suggestCupPositions(
  level: LevelLike,
  fairway: Fairway,
  cellSize: number,
  count = 5,
  opts?: {
    edgeMargin?: number;
    minStraightnessRatio?: number;
    minTurns?: number;
    minDistancePx?: number;
    // Additional constraints
    regionPoly?: number[]; // candidate cup must lie within this polygon (optional)
    // Scoring weights
    bankWeight?: number; // additional score per blocked neighbor along path (corridor/bank effect)
  }
): Array<{ x: number; y: number; score: number; lengthPx: number; turns: number }> {
  const { grid, cols, rows } = buildGrid(level, fairway, cellSize);
  const toCell = (x: number, y: number) => ({ c: clamp(Math.floor((x - fairway.x) / cellSize), 0, cols - 1), r: clamp(Math.floor((y - fairway.y) / cellSize), 0, rows - 1) });
  const toWorld = (c: number, r: number) => ({ x: fairway.x + c * cellSize + cellSize / 2, y: fairway.y + r * cellSize + cellSize / 2 });

  const start = toCell(level.tee.x, level.tee.y);

  const dxMax = Math.max(fairway.w, fairway.h);
  const minDist = opts?.minDistancePx ?? dxMax * 0.25; // ensure non-trivial distance
  const edgeMargin = opts?.edgeMargin ?? Math.max(20, Math.round(cellSize * 2));
  const minStraightness = opts?.minStraightnessRatio ?? 1.08; // must be > X times straight distance
  const minTurns = opts?.minTurns ?? 0; // at least this many turns (0 allows straight with obstacles)

  const candidates: Array<{ c: number; r: number; score: number; lengthPx: number; turns: number }> = [];

  const neighborBlockedCount = (c: number, r: number) => {
    let cnt = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (grid[nr][nc].blocked) cnt++;
      }
    }
    return cnt;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].blocked) continue;
      const w = toWorld(c, r);
      // avoid hugging edges
      if (
        w.x < fairway.x + edgeMargin ||
        w.x > fairway.x + fairway.w - edgeMargin ||
        w.y < fairway.y + edgeMargin ||
        w.y > fairway.y + fairway.h - edgeMargin
      ) continue;
      const dist = Math.hypot(w.x - level.tee.x, w.y - level.tee.y);
      if (dist < minDist) continue;
      const { found, path, lengthCost } = aStar(grid, cols, rows, start, { c, r });
      if (!found) continue;
      // basic path metrics
      let turns = 0;
      for (let i = 2; i < path.length; i++) {
        const a = path[i - 2], b = path[i - 1], d = path[i];
        const v1c = b.c - a.c, v1r = b.r - a.r;
        const v2c = d.c - b.c, v2r = d.r - b.r;
        if (v1c !== v2c || v1r !== v2r) turns++;
      }
      const lengthPx = lengthCost * cellSize;
      // reject trivial straight paths (length close to straight-line)
      if (lengthPx < dist * minStraightness) continue;
      if (turns < minTurns) continue;
      // optional region constraint
      if (opts?.regionPoly && !pointInPoly(w.x, w.y, opts.regionPoly)) continue;
      // corridor/bank scoring: reward paths that run near blocked cells (narrow corridors or banks)
      let bankAdj = 0;
      for (const p of path) bankAdj += neighborBlockedCount(p.c, p.r);
      const bankWeight = opts?.bankWeight ?? (cellSize * 0.5);
      // score favors longer, more-turn paths moderately (harder holes)
      const score = lengthPx + turns * (cellSize * 2) + bankAdj * bankWeight;
      candidates.push({ c, r, score, lengthPx, turns });
    }
  }

  // pick top N by score with spatial diversity (far from each other)
  candidates.sort((a, b) => b.score - a.score);
  const picked: Array<{ x: number; y: number; score: number; lengthPx: number; turns: number }> = [];
  const minSep = cellSize * 6;
  for (const cand of candidates) {
    const w = toWorld(cand.c, cand.r);
    if (picked.some(p => Math.hypot(p.x - w.x, p.y - w.y) < minSep)) continue;
    picked.push({ x: w.x, y: w.y, score: cand.score, lengthPx: cand.lengthPx, turns: cand.turns });
    if (picked.length >= count) break;
  }
  return picked;
}

// Lint the current cup placement; warn if the path trivially bypasses intended obstacles
export function lintCupPath(
  level: LevelLike,
  fairway: Fairway,
  cellSize: number
): string[] {
  const warnings: string[] = [];
  const { grid, cols, rows } = buildGrid(level, fairway, cellSize);
  const toCell = (x: number, y: number) => ({ c: clamp(Math.floor((x - fairway.x) / cellSize), 0, cols - 1), r: clamp(Math.floor((y - fairway.y) / cellSize), 0, rows - 1) });
  const start = toCell(level.tee.x, level.tee.y);
  const goal = toCell(level.cup.x, level.cup.y);
  const { found, path, lengthCost } = aStar(grid, cols, rows, start, goal);
  if (!found) {
    warnings.push('Cup is not reachable by A* path');
    return warnings;
  }
  // metrics
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const a = path[i - 2], b = path[i - 1], c = path[i];
    if ((b.c - a.c) !== (c.c - b.c) || (b.r - a.r) !== (c.r - b.r)) turns++;
  }
  const pathLengthPx = lengthCost * cellSize;
  const straight = Math.hypot(level.cup.x - level.tee.x, level.cup.y - level.tee.y);
  // neighbor blocked average (corridor indicator)
  const neighborBlockedCount = (c: number, r: number) => {
    let cnt = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (grid[nr][nc].blocked) cnt++;
      }
    }
    return cnt;
  };
  let blockedSum = 0;
  for (const p of path) blockedSum += neighborBlockedCount(p.c, p.r);
  const blockedAvg = blockedSum / Math.max(1, path.length);

  const obstacleCount = (level.walls?.length || 0) + (level.wallsPoly?.length || 0) + (level.water?.length || 0) + (level.waterPoly?.length || 0);
  // If there are obstacles but the path is nearly straight and not near obstacles, warn
  if (obstacleCount > 0 && turns <= 1 && pathLengthPx < straight * 1.08 && blockedAvg < 1.0) {
    warnings.push('Cup path appears to bypass obstacles (nearly straight, low corridor contact)');
  }
  // Edge proximity lint
  const edgeMargin = Math.max(2 * cellSize, 20);
  if (
    level.cup.x < fairway.x + edgeMargin ||
    level.cup.x > fairway.x + fairway.w - edgeMargin ||
    level.cup.y < fairway.y + edgeMargin ||
    level.cup.y > fairway.y + fairway.h - edgeMargin
  ) {
    warnings.push('Cup is very close to fairway edge');
  }
  return warnings;
}

function pointInPoly(px: number, py: number, pts: number[]): boolean {
  if (!pts || pts.length < 6) return false;
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1];
    const xj = pts[j * 2], yj = pts[j * 2 + 1];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-6) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

export function buildGrid(level: LevelLike, fairway: Fairway, cellSize: number): { grid: GridCell[][]; cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(fairway.w / cellSize));
  const rows = Math.max(1, Math.ceil(fairway.h / cellSize));
  const grid: GridCell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ cost: 1, blocked: false })));

  // helpers to map cell index to world center
  const cx = (c: number) => fairway.x + c * cellSize + cellSize / 2;
  const cy = (r: number) => fairway.y + r * cellSize + cellSize / 2;

  const walls = level.walls || [];
  const waters = level.water || [];
  const sands = level.sand || [];
  const wallsPoly = level.wallsPoly || [];
  const watersPoly = level.waterPoly || [];
  const sandsPoly = level.sandPoly || [];
  const hills = level.hills || [];
  const bridges = level.bridges || [];
  const posts = level.posts || [];
  // bridges are passable (unblock water/wall under a bridge)

  const dirToVec = (dir?: string): { x: number; y: number } => {
    switch ((dir || '').toUpperCase()) {
      case 'N': return { x: 0, y: -1 };
      case 'S': return { x: 0, y: 1 };
      case 'W': return { x: -1, y: 0 };
      case 'E': return { x: 1, y: 0 };
      case 'NW': return { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
      case 'NE': return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
      case 'SW': return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
      case 'SE': return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
      default: return { x: 0, y: 0 };
    }
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx(c), y = cy(r);
      // walls / water / posts are blocked
      let blocked = false;
      for (const w of walls) { if (pointInRect(x, y, w)) { blocked = true; break; } }
      if (!blocked) for (const wp of wallsPoly) { if (pointInPoly(x, y, wp.points)) { blocked = true; break; } }
      if (!blocked) for (const w of waters) { if (pointInRect(x, y, w)) { blocked = true; break; } }
      if (!blocked) for (const wp of watersPoly) { if (pointInPoly(x, y, wp.points)) { blocked = true; break; } }
      // Posts: treat as circular blockers with safety clearance (~ball radius + a little)
      if (!blocked && posts.length > 0) {
        const CLEAR = Math.max(6, Math.round(cellSize * 0.4));
        for (const p of posts) { if (Math.hypot(x - p.x, y - p.y) <= (p.r || 8) + CLEAR) { blocked = true; break; } }
      }
      // Bridge overrides: if a bridge covers this point, it's passable
      if (blocked) {
        for (const b of bridges) { if (pointInRect(x, y, b)) { blocked = false; break; } }
      }

      // sand is higher cost but not blocked; hills are a mild extra cost to reflect difficulty
      let cost = 1;
      let isSand = false;
      let hillVX = 0, hillVY = 0, hillStrength = 0;
      if (!blocked) {
        for (const s of sands) { if (pointInRect(x, y, s)) { cost = Math.max(cost, 3); isSand = true; break; } }
        if (!isSand) for (const sp of sandsPoly) { if (pointInPoly(x, y, sp.points)) { cost = Math.max(cost, 3); isSand = true; break; } }
        // hills: accumulate downhill vector and strength; directional penalty applied during A*
        for (const h of hills) {
          if (pointInRect(x, y, h as any)) {
            const v = dirToVec((h as any).dir);
            const s = Math.max(0.2, Math.min(2, (h as any).strength ?? 1));
            hillVX += v.x * s; hillVY += v.y * s; hillStrength = Math.max(hillStrength, s);
          }
        }
        // small base cost bump for hills (regardless of direction), softer than sand
        if ((hillVX !== 0 || hillVY !== 0) && cost <= 1) cost = 1.25;
      }

      const cell: GridCell = { cost, blocked };
      if (isSand) cell.isSand = true;
      if (hillVX !== 0 || hillVY !== 0) {
        // normalize vector to ~unit length
        const mag = Math.hypot(hillVX, hillVY) || 1;
        cell.hillVX = hillVX / mag;
        cell.hillVY = hillVY / mag;
        cell.hillStrength = Math.min(1.5, hillStrength);
      }

      grid[r][c] = cell;
    }
  }

  return { grid, cols, rows };
}

// A* pathfinding on 8-connected grid
export function aStar(
  grid: GridCell[][],
  cols: number,
  rows: number,
  start: { c: number; r: number },
  goal: { c: number; r: number },
  opts?: AStarOptions
): { found: boolean; path: Array<{ c: number; r: number }>; lengthCost: number } {
  const came: Record<string, string | undefined> = {};
  const gScore: Record<string, number> = { [nodeKey(start.c, start.r)]: 0 };
  const bannedNodes = opts?.bannedNodes;
  const bannedEdges = opts?.bannedEdges;

  const dirs = [
    { dc: 1, dr: 0, w: 1 }, { dc: -1, dr: 0, w: 1 }, { dc: 0, dr: 1, w: 1 }, { dc: 0, dr: -1, w: 1 },
    { dc: 1, dr: 1, w: Math.SQRT2 }, { dc: 1, dr: -1, w: Math.SQRT2 }, { dc: -1, dr: 1, w: Math.SQRT2 }, { dc: -1, dr: -1, w: Math.SQRT2 }
  ];

  // Simple array-based open set (small grid); linear scans acceptable here
  const openSet: Array<{ c: number; r: number; f: number }> = [{ c: start.c, r: start.r, f: 0 }];

  const h = (c: number, r: number) => {
    const dc = Math.abs(c - goal.c);
    const dr = Math.abs(r - goal.r);
    return (Math.max(dc, dr) - Math.min(dc, dr)) + Math.min(dc, dr) * Math.SQRT2; // octile
  };

  while (openSet.length > 0) {
    // pick lowest f
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
    const current = openSet.splice(bestIdx, 1)[0];
    const ck = nodeKey(current.c, current.r);

    if (bannedNodes && bannedNodes.has(ck)) {
      continue;
    }

    if (current.c === goal.c && current.r === goal.r) {
      // reconstruct
      const path: Array<{ c: number; r: number }> = [];
      let k: string | undefined = ck;
      while (k) {
        const [cc, rr] = k.split(',').map(Number);
        path.push({ c: cc, r: rr });
        k = came[k];
      }
      path.reverse();
      // compute path cost length
      let lengthCost = 0;
      for (let i = 1; i < path.length; i++) {
        const p = path[i - 1], q = path[i];
        const diag = (p.c !== q.c) && (p.r !== q.r);
        const step = diag ? Math.SQRT2 : 1;
        const gc = grid[q.r][q.c].cost;
        lengthCost += step * gc;
      }
      return { found: true, path, lengthCost };
    }

    for (const d of dirs) {
      const nc = current.c + d.dc, nr = current.r + d.dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (grid[nr][nc].blocked) continue;
      // Optional: prevent cutting corners through walls by checking both orthogonal neighbors when moving diagonally
      if (d.dc !== 0 && d.dr !== 0) {
        const n1 = grid[current.r][current.c + d.dc];
        const n2 = grid[current.r + d.dr][current.c];
        if (n1?.blocked || n2?.blocked) continue;
      }

      const neighborK = nodeKey(nc, nr);
      // Base cost (accounts for sand/hill base cost) using avg cell cost
      let moveCost = d.w * ((grid[nr][nc].cost + grid[current.r][current.c].cost) * 0.5);
      // Directional hill penalty/reward: penalize moving uphill, slight reward for downhill
      const stepLen = d.w;
      const sx = d.dc / stepLen, sy = d.dr / stepLen; // normalized step direction
      const h1 = grid[current.r][current.c], h2 = grid[nr][nc];
      const hx = ((h1.hillVX ?? 0) + (h2.hillVX ?? 0)) * 0.5;
      const hy = ((h1.hillVY ?? 0) + (h2.hillVY ?? 0)) * 0.5;
      const hStr = ((h1.hillStrength ?? 0) + (h2.hillStrength ?? 0)) * 0.5;
      if (hStr > 0 && (hx !== 0 || hy !== 0)) {
        const dot = hx * sx + hy * sy; // + with downhill, - against (uphill)
        const uphill = Math.max(0, -dot);
        const downhill = Math.max(0, dot);
        const alpha = 0.5;  // uphill penalty weight
        const beta = 0.15;  // downhill easing weight
        const hillFactor = clamp(1 + alpha * uphill * hStr - beta * downhill * hStr, 0.75, 1.6);
        moveCost *= hillFactor;
      }
      const tentativeG = (gScore[ck] ?? Infinity) + moveCost;
      if (tentativeG < (gScore[neighborK] ?? Infinity)) {
        came[neighborK] = ck;
        gScore[neighborK] = tentativeG;
        const f = tentativeG + h(nc, nr);
        const existing = openSet.findIndex(n => n.c === nc && n.r === nr);
        if (existing >= 0) openSet[existing].f = f; else openSet.push({ c: nc, r: nr, f });
      }
    }
  }

  return { found: false, path: [], lengthCost: 0 };
}

export function estimatePar(
  level: LevelLike,
  fairway: Fairway,
  cellSize: number,
  opts?: {
    baselineShotPx?: number;          // D baseline in px per stroke
    sandPenaltyPerCell?: number;      // per grid cell of sand encountered along the path
    turnPenaltyPerTurn?: number;      // per path turn penalty
    turnPenaltyMax?: number;          // cap for turn penalty
    hillBump?: number;                // extra bump if any hills exist
    bankWeight?: number;              // converts average blocked-neighbor count into extra strokes
    bankPenaltyMax?: number;          // cap for bank/corridor penalty
    // New: physics-aware scaling
    frictionK?: number;               // global ball friction K (from gameplay), higher = more friction
    referenceFrictionK?: number;      // reference K that baselineShotPx was tuned for (default 1.2)
    sandFrictionMultiplier?: number;  // gameplay sand multiplier (default 6.0)
    // Downhill / auto-assist tuning
    downhillBonusFactor?: number;
    autoAssistMomentumThreshold?: number;
    autoAssistBonus?: number;
    autoAssistSegmentThreshold?: number;
  }
): {
  reachable: boolean;
  suggestedPar: number;
  pathLengthPx: number;
  notes: string[];
} {
  const { grid, cols, rows } = buildGrid(level, fairway, cellSize);
  const toCell = (x: number, y: number) => ({ c: clamp(Math.floor((x - fairway.x) / cellSize), 0, cols - 1), r: clamp(Math.floor((y - fairway.y) / cellSize), 0, rows - 1) });

  const start = toCell(level.tee.x, level.tee.y);
  const goal = toCell(level.cup.x, level.cup.y);

  const { found, path, lengthCost } = aStar(grid, cols, rows, start, goal);

  const notes: string[] = [];
  if (!found) {
    // fallback: straight-line distance heuristic + obstacles factor
    const dx = level.cup.x - level.tee.x;
    const dy = level.cup.y - level.tee.y;
    const dist = Math.hypot(dx, dy);
    const obstacles = (level.walls?.length || 0) + (level.wallsPoly?.length || 0) + (level.water?.length || 0) + (level.waterPoly?.length || 0) + (level.sand?.length || 0) + (level.sandPoly?.length || 0);
    let par = Math.round(dist / 260 + obstacles * 0.3);
    par = Math.max(2, Math.min(7, par));
    notes.push('no-path: fallback distance-based par');
    return { reachable: false, suggestedPar: par, pathLengthPx: dist, notes };
  }

  // Convert cost-length into pixel length. Base cost step of 1 ~= cellSize, diagonals ~ cellSize*sqrt(2).
  // Since we already included diagonal step weights, scale by cellSize.
  const pathLengthPx = lengthCost * cellSize;

  // Count rough turns to account for complexity/banking
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const a = path[i - 2], b = path[i - 1], c = path[i];
    const v1c = b.c - a.c, v1r = b.r - a.r;
    const v2c = c.c - b.c, v2r = c.r - b.r;
    if (v1c !== v2c || v1r !== v2r) turns++;
  }

  // Corridor/bank contact: average number of blocked neighbors along the path
  const neighborBlockedCount = (cc: number, rr: number) => {
    let cnt = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = cc + dc, nr = rr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (grid[nr][nc].blocked) cnt++;
      }
    }
    return cnt;
  };
  let blockedSum = 0;
  for (const p of path) blockedSum += neighborBlockedCount(p.c, p.r);
  const blockedAvg = blockedSum / Math.max(1, path.length);

  // Base shots: assume typical effective shot distance D, scaled by friction
  const D0 = opts?.baselineShotPx ?? 320; // px per stroke baseline (tuned at refK)
  const refK = Math.max(0.05, opts?.referenceFrictionK ?? 1.2);
  const k = Math.max(0.05, opts?.frictionK ?? refK);
  // Under exponential friction, distance ~ v0/k, so scale by refK/k
  const frictionScale = refK / k;
  const D = D0 * frictionScale;
  let strokes = pathLengthPx / D;

  // Add penalties based on terrain cost encountered along path
  const sandCellsOnPath = path.filter(p => !grid[p.r][p.c].blocked && !!grid[p.r][p.c].isSand).length;
  const baseSandPenaltyPerCell = opts?.sandPenaltyPerCell ?? 0.01; // default small cumulative penalty
  const sandMult = opts?.sandFrictionMultiplier ?? 6.0; // gameplay default
  const sandPenaltyPerCell = baseSandPenaltyPerCell * (sandMult / 6.0);
  const sandPenalty = sandCellsOnPath * sandPenaltyPerCell;

  const turnPenaltyPerTurn = opts?.turnPenaltyPerTurn ?? 0.08;
  const turnPenaltyMax = opts?.turnPenaltyMax ?? 1.5;
  const turnPenalty = Math.min(turnPenaltyMax, turns * turnPenaltyPerTurn);

  // Corridor/bank penalty: reward complexity by adding strokes when path hugs blockers
  const bankWeight = opts?.bankWeight ?? 0.12; // each neighbor on average contributes some fraction of a stroke
  const bankPenaltyMax = opts?.bankPenaltyMax ?? 1.0;
  const bankPenalty = Math.min(bankPenaltyMax, blockedAvg * bankWeight);

  strokes = strokes + sandPenalty + turnPenalty + bankPenalty;

  // Hills: apply a mild bump only if the path actually crosses hill cells; scale slightly with coverage
  const hillCellsOnPath = path.filter(p => (grid[p.r][p.c].hillStrength ?? 0) > 0).length;
  const hillBump = opts?.hillBump ?? 0.15;
  if (hillCellsOnPath > 0) {
    const coverage = Math.min(1, hillCellsOnPath / Math.max(1, Math.floor(path.length * 0.5)));
    strokes += hillBump * (0.5 + 0.5 * coverage);
  }

  let suggested = Math.round(strokes + 1); // add 1 for tee off
  suggested = Math.max(2, Math.min(7, suggested));

  if (sandCellsOnPath > 0) notes.push(`sand cells ~${sandCellsOnPath}`);
  if (hillCellsOnPath > 0) notes.push(`hills on path ~${hillCellsOnPath}`);
  if (turns > 0) notes.push(`turns ~${turns}`);
  if (blockedAvg > 0) notes.push(`corridor contact ~${blockedAvg.toFixed(2)}`);

  return { reachable: true, suggestedPar: suggested, pathLengthPx, notes };
}

// --- Branching paths (K-best) and hybrid selection helpers ---

export type CandidatePath = {
  path: Array<{ c: number; r: number }>;
  worldPoints: Array<{ x: number; y: number }>;
  lengthPx: number;
  turns: number;
  blockedAvg: number;
  sandCells: number;
  hillCells: number;
  strokes: number;
  par: number;
  cellKeys: string[];
  cellSet: Set<string>;
  downhillMomentum: number;
  uphillResistance: number;
  autoAssistSegments: number;
};

type AStarOptions = {
  bannedNodes?: Set<string>;
  bannedEdges?: Set<string>;
};

const nodeKey = (c: number, r: number) => `${c},${r}`;
const edgeKey = (from: { c: number; r: number }, to: { c: number; r: number }) => `${from.c},${from.r}->${to.c},${to.r}`;

function pathSignature(path: Array<{ c: number; r: number }>): string {
  if (!path || path.length === 0) return '';
  let s = '';
  for (let i = 0; i < path.length; i++) { const p = path[i]; s += p.c + ',' + p.r + (i + 1 < path.length ? ';' : ''); }
  return s;
}

function analyzePathTraversal(
  path: Array<{ c: number; r: number }>,
  grid: GridCell[][]
): { lengthCost: number; downhillMomentum: number; uphillResistance: number; autoAssistSegments: number } {
  let lengthCost = 0;
  let downhillMomentum = 0;
  let uphillResistance = 0;
  let autoAssistSegments = 0;
  if (!path || path.length < 2) {
    return { lengthCost, downhillMomentum, uphillResistance, autoAssistSegments };
  }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dc = b.c - a.c;
    const dr = b.r - a.r;
    const diag = (dc !== 0) && (dr !== 0);
    const step = diag ? Math.SQRT2 : 1;
    const gc = grid[b.r][b.c].cost;
    lengthCost += step * gc;

    const h1 = grid[a.r][a.c];
    const h2 = grid[b.r][b.c];
    const hx = ((h1.hillVX ?? 0) + (h2.hillVX ?? 0)) * 0.5;
    const hy = ((h1.hillVY ?? 0) + (h2.hillVY ?? 0)) * 0.5;
    const hStr = ((h1.hillStrength ?? 0) + (h2.hillStrength ?? 0)) * 0.5;
    if (hStr > 0 && (hx !== 0 || hy !== 0)) {
      const sx = dc / step;
      const sy = dr / step;
      const dot = hx * sx + hy * sy;
      if (dot > 0.05) {
        const boost = dot * hStr * step;
        downhillMomentum += boost;
        if (boost >= 0.6) autoAssistSegments++;
      } else if (dot < -0.05) {
        uphillResistance += (-dot) * hStr * step;
      }
    }
  }
  return { lengthCost, downhillMomentum, uphillResistance, autoAssistSegments };
}

function pathOverlapFraction(a: CandidatePath, b: CandidatePath): number {
  if (!a || !b) return 0;
  const sizeA = a.cellSet.size;
  const sizeB = b.cellSet.size;
  if (!sizeA || !sizeB) return 0;
  let overlap = 0;
  for (const key of a.cellSet) {
    if (b.cellSet.has(key)) overlap++;
  }
  return overlap / Math.min(sizeA, sizeB);
}

function computeCandidateForPath(
  grid: GridCell[][], cols: number, rows: number,
  fairway: Fairway, cellSize: number,
  path: Array<{ c: number; r: number }>,
  opts?: Parameters<typeof estimatePar>[3]
): CandidatePath {
  const toWorld = (c: number, r: number) => ({ x: fairway.x + c * cellSize + cellSize / 2, y: fairway.y + r * cellSize + cellSize / 2 });
  const worldPoints = path.map(p => toWorld(p.c, p.r));
  const cellKeys = path.map(p => `${p.c},${p.r}`);
  const cellSet = new Set<string>(cellKeys);
  // length cost in pixel units + hill momentum metrics
  const { lengthCost, downhillMomentum, uphillResistance, autoAssistSegments } = analyzePathTraversal(path, grid);
  const lengthPx = lengthCost * cellSize;
  // turns
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const a = path[i - 2], b = path[i - 1], c = path[i];
    if ((b.c - a.c) !== (c.c - b.c) || (b.r - a.r) !== (c.r - b.r)) turns++;
  }
  // blocked neighbor average
  const neighborBlockedCount = (cc: number, rr: number) => {
    let cnt = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = cc + dc, nr = rr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (grid[nr][nc].blocked) cnt++;
      }
    }
    return cnt;
  };
  let blockedSum = 0;
  for (const p of path) blockedSum += neighborBlockedCount(p.c, p.r);
  const blockedAvg = blockedSum / Math.max(1, path.length);
  // sand/hill cells
  const sandCells = path.filter(p => !grid[p.r][p.c].blocked && !!grid[p.r][p.c].isSand).length;
  const hillCells = path.filter(p => (grid[p.r][p.c].hillStrength ?? 0) > 0).length;

  // Estimate strokes similar to estimatePar(), but for this fixed path
  const D0 = opts?.baselineShotPx ?? 320;
  const refK = Math.max(0.05, opts?.referenceFrictionK ?? 1.2);
  const k = Math.max(0.05, opts?.frictionK ?? refK);
  const frictionScale = refK / k;
  const D = D0 * frictionScale;
  let strokes = lengthPx / D;
  const baseSandPenaltyPerCell = opts?.sandPenaltyPerCell ?? 0.01;
  const sandMult = opts?.sandFrictionMultiplier ?? 6.0;
  const sandPenalty = sandCells * baseSandPenaltyPerCell * (sandMult / 6.0);
  const turnPenaltyPerTurn = opts?.turnPenaltyPerTurn ?? 0.08;
  const turnPenaltyMax = opts?.turnPenaltyMax ?? 1.5;
  const turnPenalty = Math.min(turnPenaltyMax, turns * turnPenaltyPerTurn);
  const bankWeight = opts?.bankWeight ?? 0.12;
  const bankPenaltyMax = opts?.bankPenaltyMax ?? 1.0;
  const bankPenalty = Math.min(bankPenaltyMax, blockedAvg * bankWeight);
  strokes = strokes + sandPenalty + turnPenalty + bankPenalty;
  const hillBump = opts?.hillBump ?? 0.15;
  if (hillCells > 0) {
    const coverage = Math.min(1, hillCells / Math.max(1, Math.floor(path.length * 0.5)));
    strokes += hillBump * (0.5 + 0.5 * coverage);
  }

  const downhillBonusFactor = opts?.downhillBonusFactor ?? 0.18;
  const autoAssistThreshold = opts?.autoAssistMomentumThreshold ?? 1.35;
  const autoAssistBonus = opts?.autoAssistBonus ?? 0.45;
  const autoAssistSegmentThreshold = opts?.autoAssistSegmentThreshold ?? 3;

  if (downhillMomentum > 0) {
    const downhillBonus = Math.min(1.6, downhillMomentum * downhillBonusFactor);
    strokes = Math.max(0.35, strokes - downhillBonus);
  }
  const netMomentum = downhillMomentum - uphillResistance;
  if (downhillMomentum > 0 && (autoAssistSegments >= autoAssistSegmentThreshold || netMomentum > autoAssistThreshold)) {
    strokes = Math.max(0.35, strokes - autoAssistBonus);
  }

  let par = Math.round(strokes + 1);
  par = Math.max(2, Math.min(7, par));
  return {
    path,
    worldPoints,
    lengthPx,
    turns,
    blockedAvg,
    sandCells,
    hillCells,
    strokes,
    par,
    cellKeys,
    cellSet,
    downhillMomentum,
    uphillResistance,
    autoAssistSegments
  };
}

/**
 * Compute up to K diverse candidate paths by banning cells along the current best path to force alternate branches.
 * Deterministic and fast enough for editor use.
 */
export function suggestParK(
  level: LevelLike,
  fairway: Fairway,
  cellSize: number,
  K = 3,
  opts?: Parameters<typeof estimatePar>[3]
): { candidates: CandidatePath[]; bestIndex: number; par: number } {
  const { grid, cols, rows } = buildGrid(level, fairway, cellSize);
  const toCell = (x: number, y: number) => ({ c: clamp(Math.floor((x - fairway.x) / cellSize), 0, cols - 1), r: clamp(Math.floor((y - fairway.y) / cellSize), 0, rows - 1) });
  const start = toCell(level.tee.x, level.tee.y);
  const goal = toCell(level.cup.x, level.cup.y);

  const base = aStar(grid, cols, rows, start, goal);
  if (!base.found) {
    // fallback to single-path estimate
    const single = estimatePar(level, fairway, cellSize, opts);
    return { candidates: [], bestIndex: 0, par: single.suggestedPar };
  }

  const MAX_POOL = Math.max(K * 6, K + 4);
  const MAX_DEPTH = 2;
  const SIMILARITY_THRESHOLD = 0.6;
  const SIGNATURES = new Set<string>();
  const candidates: CandidatePath[] = [];

  const considerCandidate = (path: Array<{ c: number; r: number }>): CandidatePath | null => {
    const key = pathSignature(path);
    if (!key || SIGNATURES.has(key)) return null;
    SIGNATURES.add(key);
    const candidate = computeCandidateForPath(grid, cols, rows, fairway, cellSize, path, opts);
    for (let i = 0; i < candidates.length; i++) {
      const existing = candidates[i];
      const overlap = pathOverlapFraction(candidate, existing);
      if (overlap >= SIMILARITY_THRESHOLD) {
        // If hill behavior differs materially, keep both variants
        const momentumGap = Math.abs(candidate.downhillMomentum - existing.downhillMomentum);
        const autoGap = Math.abs(candidate.autoAssistSegments - existing.autoAssistSegments);
        if (momentumGap >= 0.6 || autoGap >= 2) {
          continue;
        }
        // Otherwise, keep the lower-stroke option when nearly identical
        if (candidate.strokes + 0.05 < existing.strokes) {
          candidates[i] = candidate;
          return candidate;
        }
        return null;
      }
    }
    candidates.push(candidate);
    return candidate;
  };

  const baseCandidate = considerCandidate(base.path);
  const queue: Array<{ path: Array<{ c: number; r: number }>; depth: number }> = [];
  if (baseCandidate) queue.push({ path: base.path.slice(), depth: 0 });

  const collectStartNeighbors = (): Array<{ c: number; r: number }> => {
    const dirs = [
      { dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 },
      { dc: 1, dr: 1 }, { dc: 1, dr: -1 }, { dc: -1, dr: 1 }, { dc: -1, dr: -1 }
    ];
    const neighbors: Array<{ c: number; r: number }> = [];
    for (const d of dirs) {
      const nc = start.c + d.dc;
      const nr = start.r + d.dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (grid[nr][nc].blocked) continue;
      if (d.dc !== 0 && d.dr !== 0) {
        const corner1C = start.c + d.dc;
        const corner1R = start.r;
        const corner2C = start.c;
        const corner2R = start.r + d.dr;
        if (grid[corner1R]?.[corner1C]?.blocked || grid[corner2R]?.[corner2C]?.blocked) continue;
      }
      neighbors.push({ c: nc, r: nr });
    }
    return neighbors;
  };

  const seedPathsFromStart = () => {
    const neighbors = collectStartNeighbors();
    for (const nb of neighbors) {
      const forced = aStar(grid, cols, rows, nb, goal);
      if (!forced.found) continue;
      const seededPath = [{ c: start.c, r: start.r }, ...forced.path];
      considerCandidate(seededPath);
      if (candidates.length >= MAX_POOL) break;
    }
  };

  seedPathsFromStart();

  let queueIndex = 0;
  while (queueIndex < queue.length && candidates.length < MAX_POOL) {
    const { path, depth } = queue[queueIndex++];
    if (path.length < 4) continue;
    const sampleStep = Math.max(2, Math.round(path.length / Math.max(4, K * 3)));

    const gatherSampleIndices = (): number[] => {
      const indices: number[] = [];
      const firstIdx = Math.max(2, Math.floor(sampleStep / 2));
      for (let i = firstIdx; i < path.length - 1; i += sampleStep) {
        indices.push(i);
      }
      return indices;
    };
    const sampleIndices = gatherSampleIndices();

    for (const i of sampleIndices) {
      const banned = path[i];
      const alt = aStarWithBanned(grid, cols, rows, start, goal, new Set([banned.c + ',' + banned.r]));
      if (!alt.found) continue;
      const added = considerCandidate(alt.path);
      if (added && depth < MAX_DEPTH && queue.length < MAX_POOL) {
        queue.push({ path: alt.path.slice(), depth: depth + 1 });
      }
    }

    if (candidates.length >= MAX_POOL) break;

    if (path.length >= 6) {
      for (const i of sampleIndices) {
        const bannedSet = new Set<string>();
        const first = path[i];
        const second = path[Math.min(path.length - 2, i + Math.max(1, Math.floor(sampleStep / 2)) )];
        bannedSet.add(first.c + ',' + first.r);
        bannedSet.add(second.c + ',' + second.r);
        const altPair = aStarWithBanned(grid, cols, rows, start, goal, bannedSet);
        if (!altPair.found) continue;
        const added = considerCandidate(altPair.path);
        if (added && depth < MAX_DEPTH && queue.length < MAX_POOL) {
          queue.push({ path: altPair.path.slice(), depth: depth + 1 });
        }
      }
    }
  }
  candidates.sort((a, b) => a.strokes - b.strokes || a.lengthPx - b.lengthPx);
  const finalCandidates = candidates.slice(0, K);
  const bestIndex = finalCandidates.length > 0 ? 0 : -1;
  const fallbackPar = Math.max(2, Math.min(7, Math.round((base.lengthCost * cellSize) / (opts?.baselineShotPx ?? 320) + 1)));
  const par = finalCandidates.length > 0 ? finalCandidates[0].par : fallbackPar;
  return { candidates: finalCandidates, bestIndex, par };
}

function aStarWithBanned(
  grid: GridCell[][],
  cols: number,
  rows: number,
  start: { c: number; r: number },
  goal: { c: number; r: number },
  banned: Set<string>
): { found: boolean; path: Array<{ c: number; r: number }>; lengthCost: number } {
  return aStar(grid, cols, rows, start, goal, { bannedNodes: banned });
}

function aStarWithBannedEdges(
  grid: GridCell[][],
  cols: number,
  rows: number,
  start: { c: number; r: number },
  goal: { c: number; r: number },
  bannedEdges: Set<string>
): { found: boolean; path: Array<{ c: number; r: number }>; lengthCost: number } {
  return aStar(grid, cols, rows, start, goal, { bannedEdges });
}
