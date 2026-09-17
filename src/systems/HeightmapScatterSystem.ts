import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for heightmap-based scatter
 */
export interface HeightmapScatterConfig extends BaseScatterConfig {
  /** World size in units */
  worldSize: number;
  /** World size on Z axis (defaults to worldSize for square worlds) */
  worldSizeZ?: number;
  /** World origin (min X, min Z). Defaults to centered world: (-worldSize/2, -worldSize/2) */
  worldOrigin?: THREE.Vector2;
  /** URL to height map image */
  heightMapUrl?: string;
  /** Direct height map data (RGBA) */
  heightMapData?: Uint8Array | Uint8ClampedArray;
  /** Height map dimensions when using direct data */
  heightMapSize?: [number, number];
  /** Height multiplier */
  heightMapScale?: number;
  /** URL to mask image (white = place, black = no place) */
  maskMapUrl?: string;
  /** Direct mask map data (RGBA) */
  maskMapData?: Uint8Array | Uint8ClampedArray;
  /** Mask map dimensions when using direct data */
  maskMapSize?: [number, number];
  /** Maximum slope in degrees for placement */
  slopeLimit?: number;
  /**
   * When the scatter group is parented under transformed objects, instance matrices are expressed in
   * local space while placement uses world XZ + sampled height. Premultiply each composed instance
   * matrix by this inverse (typically `parent.matrixWorld.clone().invert()`) so instances align with
   * the sampled world surface.
   */
  scatterSpaceInverse?: THREE.Matrix4;
}

/** Default hysteresis band, as a fraction of visibilityRange. */
const DEFAULT_CHUNK_UNLOAD_MARGIN = 0.25;

/**
 * Scatter system using heightmap textures for terrain-based distribution
 */
export class HeightmapScatterSystem extends BaseScatterSystem {
  private heightMap: THREE.Texture | null = null;
  private heightMapData: Uint8Array | Uint8ClampedArray | null = null;
  private heightMapWidth = 0;
  private heightMapHeight = 0;
  private maskMap: THREE.Texture | null = null;
  private maskMapData: Uint8Array | Uint8ClampedArray | null = null;
  private maskMapWidth = 0;
  private maskMapHeight = 0;
  private worldSizeX: number;
  private worldSizeZ: number;
  private worldOrigin: THREE.Vector2;
  private heightMapScale: number;
  private slopeLimit: number;
  private scatterSpaceInverse: THREE.Matrix4 | null = null;
  /**
   * Chunks selected for this frame, reused between updates so the residency scan
   * stays allocation-free.
   */
  private pendingChunks: { key: string; x: number; z: number; visible: boolean }[] = [];
  private pendingCount = 0;

  constructor(config: HeightmapScatterConfig) {
    super(config);
    this.worldSizeX = config.worldSize;
    this.worldSizeZ = config.worldSizeZ ?? config.worldSize;
    this.worldOrigin = config.worldOrigin
      ? config.worldOrigin.clone()
      : new THREE.Vector2(-this.worldSizeX / 2, -this.worldSizeZ / 2);
    this.heightMapScale = config.heightMapScale ?? 0.2;
    this.slopeLimit = config.slopeLimit ?? 45;
    this.scatterSpaceInverse = config.scatterSpaceInverse?.clone() ?? null;
    this.init();
  }

  protected async initializeDistribution(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const cfgTyped = this.config as unknown as HeightmapScatterConfig;

    if (cfgTyped.heightMapData) {
      this.heightMapData = cfgTyped.heightMapData;
      const dims = this.resolveDataDimensions(cfgTyped.heightMapData, cfgTyped.heightMapSize);
      this.heightMapWidth = dims.width;
      this.heightMapHeight = dims.height;
    } else if (cfgTyped.heightMapUrl) {
      this.heightMap = await loader.loadAsync(cfgTyped.heightMapUrl);
      this.heightMapData = await this.extractTextureData(this.heightMap);
      const img = this.heightMap.image as HTMLImageElement;
      this.heightMapWidth = img.width;
      this.heightMapHeight = img.height;
    }

    if (cfgTyped.maskMapData) {
      this.maskMapData = cfgTyped.maskMapData;
      const dims = this.resolveDataDimensions(cfgTyped.maskMapData, cfgTyped.maskMapSize);
      this.maskMapWidth = dims.width;
      this.maskMapHeight = dims.height;
    } else if (cfgTyped.maskMapUrl) {
      this.maskMap = await loader.loadAsync(cfgTyped.maskMapUrl);
      this.maskMapData = await this.extractTextureData(this.maskMap);
      const img = this.maskMap.image as HTMLImageElement;
      this.maskMapWidth = img.width;
      this.maskMapHeight = img.height;
    }
  }

  private queuePendingChunk(key: string, x: number, z: number, visible: boolean): void {
    const entry = this.pendingChunks[this.pendingCount];
    if (entry) {
      entry.key = key;
      entry.x = x;
      entry.z = z;
      entry.visible = visible;
    } else {
      this.pendingChunks.push({ key, x, z, visible });
    }
    this.pendingCount++;
  }

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    const cameraPos = camera.position;
    const visRange = this.config.visibilityRange;
    const chunkSize = this.config.chunkSize;
    const retention = this.config.chunkRetention;
    const retentionEnabled = retention?.enabled === true;
    // Chunks are released only past the larger radius, so a camera hovering on
    // the load boundary cannot flip a chunk on and off frame to frame.
    const unloadRange = retentionEnabled
      ? visRange * (1 + Math.max(0, retention?.unloadMargin ?? DEFAULT_CHUNK_UNLOAD_MARGIN))
      : visRange;
    const scanRange = retentionEnabled ? unloadRange : visRange;
    const minWorldX = this.worldOrigin.x;
    const minWorldZ = this.worldOrigin.y;
    const maxWorldX = minWorldX + this.worldSizeX;
    const maxWorldZ = minWorldZ + this.worldSizeZ;

    const activeChunkKeys = new Set<string>();
    this.pendingCount = 0;

    const startX = Math.floor((cameraPos.x - scanRange) / chunkSize) * chunkSize;
    const endX = Math.ceil((cameraPos.x + scanRange) / chunkSize) * chunkSize;
    const startZ = Math.floor((cameraPos.z - scanRange) / chunkSize) * chunkSize;
    const endZ = Math.ceil((cameraPos.z + scanRange) / chunkSize) * chunkSize;

    // Pass 1 -- decide residency only. Nothing is populated yet: instances come
    // from a pool sized to the visible disc, so filling incoming chunks before
    // outgoing ones are released starves them, and a starved chunk stays active
    // and underfilled with nothing to repair it.
    for (let x = startX; x <= endX; x += chunkSize) {
      for (let z = startZ; z <= endZ; z += chunkSize) {
        const chunkX = x + chunkSize / 2;
        const chunkZ = z + chunkSize / 2;

        if (chunkX < minWorldX || chunkX > maxWorldX || chunkZ < minWorldZ || chunkZ > maxWorldZ) continue;

        const key = this.getChunkKey(chunkX, chunkZ);
        const dx = chunkX - cameraPos.x;
        const dz = chunkZ - cameraPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const resident = this.chunks.get(key)?.isActive === true;

        if (retentionEnabled) {
          if (resident ? distance > unloadRange : distance > visRange) continue;

          activeChunkKeys.add(key);
          // Retained past visRange for hysteresis, but never *drawn* past it:
          // otherwise visible coverage would depend on where the camera had
          // previously been and would extend beyond the configured range.
          const bounds = this.getChunkBoundsInto(chunkX, chunkZ, this.chunkBoundsScratch);
          this.queuePendingChunk(key, chunkX, chunkZ, distance <= visRange && this.isChunkInFrustum(bounds));
          continue;
        }

        if (distance <= visRange) {
          const chunkBounds = this.getChunkBoundsInto(chunkX, chunkZ, this.chunkBoundsScratch);
          if (!this.isChunkInFrustum(chunkBounds)) continue;

          activeChunkKeys.add(key);
          this.queuePendingChunk(key, chunkX, chunkZ, true);
        }
      }
    }

    // Pass 2 -- release everything leaving, returning its instances to the pool.
    for (const [key, chunk] of this.chunks.entries()) {
      if (!activeChunkKeys.has(key) && chunk.isActive) {
        this.deactivateChunk(key);
      }
    }

    // Pass 3 -- populate against the freed pool.
    for (let i = 0; i < this.pendingCount; i++) {
      const pending = this.pendingChunks[i];
      const existing = this.chunks.get(pending.key);

      if (!existing || !existing.isActive) {
        this.activateChunk(pending.x, pending.z);
      } else if (
        this.chunkNeedsLODRefresh(existing, pending.x, pending.z)
        || this.chunkNeedsStarvationRepair(existing)
      ) {
        this.deactivateChunk(pending.key);
        this.activateChunk(pending.x, pending.z);
      }

      if (retentionEnabled) {
        this.setChunkVisible(pending.key, pending.visible);
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

    chunk.starvedGeneration = undefined;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = targetCount * 3;

    while (placed < targetCount && attempts < maxAttempts) {
      attempts++;

      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);

      if (!this.shouldPlaceInstance(x, z, chunk.noiseGenerator!, rng)) continue;
      if (!this.checkMask(x, z)) continue;

      const height = this.sampleHeight(x, z);
      if (height === null) continue;

      const normal = this.sampleNormal(x, z);
      const slope = this.calculateSlope(normal);
      if (slope > this.slopeLimit) continue;

      const instanceId = this.instancePool.acquire();
      if (instanceId === null) {
        // Underfilled: remember the pool state so this chunk can be retried once
        // capacity is actually released, rather than staying permanently thin.
        chunk.starvedGeneration = this.poolReleaseGeneration;
        break;
      }

      const position = new THREE.Vector3(x, height, z);
      const transform = this.createInstanceTransform(position, rng, normal, chunk.noiseGenerator ?? undefined);

      if (this.scatterSpaceInverse) {
        const m = new THREE.Matrix4().compose(
          transform.position,
          new THREE.Quaternion().setFromEuler(transform.rotation),
          transform.scale
        );
        m.premultiply(this.scatterSpaceInverse);
        const q = new THREE.Quaternion();
        m.decompose(transform.position, q, transform.scale);
        transform.rotation.setFromQuaternion(q);
      }

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

  private resolveDataDimensions(
    data: Uint8Array | Uint8ClampedArray,
    size?: [number, number]
  ): { width: number; height: number } {
    if (size && size[0] > 0 && size[1] > 0) {
      return { width: size[0], height: size[1] };
    }

    const pixelCount = Math.floor(data.length / 4);
    const side = Math.floor(Math.sqrt(pixelCount));
    if (side > 0 && side * side === pixelCount) {
      return { width: side, height: side };
    }

    return { width: 0, height: 0 };
  }

  private worldToUV(worldX: number, worldZ: number): { u: number; v: number } {
    return {
      u: (worldX - this.worldOrigin.x) / this.worldSizeX,
      v: (worldZ - this.worldOrigin.y) / this.worldSizeZ
    };
  }

  private sampleHeight(x: number, z: number): number | null {
    if (!this.heightMapData) return 0;
    const { u, v } = this.worldToUV(x, z);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    if (this.heightMapWidth <= 0 || this.heightMapHeight <= 0) {
      return 0;
    }
    const px = Math.floor(u * (this.heightMapWidth - 1));
    const py = Math.floor((1 - v) * (this.heightMapHeight - 1));

    const heightValue = this.heightMapData[(py * this.heightMapWidth + px) * 4] / 255;
    return heightValue * this.heightMapScale;
  }

  private sampleNormal(x: number, z: number): THREE.Vector3 {
    if (!this.heightMapData) return new THREE.Vector3(0, 1, 0);

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

    if (this.maskMapWidth <= 0 || this.maskMapHeight <= 0) {
      return true;
    }
    const px = Math.floor(u * (this.maskMapWidth - 1));
    const py = Math.floor((1 - v) * (this.maskMapHeight - 1));

    return this.maskMapData[(py * this.maskMapWidth + px) * 4] > 128;
  }
}
