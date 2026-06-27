import * as THREE from 'three';
import { BaseScatterConfig, RequiredScatterConfig } from './types';
import { ChunkData } from './ChunkData';
import { InstancePool, PerlinNoise, SeededRandom } from '../utils';
import { MeshToInstancedMeshConverter } from '../converter/MeshToInstancedMeshConverter';

// Camera reference passed during update
let currentCamera: THREE.Camera | null = null;

/**
 * Abstract base class for all scatter systems.
 * Extends THREE.Group so it can be added to any scene.
 * Call update(camera) each frame for LOD calculations.
 */
export abstract class BaseScatterSystem extends THREE.Group {
  protected config: RequiredScatterConfig;
  protected converter: MeshToInstancedMeshConverter;
  protected instancePool: InstancePool;
  protected chunks: Map<string, ChunkData> = new Map();
  protected isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  protected debugGroup: THREE.Group;
  protected debugMaterial: THREE.LineBasicMaterial;

  // Frustum culling
  protected frustum: THREE.Frustum = new THREE.Frustum();
  protected frustumMatrix: THREE.Matrix4 = new THREE.Matrix4();
  protected frustumCullingEnabled: boolean = true;

  // Density map
  protected densityMapTexture: THREE.Texture | null = null;
  protected densityMapData: Uint8Array | null = null;
  /** Raster width/height for densityMapData (set by loadDensityMap or setDensityMapImageData). */
  protected densityMapWidth = 0;
  protected densityMapHeight = 0;

  constructor(config: BaseScatterConfig) {
    super();
    const defaultNoiseConfig = {
      enabled: false,
      scale: 0.1,
      octaves: 3,
      persistence: 0.5,
      lacunarity: 2.0,
      threshold: 0.3,
      power: 1.0,
      offset: 0.0,
      scaleVariation: 0.2
    };

    this.config = {
      ...config,
      maxInstances: config.maxInstances ?? 10000,
      chunkSize: config.chunkSize ?? 64,
      scaleRange: config.scaleRange ?? [0.8, 1.2],
      rotationRange: config.rotationRange ?? [0, Math.PI * 2],
      heightOffset: config.heightOffset ?? 0,
      alignToNormal: config.alignToNormal ?? true,
      randomSeed: config.randomSeed ?? Date.now(),
      showChunksDebug: config.showChunksDebug ?? false,
      noiseDistribution: { ...defaultNoiseConfig, ...(config.noiseDistribution || {}) },
      events: config.events ?? {}
    } as RequiredScatterConfig;

    this.instancePool = new InstancePool(this.config.maxInstances);
    this.converter = new MeshToInstancedMeshConverter(
      this.config.source,
      this.config.maxInstances
    );
    this.converter.setRenderCount(0);

    this.debugGroup = new THREE.Group();
    this.debugMaterial = new THREE.LineBasicMaterial({
      color: 0xffff00,
      depthTest: false,
      opacity: 0.5,
      transparent: true
    });
    this.add(this.debugGroup);
  }

  // ============================================
  // Abstract methods - must be implemented by subclasses
  // ============================================

  /**
   * Initialize system-specific distribution data (textures, surfaces, etc.)
   */
  protected abstract initializeDistribution(): Promise<void>;

  /**
   * Update which chunks are active based on camera position
   */
  protected abstract updateChunks(): void;

  /**
   * Populate a chunk with instances
   * @param chunk - Chunk data to populate
   * @param centerX - Chunk center X coordinate
   * @param centerZ - Chunk center Z coordinate
   * @param extraData - Optional system-specific data
   */
  protected abstract populateChunk(
    chunk: ChunkData,
    centerX: number,
    centerZ: number,
    extraData?: unknown
  ): void;

  // ============================================
  // Public API
  // ============================================

  /**
   * Initialize the scatter system.
   * Adds all instanced meshes to this Group.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initializeInternal();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async initializeInternal(): Promise<void> {
    // Load density map if configured with a URL
    if (this.config.densityMap?.textureUrl) {
      await this.loadDensityMap();
    }

    await this.initializeDistribution();

    // Add all instanced meshes to this Group
    for (const mesh of this.converter.getInstancedMeshes()) {
      this.add(mesh);
    }

    this.isInitialized = true;
    this.syncRenderCount();

    if (this.config.showChunksDebug) {
      this.updateDebugVisuals();
    }
  }

  /**
   * Load density map texture and extract pixel data
   */
  protected async loadDensityMap(): Promise<void> {
    if (!this.config.densityMap?.textureUrl) return;

    const loader = new THREE.TextureLoader();
    this.densityMapTexture = await loader.loadAsync(this.config.densityMap.textureUrl);

    const canvas = document.createElement('canvas');
    const img = this.densityMapTexture.image as HTMLImageElement;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    this.densityMapData = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    this.densityMapWidth = canvas.width;
    this.densityMapHeight = canvas.height;
  }

  /**
   * Release GPU texture used when the density map was loaded from a URL.
   * CPU-side {@link densityMapData} is unchanged until the next load/set.
   */
  protected disposeDensityMapTexture(): void {
    if (this.densityMapTexture) {
      this.densityMapTexture.dispose();
      this.densityMapTexture = null;
    }
  }

  /**
   * Replace density-map samples from packed RGBA {@link ImageData} and regenerate all chunks.
   * Does not require {@link densityMapTexture}; sampling uses {@link densityMapWidth} / {@link densityMapHeight}.
   *
   * Use this for live authoring (e.g. foliage mask painting) to avoid reloading a data URL each stroke.
   */
  setDensityMapImageData(imageData: ImageData): void {
    if (!this.config.densityMap) {
      console.warn('[BaseScatterSystem] setDensityMapImageData: densityMap is not configured');
      return;
    }
    if (!this.isInitialized) {
      console.warn('[BaseScatterSystem] setDensityMapImageData: scatter system not initialized yet');
      return;
    }

    this.disposeDensityMapTexture();
    this.densityMapData = new Uint8Array(imageData.data);
    this.densityMapWidth = imageData.width;
    this.densityMapHeight = imageData.height;

    this.regenerateAll();
  }

  /**
   * Reload {@link densityMapData} from {@link BaseScatterConfig.densityMap} textureUrl and regenerate chunks.
   */
  async reloadDensityMapFromConfiguredUrl(): Promise<void> {
    if (!this.config.densityMap?.textureUrl) {
      return;
    }
    if (!this.isInitialized) {
      console.warn('[BaseScatterSystem] reloadDensityMapFromConfiguredUrl: scatter system not initialized yet');
      return;
    }

    this.disposeDensityMapTexture();
    await this.loadDensityMap();
    this.regenerateAll();
  }

  /**
   * Sample density map at world position (returns 0-1)
   */
  protected sampleDensityMap(worldX: number, worldZ: number): number {
    if (!this.densityMapData || !this.config.densityMap) return 1.0;

    const w = this.densityMapWidth;
    const h = this.densityMapHeight;
    if (w <= 0 || h <= 0) return 1.0;

    const bounds = this.config.densityMap.worldBounds;
    const u = (worldX - bounds.min.x) / (bounds.max.x - bounds.min.x);
    const v = (worldZ - bounds.min.y) / (bounds.max.y - bounds.min.y);

    if (u < 0 || u > 1 || v < 0 || v > 1) return 1.0;

    const px = Math.floor(u * (w - 1));
    const py = Math.floor((1 - v) * (h - 1));
    const idx = (py * w + px) * 4;

    const channelOffset = { 'r': 0, 'g': 1, 'b': 2, 'a': 3 };
    const channel = this.config.densityMap.channel ?? 'r';
    const value = this.densityMapData[idx + channelOffset[channel]] / 255;

    return value * (this.config.densityMap.multiplier ?? 1.0);
  }

  /**
   * Update the scatter system based on camera position.
   * Call this every frame in your render loop.
   * @param camera - The camera to use for visibility calculations
   */
  update(camera: THREE.Camera): void {
    if (!this.isInitialized) return;
    // Set the camera for subclasses to use
    currentCamera = camera;
    // Update frustum for culling
    this.updateFrustum(camera);
    this.updateChunks();
    this.syncRenderCount();
  }

  /**
   * Update the view frustum from camera
   */
  protected updateFrustum(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.frustumMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(
      this.frustumMatrix,
      camera.coordinateSystem,
      camera.reversedDepth
    );
  }

  /**
   * Check if a bounding box is visible in the frustum
   */
  protected isChunkInFrustum(bounds: THREE.Box3): boolean {
    if (!this.frustumCullingEnabled) return true;
    return this.frustum.intersectsBox(bounds);
  }

  /**
   * Enable or disable frustum culling
   */
  setFrustumCulling(enabled: boolean): void {
    this.frustumCullingEnabled = enabled;
  }

  /**
   * Calculate LOD density multiplier based on distance from camera
   * @param chunkCenterX - X coordinate of chunk center
   * @param chunkCenterZ - Z coordinate of chunk center
   */
  protected getLODDensityMultiplier(chunkCenterX: number, chunkCenterZ: number): number {
    const camera = this.getCurrentCamera();
    if (!camera || !this.config.lod?.levels?.length) return 1.0;

    const dx = chunkCenterX - camera.position.x;
    const dz = chunkCenterZ - camera.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    const levels = this.config.lod.levels;
    const blendDistance = this.config.lod.blendDistance ?? 0;

    // Find which LOD level this distance falls into
    for (let i = levels.length - 1; i >= 0; i--) {
      if (distance >= levels[i].distance) {
        // Check for blending with next level
        if (blendDistance > 0 && i < levels.length - 1) {
          const nextLevel = levels[i + 1];
          const transitionStart = levels[i].distance;
          const transitionEnd = nextLevel.distance;

          if (distance < transitionStart + blendDistance && distance < transitionEnd) {
            const t = (distance - transitionStart) / blendDistance;
            const clampedT = Math.min(1, Math.max(0, t));
            return levels[i].densityMultiplier * (1 - clampedT) + nextLevel.densityMultiplier * clampedT;
          }
        }
        return levels[i].densityMultiplier;
      }
    }

    return 1.0; // Full density for closest range
  }

  /**
   * Calculate LOD scale multiplier based on distance from camera
   */
  protected getLODScaleMultiplier(chunkCenterX: number, chunkCenterZ: number): number {
    const camera = this.getCurrentCamera();
    if (!camera || !this.config.lod?.levels?.length) return 1.0;

    const dx = chunkCenterX - camera.position.x;
    const dz = chunkCenterZ - camera.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    const levels = this.config.lod.levels;

    for (let i = levels.length - 1; i >= 0; i--) {
      if (distance >= levels[i].distance) {
        return levels[i].scaleMultiplier ?? 1.0;
      }
    }

    return 1.0;
  }

  /**
   * Set instance density and regenerate
   * @param density - Instances per unit area
   */
  setDensity(density: number): void {
    this.config.density = density;
    this.regenerateAll();
  }

  /**
   * Set the visibility range
   * @param range - Distance from camera where instances are visible
   */
  setVisibilityRange(range: number): void {
    this.config.visibilityRange = range;
  }

  /**
   * Toggle debug visualization
   * @param enabled - Whether to show debug visuals
   */
  toggleDebug(enabled: boolean): void {
    this.config.showChunksDebug = enabled;
    this.debugGroup.visible = enabled;
    if (enabled) this.updateDebugVisuals();
    else this.debugGroup.clear();
  }

  /**
   * Regenerate all chunks
   */
  regenerateAll(): void {
    for (const key of this.chunks.keys()) {
      this.deactivateChunk(key);
    }
    this.chunks.clear();
    this.updateChunks();
    this.syncRenderCount();
    this.emitStatsChanged();
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    this.regenerateAll();
    this.disposeDensityMapTexture();
    this.densityMapData = null;
    this.densityMapWidth = 0;
    this.densityMapHeight = 0;
    // Remove instanced meshes from this Group
    for (const mesh of this.converter.getInstancedMeshes()) {
      this.remove(mesh);
    }
    this.converter.dispose();
    this.remove(this.debugGroup);
    this.debugGroup.clear();
    this.debugMaterial.dispose();
    this.instancePool.clear();
    this.isInitialized = false;
    this.initPromise = null;
  }

  /**
   * Get system statistics
   */
  getStats(): {
    instances: { active: number; total: number; max: number };
    chunks: { total: number; active: number };
    meshes: number;
  } {
    return {
      instances: this.instancePool.getStats(),
      chunks: {
        total: this.chunks.size,
        active: Array.from(this.chunks.values()).filter(c => c.isActive).length
      },
      meshes: this.converter.getMeshCount()
    };
  }

  /**
   * Get the underlying mesh converter
   */
  getConverter(): MeshToInstancedMeshConverter {
    return this.converter;
  }

  // ============================================
  // Protected utilities for subclasses
  // ============================================

  /**
   * Get the current camera set during update()
   */
  protected getCurrentCamera(): THREE.Camera | null {
    return currentCamera;
  }

  /**
   * Generate a unique chunk key from coordinates
   */
  protected getChunkKey(x: number, z: number): string {
    return `${Math.floor(x)}_${Math.floor(z)}`;
  }

  /**
   * Activate a chunk at the given coordinates
   */
  protected activateChunk(x: number, z: number, extraData?: unknown): void {
    const key = this.getChunkKey(x, z);
    const chunkSeed = ((x * 73856093) ^ (z * 19349663) ^ this.config.randomSeed) >>> 0;
    const noiseGen = new PerlinNoise(chunkSeed);
    const chunkSize = this.config.chunkSize;
    const bounds = new THREE.Box3(
      new THREE.Vector3(x - chunkSize / 2, -1000, z - chunkSize / 2),
      new THREE.Vector3(x + chunkSize / 2, 1000, z + chunkSize / 2)
    );

    const chunk: ChunkData = {
      instances: [],
      isActive: true,
      noiseGenerator: noiseGen,
      bounds: bounds
    };

    this.populateChunk(chunk, x, z, extraData);
    this.chunks.set(key, chunk);

    // Emit activation event
    this.config.events?.onChunkActivated?.(key, chunk.instances.length);
    this.emitStatsChanged();
  }

  /**
   * Deactivate a chunk and release its instances
   */
  protected deactivateChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    for (const instanceId of chunk.instances) {
      this.converter.hideInstance(instanceId);
      this.instancePool.release(instanceId);
    }

    chunk.instances = [];
    chunk.isActive = false;

    // Emit deactivation event
    this.config.events?.onChunkDeactivated?.(key);
    this.emitStatsChanged();
  }

  protected syncRenderCount(): void {
    const maxId = this.instancePool.getHighestActiveId();
    this.converter.setRenderCount(maxId + 1);
  }

  protected emitStatsChanged(): void {
    this.config.events?.onStatsChanged?.(this.getStats());
  }

  /**
   * Get noise value at position
   */
  protected getNoiseValue(x: number, z: number, noise: PerlinNoise): number {
    const cfg = this.config.noiseDistribution;
    const noiseValue = noise.fbm2D(
      x, z,
      cfg.octaves,
      cfg.persistence,
      cfg.lacunarity,
      cfg.scale
    );
    return Math.pow(noiseValue + cfg.offset, cfg.power);
  }

  /**
   * Check if instance should be placed at position based on noise
   */
  protected shouldPlaceInstance(x: number, z: number, noise: PerlinNoise, rng?: SeededRandom): boolean {
    if (this.config.noiseDistribution.enabled) {
      const noiseValue = this.getNoiseValue(x, z, noise);
      if (noiseValue < this.config.noiseDistribution.threshold) {
        return false;
      }
    }

    const densityValue = THREE.MathUtils.clamp(this.sampleDensityMap(x, z), 0, 1);
    if (densityValue <= 0) return false;
    if (densityValue >= 1) return true;

    if (rng) {
      return rng.next() <= densityValue;
    }

    const hashed = Math.sin((x * 12.9898) + (z * 78.233) + this.config.randomSeed) * 43758.5453;
    const pseudoRandom = hashed - Math.floor(hashed);
    return pseudoRandom <= densityValue;
  }

  /**
   * Create transform for an instance with optional normal alignment
   */
  protected createInstanceTransform(
    position: THREE.Vector3,
    rng: SeededRandom,
    normal?: THREE.Vector3,
    noiseGen?: PerlinNoise
  ): { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 } {
    position.y += this.config.heightOffset;

    const rotation = new THREE.Euler(0, rng.range(...this.config.rotationRange), 0);

    if (this.config.alignToNormal && normal) {
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);
      rotation.setFromQuaternion(quaternion);
      rotation.y += rng.range(...this.config.rotationRange);
    }

    let baseScale = rng.range(...this.config.scaleRange);

    // Apply noise-based scale variation when enabled
    if (this.config.noiseDistribution.enabled && noiseGen && this.config.noiseDistribution.scaleVariation > 0) {
      const noiseVal = this.getNoiseValue(position.x, position.z, noiseGen);
      // noiseVal is typically 0-1; remap to (1 - variation) .. (1 + variation)
      const variation = this.config.noiseDistribution.scaleVariation;
      const scaleMod = 1.0 + (noiseVal * 2.0 - 1.0) * variation;
      baseScale *= Math.max(0.01, scaleMod);
    }

    const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

    return { position, rotation, scale };
  }

  /**
   * Update debug visualization
   */
  protected updateDebugVisuals(): void {
    this.debugGroup.clear();
    if (!this.config.showChunksDebug) return;

    const size = this.config.chunkSize;
    const geometry = new THREE.BoxGeometry(size, size / 4, size);
    const edges = new THREE.EdgesGeometry(geometry);

    for (const chunk of this.chunks.values()) {
      if (!chunk.isActive) continue;
      const box = new THREE.LineSegments(edges, this.debugMaterial);
      const center = chunk.bounds.getCenter(new THREE.Vector3());
      box.position.copy(center);
      this.debugGroup.add(box);
    }

    geometry.dispose();
    edges.dispose();
  }
}
