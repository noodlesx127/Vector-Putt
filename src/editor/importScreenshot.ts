// Screenshot → Level Importer (MVP)
// Dependency-light Canvas pipeline to convert a top-down screenshot into a draft LevelData.
// Phase 1 focuses on basic fairway bounding and cup detection; walls/sand/water extraction will follow.

export interface ScreenshotImportOptions {
  targetWidth: number;
  targetHeight: number;
  gridSize?: number;
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

    // 2) Simple cup detection (dark circular blob) inside fairway
    const cup = detectCup(imgData, fairway) || {
      x: fairway.x + fairway.w - Math.max(20, Math.round(fairway.w * 0.08)),
      y: fairway.y + Math.round(fairway.h / 2),
      r: 12
    };

    // 3) Tee placement (fallback left-center)
    const tee = {
      x: fairway.x + Math.max(20, Math.round(fairway.w * 0.08)),
      y: fairway.y + Math.round(fairway.h / 2),
      r: 8
    };

    // Compose minimal LevelData draft
    const level: LevelData = {
      canvas: { width: canvas.width, height: canvas.height },
      course: { index: 1, total: 1, title: 'Imported Level' },
      par: 3,
      tee: { x: tee.x, y: tee.y, r: tee.r },
      cup: { x: cup.x, y: cup.y, r: Math.max(8, Math.min(20, Math.round(cup.r || 12))) },
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
      meta: {
        title: 'Imported Level',
        description: 'Draft created from screenshot',
        tags: ['imported', 'screenshot']
      }
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

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
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

function findGreenBoundingBox(imgData: ImageData): { x: number; y: number; w: number; h: number } | null {
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

function expandOrFallback(bb: { x: number; y: number; w: number; h: number } | null, W: number, H: number, margin: number) {
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

function detectCup(imgData: ImageData, fair: { x: number; y: number; w: number; h: number }): { x: number; y: number; r: number } | null {
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
  if (count < 50) return null; // too few pixels
  const cx = Math.round(sumX / count);
  const cy = Math.round(sumY / count);
  const rEst = Math.max(8, Math.round(Math.sqrt(count / Math.PI)));
  return { x: cx, y: cy, r: rEst };
}
