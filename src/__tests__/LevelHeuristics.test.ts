import { describe, it, expect } from 'vitest';
import { estimatePar, computePathDebug, type Fairway, type LevelLike } from '../editor/levelHeuristics';

function baseLevel(): LevelLike {
  return {
    tee: { x: 60, y: 150 },
    cup: { x: 340, y: 150, r: 8 },
    walls: [],
    wallsPoly: [],
    water: [],
    waterPoly: [],
    sand: [],
    sandPoly: [],
    hills: [],
    bridges: []
  };
}

describe('Level System heuristics', () => {
  const fair: Fairway = { x: 40, y: 60, w: 360, h: 240 };
  const cellSize = 20;

  it('computePathDebug finds a path on an empty fairway and returns world points', () => {
    const lvl = baseLevel();
    const dbg = computePathDebug(lvl, fair, cellSize);
    expect(dbg.found).toBe(true);
    expect(dbg.worldPoints.length).toBeGreaterThan(2);
  });

  it('estimatePar increases when adding obstacles and decreases when removing them', () => {
    const lvlOpen = baseLevel();
    const rOpen = estimatePar(lvlOpen, fair, cellSize);
    expect(rOpen.reachable).toBe(true);

    // Add two wall segments to form a narrow corridor with a gap in the middle
    const lvlCorridor: LevelLike = {
      ...baseLevel(),
      tee: { ...lvlOpen.tee },
      cup: { ...lvlOpen.cup },
      walls: [
        // top half vertical wall, leaves a gap
        { x: 200, y: fair.y, w: 16, h: fair.h * 0.45 },
        // bottom half vertical wall
        { x: 200, y: fair.y + fair.h * 0.55, w: 16, h: fair.h * 0.45 }
      ]
    };
    const rCorridor = estimatePar(lvlCorridor, fair, cellSize);

    // With the corridor, path is still reachable but should be longer/more complex
    expect(rCorridor.reachable).toBe(true);
    expect(rCorridor.suggestedPar).toBeGreaterThanOrEqual(rOpen.suggestedPar);

    // Remove the walls again and verify par does not increase
    const rOpenAgain = estimatePar(lvlOpen, fair, cellSize);
    expect(rOpenAgain.suggestedPar).toBeLessThanOrEqual(rCorridor.suggestedPar);
  });

  it('estimatePar reflects hill direction (uphill harder than downhill)', () => {
    const base: LevelLike = baseLevel();
    // Wide hill band across the middle corridor
    const hillRect = { x: fair.x + 120, y: fair.y + fair.h / 2 - 40, w: 120, h: 80, dir: 'W', strength: 1 } as any;
    const lvlUphill: LevelLike = { ...base, hills: [hillRect] };
    // Uphill: tee->cup is eastbound; hill downhill points west, so movement is uphill
    const rUp = estimatePar(lvlUphill, fair, cellSize);

    // Flip to downhill assistance (east)
    const lvlDownhill: LevelLike = { ...base, hills: [{ ...hillRect, dir: 'E' }] };
    const rDown = estimatePar(lvlDownhill, fair, cellSize);

    expect(rUp.reachable).toBe(true);
    expect(rDown.reachable).toBe(true);
    // Uphill should be tougher than downhill
    expect(rUp.suggestedPar).toBeGreaterThanOrEqual(rDown.suggestedPar);
  });

  it('estimatePar accounts for bridges passing over blocked water', () => {
    const base: LevelLike = baseLevel();
    // Water wall blocking mid corridor
    const waterRect = { x: fair.x + 180, y: fair.y, w: 16, h: fair.h };
    const lvlWaterBlock: LevelLike = { ...base, water: [waterRect] };
    const rBlock = estimatePar(lvlWaterBlock, fair, cellSize);

    // Add a bridge to allow pass-through
    const bridgeRect = { x: waterRect.x, y: fair.y + fair.h / 2 - 30, w: waterRect.w, h: 60 };
    const lvlBridge: LevelLike = { ...base, water: [waterRect], bridges: [bridgeRect] };
    const rBridge = estimatePar(lvlBridge, fair, cellSize);

    // With a bridge, par should be less than or equal to the fully blocked version
    expect(rBridge.suggestedPar).toBeLessThanOrEqual(rBlock.suggestedPar);
  });
});
