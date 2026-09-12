import * as THREE from 'three';

/**
 * Noise distribution configuration for procedural placement variation
 */
export interface NoiseDistributionConfig {
  enabled: boolean;
  scale?: number;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  threshold?: number;
  power?: number;
  offset?: number;
  scaleVariation?: number;
}

/**
 * Event callbacks for scatter system lifecycle
 */
export interface ScatterEvents {
  /** Called when a chunk is activated with instances */
  onChunkActivated?: (chunkKey: string, instanceCount: number) => void;
  /** Called when a chunk is deactivated */
  onChunkDeactivated?: (chunkKey: string) => void;
  /** Called when scatter statistics change */
  onStatsChanged?: (stats: ScatterStats) => void;
}

/**
 * Scatter system statistics
 */
export interface ScatterStats {
  instances: { active: number; total: number; max: number };
  chunks: { total: number; active: number };
  meshes: number;
}

/**
 * Single LOD level configuration
 */
export interface LODLevel {
  /** Distance threshold for this LOD level */
  distance: number;
  /** Density multiplier (0-1) */
  densityMultiplier: number;
  /** Optional scale multiplier */
  scaleMultiplier?: number;
}

/**
 * LOD configuration for progressive detail reduction
 */
export interface LODConfig {
  /** Array of LOD levels, ordered by distance (ascending) */
  levels: LODLevel[];
  /** Blend distance between levels (optional smooth transition) */
  blendDistance?: number;
}

/**
 * Density map configuration for texture-based density modulation
 */
export interface DensityMapConfig {
  /** URL to density map texture (optional if you only use {@link BaseScatterSystem.setDensityMapImageData}) */
  textureUrl?: string;
  /** Which channel to sample (default: 'r') */
  channel?: 'r' | 'g' | 'b' | 'a';
  /** World bounds the texture maps to */
  worldBounds: THREE.Box2;
  /** Multiplier applied to sampled value */
  multiplier?: number;
}

/**
 * Chunk residency policy.
 *
 * By default a chunk's lifetime is tied to the view frustum: leaving it tears the
 * chunk down and releases its instances, so turning back re-runs the whole
 * placement pass (sampling, slope rejection, masking, transform composition).
 * With retention enabled, residency depends on distance alone and the frustum
 * only decides whether a resident chunk is drawn.
 */
export interface ChunkRetentionConfig {
  /** Retain chunks by distance instead of by frustum. */
  enabled: boolean;
  /**
   * Extra fraction of `visibilityRange` a resident chunk is kept for before being
   * released. Gives load/unload hysteresis so a camera sitting on the boundary
   * cannot thrash a chunk. Default 0.25.
   */
  unloadMargin?: number;
  /**
   * Lets an owner veto a chunk being shown -- for occlusion or zone culling that
   * lives outside this package. Consulted whenever frustum visibility changes, so
   * the two systems cannot fight over the same instances frame to frame.
   */
  isExternallyHidden?: (chunkKey: string) => boolean;
}

/**
 * Base configuration shared by all scatter systems
 */
export interface BaseScatterConfig {
  /** Source mesh or group to instance */
  source: THREE.Mesh | THREE.Group;
  /** Instances per unit area (or volume for VolumeScatter) */
  density: number;
  /** Maximum number of instances to create */
  maxInstances?: number;
  /** Distance from camera where instances are visible */
  visibilityRange: number;
  /** Size of each chunk for spatial partitioning */
  chunkSize?: number;
  /** Min/max scale range for instances */
  scaleRange?: [number, number];
  /** Min/max Y rotation range in radians */
  rotationRange?: [number, number];
  /** Vertical offset applied to all instances */
  heightOffset?: number;
  /** Align instances to surface normal */
  alignToNormal?: boolean;
  /** Seed for deterministic random placement */
  randomSeed?: number;
  /** Show debug wireframes for chunks */
  showChunksDebug?: boolean;
  /** Noise-based distribution settings */
  noiseDistribution?: NoiseDistributionConfig;
  /** Event callbacks */
  events?: ScatterEvents;
  /** LOD configuration for distance-based density */
  lod?: LODConfig;
  /** Density map for texture-based density variation */
  densityMap?: DensityMapConfig;
  /** Chunk residency policy. Omitted means frustum-tied lifetime, as before. */
  chunkRetention?: ChunkRetentionConfig;
}

/**
 * Required version of BaseScatterConfig with all optional fields filled
 */
export type RequiredScatterConfig = Required<Omit<BaseScatterConfig, 'events'>> & {
  noiseDistribution: Required<NoiseDistributionConfig>;
  events: ScatterEvents;
};

