import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for heightmap-based scatter
 */
export interface HeightmapScatterConfig extends BaseScatterConfig {
  /** World size in units */
  worldSize: number;
  /** URL to height map image */
  heightMapUrl?: string;
  /** Height multiplier */
  heightMapScale?: number;
  /** URL to mask image (white = place, black = no place) */
  maskMapUrl?: string;
  /** Maximum slope in degrees for placement */
  slopeLimit?: number;
}

/**
 * Scatter system using heightmap textures for terrain-based distribution
 */
export class HeightmapScatterSystem extends BaseScatterSystem {
  private heightMap: THREE.Texture | null = null;
  private heightMapData: Uint8Array | null = null;
  private maskMap: THREE.Texture | null = null;
  private maskMapData: Uint8Array | null = null;
  private worldSize: number;
  private heightMapScale: number;
  private slopeLimit: number;

  constructor(config: HeightmapScatterConfig) {
    super(config);
    this.worldSize = config.worldSize;
    this.heightMapScale = config.heightMapScale ?? 0.2;
    this.slopeLimit = config.slopeLimit ?? 45;
    this.init();
  }

  protected async initializeDistribution(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const cfgTyped = this.config as unknown as HeightmapScatterConfig;

    if (cfgTyped.heightMapUrl) {
      this.heightMap = await loader.loadAsync(cfgTyped.heightMapUrl);
      this.heightMapData = await this.extractTextureData(this.heightMap);
    }

    if (cfgTyped.maskMapUrl) {
      this.maskMap = await loader.loadAsync(cfgTyped.maskMapUrl);
      this.maskMapData = await this.extractTextureData(this.maskMap);
    }
  }

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    const cameraPos = camera.position;
    const visRange = this.config.visibilityRange;
    const chunkSize = this.config.chunkSize;
    const halfWorld = this.worldSize / 2;

    const activeChunkKeys = new Set<string>();

    const startX = Math.floor((cameraPos.x - visRange) / chunkSize) * chunkSize;
    const endX = Math.ceil((cameraPos.x + visRange) / chunkSize) * chunkSize;
    const startZ = Math.floor((cameraPos.z - visRange) / chunkSize) * chunkSize;
    const endZ = Math.ceil((cameraPos.z + visRange) / chunkSize) * chunkSize;

    for (let x = startX; x <= endX; x += chunkSize) {
      for (let z = startZ; z <= endZ; z += chunkSize) {
        const chunkX = x + chunkSize / 2;
        const chunkZ = z + chunkSize / 2;

        if (Math.abs(chunkX) > halfWorld || Math.abs(chunkZ) > halfWorld) continue;

        const key = this.getChunkKey(chunkX, chunkZ);
        const dx = chunkX - cameraPos.x;
        const dz = chunkZ - cameraPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance <= visRange) {
          // Frustum culling - skip chunks not visible
          const chunkBounds = new THREE.Box3(
            new THREE.Vector3(chunkX - chunkSize / 2, -1000, chunkZ - chunkSize / 2),
            new THREE.Vector3(chunkX + chunkSize / 2, 1000, chunkZ + chunkSize / 2)
          );
          if (!this.isChunkInFrustum(chunkBounds)) continue;

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
    const minX = centerX - halfSize;
    const maxX = centerX + halfSize;
    const minZ = centerZ - halfSize;
    const maxZ = centerZ + halfSize;

    const chunkArea = this.config.chunkSize * this.config.chunkSize;
    const lodMultiplier = this.getLODDensityMultiplier(centerX, centerZ);
    const targetCount = Math.floor(chunkArea * this.config.density * lodMultiplier);

    const chunkSeed = ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
    const rng = new SeededRandom(chunkSeed);

    let placed = 0;
    let attempts = 0;
    const maxAttempts = targetCount * 3;

    while (placed < targetCount && attempts < maxAttempts) {
      attempts++;

      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);

      if (!this.shouldPlaceInstance(x, z, chunk.noiseGenerator!)) continue;
      if (!this.checkMask(x, z)) continue;

      const height = this.sampleHeight(x, z);
      if (height === null) continue;

      const normal = this.sampleNormal(x, z);
      const slope = this.calculateSlope(normal);
      if (slope > this.slopeLimit) continue;

      const instanceId = this.instancePool.acquire();
      if (instanceId === null) break;

      const position = new THREE.Vector3(x, height, z);
      const transform = this.createInstanceTransform(position, rng, normal);

      this.converter.setInstanceTransform(instanceId, transform.position, transform.rotation, transform.scale);
      chunk.instances.push(instanceId);
      placed++;
    }
  }

  private async extractTextureData(texture: THREE.Texture): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    const img = texture.image as HTMLImageElement;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  }

  private worldToUV(worldX: number, worldZ: number): { u: number; v: number } {
    const halfWorld = this.worldSize / 2;
    return {
      u: (worldX + halfWorld) / this.worldSize,
      v: (worldZ + halfWorld) / this.worldSize
    };
  }

  private sampleHeight(x: number, z: number): number | null {
    if (!this.heightMapData) return 0;
    const { u, v } = this.worldToUV(x, z);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    const img = this.heightMap!.image as HTMLImageElement;
    const px = Math.floor(u * (img.width - 1));
    const py = Math.floor((1 - v) * (img.height - 1));

    const heightValue = this.heightMapData[(py * img.width + px) * 4] / 255;
    return heightValue * this.heightMapScale;
  }

  private sampleNormal(x: number, z: number): THREE.Vector3 {
    if (!this.heightMap) return new THREE.Vector3(0, 1, 0);

    const delta = 1;
    const hL = this.sampleHeight(x - delta, z) ?? 0;
    const hR = this.sampleHeight(x + delta, z) ?? 0;
    const hD = this.sampleHeight(x, z - delta) ?? 0;
    const hU = this.sampleHeight(x, z + delta) ?? 0;

    return new THREE.Vector3((hL - hR) / (2 * delta), 1, (hD - hU) / (2 * delta)).normalize();
  }

  private calculateSlope(normal: THREE.Vector3): number {
    return THREE.MathUtils.radToDeg(Math.acos(normal.y));
  }

  private checkMask(x: number, z: number): boolean {
    if (!this.maskMapData) return true;
    const { u, v } = this.worldToUV(x, z);
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;

    const img = this.maskMap!.image as HTMLImageElement;
    const px = Math.floor(u * (img.width - 1));
    const py = Math.floor((1 - v) * (img.height - 1));

    return this.maskMapData[(py * img.width + px) * 4] > 128;
  }
}
