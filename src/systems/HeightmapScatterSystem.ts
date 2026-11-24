import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { PerlinNoise, SeededRandom, violatesMinSpacing } from '../utils';

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
  /** Points for this update, including chunks that are not resident. Load order must not change them. */
  private _placementMemo = new Map<string, { x: number; z: number }[]>();

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

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    this._placementMemo = new Map();
    const cameraPos = camera.position;
    const chunkSize = this.config.chunkSize;
    const residentRange = this.getResidentRange();
    const retain = this.isRetentionEnabled();
    const minWorldX = this.worldOrigin.x;
    const minWorldZ = this.worldOrigin.y;
    const maxWorldX = minWorldX + this.worldSizeX;
    const maxWorldZ = minWorldZ + this.worldSizeZ;

    const residents: Array<{
      key: string;
      x: number;
      z: number;
      bounds: THREE.Box3;
      scatterVisible: boolean;
    }> = [];
    const residentKeys = new Set<string>();

    const startX = Math.floor((cameraPos.x - residentRange) / chunkSize) * chunkSize;
    const endX = Math.ceil((cameraPos.x + residentRange) / chunkSize) * chunkSize;
    const startZ = Math.floor((cameraPos.z - residentRange) / chunkSize) * chunkSize;
    const endZ = Math.ceil((cameraPos.z + residentRange) / chunkSize) * chunkSize;

    for (let x = startX; x <= endX; x += chunkSize) {
      for (let z = startZ; z <= endZ; z += chunkSize) {
        const chunkX = x + chunkSize / 2;
        const chunkZ = z + chunkSize / 2;

        if (chunkX < minWorldX || chunkX > maxWorldX || chunkZ < minWorldZ || chunkZ > maxWorldZ) continue;

        const dx = chunkX - cameraPos.x;
        const dz = chunkZ - cameraPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > residentRange) continue;

        const chunkBounds = new THREE.Box3(
          new THREE.Vector3(chunkX - chunkSize / 2, -1000, chunkZ - chunkSize / 2),
          new THREE.Vector3(chunkX + chunkSize / 2, 1000, chunkZ + chunkSize / 2)
        );
        const scatterVisible = this.isChunkScatterVisible(chunkX, chunkZ, chunkBounds);
        // Without retention, frustum still gates residency so turning away
        // releases instances. With retention, off-frustum chunks stay allocated.
        if (!retain && !scatterVisible) continue;

        const key = this.getChunkKey(chunkX, chunkZ);
        residentKeys.add(key);
        residents.push({ key, x: chunkX, z: chunkZ, bounds: chunkBounds, scatterVisible });
      }
    }

    // Release everything leaving before populating, so peak allocation is the
    // resident set rather than outgoing + incoming.
    for (const [key, chunk] of this.chunks.entries()) {
      if (!residentKeys.has(key) && chunk.isActive) {
        this.deactivateChunk(key);
      }
    }

    const releaseGeneration = this.instancePool.getReleaseGeneration();
    for (const resident of residents) {
      const chunk = this.chunks.get(resident.key);
      const needsPopulate = !chunk?.isActive;
      const needsLodRefresh = !!chunk?.isActive && this.chunkNeedsLODRefresh(chunk, resident.x, resident.z);
      const needsStarvedRetry = !!chunk?.isActive
        && chunk.starvedGeneration !== undefined
        && releaseGeneration > chunk.starvedGeneration;

      if (needsPopulate) {
        this.activateChunk(resident.x, resident.z);
      } else if (needsLodRefresh || needsStarvedRetry) {
        this.rebuildChunk(resident.x, resident.z);
      }
    }

    for (const resident of residents) {
      this.syncChunkScatterVisibility(resident.key, resident.scatterVisible);
    }
  }

  protected populateChunk(chunk: ChunkData, centerX: number, centerZ: number): void {
    const lodMultiplier = this.getLODDensityMultiplier(centerX, centerZ);
    chunk.populatedLodMultiplier = lodMultiplier;
    const candidates = this._acceptedPoints(centerX, centerZ);
    // LOD only removes a stable suffix; it never changes spacing decisions.
    const local = this.config.minSpacing > 0
      ? candidates.slice(0, Math.floor(candidates.length * Math.min(1, Math.max(0, lodMultiplier))))
      : candidates;
    chunk.placedPoints = local.slice();

    const chunkSeed = this._chunkSeed(centerX, centerZ);
    const transformRng = new SeededRandom((chunkSeed ^ 0x85ebca6b) >>> 0);
    for (const point of local) {
      const height = this.sampleHeight(point.x, point.z);
      if (height === null) continue;

      const instanceId = this.instancePool.acquire();
      if (instanceId === null) {
        chunk.starvedGeneration = this.instancePool.getReleaseGeneration();
        break;
      }

      const normal = this.sampleNormal(point.x, point.z);
      const position = new THREE.Vector3(point.x, height, point.z);
      const transform = this.createInstanceTransform(
        position,
        transformRng,
        normal,
        chunk.noiseGenerator ?? undefined,
      );

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
    }
  }

  /**
   * Yield to full-density local candidates from earlier neighboring chunks.
   * Neighbors do not resolve their own neighbors here: even a candidate which
   * later loses a border conflict reserves its space. This conservative border
   * thinning gives a finite halo and a camera-independent, globally spaced set.
   */
  private _acceptedPoints(centerX: number, centerZ: number): { x: number; z: number }[] {
    const local = this._localCandidates(centerX, centerZ);
    if (this.config.minSpacing <= 0) return local;
    const half = this.config.chunkSize / 2;
    const bounds = new THREE.Box3(
      new THREE.Vector3(centerX - half, -1000, centerZ - half),
      new THREE.Vector3(centerX + half, 1000, centerZ + half),
    );
    const anchors = this._deterministicAnchors(centerX, centerZ, bounds);
    return local.filter((point) => !violatesMinSpacing(point.x, point.z, anchors, this.config.minSpacing));
  }

  private _localCandidates(centerX: number, centerZ: number): { x: number; z: number }[] {
    const key = `${centerX}:${centerZ}`;
    const cached = this._placementMemo.get(key);
    if (cached) {
      return cached;
    }

    const local: { x: number; z: number }[] = [];
    this._placementMemo.set(key, local);
    const chunkSize = this.config.chunkSize;
    if (!(chunkSize > 0) || !this._chunkCenterInWorld(centerX, centerZ)) {
      return local;
    }

    const halfSize = chunkSize / 2;
    const minX = centerX - halfSize;
    const maxX = centerX + halfSize;
    const minZ = centerZ - halfSize;
    const maxZ = centerZ + halfSize;
    const accepted: { x: number; z: number }[] = [];

    const lodMultiplier = this.config.minSpacing > 0 ? 1 : this.getLODDensityMultiplier(centerX, centerZ);
    const targetCount = Math.floor(chunkSize * chunkSize * this.config.density * lodMultiplier);
    const maxAttempts = targetCount * 3;
    const minSpacing = this.config.minSpacing;
    const chunkSeed = this._chunkSeed(centerX, centerZ);
    const rng = new SeededRandom(chunkSeed);
    const noise = new PerlinNoise(chunkSeed);
    let placed = 0;
    let attempts = 0;

    while (placed < targetCount && attempts < maxAttempts) {
      attempts++;
      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);
      if (violatesMinSpacing(x, z, accepted, minSpacing)) continue;
      if (!this.shouldPlaceInstance(x, z, noise, rng)) continue;
      if (!this.checkMask(x, z)) continue;
      if (this.sampleHeight(x, z) === null) continue;
      if (this.calculateSlope(this.sampleNormal(x, z)) > this.slopeLimit) continue;

      const point = { x, z };
      accepted.push(point);
      local.push(point);
      placed++;
    }

    return local;
  }

  private _deterministicAnchors(
    centerX: number,
    centerZ: number,
    bounds: THREE.Box3,
  ): { x: number; z: number }[] {
    const minSpacing = this.config.minSpacing;
    const chunkSize = this.config.chunkSize;
    if (minSpacing <= 0 || !(chunkSize > 0)) {
      return [];
    }

    const reach = Math.max(1, Math.ceil(minSpacing / chunkSize));
    const minX = bounds.min.x - minSpacing;
    const maxX = bounds.max.x + minSpacing;
    const minZ = bounds.min.z - minSpacing;
    const maxZ = bounds.max.z + minSpacing;
    const anchors: { x: number; z: number }[] = [];
    for (let ix = -reach; ix <= reach; ix++) {
      for (let iz = -reach; iz <= reach; iz++) {
        if (ix === 0 && iz === 0) continue;
        const neighborX = centerX + (ix * chunkSize);
        const neighborZ = centerZ + (iz * chunkSize);
        if (this._chunkOrder(neighborX, neighborZ, centerX, centerZ) >= 0) continue;
        if (!this._chunkCenterInWorld(neighborX, neighborZ)) continue;

        for (const point of this._localCandidates(neighborX, neighborZ)) {
          if (point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ) continue;
          anchors.push(point);
        }
      }
    }
    return anchors;
  }

  private _chunkSeed(centerX: number, centerZ: number): number {
    return ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
  }

  private _chunkCenterInWorld(centerX: number, centerZ: number): boolean {
    return centerX >= this.worldOrigin.x
      && centerX <= this.worldOrigin.x + this.worldSizeX
      && centerZ >= this.worldOrigin.y
      && centerZ <= this.worldOrigin.y + this.worldSizeZ;
  }

  /** Negative when the first chunk is the one that keeps its points. */
  private _chunkOrder(ax: number, az: number, bx: number, bz: number): number {
    if (ax !== bx) return ax < bx ? -1 : 1;
    if (az !== bz) return az < bz ? -1 : 1;
    return 0;
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
