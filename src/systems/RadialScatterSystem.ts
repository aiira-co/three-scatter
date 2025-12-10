import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for radial scatter
 */
export interface RadialScatterConfig extends BaseScatterConfig {
  /** Center point of the radial distribution */
  center: THREE.Vector3;
  /** Inner radius (creates a hole in the middle) */
  innerRadius: number;
  /** Outer radius */
  outerRadius: number;
  /** Start angle in radians */
  angleStart?: number;
  /** End angle in radians */
  angleEnd?: number;
  /** Height range for instances */
  heightRange?: [number, number];
  /** Density falloff toward center (0 = uniform, >0 = denser outside) */
  radialDensityFalloff?: number;
}

/**
 * Scatter system distributing instances in a radial/ring pattern
 */
export class RadialScatterSystem extends BaseScatterSystem {
  private center: THREE.Vector3;
  private innerRadius: number;
  private outerRadius: number;
  private angleStart: number;
  private angleEnd: number;
  private heightRange: [number, number];
  private radialDensityFalloff: number;

  constructor(config: RadialScatterConfig) {
    super(config);
    this.center = config.center;
    this.innerRadius = config.innerRadius;
    this.outerRadius = config.outerRadius;
    this.angleStart = config.angleStart ?? 0;
    this.angleEnd = config.angleEnd ?? Math.PI * 2;
    this.heightRange = config.heightRange ?? [0, 0];
    this.radialDensityFalloff = config.radialDensityFalloff ?? 0;

    this.init();
  }

  protected async initializeDistribution(): Promise<void> {
    // No async initialization needed
  }

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    const cameraPos = camera.position;
    const visRange = this.config.visibilityRange;
    const chunkSize = this.config.chunkSize;

    const activeChunkKeys = new Set<string>();

    const minX = Math.floor((this.center.x - this.outerRadius) / chunkSize) * chunkSize;
    const maxX = Math.ceil((this.center.x + this.outerRadius) / chunkSize) * chunkSize;
    const minZ = Math.floor((this.center.z - this.outerRadius) / chunkSize) * chunkSize;
    const maxZ = Math.ceil((this.center.z + this.outerRadius) / chunkSize) * chunkSize;

    for (let x = minX; x <= maxX; x += chunkSize) {
      for (let z = minZ; z <= maxZ; z += chunkSize) {
        const chunkX = x + chunkSize / 2;
        const chunkZ = z + chunkSize / 2;

        const dx = chunkX - cameraPos.x;
        const dz = chunkZ - cameraPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance <= visRange) {
          const key = this.getChunkKey(chunkX, chunkZ);
          activeChunkKeys.add(key);

          if (!this.chunks.has(key) || !this.chunks.get(key)!.isActive) {
            this.activateChunk(chunkX, chunkZ);
          }
        }
      }
    }

    for (const [key, chunk] of this.chunks.entries()) {
      if (!activeChunkKeys.has(key) && chunk.isActive) {
        this.deactivateChunk(key);
      }
    }
  }

  protected populateChunk(chunk: ChunkData, centerX: number, centerZ: number): void {
    const halfSize = this.config.chunkSize / 2;
    const chunkBounds = new THREE.Box3(
      new THREE.Vector3(centerX - halfSize, this.heightRange[0], centerZ - halfSize),
      new THREE.Vector3(centerX + halfSize, this.heightRange[1], centerZ + halfSize)
    );

    const chunkArea = this.config.chunkSize * this.config.chunkSize;
    const targetCount = Math.floor(chunkArea * this.config.density);

    const chunkSeed = ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
    const rng = new SeededRandom(chunkSeed);

    let placed = 0;
    let attempts = 0;
    const maxAttempts = targetCount * 5;

    while (placed < targetCount && attempts < maxAttempts) {
      attempts++;

      const angle = rng.range(this.angleStart, this.angleEnd);

      let radius: number;
      if (this.radialDensityFalloff > 0) {
        const t = Math.pow(rng.next(), 1 / (1 + this.radialDensityFalloff));
        radius = this.innerRadius + t * (this.outerRadius - this.innerRadius);
      } else {
        radius = rng.range(this.innerRadius, this.outerRadius);
      }

      const x = this.center.x + radius * Math.cos(angle);
      const z = this.center.z + radius * Math.sin(angle);
      const y = rng.range(this.heightRange[0], this.heightRange[1]);

      const position = new THREE.Vector3(x, y, z);

      if (!chunkBounds.containsPoint(position)) continue;
      if (!this.shouldPlaceInstance(x, z, chunk.noiseGenerator!)) continue;

      const instanceId = this.instancePool.acquire();
      if (instanceId === null) break;

      const directionFromCenter = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).normalize();
      const rotation = new THREE.Euler(
        0,
        Math.atan2(directionFromCenter.x, directionFromCenter.z) + rng.range(...this.config.rotationRange),
        0
      );

      const baseScale = rng.range(...this.config.scaleRange);
      const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

      position.y += this.config.heightOffset;

      this.converter.setInstanceTransform(instanceId, position, rotation, scale);
      chunk.instances.push(instanceId);
      placed++;
    }
  }

  /**
   * Update the radial bounds and regenerate
   */
  updateRadialBounds(innerRadius: number, outerRadius: number): void {
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
    this.regenerateAll();
  }
}
