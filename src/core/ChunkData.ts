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
  /**
   * LOD band index this chunk's instances were generated at, or -1 for the
   * nearest (full-density) band. Lets a system detect that a chunk has moved
   * into a denser band and needs repopulating; see
   * {@link BaseScatterSystem.getLODBandIndex}.
   */
  lodBand?: number;
  /**
   * Whether this chunk's instances are currently shown. Distinct from
   * {@link isActive}: a retained chunk stays active (its placement preserved)
   * while being hidden because it is outside the view frustum.
   */
  isVisible?: boolean;
  /**
   * Density multiplier this chunk was populated at. Needed alongside
   * {@link lodBand} because with `blendDistance` the multiplier varies *inside* a
   * band, so the band index alone under-detects a density change.
   */
  lodDensity?: number;
  /**
   * Value of the system's pool-release counter at the moment this chunk ran out
   * of instances mid-population, or undefined if it filled completely.
   *
   * A starved chunk is underfilled but still active, so nothing would ever repair
   * it. Retrying is gated on the counter having moved -- i.e. some other chunk has
   * since been released -- so a genuinely over-subscribed pool cannot make the
   * same chunk rebuild every frame.
   */
  starvedGeneration?: number;
}
