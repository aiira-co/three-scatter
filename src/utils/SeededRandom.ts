/**
 * Deterministic pseudo-random number generator
 * Uses Linear Congruential Generator (LCG) algorithm
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Generate next random number between 0 and 1
   */
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  /**
   * Generate random number within a range
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (exclusive)
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate random integer within a range
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   */
  rangeInt(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Reset the generator to a new seed
   */
  setSeed(seed: number): void {
    this.seed = seed;
  }
}
