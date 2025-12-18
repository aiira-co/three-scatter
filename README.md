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

- **8 Scatter Systems** for different distribution needs
- **Chunk-based LOD** - Only renders instances near the camera
- **Deterministic placement** - Same seed = same results
- **Noise-based distribution** - Natural-looking patterns
- **Instance pooling** - Efficient memory management

## Scatter Systems

| System | Use Case |
|--------|----------|
| `HeightmapScatterSystem` | Terrain vegetation using height/mask textures |
| `MeshScatterSystem` | Surface sampling on any mesh |
| `CurveScatterSystem` | Distribution along a curve (fences, paths) |
| `VolumeScatterSystem` | 3D volume filling (particles, debris) |
| `RadialScatterSystem` | Ring/circular patterns (forest clearing) |
| `GridScatterSystem` | Regular grids (orchards, street lights) |
| `SplineScatterSystem` | Advanced spline with banking/Frenet frames |
| `PhysicsScatterSystem` | Physics-simulated natural placement |

## Quick Start

```typescript
import * as THREE from 'three';
import { MeshScatterSystem } from '@interverse/three-scatter';

// Create scatter system
const scatter = new MeshScatterSystem({
  scene,
  camera,
  source: treeMesh,           // Mesh to instance
  surfaceMesh: terrainMesh,   // Surface to scatter on
  density: 0.01,              // Instances per unit area
  visibilityRange: 200,       // LOD distance
  scaleRange: [0.8, 1.2],
  alignToNormal: true
});

// Update loop
function animate() {
  scatter.update();  // Updates chunk visibility
  renderer.render(scene, camera);
}
```

## Configuration

All systems share a base configuration:

```typescript
interface BaseScatterConfig {
  scene: THREE.Scene;
  camera: THREE.Camera;
  source: THREE.Mesh | THREE.Group;
  density: number;
  visibilityRange: number;
  maxInstances?: number;       // Default: 10000
  chunkSize?: number;          // Default: 64
  scaleRange?: [number, number];
  rotationRange?: [number, number];
  heightOffset?: number;
  alignToNormal?: boolean;
  randomSeed?: number;
  showChunksDebug?: boolean;
  noiseDistribution?: NoiseDistributionConfig;
}
```

## Advanced Usage

### Noise Distribution

```typescript
const scatter = new HeightmapScatterSystem({
  // ... base config
  noiseDistribution: {
    enabled: true,
    scale: 0.05,
    octaves: 4,
    threshold: 0.4  // Only place where noise > 0.4
  }
});
```

### Grid with Skip Pattern

```typescript
const orchard = new GridScatterSystem({
  // ... base config
  gridSize: new THREE.Vector2(10, 10),
  cellSize: 5,
  skipPattern: (x, z) => {
    // Skip middle for path
    return z === 5;
  }
});
```

### Physics Scatter

```typescript
const rocks = new PhysicsScatterSystem({
  // ... base config
  dropHeight: 50,
  dropBounds: new THREE.Box3(/*...*/),
  simulationSteps: 200,
  groundMesh: terrainMesh,
  enableCollisions: true
});
```

## API

All systems share these methods:

```typescript
scatter.update();                    // Call every frame
scatter.setDensity(0.02);           // Change density
scatter.setVisibilityRange(300);    // Change LOD range
scatter.toggleDebug(true);          // Show chunk bounds
scatter.regenerateAll();            // Force regenerate
scatter.dispose();                  // Clean up
scatter.getStats();                 // Get instance counts
```

## License

MIT
