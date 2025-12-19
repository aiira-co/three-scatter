# @interverse/three-scatter

High-performance instanced scatter systems for Three.js with chunk-based LOD and multiple distribution modes.

## 📦 Installation

```bash
npm install @interverse/three-scatter
# or
yarn add @interverse/three-scatter
```

**Peer Dependencies:**
- `three` >= 0.182.0

## Features

- **8 Scatter Systems** - Different distribution patterns for every need
- **Chunk-based LOD** - Only renders instances near the camera
- **Deterministic placement** - Same seed = same results
- **Noise-based distribution** - Natural-looking patterns
- **Instance pooling** - Efficient memory management
- **Normal alignment** - Objects orient to surface

## Scatter Systems Overview

| System | Use Case |
|--------|----------|
| `MeshScatterSystem` | Surface sampling on any mesh |
| `HeightmapScatterSystem` | Terrain vegetation with height/mask textures |
| `CurveScatterSystem` | Distribution along a THREE.Curve |
| `SplineScatterSystem` | Advanced spline with banking and Frenet frames |
| `VolumeScatterSystem` | 3D volume filling (box, sphere, cylinder) |
| `RadialScatterSystem` | Ring/circular patterns |
| `GridScatterSystem` | Regular grids with skip patterns |
| `PhysicsScatterSystem` | Physics-simulated natural placement |

## Quick Start

```typescript
import * as THREE from 'three';
import { MeshScatterSystem } from '@interverse/three-scatter';

const scatter = new MeshScatterSystem({
  source: treeMesh,
  surfaceMesh: terrainMesh,
  density: 0.01,
  visibilityRange: 200,
  scaleRange: [0.8, 1.2],
  alignToNormal: true
});

scene.add(scatter); // Scatter systems are THREE.Groups

function animate() {
  scatter.update(camera); // Update chunk visibility
  renderer.render(scene, camera);
}
```

## Base Configuration

All systems share these options:

```typescript
interface BaseScatterConfig {
  source: THREE.Mesh | THREE.Group;  // Object to instance
  density: number;                    // Instances per unit area
  visibilityRange: number;            // LOD distance
  maxInstances?: number;              // Default: 10000
  chunkSize?: number;                 // Default: 64
  scaleRange?: [number, number];      // Default: [0.8, 1.2]
  rotationRange?: [number, number];   // Default: [0, 2π]
  heightOffset?: number;              // Default: 0
  alignToNormal?: boolean;            // Default: true
  randomSeed?: number;                // For deterministic placement
  showChunksDebug?: boolean;          // Visualize chunks
  noiseDistribution?: NoiseDistributionConfig;
}
```

---

## 🌲 HeightmapScatterSystem

Distributes instances on terrain using heightmap and mask textures.

```typescript
import { HeightmapScatterSystem } from '@interverse/three-scatter';

const vegetation = new HeightmapScatterSystem({
  source: treeMesh,
  density: 0.02,
  visibilityRange: 300,
  
  // Heightmap config
  worldSize: 1000,
  heightMapUrl: '/textures/terrain_height.png',
  heightMapScale: 50,        // Height multiplier
  maskMapUrl: '/textures/vegetation_mask.png',
  slopeLimit: 35             // Max slope in degrees
});

scene.add(vegetation);
```

| Option | Type | Description |
|--------|------|-------------|
| `worldSize` | `number` | Total terrain size in units |
| `heightMapUrl` | `string` | URL to grayscale height texture |
| `heightMapScale` | `number` | Height multiplier (default: 0.2) |
| `maskMapUrl` | `string` | URL to mask (white = place, black = skip) |
| `slopeLimit` | `number` | Maximum slope in degrees (default: 45) |

---

## 🔄 CurveScatterSystem

Distributes instances along a THREE.Curve (fences, paths, power lines).

```typescript
import { CurveScatterSystem } from '@interverse/three-scatter';

const path = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-10, 0, 0),
  new THREE.Vector3(0, 5, 10),
  new THREE.Vector3(10, 0, 0)
]);

const fence = new CurveScatterSystem({
  source: fencePostMesh,
  density: 1,
  visibilityRange: 200,
  
  // Curve config
  curve: path,
  spacing: 2,               // Fixed spacing (overrides segmentCount)
  width: 3,                 // Width perpendicular to curve
  offsetRange: [-0.5, 0.5]  // Random perpendicular offset
});

scene.add(fence);

// Update curve dynamically
fence.updateCurve(newCurve, segmentCount);
```

| Option | Type | Description |
|--------|------|-------------|
| `curve` | `THREE.Curve<Vector3>` | Any Three.js curve |
| `segmentCount` | `number` | Points along curve (default: 50) |
| `spacing` | `number` | Alternative: fixed distance between instances |
| `width` | `number` | Distribution width perpendicular to curve |
| `offsetRange` | `[number, number]` | Random perpendicular offset |
| `handles` | `THREE.Object3D[]` | Rotation/scale interpolation handles |

---

## 🛤️ SplineScatterSystem

Advanced spline distribution with Frenet frames, banking, and distribution modes.

```typescript
import { SplineScatterSystem } from '@interverse/three-scatter';

const track = new THREE.CatmullRomCurve3(controlPoints, true);

const rails = new SplineScatterSystem({
  source: railMesh,
  density: 1,
  visibilityRange: 500,
  
  // Spline config
  spline: track,
  distributionMode: 'adaptive',  // More points on curves
  tension: 0.5,
  width: 1.4,
  distributionsPerSegment: 2,    // Rails on both sides
  bankAngle: 0.3,                // Tilt on curves
  followTangent: true,
  upVector: new THREE.Vector3(0, 1, 0)
});

scene.add(rails);
rails.setBankAngle(0.5);  // Update banking
```

| Option | Type | Description |
|--------|------|-------------|
| `spline` | `CatmullRomCurve3 \| BezierCurve` | Spline to follow |
| `distributionMode` | `'uniform' \| 'adaptive' \| 'density-based'` | Point distribution |
| `tension` | `number` | CatmullRom tension (default: 0.5) |
| `width` | `number` | Width perpendicular to spline |
| `distributionsPerSegment` | `number` | Instances per segment (for lanes) |
| `bankAngle` | `number` | Tilt angle in radians |
| `followTangent` | `boolean` | Orient along spline direction |
| `upVector` | `Vector3` | Custom up vector for Frenet frame |
| `offsetCurve` | `(t: number) => number` | Custom offset function |

---

## 📦 VolumeScatterSystem

Fills a 3D volume with instances (particles, debris, asteroid fields).

```typescript
import { VolumeScatterSystem } from '@interverse/three-scatter';

const debris = new VolumeScatterSystem({
  source: rockMesh,
  density: 0.001,
  visibilityRange: 100,
  
  // Volume config
  bounds: new THREE.Box3(
    new THREE.Vector3(-50, 0, -50),
    new THREE.Vector3(50, 30, 50)
  ),
  volumeType: 'sphere',    // 'box' | 'sphere' | 'cylinder'
  hollowness: 0.5,         // 0 = solid, 0.5 = 50% center hollow
  falloffDistance: 5       // Density fades at edges
});

scene.add(debris);
debris.updateBounds(newBounds);
```

| Option | Type | Description |
|--------|------|-------------|
| `bounds` | `THREE.Box3` | Bounding volume |
| `volumeType` | `'box' \| 'sphere' \| 'cylinder'` | Shape type |
| `hollowness` | `number` | 0-1, creates hollow center |
| `falloffDistance` | `number` | Density falloff at edges |

---

## 🎯 RadialScatterSystem

Ring/circular distribution (forest clearings, explosion debris).

```typescript
import { RadialScatterSystem } from '@interverse/three-scatter';

const clearing = new RadialScatterSystem({
  source: treeMesh,
  density: 0.05,
  visibilityRange: 200,
  
  // Radial config
  center: new THREE.Vector3(0, 0, 0),
  innerRadius: 20,         // Creates hole in center
  outerRadius: 100,
  angleStart: 0,           // Partial ring
  angleEnd: Math.PI * 1.5, // 270 degrees
  radialDensityFalloff: 1  // Denser toward outside
});

scene.add(clearing);
clearing.updateRadialBounds(30, 120);
```

| Option | Type | Description |
|--------|------|-------------|
| `center` | `Vector3` | Center point |
| `innerRadius` | `number` | Inner radius (0 = filled circle) |
| `outerRadius` | `number` | Outer radius |
| `angleStart` | `number` | Start angle in radians |
| `angleEnd` | `number` | End angle in radians |
| `heightRange` | `[number, number]` | Y position range |
| `radialDensityFalloff` | `number` | 0 = uniform, >0 = denser outside |

---

## 🔳 GridScatterSystem

Regular grid distribution with skip patterns (orchards, street lights).

```typescript
import { GridScatterSystem } from '@interverse/three-scatter';

const orchard = new GridScatterSystem({
  source: appleMesh,
  density: 1,
  visibilityRange: 200,
  
  // Grid config
  gridSize: new THREE.Vector2(20, 20),
  cellSize: 5,
  center: new THREE.Vector3(0, 0, 0),
  randomOffset: 0.2,       // Jitter within cell
  
  // Skip pattern for paths
  skipPattern: (x, z) => {
    return x === 10 || z === 10;  // Cross-shaped path
  }
});

scene.add(orchard);
orchard.updateGrid(new THREE.Vector2(30, 30), 4);
```

| Option | Type | Description |
|--------|------|-------------|
| `gridSize` | `Vector2` | Number of cells (X, Z) |
| `cellSize` | `number` | Size of each cell |
| `center` | `Vector3` | Grid center |
| `randomOffset` | `number` | 0-1, random jitter within cells |
| `skipPattern` | `(x, z) => boolean` | Function to skip cells |

---

## 🎲 PhysicsScatterSystem

Physics-simulated placement for natural-looking debris and rocks.

```typescript
import { PhysicsScatterSystem } from '@interverse/three-scatter';

const rocks = new PhysicsScatterSystem({
  source: rockMesh,
  density: 0.01,
  visibilityRange: 200,
  
  // Physics config
  dropHeight: 50,
  dropBounds: new THREE.Box3(
    new THREE.Vector3(-50, 0, -50),
    new THREE.Vector3(50, 0, 50)
  ),
  groundMesh: terrainMesh,
  simulationSteps: 300,
  gravity: new THREE.Vector3(0, -9.8, 0),
  enableCollisions: true,
  
  // Callbacks
  beforeSimulation: (body, index) => {
    body.restitution = 0.3;  // Bounciness
    body.friction = 0.8;
  },
  afterSimulation: (position, rotation, index) => {
    // Post-process final position
  }
});

scene.add(rocks);
rocks.resimulate();  // Re-run physics
```

| Option | Type | Description |
|--------|------|-------------|
| `dropHeight` | `number` | Height to drop from |
| `dropBounds` | `THREE.Box3` | Area to drop instances |
| `groundMesh` | `THREE.Mesh` | Collision ground |
| `simulationSteps` | `number` | Physics iterations |
| `gravity` | `Vector3` | Gravity vector |
| `enableCollisions` | `boolean` | Inter-object collisions |
| `beforeSimulation` | `callback` | Modify body before sim |
| `afterSimulation` | `callback` | Process results |

---

## Noise Distribution

Add natural variation with Perlin noise:

```typescript
noiseDistribution: {
  enabled: true,
  scale: 0.05,           // Noise frequency
  octaves: 4,            // Detail levels
  persistence: 0.5,      // Amplitude falloff
  lacunarity: 2.0,       // Frequency increase
  threshold: 0.4,        // Only place where noise > threshold
  power: 1.0,            // Contrast adjustment
  offset: 0.0,           // Shift noise values
  scaleVariation: 0.2    // Apply to instance scale
}
```

---

## Common API

All systems share these methods:

```typescript
// Update each frame
scatter.update(camera);

// Change parameters
scatter.setDensity(0.02);
scatter.setVisibilityRange(300);

// Debug
scatter.toggleDebug(true);  // Visualize chunk bounds

// Regenerate
scatter.regenerateAll();

// Statistics
const stats = scatter.getStats();
// { instances: { active, total, max }, chunks: { total, active }, meshes }

// Cleanup
scatter.dispose();
```

## License

MIT © Interverse Engine
