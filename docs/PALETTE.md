# Palette

Canonical colors used by Vector Putt. Keep this file in sync with `src/main.ts` `COLORS`.

## Course and HUD
- table: `#7a7b1e` — Background "table" felt color behind the course and HUD.
- fairway: `#126a23` — Primary green for fairway surfaces.
- fairwayBand: `#115e20` — Subtle horizontal bands for retro look.
- fairwayLine: `#0b3b14` — Fairway outline (2px stroke on rectangles and bridges).
- holeFill: `#0a1a0b` — Cup interior.
- holeRim: `#0f3f19` — Cup rim stroke (2px).
- hudText: `#111111` — HUD text on mustard table background.
- hudBg: `#0d1f10` — Reserved for future HUD panels (currently HUD uses table background).

## Terrain
- waterFill: `#1f6dff` — Water bodies.
- waterStroke: `#1348aa` — Water outline (1.5–2px; rectangles use 1.5px inset stroke, polys 2px path stroke).
- sandFill: `#d4b36a` — Sand traps.
- sandStroke: `#a98545` — Sand outline (1.5–2px; rectangles use 1.5px inset stroke, polys 2px path stroke).

## Walls and Posts
- wallFill: `#e2e2e2` — Wall face and post face.
- wallStroke: `#bdbdbd` — Wall/post rim stroke (2px). Inner highlight uses `rgba(255,255,255,0.25)`.

## UI neutrals and accents
- white: `#ffffff` — General UI text/buttons, ball fill, menu labels.
- lightGray: `#cfd2cf` — Button borders (non-hover), putter shaft, etc.
- accentRed: `#d11e2a` — Menu flag and flower centers.
- overlays: `rgba(0,0,0,0.10–0.65)` — Various scrims and gradients; water ripples use animated `rgba(255,255,255,alpha)`.

## Outlines and styles
- Fairway: 2px `fairwayLine` rectangle stroke.
- Bridges: 1.5px `fairwayLine` rectangle stroke.
- Water: rectangles 1.5px inset stroke; polygons 2px path stroke using `waterStroke`.
- Sand: rectangles 1.5px inset stroke; polygons 2px path stroke using `sandStroke`.
- Walls/Posts: 2px `wallStroke` rim + subtle white highlight on top/left.
- Cup: 2px `holeRim` stroke.

## Effects & Compositing (Seamless)

- Seamless terrain outlines: for Water and Sand, render outlines first (stroke), then fills. For polygons, do a two‑pass approach: stroke all polygons first, then fill all polygons. This hides any shared‑edge strokes while preserving the outer rims.
- Walls/Posts: fill face then stroke rim with bevel joins for chamfers (`lineJoin='bevel'`, tuned `miterLimit`).
- Wall/post depth: add a subtle top/left highlight `rgba(255,255,255,0.22–0.25)` and a soft bottom/right shadow `rgba(0,0,0,0.28–0.35)`; these are visual only and do not affect collision.
- Sand recess: optional inner shadow `rgba(0,0,0,0.12–0.16)` feathered inward 2–3px on large shapes.
- Water ripples: optional animated white ripples `rgba(255,255,255,0.06–0.10)` on large areas; skip for tiny shapes by area threshold.
- Cup depth: inner radial darken peaking near center `rgba(0,0,0,0.30–0.40)` beneath the `holeRim`.
- Ball polish: soft drop shadow `rgba(0,0,0,0.25–0.30)` and small radial highlight (white 15–25% alpha). Purely cosmetic.

## Hills Arrow Glyphs

- Fill: `white`.
- Outline: use `fairwayLine` at 80–100% opacity for contrast; 1–1.5px stroke.
- Placement: arrows are spaced sparsely along the slope direction to avoid visual noise; honor the View → "Slope Arrows" toggle in both editor and runtime.

## Canonical Render Order

1) Table background
2) Fairway base + bands
3) Water/Sand strokes
4) Water/Sand fills
5) Walls/Posts fills
6) Wall/Post strokes + highlights/shadows
7) Bridges
8) Hills gradient + arrows
9) Tee/Cup (rim last)
10) Ball
11) UI overlays

## Notes
- Page background (outside canvas): `#222` and canvas element background: `#1f4d21` are defined in `index.html` for framing and do not affect in-canvas palette.
- Keep palette additions centralized in `COLORS` and prefer using these constants over hard-coded hex values.
