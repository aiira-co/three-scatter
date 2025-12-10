import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for volume-based scatter
 */
export interface VolumeScatterConfig extends BaseScatterConfig {
  /** Bounding box for the volume */
  bounds: THREE.Box3;
  /** Type of volume shape */
  volumeType?: 'box' | 'sphere' | 'cylinder';
  /** 0 = solid, 1 = shell only */
  hollowness?: number;
  /** Distance from edge where density falls off */
  falloffDistance?: number;
}

/**
 * Scatter system distributing instances within a 3D volume
 */
export class VolumeScatterSystem extends BaseScatterSystem {
  private bounds: THREE.Box3;
  private volumeType: 'box' | 'sphere' | 'cylinder';
  private hollowness: number;
  private falloffDistance: number;
  private center: THREE.Vector3;
  private radius: number;

  constructor(config: VolumeScatterConfig) {
    super(config);
    this.bounds = config.bounds;
    this.volumeType = config.volumeType ?? 'box';
    this.hollowness = config.hollowness ?? 0;
    this.falloffDistance = config.falloffDistance ?? 0;

    this.center = new THREE.Vector3();
    this.bounds.getCenter(this.center);

    const size = new THREE.Vector3();
    this.bounds.getSize(size);
    this.radius = Math.max(size.x, size.y, size.z) / 2;

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

    const minX = Math.floor(this.bounds.min.x / chunkSize) * chunkSize;
    const maxX = Math.ceil(this.bounds.max.x / chunkSize) * chunkSize;
    const minZ = Math.floor(this.bounds.min.z / chunkSize) * chunkSize;
    const maxZ = Math.ceil(this.bounds.max.z / chunkSize) * chunkSize;

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
      new THREE.Vector3(centerX - halfSize, this.bounds.min.y, centerZ - halfSize),
      new THREE.Vector3(centerX + halfSize, this.bounds.max.y, centerZ + halfSize)
    );

    const chunkVolume = chunkBounds.getSize(new THREE.Vector3()).length();
    const targetCount = Math.floor(chunkVolume * this.config.density);

    const chunkSeed = ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
    const rng = new SeededRandom(chunkSeed);

    let placed = 0;
    let attempts = 0;
    const maxAttempts = targetCount * 5;

    while (placed < targetCount && attempts < maxAttempts) {
      attempts++;

      const x = rng.range(chunkBounds.min.x, chunkBounds.max.x);
      const y = rng.range(chunkBounds.min.y, chunkBounds.max.y);
      const z = rng.range(chunkBounds.min.z, chunkBounds.max.z);
      const position = new THREE.Vector3(x, y, z);

      if (!this.isPointInVolume(position, rng)) continue;
      if (!this.shouldPlaceInstance(x, z, chunk.noiseGenerator!)) continue;

      const instanceId = this.instancePool.acquire();
      if (instanceId === null) break;

      const rotation = new THREE.Euler(
        rng.range(0, Math.PI * 2),
        rng.range(0, Math.PI * 2),
        rng.range(0, Math.PI * 2)
      );

      const baseScale = rng.range(...this.config.scaleRange);
      const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

      position.y += this.config.heightOffset;

      this.converter.setInstanceTransform(instanceId, position, rotation, scale);
      chunk.instances.push(instanceId);
      placed++;
    }
  }

  private isPointInVolume(point: THREE.Vector3, rng: SeededRandom): boolean {
    let normalizedDistance = 0;

    switch (this.volumeType) {
      case 'sphere': {
        const distanceFromCenter = point.distanceTo(this.center);
        normalizedDistance = distanceFromCenter / this.radius;

        if (normalizedDistance > 1) return false;
        if (this.hollowness > 0 && normalizedDistance < this.hollowness) return false;

        if (this.falloffDistance > 0) {
          const falloffStart = 1 - this.falloffDistance / this.radius;
          if (normalizedDistance > falloffStart) {
            const falloffT = (normalizedDistance - falloffStart) / (1 - falloffStart);
            if (rng.next() > 1 - falloffT) return false;
          }
        }
        break;
      }

      case 'cylinder': {
        const dx = point.x - this.center.x;
        const dz = point.z - this.center.z;
        const radialDist = Math.sqrt(dx * dx + dz * dz);
        normalizedDistance = radialDist / this.radius;

        if (normalizedDistance > 1) return false;
        if (this.hollowness > 0 && normalizedDistance < this.hollowness) return false;
        if (point.y < this.bounds.min.y || point.y > this.bounds.max.y) return false;
        break;
      }

      case 'box':
      default: {
        if (!this.bounds.containsPoint(point)) return false;

        if (this.hollowness > 0) {
          const size = new THREE.Vector3();
          this.bounds.getSize(size);
          const minDist = Math.min(
            point.x - this.bounds.min.x,
            this.bounds.max.x - point.x,
            point.y - this.bounds.min.y,
            this.bounds.max.y - point.y,
            point.z - this.bounds.min.z,
            this.bounds.max.z - point.z
          );
          const maxSize = Math.max(size.x, size.y, size.z);
          if (minDist / maxSize > 1 - this.hollowness) return false;
        }
        break;
      }
    }

    return true;
  }

  /**
   * Update the volume bounds and regenerate
   */
  updateBounds(bounds: THREE.Box3): void {
    this.bounds = bounds;
    this.bounds.getCenter(this.center);
    const size = new THREE.Vector3();
    this.bounds.getSize(size);
    this.radius = Math.max(size.x, size.y, size.z) / 2;
    this.regenerateAll();
  }
}
