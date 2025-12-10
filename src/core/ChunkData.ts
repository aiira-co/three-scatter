import * as THREE from 'three';
import { PerlinNoise } from '../utils/PerlinNoise';

/**
 * Data structure for a chunk in the scatter system
 */
export interface ChunkData {
  /** Instance IDs assigned to this chunk */
  instances: number[];
  /** Whether the chunk is currently active/visible */
  isActive: boolean;
  /** Noise generator for this chunk (seeded by position) */
  noiseGenerator: PerlinNoise | null;
  /** World-space bounding box of the chunk */
  bounds: THREE.Box3;
}
