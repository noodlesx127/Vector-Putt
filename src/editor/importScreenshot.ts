// Screenshot → Level Importer (MVP)
// Dependency-light Canvas pipeline to convert a top-down screenshot into a draft LevelData.
// Phase 2: adds HSV segmentation, contour tracing, and polygon simplification to extract
// walls/sand/water polygons. Cup detection remains heuristic with a user-click fallback in the editor.

export interface ScreenshotImportOptions {
  targetWidth: number;
  targetHeight: number;
  gridSize?: number;
}

// Public helper: recompute polygons from thresholds (used by Import Review overlay)
export function computePolysFromThresholds(
  imgData: ImageData,
  fairway: { x: number; y: number; w: number; h: number },
  thresholds: Thresholds,
  gridSize: number,
  canvasW: number,
  canvasH: number
): { wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> } {
  const masks = segmentByColor(imgData, fairway, thresholds);
  const simplifyEps = Math.max(1.5, Math.min(10, gridSize * 0.15));
  const minPixels = Math.max(60, Math.round((gridSize * gridSize) / 2));
  const toPolys = (mask: Uint8Array) =>
    traceContours(mask, imgData.width, imgData.height, minPixels)
      .map(poly => simplifyPolygon(poly, simplifyEps))
      .map(poly => snapPolygonToGrid(poly, gridSize))
      .map(poly => clampPolygon(poly, canvasW, canvasH))
      .map(points => ({ points: flattenPoints(points) }));
  const wallsPoly = toPolys(masks.walls);
  const sandPoly = toPolys(masks.sand);
  const waterPoly = toPolys(masks.water);
  return { wallsPoly, sandPoly, waterPoly };
}

export type LevelData = any; // Uses the editor/runtime LevelData shape already in the project

// Public entry point
export async function importLevelFromScreenshot(file: File, opts: ScreenshotImportOptions): Promise<LevelData | null> {
  try {
    const img = await readImageFile(file);
    const { canvas, ctx } = drawToOffscreen(img, opts.targetWidth, opts.targetHeight);

    // Read pixels
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 1) Rough green (fairway) segmentation to find playfield bounds
    const fairBB = findGreenBoundingBox(imgData);
    const fairway = expandOrFallback(fairBB, canvas.width, canvas.height, 20);

    // 2) Segment colors (HSV) → binary masks within the fairway region
    const thresholds = buildDefaultThresholds();
    const masks = segmentByColor(imgData, fairway, thresholds);

    // 3) Contour tracing per mask → polygons
    const gridSize = Math.max(2, Math.min(100, Math.round(opts.gridSize || 20)));
    const simplifyEps = Math.max(1.5, Math.min(10, gridSize * 0.15));
    const minPixels = Math.max(60, Math.round((gridSize * gridSize) / 2)); // discard tiny noise

    const toPolys = (mask: Uint8Array) =>
      traceContours(mask, imgData.width, imgData.height, minPixels)
        .map(poly => simplifyPolygon(poly, simplifyEps))
        .map(poly => snapPolygonToGrid(poly, gridSize))
        .map(poly => clampPolygon(poly, canvas.width, canvas.height))
        .map(points => ({ points: flattenPoints(points) }));

    const wallsPoly = toPolys(masks.walls);
    const sandPoly = toPolys(masks.sand);
    const waterPoly = toPolys(masks.water);

    // 4) Cup detection (dark circular blob) inside fairway with simple fallback
    const cupDetectedCandidate = detectCup(imgData, fairway);
    const cup = cupDetectedCandidate || {
      x: fairway.x + fairway.w - Math.max(20, Math.round(fairway.w * 0.08)),
      y: fairway.y + Math.round(fairway.h / 2),
      r: 12
    };

    // 5) Tee placement (fallback left-center)
    const tee = {
      x: fairway.x + Math.max(20, Math.round(fairway.w * 0.08)),
      y: fairway.y + Math.round(fairway.h / 2),
      r: 8
    };

    // Compose LevelData draft
    const level: LevelData = {
      canvas: { width: canvas.width, height: canvas.height },
      course: { index: 1, total: 1, title: 'Imported Level' },
      par: 3,
      tee: { x: tee.x, y: tee.y, r: tee.r },
      cup: { x: Math.round(cup.x), y: Math.round(cup.y), r: Math.max(8, Math.min(20, Math.round(cup.r || 12))) },
      walls: [],
      wallsPoly,
      posts: [],
      bridges: [],
      water: [],
      waterPoly,
      sand: [],
      sandPoly,
      hills: [],
      decorations: [],
      meta: {
        title: 'Imported Level',
        description: 'Draft created from screenshot',
        tags: ['imported', 'screenshot'],
        importInfo: {
          cupDetected: !!cupDetectedCandidate
        }
      }
    } as any;

    // Attach ephemeral review data (not persisted) for the editor's review overlay
    (level as any).__review = {
      imageData: imgData,
      thresholds,
      fairway
    };

    return level;
  } catch (e) {
    console.error('importLevelFromScreenshot: failed', e);
    return null;
  }
}

// Utilities
async function readImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}

function drawToOffscreen(img: HTMLImageElement, targetW: number, targetH: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(400, Math.round(targetW || img.naturalWidth || 800));
  canvas.height = Math.max(300, Math.round(targetH || img.naturalHeight || 600));
  const ctx = canvas.getContext('2d')!;

  // Fit image preserving aspect into target canvas with letterboxing
  const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);
  const dx = Math.round((canvas.width - dw) / 2);
  const dy = Math.round((canvas.height - dh) / 2);

  // Fill background (neutral)
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, dx, dy, dw, dh);
  return { canvas, ctx };
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h: h * 360, s, v };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Thresholds seeded from docs/PALETTE.md
export function buildDefaultThresholds() {
  const fair = hexToRgb('#126a23');
  const water = hexToRgb('#1f6dff');
  const sand = hexToRgb('#d4b36a');
  const wall = hexToRgb('#e2e2e2');
  const fh = rgbToHsv(fair.r, fair.g, fair.b).h;
  const wh = rgbToHsv(water.r, water.g, water.b).h;
  const sh = rgbToHsv(sand.r, sand.g, sand.b).h;
  return {
    fairway: { hMin: Math.max(0, fh - 40), hMax: Math.min(360, fh + 40), sMin: 0.25, vMin: 0.15 },
    water:   { hMin: Math.max(0, wh - 25), hMax: Math.min(360, wh + 25), sMin: 0.35, vMin: 0.25 },
    sand:    { hMin: Math.max(0, sh - 25), hMax: Math.min(360, sh + 25), sMin: 0.20, vMin: 0.30 },
    // light gray walls: low saturation, high value, and not green/water/sand hues
    walls:   { sMax: 0.20, vMin: 0.65 }
  } as const;
}

export type Thresholds = ReturnType<typeof buildDefaultThresholds>;

// Segment into binary masks (Uint8Array 0/1) limited to the fairway bbox region
export function segmentByColor(img: ImageData, fair: { x: number; y: number; w: number; h: number }, t: Thresholds): { fairway: Uint8Array; walls: Uint8Array; sand: Uint8Array; water: Uint8Array } {
  const { data, width, height } = img;
  const N = width * height;
  const fairMask = new Uint8Array(N);
  const wallsMask = new Uint8Array(N);
  const sandMask = new Uint8Array(N);
  const waterMask = new Uint8Array(N);
  const insideFair = (x: number, y: number) => x >= fair.x && x < fair.x + fair.w && y >= fair.y && y < fair.y + fair.h;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x);
      const a = data[idx * 4 + 3];
      if (a < 10) continue;
      const r = data[idx * 4 + 0];
      const g = data[idx * 4 + 1];
      const b = data[idx * 4 + 2];
      const { h, s, v } = rgbToHsv(r, g, b);
      const isFair = (v >= t.fairway.vMin && s >= t.fairway.sMin && inHueRange(h, t.fairway.hMin, t.fairway.hMax));
      if (isFair) fairMask[idx] = 1;
      if (!insideFair(x, y)) continue; // only detect features within fairway bbox
      if (v >= t.water.vMin && s >= t.water.sMin && inHueRange(h, t.water.hMin, t.water.hMax)) waterMask[idx] = 1;
      if (v >= t.sand.vMin && s >= t.sand.sMin && inHueRange(h, t.sand.hMin, t.sand.hMax)) sandMask[idx] = 1;
      // walls: light gray (low saturation), high value, but avoid fairway/blue/sand hues
      if (s <= t.walls.sMax && v >= t.walls.vMin && !isFair) {
        const isBlue = inHueRange(h, t.water.hMin, t.water.hMax) && s >= t.water.sMin;
        const isTan = inHueRange(h, t.sand.hMin, t.sand.hMax) && s >= t.sand.sMin;
        if (!isBlue && !isTan) wallsMask[idx] = 1;
      }
    }
  }
  // Note: We already restrict feature detection (water/sand/walls) to the fairway bounding box
  // via `insideFair(x,y)` above. Do NOT intersect with the green fairway mask here; features are
  // not green themselves and would be zeroed out. Returning masks as-is preserves detections.
  return { fairway: fairMask, walls: wallsMask, sand: sandMask, water: waterMask };
}

export function inHueRange(h: number, min: number, max: number): boolean {
  if (min <= max) return h >= min && h <= max;
  // wrap-around
  return h >= min || h <= max;
}

export function findGreenBoundingBox(imgData: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { data, width, height } = imgData;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const N = width * height;
  for (let i = 0; i < N; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    if (a < 10) continue;
    const { h, s, v } = rgbToHsv(r, g, b);
    // Generic green range
    if (v > 0.15 && s > 0.25 && h >= 70 && h <= 170) {
      const x = i % width;
      const y = Math.floor(i / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function expandOrFallback(bb: { x: number; y: number; w: number; h: number } | null, W: number, H: number, margin: number) {
  if (!bb) {
    const m = Math.max(20, margin);
    return { x: m, y: m, w: Math.max(1, W - 2 * m), h: Math.max(1, H - 2 * m) };
  }
  // Ensure a minimum margin to avoid clipping strokes later
  const x = Math.max(margin, bb.x);
  const y = Math.max(margin, bb.y);
  const w = Math.min(W - x - margin, bb.w);
  const h = Math.min(H - y - margin, bb.h);
  return { x, y, w, h };
}

export function detectCup(imgData: ImageData, fair: { x: number; y: number; w: number; h: number }): { x: number; y: number; r: number } | null {
  const { data, width } = imgData;
  let sumX = 0, sumY = 0, count = 0;
  for (let y = fair.y; y < fair.y + fair.h; y++) {
    for (let x = fair.x; x < fair.x + fair.w; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      if (a < 10) continue;
      const { s, v } = rgbToHsv(r, g, b);
      // Dark, low-sat area is a cup candidate; avoid too-bright gray borders by v threshold
      if (v < 0.18 && s < 0.35) {
        sumX += x; sumY += y; count++;
      }
    }
  }
  // Require a small but non-trivial cluster. Scale with fairway area so unit tests and small images pass.
  const minCluster = Math.max(9, Math.round((fair.w * fair.h) / 400));
  if (count < minCluster) return null; // too few pixels
  const cx = Math.round(sumX / count);
  const cy = Math.round(sumY / count);
  const rEst = Math.max(8, Math.round(Math.sqrt(count / Math.PI)));
  return { x: cx, y: cy, r: rEst };
}

// Contour tracing (Moore-Neighbor) for binary mask (1 = foreground)
export function traceContours(mask: Uint8Array, width: number, height: number, minPixels: number): Array<Array<{ x: number; y: number }>> {
  const visited = new Uint8Array(width * height);
  const contours: Array<Array<{ x: number; y: number }>> = [];
  const idx = (x: number, y: number) => y * width + x;
  const isOn = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[idx(x, y)] === 1;
  const isEdge = (x: number, y: number) => isOn(x, y) && (
    !isOn(x - 1, y) || !isOn(x + 1, y) || !isOn(x, y - 1) || !isOn(x, y + 1)
  );

  // 8-neighborhood directions clockwise starting from E
  const dirs = [
    { dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 },
    { dx: -1, dy: 0 }, { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 }
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = idx(x, y);
      if (visited[p] || mask[p] !== 1 || !isEdge(x, y)) continue;

      // Border following from (x, y)
      let cx = x, cy = y;
      let prevDir = 0; // previous direction index
      const contour: Array<{ x: number; y: number }> = [];
      let safety = width * height; // prevent infinite loops
      while (safety-- > 0) {
        contour.push({ x: cx, y: cy });
        visited[idx(cx, cy)] = 1;
        // find next neighbor starting from prevDir-2 (Moore neighborhood rule)
        let found = false;
        for (let k = 0; k < 8; k++) {
          const dirIndex = (prevDir + 6 + k) % 8; // turn right relative to previous
          const nx = cx + dirs[dirIndex].dx;
          const ny = cy + dirs[dirIndex].dy;
          if (isOn(nx, ny) && isEdge(nx, ny)) {
            prevDir = dirIndex;
            cx = nx; cy = ny; found = true; break;
          }
        }
        if (!found) break;
        if (cx === x && cy === y) {
          // closed loop
          break;
        }
      }
      if (contour.length >= 4 && contour.length >= Math.sqrt(minPixels)) {
        contours.push(contour);
      }
    }
  }
  return contours;
}

// Ramer–Douglas–Peucker simplification
export function simplifyPolygon(points: Array<{ x: number; y: number }>, epsilon: number): Array<{ x: number; y: number }> {
  if (points.length <= 3) return points;
  const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const distSeg = (p: any, a: any, b: any) => {
    const l2 = d2(a, b);
    if (l2 === 0) return Math.sqrt(d2(p, a));
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  };
  const epsilonAbs = Math.max(0.5, epsilon);
  const last = points.length - 1;
  const stack = [[0, last]];
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[last] = true;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distSeg(points[i], points[s], points[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilonAbs && idx !== -1) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  if (out.length >= 3) return out;
  return points; // fallback
}

function snapPolygonToGrid(points: Array<{ x: number; y: number }>, grid: number): Array<{ x: number; y: number }> {
  const snap = (n: number) => Math.round(n / grid) * grid;
  return points.map(p => ({ x: snap(p.x), y: snap(p.y) }));
}

function clampPolygon(points: Array<{ x: number; y: number }>, W: number, H: number): Array<{ x: number; y: number }> {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  return points.map(p => ({ x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) }));
}

function flattenPoints(points: Array<{ x: number; y: number }>): number[] {
  const out: number[] = [];
  for (const p of points) { out.push(Math.round(p.x), Math.round(p.y)); }
  // ensure closed polygon by repeating the first point if the last is far
  if (out.length >= 4) {
    const n = out.length;
    const dx = out[0] - out[n - 2];
    const dy = out[1] - out[n - 1];
    if (Math.hypot(dx, dy) > 1e-3) {
      out.push(out[0], out[1]);
    }
  }
  return out;
}
