// Screenshot → Level Importer (MVP)
// Dependency-light Canvas pipeline to convert a top-down screenshot into a draft LevelData.
// Phase 2: adds HSV segmentation, contour tracing, and polygon simplification to extract
// walls/sand/water polygons. Cup detection remains heuristic with a user-click fallback in the editor.

export interface ScreenshotImportOptions {
  targetWidth: number;
  targetHeight: number;
  gridSize?: number;
}

// Manual annotation interfaces
export interface AnnotationData {
  walls: Array<{ points: Array<{ x: number; y: number }> }>;
  water: Array<{ points: Array<{ x: number; y: number }> }>;
  sand: Array<{ points: Array<{ x: number; y: number }> }>;
  hills: Array<{ points: Array<{ x: number; y: number }>; direction: number }>;
  posts: Array<{ x: number; y: number; r: number }>;
  fairway?: { points: Array<{ x: number; y: number }> };
  tee?: { x: number; y: number; r: number };
  cup?: { x: number; y: number; r: number };
}

export interface AnnotationOptions {
  targetWidth: number;
  targetHeight: number;
  gridSize?: number;
  // Import-time shaping options (no UI changes required)
  waterBorderThickness?: number; // px, when a water polygon encloses the fairway
  wallBorderThickness?: number;  // px, when a large wall fill encloses the fairway
  enableAutoWaterBorder?: boolean; // default true
  enableAutoWallBorder?: boolean;  // default true
  // Source annotation canvas size (for scale normalization)
  sourceWidth?: number;
  sourceHeight?: number;
}

// Expand a rectangle by margin and clamp to image bounds
function expandRect(rect: { x: number; y: number; w: number; h: number }, margin: number, bounds: { W: number; H: number }) {
  const x = Math.max(0, Math.floor(rect.x - margin));
  const y = Math.max(0, Math.floor(rect.y - margin));
  const w = Math.min(bounds.W - x, Math.floor(rect.w + 2 * margin));
  const h = Math.min(bounds.H - y, Math.floor(rect.h + 2 * margin));
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

// 4-neighborhood dilation of a binary mask by N iterations
function dilateMask(mask: Uint8Array, width: number, height: number, iterations: number): Uint8Array {
  if (iterations <= 0) return mask;
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (cur[p]) { out[p] = 1; continue; }
        if ((x > 0 && cur[p - 1]) || (x + 1 < width && cur[p + 1]) || (y > 0 && cur[p - width]) || (y + 1 < height && cur[p + width])) {
          out[p] = 1;
        }
      }
    }
    cur = out;
  }
  return cur;
}

// Compute signed area magnitude of polygon given flat points [x0,y0,x1,y1,...]
function polygonArea(flat: number[]): number {
  if (!Array.isArray(flat) || flat.length < 6) return 0;
  let area = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const x1 = flat[i], y1 = flat[i + 1];
    const x2 = flat[(i + 2) % flat.length], y2 = flat[(i + 3) % flat.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) * 0.5;
}

function totalPolyArea(polys: Array<{ points: number[] }>): number {
  if (!Array.isArray(polys)) return 0;
  let sum = 0;
  for (const p of polys) sum += polygonArea(p.points);
  return sum;
}

// Public helper: recompute polygons from thresholds (used by Import Review overlay)
export async function computePolysFromThresholds(
  imgData: ImageData,
  fairway: { x: number; y: number; w: number; h: number },
  thresholds: Thresholds,
  gridSize: number,
  canvasW: number,
  canvasH: number
): Promise<{ wallsPoly: Array<{ points: number[] }>; sandPoly: Array<{ points: number[] }>; waterPoly: Array<{ points: number[] }> }> {
  // Work on a cropped fairway sub-image for performance and lower memory
  const fairImg = cropImageData(imgData, fairway);
  const localFair = { x: 0, y: 0, w: fairway.w, h: fairway.h };
  // For walls, allow detection outside the fairway by a margin to preserve full thickness near borders
  const wallMargin = Math.max(8, Math.round(Math.min(fairway.w, fairway.h) * 0.04));
  const wallRect = expandRect(fairway, wallMargin, { W: imgData.width, H: imgData.height });
  const wallImg = cropImageData(imgData, wallRect);
  const localWallRect = { x: 0, y: 0, w: wallRect.w, h: wallRect.h };
  const masksFW = segmentByColor(fairImg, localFair, thresholds);
  const masksWalls = segmentByColor(wallImg, localWallRect, thresholds);
  const simplifyEps = Math.max(1.5, Math.min(10, gridSize * 0.15));
  const minPixels = Math.max(30, Math.round((gridSize * gridSize) / 4));
  const toPolys = async (mask: Uint8Array, width: number, height: number, offsetX: number, offsetY: number) => {
    const contours = await traceContoursAsync(mask, width, height, minPixels);
    await yieldToMain();
    
    return contours
      .map((poly: Array<{ x: number; y: number }>) => simplifyPolygon(poly, simplifyEps))
      .map((poly: Array<{ x: number; y: number }>) => offsetPolygon(poly, offsetX, offsetY))
      .map((poly: Array<{ x: number; y: number }>) => snapPolygonToGrid(poly, gridSize))
      .map((poly: Array<{ x: number; y: number }>) => clampPolygon(poly, canvasW, canvasH))
      .map((points: Array<{ x: number; y: number }>) => ({ points: flattenPoints(points) }));
  };
  // Walls traced on the expanded wall image to preserve thickness near fairway borders
  const toWallPolys = async (mask: Uint8Array, width: number, height: number, offsetX: number, offsetY: number) => {
    const dilatedMask = dilateMask(mask, width, height, 1);
    await yieldToMain();
    
    const contours = await traceContoursAsync(dilatedMask, width, height, minPixels);
    await yieldToMain();
    
    return contours
      .map((poly: Array<{ x: number; y: number }>) => simplifyPolygon(poly, simplifyEps))
      .map((poly: Array<{ x: number; y: number }>) => offsetPolygon(poly, offsetX, offsetY))
      // Use a finer snap for walls to avoid collapsing thickness to a single grid line
      .map((poly: Array<{ x: number; y: number }>) => snapPolygonToGrid(poly, Math.max(2, Math.round(gridSize / 2))))
      .map((poly: Array<{ x: number; y: number }>) => clampPolygon(poly, canvasW, canvasH))
      .map((points: Array<{ x: number; y: number }>) => ({ points: flattenPoints(points) }));
  };
  let wallsPoly = await toWallPolys(masksWalls.walls, wallImg.width, wallImg.height, wallRect.x, wallRect.y);
  // Drop the outer perimeter wall polygon that spans the entire fairway bbox (we don't support holes in polys)
  wallsPoly = wallsPoly.filter((p: { points: number[] }) => !isPerimeterPoly(p.points, fairway));
  
  // Remove large filled areas that are likely misclassified fairway regions
  const fairwayAreaCompute = Math.max(1, fairway.w * fairway.h);
  const isLargeFillCompute = (poly: { points: number[] }) => {
    const polyArea = polygonArea(poly.points);
    const areaFrac = polyArea / fairwayAreaCompute;
    // If polygon covers more than 25% of fairway area, it's likely a misclassified fill
    return areaFrac > 0.25;
  };
  wallsPoly = wallsPoly.filter((p: { points: number[] }) => !isLargeFillCompute(p));
  
  // Additional guard: remove any "wall" polygon whose interior is mostly green (misclassified giant fill)
  const greenDrop = (poly: { points: number[] }) => estimateGreenFractionInPolygon(imgData, poly.points, thresholds, Math.max(5, Math.round(Math.min(gridSize, 12))), 1800) >= 0.8;
  wallsPoly = wallsPoly.filter((p: { points: number[] }) => !greenDrop(p));
  // Sand/Water from fairway region only; then filter tiny fragments
  let sandPoly = await toPolys(masksFW.sand, fairImg.width, fairImg.height, fairway.x, fairway.y);
  let waterPoly = await toPolys(masksFW.water, fairImg.width, fairImg.height, fairway.x, fairway.y);
  const minPolyArea = Math.max(100, Math.round(gridSize * gridSize * 0.8));
  sandPoly = sandPoly.filter((p: { points: number[] }) => polygonArea(p.points) >= minPolyArea);
  waterPoly = waterPoly.filter((p: { points: number[] }) => polygonArea(p.points) >= minPolyArea);
  // Safety: drop trivial sand/water if total area fraction is negligible (<0.5% of fairway)
  const fairArea = Math.max(1, fairway.w * fairway.h);
  const sandFrac = totalPolyArea(sandPoly) / fairArea;
  const waterFrac = totalPolyArea(waterPoly) / fairArea;
  if (sandFrac < 0.005) sandPoly = [];
  if (waterFrac < 0.005) waterPoly = [];
  return { wallsPoly, sandPoly, waterPoly };
}

export type LevelData = any; // Uses the editor/runtime LevelData shape already in the project

// Helper to yield control back to the browser
function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 0);
    }
  });
}


// Public entry point with progressive processing (legacy auto-detection)
export async function importLevelFromScreenshot(file: File, opts: ScreenshotImportOptions): Promise<LevelData | null> {
  try {
    console.log('Starting screenshot import...');
    
    const img = await readImageFile(file);
    console.log(`Original image: ${img.width}x${img.height}`);
    
    const { canvas, ctx } = drawToOffscreen(img, opts.targetWidth, opts.targetHeight);
    console.log(`Canvas size: ${canvas.width}x${canvas.height}`);

    // Read pixels
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    await yieldToMain(); // Yield after expensive getImageData

    // 1) Rough green (fairway) segmentation to find playfield bounds
    console.log('Finding fairway bounds...');
    const fairBB = findGreenBoundingBox(imgData);
    const fairway = expandOrFallback(fairBB, canvas.width, canvas.height, 20);
    console.log(`Fairway: ${fairway.w}x${fairway.h} at (${fairway.x}, ${fairway.y})`);
    await yieldToMain();

    // 2) Segment colors (HSV) → binary masks within the fairway region
    console.log('Segmenting colors...');
    const thresholds = buildDefaultThresholds();
    // Process on a cropped fairway image for performance
    const fairImg = cropImageData(imgData, fairway);
    const localFair = { x: 0, y: 0, w: fairway.w, h: fairway.h };
    // For walls, expand region beyond fairway to retain full thickness bands near the edges
    const wallMargin = Math.max(8, Math.round(Math.min(fairway.w, fairway.h) * 0.04));
    const wallRect = expandRect(fairway, wallMargin, { W: canvas.width, H: canvas.height });
    const wallImg = cropImageData(imgData, wallRect);
    const localWallRect = { x: 0, y: 0, w: wallRect.w, h: wallRect.h };
    await yieldToMain();

    const masksFW = segmentByColor(fairImg, localFair, thresholds);
    await yieldToMain(); // Yield after fairway segmentation
    
    const masksWalls = segmentByColor(wallImg, localWallRect, thresholds);
    await yieldToMain(); // Yield after wall segmentation

    // 3) Contour tracing per mask → polygons
    console.log('Tracing contours...');
    const gridSize = Math.max(2, Math.min(100, Math.round(opts.gridSize || 20)));
    const simplifyEps = Math.max(1.5, Math.min(10, gridSize * 0.15));
    // Walls need gentler simplification and finer snap to preserve beveled/rounded shapes
    const simplifyEpsWalls = Math.max(1.0, Math.min(6, gridSize * 0.10));
    const minPixels = Math.max(30, Math.round((gridSize * gridSize) / 4)); // discard tiny noise

    const toPolys = async (mask: Uint8Array, width: number, height: number, offsetX: number, offsetY: number) => {
      const contours = await traceContoursAsync(mask, width, height, minPixels);
      await yieldToMain();
      
      return contours
        .map((poly: Array<{ x: number; y: number }>) => simplifyPolygon(poly, simplifyEps))
        .map((poly: Array<{ x: number; y: number }>) => offsetPolygon(poly, offsetX, offsetY))
        .map((poly: Array<{ x: number; y: number }>) => snapPolygonToGrid(poly, gridSize))
        .map((poly: Array<{ x: number; y: number }>) => clampPolygon(poly, canvas.width, canvas.height))
        .map((points: Array<{ x: number; y: number }>) => ({ points: flattenPoints(points) }));
    };

    const toWallPolys = async (mask: Uint8Array, width: number, height: number, offsetX: number, offsetY: number) => {
      const dilatedMask = dilateMask(mask, width, height, 1);
      await yieldToMain();
      
      const contours = await traceContoursAsync(dilatedMask, width, height, minPixels);
      await yieldToMain();
      
      return contours
        .map((poly: Array<{ x: number; y: number }>) => simplifyPolygon(poly, simplifyEpsWalls))
        .map((poly: Array<{ x: number; y: number }>) => offsetPolygon(poly, offsetX, offsetY))
        // Use a finer snap for walls to avoid collapsing beveled corners
        .map((poly: Array<{ x: number; y: number }>) => snapPolygonToGrid(poly, Math.max(2, Math.round(gridSize / 2))))
        .map((poly: Array<{ x: number; y: number }>) => clampPolygon(poly, canvas.width, canvas.height))
        .map((points: Array<{ x: number; y: number }>) => ({ points: flattenPoints(points) }));
    };

    let wallsPoly = await toWallPolys(masksWalls.walls, wallImg.width, wallImg.height, wallRect.x, wallRect.y);
    console.log(`Found ${wallsPoly.length} wall polygons`);
    await yieldToMain();

    // Drop the outer perimeter wall polygon that spans the entire fairway bbox (we don't support holes in polys)
    wallsPoly = wallsPoly.filter((p: { points: number[] }) => !isPerimeterPoly(p.points, fairway));
    
    // Remove large filled areas that are likely misclassified fairway regions
    const fairwayArea = Math.max(1, fairway.w * fairway.h);
    const isLargeFill = (poly: { points: number[] }) => {
      const polyArea = polygonArea(poly.points);
      const areaFrac = polyArea / fairwayArea;
      // If polygon covers more than 25% of fairway area, it's likely a misclassified fill
      return areaFrac > 0.25;
    };
    wallsPoly = wallsPoly.filter((p: { points: number[] }) => !isLargeFill(p));
    
    // Remove misclassified giant fills: if interior samples are mostly green, it's not a wall
    const greenDrop = (poly: { points: number[] }) => estimateGreenFractionInPolygon(imgData, poly.points, thresholds, Math.max(5, Math.round(Math.min(gridSize, 12))), 1800) >= 0.8;
    wallsPoly = wallsPoly.filter((p: { points: number[] }) => !greenDrop(p));
    console.log(`After filtering: ${wallsPoly.length} wall polygons`);
    await yieldToMain();

    let sandPoly = await toPolys(masksFW.sand, fairImg.width, fairImg.height, fairway.x, fairway.y);
    console.log(`Found ${sandPoly.length} sand polygons`);
    await yieldToMain();

    let waterPoly = await toPolys(masksFW.water, fairImg.width, fairImg.height, fairway.x, fairway.y);
    console.log(`Found ${waterPoly.length} water polygons`);
    await yieldToMain();

    const minPolyArea = Math.max(100, Math.round(gridSize * gridSize * 0.8));
    sandPoly = sandPoly.filter((p: { points: number[] }) => polygonArea(p.points) >= minPolyArea);
    waterPoly = waterPoly.filter((p: { points: number[] }) => polygonArea(p.points) >= minPolyArea);
    const fairArea = Math.max(1, fairway.w * fairway.h);
    const sandFrac = totalPolyArea(sandPoly) / fairArea;
    const waterFrac = totalPolyArea(waterPoly) / fairArea;
    if (sandFrac < 0.005) sandPoly = [];
    if (waterFrac < 0.005) waterPoly = [];

    // 4) Cup detection (dark circular blob) inside fairway with simple fallback
    console.log('Detecting cup...');
    // Run cup detection on cropped image to reduce memory/CPU, then offset back
    const cupLocal = detectCup(fairImg, localFair);
    const cupDetectedCandidate = cupLocal ? { x: cupLocal.x + fairway.x, y: cupLocal.y + fairway.y, r: cupLocal.r } : null;
    const cup = cupDetectedCandidate || {
      x: fairway.x + fairway.w - Math.max(20, Math.round(fairway.w * 0.08)),
      y: fairway.y + Math.round(fairway.h / 2),
      r: 12
    };
    await yieldToMain();

    // 5) Tee placement (fallback left-center)
    const tee = {
      x: fairway.x + Math.max(20, Math.round(fairway.w * 0.08)),
      y: fairway.y + Math.round(fairway.h / 2),
      r: 8
    };

    // Compose LevelData draft
    console.log('Composing level data...');
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

    console.log('Screenshot import completed successfully');
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
  
  // Performance optimization: limit maximum canvas size to prevent browser crashes
  const MAX_CANVAS_SIZE = 2048; // Maximum dimension in pixels
  const MAX_PIXELS = 2048 * 1536; // Maximum total pixels (~3MP)
  
  let canvasW = Math.max(400, Math.round(targetW || img.naturalWidth || 800));
  let canvasH = Math.max(300, Math.round(targetH || img.naturalHeight || 600));
  
  // Enforce maximum size constraints
  if (canvasW > MAX_CANVAS_SIZE || canvasH > MAX_CANVAS_SIZE) {
    const scale = Math.min(MAX_CANVAS_SIZE / canvasW, MAX_CANVAS_SIZE / canvasH);
    canvasW = Math.round(canvasW * scale);
    canvasH = Math.round(canvasH * scale);
  }
  
  // Enforce maximum pixel count
  if (canvasW * canvasH > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / (canvasW * canvasH));
    canvasW = Math.round(canvasW * scale);
    canvasH = Math.round(canvasH * scale);
  }
  
  canvas.width = canvasW;
  canvas.height = canvasH;
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
    walls:   { sMax: 0.30, vMin: 0.50 }
  } as const;
}

export type Thresholds = ReturnType<typeof buildDefaultThresholds>;

// Segment into binary masks (Uint8Array 0/1) limited to the fairway bbox region
export function segmentByColor(img: ImageData, fair: { x: number; y: number; w: number; h: number }, t: Thresholds): { fairway: Uint8Array; walls: Uint8Array; sand: Uint8Array; water: Uint8Array } {
  const { data, width, height } = img;
  const N = width * height;
  const fairMask = new Uint8Array(N);
  let wallsMask = new Uint8Array(N);
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
      const isGreenHue = inHueRange(h, t.fairway.hMin, t.fairway.hMax);
      if (isFair) fairMask[idx] = 1;
      if (!insideFair(x, y)) continue; // only detect features within fairway bbox
      if (v >= t.water.vMin && s >= t.water.sMin && inHueRange(h, t.water.hMin, t.water.hMax)) waterMask[idx] = 1;
      if (v >= t.sand.vMin && s >= t.sand.sMin && inHueRange(h, t.sand.hMin, t.sand.hMax)) sandMask[idx] = 1;
      // walls: light gray (low saturation), high value
      // Relax hue gating: for very low saturation we ignore hue completely; for moderate saturation avoid blue/tan hues.
      if (s <= t.walls.sMax && v >= t.walls.vMin && !isFair) {
        const isBlue = inHueRange(h, t.water.hMin, t.water.hMax) && s >= t.water.sMin;
        const isTan = inHueRange(h, t.sand.hMin, t.sand.hMax) && s >= t.sand.sMin;
        // If saturation is low (<0.15), accept as wall regardless of hue; otherwise avoid blue/tan.
        if (s < 0.15 || (!isBlue && !isTan)) wallsMask[idx] = 1;
      }
    }
  }
  // Note: We already restrict feature detection (water/sand/walls) to the fairway bounding box
  // via `insideFair(x,y)` above. Do NOT intersect with the green fairway mask or require adjacency
  // to fairway edges — that collapses thick wall bands to 1px outlines. Return masks as-is to
  // preserve full wall thickness for contour tracing.
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
  const { data, width, height } = imgData;
  const idx4 = (x: number, y: number) => (y * width + x) * 4;
  const inside = (x: number, y: number) => x >= fair.x && x < fair.x + fair.w && y >= fair.y && y < fair.y + fair.h;

  // Build a binary mask of dark, low-saturation pixels within the fairway rect
  const mask = new Uint8Array(width * height);
  for (let y = fair.y; y < fair.y + fair.h; y++) {
    for (let x = fair.x; x < fair.x + fair.w; x++) {
      const i = idx4(x, y);
      const a = data[i + 3]; if (a < 10) continue;
      const r = data[i + 0], g = data[i + 1], b = data[i + 2];
      const { s, v } = rgbToHsv(r, g, b);
      if (v < 0.18 && s < 0.35) mask[y * width + x] = 1;
    }
  }

  // Connected-components (4-neighborhood) to find blobs; score by circularity and size
  const visited = new Uint8Array(width * height);
  type Blob = { cx: number; cy: number; count: number; minX: number; minY: number; maxX: number; maxY: number };
  const blobs: Blob[] = [];
  const qx = new Int32Array(width * height);
  const qy = new Int32Array(width * height);

  const pushBlob = (startX: number, startY: number) => {
    let head = 0, tail = 0;
    qx[tail] = startX; qy[tail] = startY; tail++;
    visited[startY * width + startX] = 1;
    let sumX = 0, sumY = 0, count = 0;
    let minX = startX, minY = startY, maxX = startX, maxY = startY;
    while (head < tail) {
      const x = qx[head], y = qy[head]; head++;
      sumX += x; sumY += y; count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      // 4-neighbors
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as Array<[number, number]>;
      for (let k = 0; k < 4; k++) {
        const nx = nb[k][0], ny = nb[k][1];
        if (!inside(nx, ny)) continue;
        const p = ny * width + nx;
        if (visited[p] || mask[p] !== 1) continue;
        visited[p] = 1; qx[tail] = nx; qy[tail] = ny; tail++;
      }
    }
    if (count > 0) blobs.push({ cx: Math.round(sumX / count), cy: Math.round(sumY / count), count, minX, minY, maxX, maxY });
  };

  for (let y = fair.y; y < fair.y + fair.h; y++) {
    for (let x = fair.x; x < fair.x + fair.w; x++) {
      const p = y * width + x;
      if (mask[p] === 1 && !visited[p]) pushBlob(x, y);
    }
  }

  if (blobs.length === 0) return null;

  // Score blobs: prefer near-circular, reasonable size, away from edges
  const fairMargin = Math.max(8, Math.round(Math.min(fair.w, fair.h) * 0.01));
  const minCluster = Math.max(12, Math.round((fair.w * fair.h) / 8000));
  let best: { score: number; cx: number; cy: number; r: number } | null = null;
  for (const b of blobs) {
    if (b.count < minCluster) continue;
    const w = (b.maxX - b.minX + 1);
    const h = (b.maxY - b.minY + 1);
    const rEst = Math.sqrt(b.count / Math.PI);
    const rBox = Math.max(w, h) / 2;
    const roundness = Math.min(1, b.count / (Math.PI * rBox * rBox));
    const aspect = Math.min(w, h) / Math.max(w, h);
    const edgeDist = Math.min(b.cx - fair.x, fair.x + fair.w - b.cx, b.cy - fair.y, fair.y + fair.h - b.cy);
    const edgeFactor = Math.max(0, Math.min(1, (edgeDist - fairMargin) / (fairMargin * 3 + 1e-6)));
    const score = roundness * 0.7 + aspect * 0.2 + edgeFactor * 0.1;
    // Consider plausible radius range (allow smaller clusters on small canvases/tests)
    if (rEst < 3 || rEst > 20) continue;
    if (!best || score > best.score) best = { score, cx: b.cx, cy: b.cy, r: rEst };
  }

  if (!best) return null;
  return { x: Math.round(best.cx), y: Math.round(best.cy), r: Math.round(Math.max(6, Math.min(16, best.r))) };
}

// Async contour tracing with periodic yielding to prevent UI blocking
export async function traceContoursAsync(mask: Uint8Array, width: number, height: number, minPixels: number): Promise<Array<Array<{ x: number; y: number }>>> {
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

  let processedPixels = 0;
  const YIELD_INTERVAL = 10000; // Yield every 10k pixels processed

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      processedPixels++;
      if (processedPixels % YIELD_INTERVAL === 0) {
        await yieldToMain(); // Yield periodically to prevent UI blocking
      }

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

function offsetPolygon(points: Array<{ x: number; y: number }>, dx: number, dy: number): Array<{ x: number; y: number }> {
  if (!Array.isArray(points) || points.length === 0) return points;
  return points.map(p => ({ x: p.x + dx, y: p.y + dy }));
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

// Create a cropped ImageData of rect {x,y,w,h} from the source ImageData
function cropImageData(src: ImageData, rect: { x: number; y: number; w: number; h: number }): ImageData {
  const sx = Math.max(0, Math.min(src.width, Math.floor(rect.x)));
  const sy = Math.max(0, Math.min(src.height, Math.floor(rect.y)));
  const sw = Math.max(1, Math.min(src.width - sx, Math.floor(rect.w)));
  const sh = Math.max(1, Math.min(src.height - sy, Math.floor(rect.h)));
  const out = new ImageData(sw, sh);
  const sdata = src.data;
  const ddata = out.data;
  const srcStride = src.width * 4;
  const dstStride = sw * 4;
  for (let row = 0; row < sh; row++) {
    const sOff = ((sy + row) * src.width + sx) * 4;
    const dOff = row * dstStride;
    ddata.set(sdata.subarray(sOff, sOff + dstStride), dOff);
  }
  return out;
}

// Heuristic: identify the outer perimeter wall polygon that hugs the fairway rectangle.
// Because we don't support polygon holes, filling this polygon would cover the entire fairway.
function isPerimeterPoly(flatPoints: number[], fair: { x: number; y: number; w: number; h: number }): boolean {
  if (!Array.isArray(flatPoints) || flatPoints.length < 8) return false;
  // Compute bounding box of the polygon
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < flatPoints.length; i += 2) {
    const x = flatPoints[i];
    const y = flatPoints[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const tol = Math.max(2, Math.round(Math.min(fair.w, fair.h) * 0.02));
  const nearLeft = Math.abs(minX - fair.x) <= tol;
  const nearRight = Math.abs(maxX - (fair.x + fair.w)) <= tol;
  const nearTop = Math.abs(minY - fair.y) <= tol;
  const nearBottom = Math.abs(maxY - (fair.y + fair.h)) <= tol;
  const sidesNear = [nearLeft, nearRight, nearTop, nearBottom].filter(Boolean).length;

  // Area check (shoelace). Large area relative to fairway indicates a flood-fill risk.
  let area = 0;
  for (let i = 0; i + 3 < flatPoints.length; i += 2) {
    const x1 = flatPoints[i], y1 = flatPoints[i + 1];
    const x2 = flatPoints[(i + 2) % flatPoints.length], y2 = flatPoints[(i + 3) % flatPoints.length];
    area += x1 * y2 - x2 * y1;
  }
  const polyArea = Math.abs(area) * 0.5;
  const fairArea = Math.max(1, fair.w * fair.h);
  const areaFrac = polyArea / fairArea;

  // Consider it a perimeter poly if it hugs at least 3 sides and is large,
  // or hugs all 4 sides with moderately large area.
  if ((sidesNear >= 3 && areaFrac >= 0.35) || (sidesNear === 4 && areaFrac >= 0.20)) return true;
  return false;
}

// Ray-casting point-in-polygon for flat [x0,y0,x1,y1,...]
function pointInPolygonFlat(px: number, py: number, flat: number[]): boolean {
  let inside = false;
  const n = flat.length;
  for (let i = 0, j = (n - 2); i < n; i += 2) {
    const xi = flat[i], yi = flat[i + 1];
    const xj = flat[j], yj = flat[j + 1];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-6) + xi);
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

// Estimate fraction of green pixels inside a polygon by uniform grid sampling
function estimateGreenFractionInPolygon(
  img: ImageData,
  flatPoints: number[],
  t: Thresholds,
  baseStep: number,
  sampleLimit: number
): number {
  if (!flatPoints || flatPoints.length < 6) return 0;
  // BBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < flatPoints.length; i += 2) {
    const x = flatPoints[i], y = flatPoints[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // Clamp bbox to image bounds
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(img.width - 1, Math.ceil(maxX));
  maxY = Math.min(img.height - 1, Math.ceil(maxY));

  // Derive step from area to keep within sampleLimit
  const area = polygonArea(flatPoints);
  const targetSamples = Math.max(200, Math.min(sampleLimit, Math.round(area / Math.max(1, baseStep))));
  const spanX = Math.max(1, maxX - minX + 1);
  const spanY = Math.max(1, maxY - minY + 1);
  const gridSide = Math.max(1, Math.sqrt((spanX * spanY) / Math.max(1, targetSamples)));
  const step = Math.max(3, Math.round(Math.min( Math.max(baseStep, gridSide), 24)));

  const data = img.data;
  let total = 0, green = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!pointInPolygonFlat(x + 0.5, y + 0.5, flatPoints)) continue;
      const idx = (y * img.width + x) * 4;
      const a = data[idx + 3]; if (a < 10) continue;
      const r = data[idx + 0], g = data[idx + 1], b = data[idx + 2];
      const { h, s, v } = rgbToHsv(r, g, b);
      const isGreen = (v >= t.fairway.vMin && s >= t.fairway.sMin && inHueRange(h, t.fairway.hMin, t.fairway.hMax));
      if (isGreen) green++;
      total++;
      if (total >= sampleLimit) {
        return total ? (green / total) : 0;
      }
    }
  }
  return total ? (green / total) : 0;
}

// Convert manual annotations to LevelData
export function importLevelFromAnnotations(annotations: AnnotationData, opts: AnnotationOptions): LevelData {
  console.log('Converting annotations to level data...');
  // Compute scale from source (annotation canvas) to target level size
  const srcW = Math.max(1, Math.round(opts.sourceWidth || opts.targetWidth));
  const srcH = Math.max(1, Math.round(opts.sourceHeight || opts.targetHeight));
  const scaleX = (opts.targetWidth && srcW) ? (opts.targetWidth / srcW) : 1;
  const scaleY = (opts.targetHeight && srcH) ? (opts.targetHeight / srcH) : 1;
  const scaleR = (scaleX + scaleY) * 0.5;
  
  // Helper function to convert annotation points to level coordinates
  const convertPoints = (points: Array<{ x: number; y: number }>) => {
    return points.map(p => ({ x: Math.round(p.x * scaleX), y: Math.round(p.y * scaleY) }));
  };
  
  // Helper function to snap polygon to grid if enabled
  const snapPolygonToGrid = (points: Array<{ x: number; y: number }>, gridSize?: number) => {
    if (!gridSize) return points;
    return points.map(p => ({
      x: Math.round(p.x / gridSize) * gridSize,
      y: Math.round(p.y / gridSize) * gridSize
    }));
  };
  
  // Helper function to flatten points array
  const flattenPoints = (points: Array<{ x: number; y: number }>) => {
    const flat: number[] = [];
    for (const p of points) {
      flat.push(p.x, p.y);
    }
    return flat;
  };
  
  // Create level data structure
  const level: LevelData = {
    fairway: { x: 50, y: 50, w: opts.targetWidth - 100, h: opts.targetHeight - 100 },
    walls: [],
    wallsPoly: [],
    water: [],
    waterPoly: [],
    sand: [],
    sandPoly: [],
    hills: [],
    posts: [],
    tee: { x: 100, y: opts.targetHeight / 2, r: 8 },
    cup: { x: opts.targetWidth - 100, y: opts.targetHeight / 2, r: 12 },
    meta: {
      title: 'Annotated Level',
      authorName: 'User',
      authorId: '',
      par: 3,
      description: 'Level created from screenshot annotation',
      tags: ['imported', 'annotated'],
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    }
  };
  
  // Convert fairway
  if (annotations.fairway && annotations.fairway.points.length >= 3) {
    const points = snapPolygonToGrid(convertPoints(annotations.fairway.points), opts.gridSize);
    // Calculate bounding box for fairway
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    level.fairway = {
      x: Math.max(0, minX - 10),
      y: Math.max(0, minY - 10),
      w: Math.min(opts.targetWidth, maxX - minX + 20),
      h: Math.min(opts.targetHeight, maxY - minY + 20)
    };
  }
  const canvasW = opts.targetWidth;
  const canvasH = opts.targetHeight;

  // Helper: canvas corners (for detecting outer fills)
  const canvasCorners = [
    { x: 0, y: 0 },
    { x: canvasW - 1, y: 0 },
    { x: canvasW - 1, y: canvasH - 1 },
    { x: 0, y: canvasH - 1 }
  ];

  // Helper: fairway bbox derived from level.fairway
  const fw = level.fairway;
  const fairwayBBox = fw ? { x: fw.x, y: fw.y, w: fw.w, h: fw.h } : { x: 80, y: 60, w: canvasW - 160, h: canvasH - 120 };
  const hasFairwayPoly = !!annotations.fairway && annotations.fairway.points.length >= 3;

  // Helper to make a rectangle polygon from x,y,w,h
  const rectPoly = (x: number, y: number, w: number, h: number) => [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
  ];

  // Helper: convert and push polygon points to a target array as { points: number[] }
  const pushPoly = (arr: Array<{ points: number[] }>, pts: Array<{x:number;y:number}>) => {
    const snapped = snapPolygonToGrid(pts, opts.gridSize);
    arr.push({ points: flattenPoints(snapped) });
  };
  
  // Convert wall polygons (filter giant outer fills, optional auto border)
  const wallFlats: Array<{ points: number[] }> = [];
  let hasOuterWallFill = false;
  const areaCanvas = canvasW * canvasH;
  for (const wall of annotations.walls) {
    if (wall.points.length >= 3) {
      const pts = convertPoints(wall.points);
      // Detect outer wall fills (annotate flow): require ≥2 canvas corners inside AND a fairway polygon present
      const cornersInside = canvasCorners.reduce((n, c) => n + (pointInPolygon(c.x, c.y, pts) ? 1 : 0), 0);
      if (hasFairwayPoly && cornersInside >= 2) {
        hasOuterWallFill = true; // we will replace with border band if enabled
        continue;
      }
      pushPoly(wallFlats, pts);
    }
  }
  
  // Convert water polygons (outer water detection -> border strips)
  const waterFlats: Array<{ points: number[] }> = [];
  let hasOuterWater = false;
  for (const water of annotations.water) {
    if (water.points.length >= 3) {
      const pts = convertPoints(water.points);
      const cornersInside = canvasCorners.reduce((n, c) => n + (pointInPolygon(c.x, c.y, pts) ? 1 : 0), 0);
      if (hasFairwayPoly && cornersInside >= 2) {
        hasOuterWater = true; // treat as sea around fairway
        continue;
      }
      pushPoly(waterFlats, pts);
    }
  }
  
  // Convert sand polygons (keep as drawn; inner shapes preserved)
  const sandFlats: Array<{ points: number[] }> = [];
  for (const sand of annotations.sand) {
    if (sand.points.length >= 3) {
      const pts = convertPoints(sand.points);
      pushPoly(sandFlats, pts);
    }
  }
  
  // Convert hills
  for (const hill of annotations.hills) {
    if (hill.points.length >= 3) {
      const points = snapPolygonToGrid(convertPoints(hill.points), opts.gridSize);
      level.hills.push({
        points: flattenPoints(points),
        direction: hill.direction || 0
      });
    }
  }

  // Optional auto border generation using fairway bbox
  const enableAutoWaterBorder = opts.enableAutoWaterBorder !== false;
  const enableAutoWallBorder = opts.enableAutoWallBorder !== false;
  const waterThickness = Math.max(1, Math.round(opts.waterBorderThickness ?? 24));
  const wallThickness  = Math.max(1, Math.round(opts.wallBorderThickness  ?? 12));

  // Generate border strips around fairway bbox against canvas edges
  const addBorderStrips = (thickness: number, target: Array<{ points: number[] }>) => {
    const x = Math.max(0, fairwayBBox.x);
    const y = Math.max(0, fairwayBBox.y);
    const r = Math.min(canvasW, fairwayBBox.x + fairwayBBox.w);
    const b = Math.min(canvasH, fairwayBBox.y + fairwayBBox.h);
    // top strip
    if (y > 0) pushPoly(target, rectPoly(0, Math.max(0, y - thickness), canvasW, Math.min(thickness, y)));
    // bottom strip
    if (b < canvasH) pushPoly(target, rectPoly(0, b, canvasW, Math.min(thickness, canvasH - b)));
    // left strip
    if (x > 0) pushPoly(target, rectPoly(Math.max(0, x - thickness), y, Math.min(thickness, x), Math.max(0, b - y)));
    // right strip
    if (r < canvasW) pushPoly(target, rectPoly(r, y, Math.min(thickness, canvasW - r), Math.max(0, b - y)));
  };

  // Apply collected polys and optional borders
  // Walls
  for (const f of wallFlats) level.wallsPoly.push(f);
  if (enableAutoWallBorder && hasFairwayPoly && hasOuterWallFill) {
    addBorderStrips(wallThickness, level.wallsPoly);
  }

  // Water
  for (const f of waterFlats) level.waterPoly.push(f);
  if (enableAutoWaterBorder && hasFairwayPoly && (hasOuterWater || annotations.water.length === 0)) {
    addBorderStrips(waterThickness, level.waterPoly);
  }

  // Sand
  for (const f of sandFlats) level.sandPoly.push(f);
  
  // Convert posts
  for (const post of annotations.posts) {
    level.posts.push({
      x: Math.round(post.x * scaleX),
      y: Math.round(post.y * scaleY),
      r: Math.max(1, Math.round(post.r * scaleR))
    });
  }
  
  // Convert tee
  if (annotations.tee) {
    level.tee = {
      x: Math.round(annotations.tee.x * scaleX),
      y: Math.round(annotations.tee.y * scaleY),
      r: Math.max(1, Math.round(annotations.tee.r * scaleR))
    };
  }
  
  // Convert cup
  if (annotations.cup) {
    level.cup = {
      x: Math.round(annotations.cup.x * scaleX),
      y: Math.round(annotations.cup.y * scaleY),
      r: Math.max(1, Math.round(annotations.cup.r * scaleR))
    };
  }
  
  console.log('Annotation conversion complete:', {
    walls: level.wallsPoly.length,
    water: level.waterPoly.length,
    sand: level.sandPoly.length,
    hills: level.hills.length,
    posts: level.posts.length,
    hasTee: !!annotations.tee,
    hasCup: !!annotations.cup,
    hasFairway: !!annotations.fairway
  });
  
  return level;
}

// Annotation selection utilities
export function findAnnotationAtPoint(
  annotations: AnnotationData, 
  x: number, 
  y: number, 
  tolerance: number = 14
): { type: string; index: number } | null {
  
  // Helper function to check if point is near a line segment
  const nearLineSegment = (x1: number, y1: number, x2: number, y2: number, px: number, py: number, tolerance: number): boolean => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return Math.sqrt(A * A + B * B) <= tolerance;
    
    let param = dot / lenSq;
    param = Math.max(0, Math.min(1, param));
    
    const xx = x1 + param * C;
    const yy = y1 + param * D;
    
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy) <= tolerance;
  };
  
  // Helper function to check if point is near polygon boundary
  const nearPolygonBoundary = (points: Array<{ x: number; y: number }>, px: number, py: number, tolerance: number): boolean => {
    if (points.length < 2) return false;
    
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      
      if (nearLineSegment(p1.x, p1.y, p2.x, p2.y, px, py, tolerance)) {
        return true;
      }
    }
    return false;
  };
  
  // Helper function to check if point is near a circle
  const nearCircle = (cx: number, cy: number, r: number, px: number, py: number, tolerance: number): boolean => {
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    return dist <= r + tolerance;
  };
  
  // Check posts (circles)
  for (let i = 0; i < annotations.posts.length; i++) {
    const post = annotations.posts[i];
    if (nearCircle(post.x, post.y, post.r, x, y, tolerance)) {
      return { type: 'posts', index: i };
    }
  }
  
  // Check tee (circle)
  if (annotations.tee && nearCircle(annotations.tee.x, annotations.tee.y, annotations.tee.r, x, y, tolerance)) {
    return { type: 'tee', index: 0 };
  }
  
  // Check cup (circle)
  if (annotations.cup && nearCircle(annotations.cup.x, annotations.cup.y, annotations.cup.r, x, y, tolerance)) {
    return { type: 'cup', index: 0 };
  }
  
  // Check walls (boundary-based selection for better wall handling)
  for (let i = annotations.walls.length - 1; i >= 0; i--) {
    const wall = annotations.walls[i];
    if (wall.points) {
      if (nearPolygonBoundary(wall.points, x, y, tolerance)) {
        return { type: 'walls', index: i };
      }
      // Inside-area fallback too: many users click inside the thick wall fill
      if (pointInPolygon(x, y, wall.points)) {
        return { type: 'walls', index: i };
      }
    }
  }
  
  // Check water (boundary-first, with inside fallback)
  for (let i = annotations.water.length - 1; i >= 0; i--) {
    const water = annotations.water[i];
    if (water.points) {
      if (nearPolygonBoundary(water.points, x, y, tolerance)) {
        return { type: 'water', index: i };
      }
      // Inside-area fallback for large filled regions like lakes/borders
      if (pointInPolygon(x, y, water.points)) {
        return { type: 'water', index: i };
      }
    }
  }
  
  // Check sand (boundary-first, with inside fallback)
  for (let i = annotations.sand.length - 1; i >= 0; i--) {
    const sand = annotations.sand[i];
    if (sand.points) {
      if (nearPolygonBoundary(sand.points, x, y, tolerance)) {
        return { type: 'sand', index: i };
      }
      if (pointInPolygon(x, y, sand.points)) {
        return { type: 'sand', index: i };
      }
    }
  }
  
  // Check hills (boundary-first, with inside fallback)
  for (let i = annotations.hills.length - 1; i >= 0; i--) {
    const hill = annotations.hills[i];
    if (hill.points) {
      if (nearPolygonBoundary(hill.points, x, y, tolerance)) {
        return { type: 'hills', index: i };
      }
      if (pointInPolygon(x, y, hill.points)) {
        return { type: 'hills', index: i };
      }
    }
  }
  
  // Check fairway (boundary-first, with inside fallback)
  if (annotations.fairway && annotations.fairway.points) {
    if (nearPolygonBoundary(annotations.fairway.points, x, y, tolerance)) {
      return { type: 'fairway', index: 0 };
    }
    if (pointInPolygon(x, y, annotations.fairway.points)) {
      return { type: 'fairway', index: 0 };
    }
  }
  
  return null;
}

// Helper function to check if point is inside polygon (fallback for area-based selection)
export function pointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (((points[i].y > y) !== (points[j].y > y)) &&
        (x < (points[j].x - points[i].x) * (y - points[i].y) / (points[j].y - points[i].y) + points[i].x)) {
      inside = !inside;
    }
  }
  return inside;
}
