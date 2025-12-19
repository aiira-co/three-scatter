// Core
export { BaseScatterSystem } from './core';
export type {
  BaseScatterConfig,
  RequiredScatterConfig,
  NoiseDistributionConfig,
  ChunkData,
  ScatterEvents,
  ScatterStats,
  LODLevel,
  LODConfig,
  DensityMapConfig
} from './core';

// Systems
export {
  HeightmapScatterSystem,
  MeshScatterSystem,
  CurveScatterSystem,
  VolumeScatterSystem,
  RadialScatterSystem,
  GridScatterSystem,
  SplineScatterSystem,
  PhysicsScatterSystem
} from './systems';

export type {
  HeightmapScatterConfig,
  MeshScatterConfig,
  CurveScatterConfig,
  VolumeScatterConfig,
  RadialScatterConfig,
  GridScatterConfig,
  SplineScatterConfig,
  PhysicsScatterConfig,
  PhysicsBody
} from './systems';

// Utils
export {
  SeededRandom,
  PerlinNoise,
  InstancePool,
  ScatterSerializer
} from './utils';

export type {
  ScatterSaveData,
  SerializedScatterConfig,
  SerializedInstance
} from './utils';

// Features
export {
  ScatterBlender,
  ScatterBrush
} from './features';

export type {
  ScatterLayer,
  BlenderConfig,
  BrushConfig,
  PaintedInstance
} from './features';

// Converter
export { MeshToInstancedMeshConverter } from './converter';
export type { ITransformationData } from './converter';
