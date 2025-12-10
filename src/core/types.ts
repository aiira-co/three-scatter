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
}

/**
 * Required version of BaseScatterConfig with all optional fields filled
 */
export type RequiredScatterConfig = Required<BaseScatterConfig> & {
  noiseDistribution: Required<NoiseDistributionConfig>;
};
