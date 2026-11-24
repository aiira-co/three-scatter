import * as THREE from 'three';
import { PerlinNoise } from '../utils/PerlinNoise';

/**
 * Data structure for a chunk in the scatter system
 */
export interface ChunkData {
  /** Instance IDs assigned to this chunk */
  instances: number[];
  /** Whether the chunk is currently resident (instances allocated) */
  isActive: boolean;
  /**
   * Whether the chunk is currently drawn.
   * Combined from scatter visibility (distance/frustum) and external culling.
   */
  isVisible: boolean;
  /** Scatter-owned visibility: in range and in frustum */
  scatterVisible: boolean;
  /** Hidden by an owner (occlusion, streaming zones, etc.) */
  externallyHidden: boolean;
  /** Chunk center X in world space */
  centerX: number;
  /** Chunk center Z in world space */
  centerZ: number;
  /** Noise generator for this chunk (seeded by position) */
  noiseGenerator: PerlinNoise | null;
  /** World-space bounding box of the chunk */
  bounds: THREE.Box3;
  /** Density multiplier used the last time this chunk was populated */
  populatedLodMultiplier?: number;
  /** Points accepted in this chunk, so a neighbor can honor minSpacing across the border. */
  placedPoints?: { x: number; z: number }[];
  /**
   * Instance-pool release generation at the moment this chunk ran out of
   * capacity. Retried only after that counter moves, so an over-subscribed
   * pool does not rebuild the same chunk every frame.
   */
  starvedGeneration?: number;
}
