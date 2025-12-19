import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for grid-based scatter
 */
export interface GridScatterConfig extends BaseScatterConfig {
  /** Grid dimensions (cells in X and Z) */
  gridSize: THREE.Vector2;
  /** Size of each cell */
  cellSize: number;
  /** Center of the grid */
  center?: THREE.Vector3;
  /** Random offset within cell (0-1) */
  randomOffset?: number;
  /** Function to determine if a cell should be skipped */
  skipPattern?: (x: number, z: number) => boolean;
}

/**
 * Scatter system distributing instances in a regular grid pattern
 */
export class GridScatterSystem extends BaseScatterSystem {
  private gridSize: THREE.Vector2;
  private cellSize: number;
  private center: THREE.Vector3;
  private randomOffset: number;
  private skipPattern?: (x: number, z: number) => boolean;

  constructor(config: GridScatterConfig) {
    super(config);
    this.gridSize = config.gridSize;
    this.cellSize = config.cellSize;
    this.center = config.center ?? new THREE.Vector3(0, 0, 0);
    this.randomOffset = config.randomOffset ?? 0.3;
    this.skipPattern = config.skipPattern;

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

    const halfGridX = (this.gridSize.x * this.cellSize) / 2;
    const halfGridZ = (this.gridSize.y * this.cellSize) / 2;

    const minX = Math.floor((this.center.x - halfGridX) / chunkSize) * chunkSize;
    const maxX = Math.ceil((this.center.x + halfGridX) / chunkSize) * chunkSize;
    const minZ = Math.floor((this.center.z - halfGridZ) / chunkSize) * chunkSize;
    const maxZ = Math.ceil((this.center.z + halfGridZ) / chunkSize) * chunkSize;

    for (let x = minX; x <= maxX; x += chunkSize) {
      for (let z = minZ; z <= maxZ; z += chunkSize) {
        const chunkX = x + chunkSize / 2;
        const chunkZ = z + chunkSize / 2;

        const dx = chunkX - cameraPos.x;
        const dz = chunkZ - cameraPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance <= visRange) {
          // Frustum culling
          const chunkBounds = new THREE.Box3(
            new THREE.Vector3(chunkX - chunkSize / 2, -100, chunkZ - chunkSize / 2),
            new THREE.Vector3(chunkX + chunkSize / 2, 100, chunkZ + chunkSize / 2)
          );
          if (!this.isChunkInFrustum(chunkBounds)) continue;

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
      new THREE.Vector3(centerX - halfSize, -Infinity, centerZ - halfSize),
      new THREE.Vector3(centerX + halfSize, Infinity, centerZ + halfSize)
    );

    const chunkSeed = ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
    const rng = new SeededRandom(chunkSeed);

    const halfGridX = (this.gridSize.x * this.cellSize) / 2;
    const halfGridZ = (this.gridSize.y * this.cellSize) / 2;
    const gridStartX = this.center.x - halfGridX;
    const gridStartZ = this.center.z - halfGridZ;

    for (let gx = 0; gx < this.gridSize.x; gx++) {
      for (let gz = 0; gz < this.gridSize.y; gz++) {
        if (this.skipPattern && this.skipPattern(gx, gz)) continue;

        const cellCenterX = gridStartX + (gx + 0.5) * this.cellSize;
        const cellCenterZ = gridStartZ + (gz + 0.5) * this.cellSize;

        const offsetX = (rng.next() - 0.5) * this.cellSize * this.randomOffset;
        const offsetZ = (rng.next() - 0.5) * this.cellSize * this.randomOffset;

        const x = cellCenterX + offsetX;
        const z = cellCenterZ + offsetZ;
        const position = new THREE.Vector3(x, 0, z);

        if (!chunkBounds.containsPoint(position)) continue;

        const instanceId = this.instancePool.acquire();
        if (instanceId === null) break;

        const rotation = new THREE.Euler(0, rng.range(...this.config.rotationRange), 0);
        const baseScale = rng.range(...this.config.scaleRange);
        const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

        position.y += this.config.heightOffset;

        this.converter.setInstanceTransform(instanceId, position, rotation, scale);
        chunk.instances.push(instanceId);
      }
    }
  }

  /**
   * Update grid parameters and regenerate
   */
  updateGrid(gridSize: THREE.Vector2, cellSize: number): void {
    this.gridSize = gridSize;
    this.cellSize = cellSize;
    this.regenerateAll();
  }
}
