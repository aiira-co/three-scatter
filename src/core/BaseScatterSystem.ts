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
  protected debugGroup: THREE.Group;
  protected debugMaterial: THREE.LineBasicMaterial;

  // Frustum culling
  protected frustum: THREE.Frustum = new THREE.Frustum();
  protected frustumMatrix: THREE.Matrix4 = new THREE.Matrix4();
  protected frustumCullingEnabled: boolean = true;

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
    await this.initializeDistribution();
    // Add all instanced meshes to this Group
    for (const mesh of this.converter.getInstancedMeshes()) {
      this.add(mesh);
    }
    this.isInitialized = true;
    if (this.config.showChunksDebug) this.updateDebugVisuals();
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
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
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
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    this.regenerateAll();
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
  protected shouldPlaceInstance(x: number, z: number, noise: PerlinNoise): boolean {
    if (!this.config.noiseDistribution.enabled) return true;
    const noiseValue = this.getNoiseValue(x, z, noise);
    return noiseValue >= this.config.noiseDistribution.threshold;
  }

  /**
   * Create transform for an instance with optional normal alignment
   */
  protected createInstanceTransform(
    position: THREE.Vector3,
    rng: SeededRandom,
    normal?: THREE.Vector3
  ): { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 } {
    position.y += this.config.heightOffset;

    const rotation = new THREE.Euler(0, rng.range(...this.config.rotationRange), 0);

    if (this.config.alignToNormal && normal) {
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);
      rotation.setFromQuaternion(quaternion);
      rotation.y += rng.range(...this.config.rotationRange);
    }

    const baseScale = rng.range(...this.config.scaleRange);
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
