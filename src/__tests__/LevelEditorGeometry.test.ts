import { describe, it, expect } from 'vitest';
import { rectLikeToPolygonPoints } from '../editor/levelEditor';

const coordsToPairs = (points: number[]): Array<{ x: number; y: number }> => {
  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pairs.push({ x: points[i], y: points[i + 1] });
  }
  return pairs;
};

describe('rectLikeToPolygonPoints', () => {
  it('returns four corners for axis-aligned rectangles', () => {
    const points = rectLikeToPolygonPoints({ x: 10, y: 20, w: 30, h: 40 });
    expect(points).toHaveLength(8);
    const pairs = coordsToPairs(points);
    expect(pairs).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 }
    ]);
  });

  it('rotates rectangle corners around center when rot is provided', () => {
    const rotPoints = rectLikeToPolygonPoints({ x: 10, y: 20, w: 30, h: 10, rot: Math.PI / 2 });
    expect(rotPoints).toHaveLength(8);
    const pairs = coordsToPairs(rotPoints);
    const expected = [
      { x: 30, y: 10 },
      { x: 30, y: 40 },
      { x: 20, y: 40 },
      { x: 20, y: 10 }
    ];
    pairs.forEach((pair, index) => {
      expect(pair.x).toBeCloseTo(expected[index].x, 6);
      expect(pair.y).toBeCloseTo(expected[index].y, 6);
    });
  });
});
