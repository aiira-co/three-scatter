# @interverse/three-scatter

High-performance instanced scatter systems for Three.js with chunk-based visibility, optional LOD, noise-driven placement, and density-map modulation.

## Installation

```bash
npm install @interverse/three-scatter
# or
yarn add @interverse/three-scatter
```

Peer dependency:

- `three >= 0.182.0`

## Exported API

Systems:

- `HeightmapScatterSystem`
- `MeshScatterSystem`
- `CurveScatterSystem`
- `SplineScatterSystem`
- `VolumeScatterSystem`
- `RadialScatterSystem`
- `GridScatterSystem`
- `PhysicsScatterSystem`

Core:

- `BaseScatterSystem`
- `BaseScatterConfig`, `LODConfig`, `DensityMapConfig`, `ScatterEvents`, `ScatterStats`

Features:

- `ScatterBlender`
- `ScatterBrush`

Utils:

- `ScatterSerializer`
- `SeededRandom`
- `PerlinNoise`
- `InstancePool`

Converter:

- `MeshToInstancedMeshConverter`

## Quick Start

```ts
import * as THREE from 'three';
import { MeshScatterSystem } from '@interverse/three-scatter';

const scatter = new MeshScatterSystem({
  source: treeMesh,
  surfaceMesh: terrainMesh,
  density: 0.02,
  visibilityRange: 250,
  chunkSize: 64,
  scaleRange: [0.8, 1.2],
  alignToNormal: true
});

// Constructors call init() automatically.
// Await init() if you need a strict readiness barrier.
await scatter.init();

scene.add(scatter);

function animate() {
  scatter.update(camera);
  renderer.render(scene, camera);
}
```

## Base Configuration

```ts
interface BaseScatterConfig {
  source: THREE.Mesh | THREE.Group;
  density: number;
  visibilityRange: number;

  maxInstances?: number;          // default: 10000
  chunkSize?: number;             // default: 64
  scaleRange?: [number, number];  // default: [0.8, 1.2]
  rotationRange?: [number, number]; // default: [0, Math.PI * 2]
  heightOffset?: number;          // default: 0
  alignToNormal?: boolean;        // default: true
  randomSeed?: number;            // default: Date.now()
  showChunksDebug?: boolean;      // default: false

  noiseDistribution?: {
    enabled: boolean;
    scale?: number;
    octaves?: number;
    persistence?: number;
    lacunarity?: number;
    threshold?: number;
    power?: number;
    offset?: number;
    scaleVariation?: number;
  };

  lod?: {
    levels: Array<{
      distance: number;
      densityMultiplier: number;
      scaleMultiplier?: number;
    }>;
    blendDistance?: number;
  };

  densityMap?: {
    /** Optional when you supply pixels via {@link BaseScatterSystem.setDensityMapImageData} after `init()`. */
    textureUrl?: string;
    channel?: 'r' | 'g' | 'b' | 'a';
    worldBounds: THREE.Box2;
    multiplier?: number;
  };

  events?: {
    onChunkActivated?: (chunkKey: string, instanceCount: number) => void;
    onChunkDeactivated?: (chunkKey: string) => void;
    onStatsChanged?: (stats: ScatterStats) => void;
  };
}
```

## System-Specific Config

`MeshScatterSystem`

- Required: `surfaceMesh`
- Optional: `slopeLimit`
- Runtime method: `updateMesh(mesh)`

`HeightmapScatterSystem`

- Required: `worldSize`
- Optional:
  - `worldSizeZ`, `worldOrigin`
  - `heightMapUrl` or `heightMapData` + `heightMapSize`
  - `maskMapUrl` or `maskMapData` + `maskMapSize`
  - `heightMapScale`, `slopeLimit`

`CurveScatterSystem`

- Required: `curve`
- Optional: `handles`, `segmentCount`, `spacing`, `offsetRange`, `width`
- Runtime method: `updateCurve(curve, segmentCount?)`

`SplineScatterSystem`

- Required: `spline`
- Optional:
  - `distributionMode` (`uniform` | `adaptive` | `density-based`)
  - `segmentCount`, `spacing`, `tension`
  - `width`, `distributionsPerSegment`
  - `bankAngle`, `followTangent`, `upVector`, `offsetCurve`
- Runtime methods: `updateSpline(spline, segmentCount?)`, `setBankAngle(angle)`

`VolumeScatterSystem`

- Required: `bounds`
- Optional: `volumeType`, `hollowness`, `falloffDistance`
- Runtime method: `updateBounds(bounds)`

`RadialScatterSystem`

- Required: `center`, `innerRadius`, `outerRadius`
- Optional: `angleStart`, `angleEnd`, `heightRange`, `radialDensityFalloff`
- Runtime method: `updateRadialBounds(innerRadius, outerRadius)`

`GridScatterSystem`

- Required: `gridSize`, `cellSize`
- Optional: `center`, `randomOffset`, `skipPattern`
- Runtime method: `updateGrid(gridSize, cellSize)`

`PhysicsScatterSystem`

- Required: `dropHeight`, `dropBounds`
- Optional:
  - `simulationSteps`, `gravity`
  - `enableCollisions`, `groundMesh`
  - `beforeSimulation`, `afterSimulation`
- Runtime method: `resimulate()`

## Common Runtime API

All systems inherit from `BaseScatterSystem`:

```ts
await scatter.init();            // optional, constructors already trigger init
scatter.update(camera);          // call every frame

scatter.setDensity(0.01);
scatter.setVisibilityRange(300);
scatter.setFrustumCulling(true); // enabled by default
scatter.toggleDebug(true);

scatter.regenerateAll();
const stats = scatter.getStats();
const converter = scatter.getConverter();

scatter.dispose();
```

### Density map (texture URL vs live pixels)

- If `densityMap.textureUrl` is set, the loader runs during `init()` and samples use the decoded RGBA buffer (and internal raster size).
- If you omit `textureUrl` but still pass `densityMap` (bounds, channel, multiplier), call **`setDensityMapImageData(imageData)`** after **`await scatter.init()`** so placement has mask data. Until you do, sampling behaves as “no mask” (full density).
- To refresh from the URL currently in `config.densityMap.textureUrl`, use **`await scatter.reloadDensityMapFromConfiguredUrl()`** (regenerates all chunks).

```ts
// A) URL-based (unchanged pattern)
const scatterA = new HeightmapScatterSystem({
  /* ... */,
  densityMap: {
    textureUrl: '/masks/biome.png',
    channel: 'a',
    worldBounds: new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(1024, 1024))
  }
});
await scatterA.init();

// B) Live pixels (no URL decode on each stroke)
const scatterB = new HeightmapScatterSystem({
  /* ... */,
  densityMap: {
    channel: 'a',
    worldBounds: new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(1024, 1024)),
    multiplier: 1
  }
});
await scatterB.init();
scatterB.setDensityMapImageData(myImageData); // RGBA ImageData matching worldBounds aspect

// C) Refresh after changing config.densityMap.textureUrl at runtime
await scatterA.reloadDensityMapFromConfiguredUrl();
```

## ScatterBlender

`ScatterBlender` manages multiple scatter systems as layers and updates them on an interval.

```ts
import { ScatterBlender } from '@interverse/three-scatter';

const blender = new ScatterBlender({
  worldBounds: new THREE.Box2(
    new THREE.Vector2(-500, -500),
    new THREE.Vector2(500, 500)
  ),
  updateInterval: 2
});

blender.addLayer('grass', grassSystem, 1.0);
blender.addLayer('rocks', rockSystem, 0.6);

await blender.init('/textures/biome-mask.png');
scene.add(blender);

blender.update(camera);
const channels = blender.sampleBlendMask(10, 20); // { r, g, b, a } in 0..1
```

Notes:

- `setLayerWeight(name, weight)` stores per-layer weight.
- Mask sampling is provided via `sampleBlendMask`; weighting/mask application logic is currently up to your app logic per layer.

## ScatterBrush

Runtime paint/erase utility for a single scatter system.

```ts
import { ScatterBrush } from '@interverse/three-scatter';

const brush = new ScatterBrush(scatterSystem, {
  radius: 6,
  strength: 1.0,
  density: 10,
  falloff: 'smooth'
});

const hit = ScatterBrush.getIntersection(raycaster, [terrainMesh]);
if (hit) {
  brush.paint(hit, (x, z) => terrainHeightAt(x, z));
  // or
  brush.erase(hit);
}
```

## ScatterSerializer

Serialize/deserialize JSON-safe config payloads.

```ts
import { ScatterSerializer } from '@interverse/three-scatter';

const json = ScatterSerializer.toJSON(baseConfig, 'HeightmapScatterSystem');
localStorage.setItem('scatter', json);

const saved = localStorage.getItem('scatter');
if (saved) {
  const { type, config } = ScatterSerializer.fromJSON(saved, sourceMesh);
  // create the matching system from `type` + `config`
}
```

## Notes

- Constructors call `init()` internally; `await init()` is still useful when you need deterministic readiness before first update.
- Frustum culling is implemented in chunk-based area/volume systems and can be toggled with `setFrustumCulling`.
- `PhysicsScatterSystem` runs CPU simulation in JS; high density + high simulation steps can be expensive.

## Migration / changelog (v1.2.5 → v1.2.6)

**Type change (may affect TypeScript builds)**

- `DensityMapConfig.textureUrl` is now **optional**. Callers that construct a `DensityMapConfig` literal no longer need a dummy URL when they only intend to use **`setDensityMapImageData()`** after initialization.

**Runtime behavior**

- If `densityMap` is present **without** `textureUrl` and you never call **`setDensityMapImageData`**, density sampling falls through to the default (**full density**, same as having no density map). Previously, a config object that omitted `textureUrl` was not a supported shape; now it is explicitly “URL deferred / pixels supplied later”.
- Density sampling uses internal raster dimensions (`densityMapWidth` / `densityMapHeight`) and **`densityMapData`** only. A loaded **`densityMapTexture`** is not required for sampling after pixels are in memory.
- **`dispose()`** now also disposes the density-map GPU texture (when present) and clears **`densityMapData`** / dimensions. Do not use a scatter instance after `dispose()`.

**New APIs on `BaseScatterSystem`**

- **`setDensityMapImageData(imageData: ImageData): void`** — Replace mask/density samples from canvas-style RGBA data and **`regenerateAll()`**. Intended for live authoring (e.g. foliage masks) without reloading a data URL each stroke.
- **`reloadDensityMapFromConfiguredUrl(): Promise<void>`** — Reload from `config.densityMap.textureUrl` and regenerate.

## Migration Notes (Older README -> v1.2.5)

- `init()` behavior:
  - Old expectation: constructor-only fire-and-forget setup.
  - Current behavior: constructors still trigger `init()`, but you can and should `await system.init()` when you need strict readiness.

- `ScatterBlender` behavior:
  - Old expectation: layer weights + mask automatically blend densities across systems.
  - Current behavior: blender manages layers, update cadence, and mask sampling; applying sampled channels/weights to system configs is app-level logic.

- `HeightmapScatterSystem` input options:
  - Added support for direct data input (`heightMapData`, `maskMapData`) with optional explicit sizes (`heightMapSize`, `maskMapSize`).
  - Added world mapping controls (`worldSizeZ`, `worldOrigin`) for non-square/offset terrains.

- Frustum culling scope:
  - `setFrustumCulling()` is available on all systems via `BaseScatterSystem`.
  - Practical chunk frustum tests are implemented in area/volume chunked systems; curve/spline flows remain primarily distance-driven.

- Type/API naming:
  - `SplineScatterSystem` accepts `THREE.CatmullRomCurve3 | THREE.CubicBezierCurve3 | THREE.QuadraticBezierCurve3`.
  - Runtime mutators are:
    - `updateMesh`
    - `updateCurve`
    - `updateSpline`
    - `setBankAngle`
    - `updateBounds`
    - `updateRadialBounds`
    - `updateGrid`
    - `resimulate`

## License

MIT
