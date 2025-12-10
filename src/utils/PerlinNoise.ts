import { SeededRandom } from './SeededRandom';

/**
 * Perlin noise generator with FBM (Fractional Brownian Motion) support
 * Used for natural-looking procedural distribution patterns
 */
export class PerlinNoise {
  private permutation: number[];
  private grad3: Float32Array;

  constructor(seed: number) {
    this.permutation = new Array(512);
    this.grad3 = new Float32Array([
      1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
      1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
      0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
    ]);

    const rng = new SeededRandom(seed);
    const p = new Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    
    for (let i = 0; i < 512; i++) {
      this.permutation[i] = p[i & 255];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  /**
   * Sample 2D Perlin noise
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns Noise value between 0 and 1
   */
  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    
    const u = this.fade(x);
    const v = this.fade(y);
    
    const a = this.permutation[X] + Y;
    const b = this.permutation[X + 1] + Y;
    
    return (this.lerp(
      this.lerp(
        this.grad(this.permutation[a], x, y),
        this.grad(this.permutation[b], x - 1, y),
        u
      ),
      this.lerp(
        this.grad(this.permutation[a + 1], x, y - 1),
        this.grad(this.permutation[b + 1], x - 1, y - 1),
        u
      ),
      v
    ) + 1) * 0.5;
  }

  /**
   * Sample Fractional Brownian Motion (multi-octave noise)
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param octaves - Number of noise octaves to combine
   * @param persistence - Amplitude multiplier per octave (0-1)
   * @param lacunarity - Frequency multiplier per octave (typically 2)
   * @param scale - Base frequency scale
   * @returns Combined noise value between 0 and 1
   */
  fbm2D(
    x: number,
    y: number,
    octaves: number,
    persistence: number,
    lacunarity: number,
    scale: number = 1
  ): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    
    x *= scale;
    y *= scale;
    
    for (let i = 0; i < octaves; i++) {
      value += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    
    return value / maxValue;
  }
}
