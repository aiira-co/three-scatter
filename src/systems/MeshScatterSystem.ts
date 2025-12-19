import * as THREE from 'three';
// @ts-ignore - MeshSurfaceSampler types may not be available
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for mesh surface scatter
 */
export interface MeshScatterConfig extends BaseScatterConfig {
  /** Mesh to scatter instances on */
  surfaceMesh: THREE.Mesh;
  /** Maximum slope in degrees for placement */
  slopeLimit?: number;
}

/**
 * Scatter system using THREE.MeshSurfaceSampler for mesh-based distribution
 */
export class MeshScatterSystem extends BaseScatterSystem {
  private meshSampler: MeshSurfaceSampler;
  private meshBounds: THREE.Box3;
  private slopeLimit: number;

  constructor(config: MeshScatterConfig) {
    super(config);
    this.slopeLimit = config.slopeLimit ?? 45;

    this.meshSampler = new MeshSurfaceSampler(config.surfaceMesh)
      .setWeightAttribute(null)
      .build();
    this.meshBounds = new THREE.Box3().setFromObject(config.surfaceMesh);

    this.init();
  }

  protected async initializeDistribution(): Promise<void> {
    // No async initialization needed for mesh
  }

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    const cameraPos = camera.position;
    const visRange = this.config.visibilityRange;
    const chunkSize = this.config.chunkSize;

    const activeChunkKeys = new Set<string>();

    const minX = Math.floor(this.meshBounds.min.x / chunkSize) * chunkSize;
    const maxX = Math.ceil(this.meshBounds.max.x / chunkSize) * chunkSize;
    const minZ = Math.floor(this.meshBounds.min.z / chunkSize) * chunkSize;
    const maxZ = Math.ceil(this.meshBounds.max.z / chunkSize) * chunkSize;

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
            new THREE.Vector3(chunkX - chunkSize / 2, this.meshBounds.min.y, chunkZ - chunkSize / 2),
            new THREE.Vector3(chunkX + chunkSize / 2, this.meshBounds.max.y, chunkZ + chunkSize / 2)
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

    const chunkArea = this.config.chunkSize * this.config.chunkSize;
    const targetCount = Math.floor(chunkArea * this.config.density);

    const chunkSeed = ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
    const rng = new SeededRandom(chunkSeed);

    let placed = 0;
    let attempts = 0;
    const maxAttempts = targetCount * 5;

    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();

    while (placed < targetCount && attempts < maxAttempts) {
      attempts++;

      this.meshSampler.sample(position, normal);

      if (!chunkBounds.containsPoint(position)) continue;
      if (!this.shouldPlaceInstance(position.x, position.z, chunk.noiseGenerator!)) continue;

      const slope = THREE.MathUtils.radToDeg(Math.acos(normal.y));
      if (slope > this.slopeLimit) continue;

      const instanceId = this.instancePool.acquire();
      if (instanceId === null) break;

      const transform = this.createInstanceTransform(position.clone(), rng, normal);

      this.converter.setInstanceTransform(instanceId, transform.position, transform.rotation, transform.scale);
      chunk.instances.push(instanceId);
      placed++;
    }
  }

  /**
   * Update the surface mesh and regenerate
   */
  updateMesh(mesh: THREE.Mesh): void {
    this.meshSampler = new MeshSurfaceSampler(mesh)
      .setWeightAttribute(null)
      .build();
    this.meshBounds = new THREE.Box3().setFromObject(mesh);
    this.regenerateAll();
  }
}
