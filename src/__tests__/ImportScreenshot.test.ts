// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  rgbToHsv,
  hexToRgb,
  buildDefaultThresholds,
  inHueRange,
  segmentByColor,
  findGreenBoundingBox,
  expandOrFallback,
  detectCup,
  traceContours,
  simplifyPolygon,
  type Thresholds,
} from '../editor/importScreenshot';

function makeImageData(width: number, height: number, fill: [number, number, number, number] = [0,0,0,255]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i+0] = fill[0];
      data[i+1] = fill[1];
      data[i+2] = fill[2];
      data[i+3] = fill[3];
    }
  }
  const ImageDataCtor: any = (globalThis as any).ImageData || class {
    data: Uint8ClampedArray; width: number; height: number;
    constructor(d: Uint8ClampedArray, w: number, h: number) { this.data = d; this.width = w; this.height = h; }
  };
  return new ImageDataCtor(data, width, height) as any as ImageData;
}

function paintRect(img: ImageData, x0: number, y0: number, x1: number, y1: number, color: [number, number, number, number]) {
  const { data, width, height } = img;
  for (let y = Math.max(0,y0); y < Math.min(height,y1); y++) {
    for (let x = Math.max(0,x0); x < Math.min(width,x1); x++) {
      const i = (y * width + x) * 4;
      data[i+0] = color[0];
      data[i+1] = color[1];
      data[i+2] = color[2];
      data[i+3] = color[3];
    }
  }
}

describe('importScreenshot helpers', () => {
  it('rgbToHsv basic colors', () => {
    const g = rgbToHsv(0x12, 0x6a, 0x23);
    expect(g.s).toBeGreaterThan(0.2);
    const w = rgbToHsv(255,255,255);
    expect(w.s).toBeCloseTo(0);
    const b = rgbToHsv(0,0,255);
    expect(b.h).toBeGreaterThan(200);
  });

  it('inHueRange wrap-around', () => {
    expect(inHueRange(350, 300, 40)).toBe(true);
    expect(inHueRange(10, 300, 40)).toBe(true);
    expect(inHueRange(200, 300, 40)).toBe(false);
  });

  it('findGreenBoundingBox and segmentByColor identify fairway and features', () => {
    const W = 40, H = 24;
    const img = makeImageData(W, H, [0,0,0,255]);
    const fair = hexToRgb('#126a23');
    const water = hexToRgb('#1f6dff');
    const sand = hexToRgb('#d4b36a');
    const wall = hexToRgb('#e2e2e2');

    // Fairway rectangle
    paintRect(img, 4, 4, 36, 20, [fair.r, fair.g, fair.b, 255]);
    // Water patch inside fairway
    paintRect(img, 20, 10, 28, 14, [water.r, water.g, water.b, 255]);
    // Sand patch inside fairway
    paintRect(img, 8, 12, 14, 16, [sand.r, sand.g, sand.b, 255]);
    // Wall light gray patch inside fairway
    paintRect(img, 30, 6, 34, 8, [wall.r, wall.g, wall.b, 255]);

    const bb = findGreenBoundingBox(img)!;
    expect(bb).toBeTruthy();
    expect(bb.x).toBeLessThanOrEqual(6);
    expect(bb.y).toBeLessThanOrEqual(6);

    const fairway = expandOrFallback(bb, W, H, 2);
    const t = buildDefaultThresholds();
    const masks = segmentByColor(img, fairway, t);

    // A few sample pixels to verify masks
    const idx = (x: number, y: number) => y * W + x;
    expect(masks.fairway[idx(5,5)]).toBe(1);
    expect(masks.water[idx(21,11)]).toBe(1);
    expect(masks.sand[idx(9,13)]).toBe(1);
    // walls are low-sat high-V, not green/blue/tan
    expect(masks.walls[idx(31,7)]).toBe(1);
  });

  it('detectCup finds dark cluster center', () => {
    const W = 40, H = 24;
    const img = makeImageData(W, H, [18, 90, 35, 255]); // greenish base
    // Dark cluster near (30, 12)
    for (let y = 11; y <= 13; y++) for (let x = 29; x <= 31; x++) {
      const i = (y * W + x) * 4; img.data[i+0] = 8; img.data[i+1] = 8; img.data[i+2] = 8; img.data[i+3] = 255;
    }
    const fair = { x: 0, y: 0, w: W, h: H };
    const cup = detectCup(img, fair);
    expect(cup).toBeTruthy();
    expect(cup!.x).toBeGreaterThanOrEqual(28);
    expect(cup!.x).toBeLessThanOrEqual(32);
    expect(cup!.y).toBeGreaterThanOrEqual(10);
    expect(cup!.y).toBeLessThanOrEqual(14);
  });

  it('traceContours returns an outline for a filled rectangle mask', () => {
    const W = 20, H = 12;
    const mask = new Uint8Array(W * H);
    for (let y = 3; y <= 8; y++) for (let x = 4; x <= 15; x++) mask[y*W+x] = 1;
    const contours = traceContours(mask, W, H, 10);
    expect(contours.length).toBeGreaterThan(0);
    const poly = contours[0];
    expect(poly.length).toBeGreaterThan(8);
    const simplified = simplifyPolygon(poly, 2);
    expect(simplified.length).toBeGreaterThan(3);
  });
});
