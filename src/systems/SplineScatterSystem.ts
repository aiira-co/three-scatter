import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for spline-based scatter
 */
export interface SplineScatterConfig extends BaseScatterConfig {
  /** Spline curve to scatter along */
  spline: THREE.CatmullRomCurve3 | THREE.CubicBezierCurve3 | THREE.QuadraticBezierCurve3;
  /** Distribution mode */
  distributionMode?: 'uniform' | 'adaptive' | 'density-based';
  /** Number of segments along spline */
  segmentCount?: number;
  /** Alternative: spacing between instances */
  spacing?: number;
  /** Tension for CatmullRom curves */
  tension?: number;
  /** Width perpendicular to spline */
  width?: number;
  /** Instances per segment for width distribution */
  distributionsPerSegment?: number;
  /** Bank angle on curves (radians) */
  bankAngle?: number;
  /** Orient along spline direction */
  followTangent?: boolean;
  /** Custom up vector */
  upVector?: THREE.Vector3;
  /** Custom offset function based on t (0-1) */
  offsetCurve?: (t: number) => number;
}

/**
 * Scatter system with advanced spline features including banking and Frenet frames
 */
export class SplineScatterSystem extends BaseScatterSystem {
  private spline: THREE.CatmullRomCurve3 | THREE.CubicBezierCurve3 | THREE.QuadraticBezierCurve3;
  private distributionMode: 'uniform' | 'adaptive' | 'density-based';
  private segmentCount: number;
  private spacing?: number;
  private tension: number;
  private width: number;
  private distributionsPerSegment: number;
  private bankAngle: number;
  private followTangent: boolean;
  private upVector: THREE.Vector3;
  private offsetCurve?: (t: number) => number;

  private splinePoints: THREE.Vector3[] = [];
  private splineTangents: THREE.Vector3[] = [];
  private splineNormals: THREE.Vector3[] = [];
  private splineBinormals: THREE.Vector3[] = [];

  constructor(config: SplineScatterConfig) {
    super(config);
    this.spline = config.spline;
    this.distributionMode = config.distributionMode ?? 'uniform';
    this.segmentCount = config.segmentCount ?? 100;
    this.spacing = config.spacing;
    this.tension = config.tension ?? 0.5;
    this.width = config.width ?? 0;
    this.distributionsPerSegment = config.distributionsPerSegment ?? 1;
    this.bankAngle = config.bankAngle ?? 0;
    this.followTangent = config.followTangent ?? true;
    this.upVector = config.upVector ?? new THREE.Vector3(0, 1, 0);
    this.offsetCurve = config.offsetCurve;

    this.init();
  }

  protected async initializeDistribution(): Promise<void> {
    this.generateSplineData();
  }

  private generateSplineData(): void {
    let pointCount = this.segmentCount;
    if (this.spacing) {
      pointCount = Math.floor(this.spline.getLength() / this.spacing);
    }

    if (this.spline instanceof THREE.CatmullRomCurve3) {
      this.spline.tension = this.tension;
    }

    switch (this.distributionMode) {
      case 'adaptive':
        this.splinePoints = this.generateAdaptivePoints(pointCount);
        break;
      case 'density-based':
        this.splinePoints = this.generateDensityBasedPoints(pointCount);
        break;
      case 'uniform':
      default:
        this.splinePoints = this.spline.getPoints(pointCount);
        break;
    }

    this.splineTangents = this.splinePoints.map((_, index) => {
      const t = index / (this.splinePoints.length - 1);
      return this.spline.getTangent(t).normalize();
    });

    this.calculateFrenetFrame();
  }

  private generateAdaptivePoints(targetCount: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const segments = targetCount * 2;
    const tempPoints = this.spline.getPoints(segments);

    const curvatures: number[] = [];
    for (let i = 1; i < tempPoints.length - 1; i++) {
      const prev = tempPoints[i - 1];
      const curr = tempPoints[i];
      const next = tempPoints[i + 1];

      const v1 = new THREE.Vector3().subVectors(curr, prev);
      const v2 = new THREE.Vector3().subVectors(next, curr);
      const angle = v1.angleTo(v2);
      curvatures.push(angle);
    }

    const totalCurvature = curvatures.reduce((sum, c) => sum + c, 0);
    let cumulativeCurvature = 0;
    let pointIndex = 0;

    for (let i = 0; i < targetCount; i++) {
      const targetCurvature = (i / targetCount) * totalCurvature;

      while (cumulativeCurvature < targetCurvature && pointIndex < curvatures.length) {
        cumulativeCurvature += curvatures[pointIndex];
        pointIndex++;
      }

      const t = (pointIndex + 1) / (tempPoints.length - 1);
      points.push(this.spline.getPoint(t));
    }

    return points;
  }

  private generateDensityBasedPoints(targetCount: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];

    for (let i = 0; i < targetCount; i++) {
      const t = i / (targetCount - 1);
      const point = this.spline.getPoint(t);

      const densityModifier = this.config.density;
      if (Math.random() < densityModifier) {
        points.push(point);
      }
    }

    return points;
  }

  private calculateFrenetFrame(): void {
    this.splineNormals = [];
    this.splineBinormals = [];

    for (let i = 0; i < this.splineTangents.length; i++) {
      const tangent = this.splineTangents[i];

      const normal = new THREE.Vector3().crossVectors(this.upVector, tangent).normalize();

      if (normal.length() < 0.001) {
        normal.set(1, 0, 0);
      }

      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

      this.splineNormals.push(normal);
      this.splineBinormals.push(binormal);
    }
  }

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    const cameraPos = camera.position;
    const visRange = this.config.visibilityRange;
    const chunkSize = this.config.chunkSize;

    const activeChunkKeys = new Set<string>();

    for (let i = 0; i < this.splinePoints.length; i++) {
      const point = this.splinePoints[i];
      const distance = point.distanceTo(cameraPos);

      if (distance <= visRange) {
        const chunkX = Math.floor(point.x / chunkSize) * chunkSize + chunkSize / 2;
        const chunkZ = Math.floor(point.z / chunkSize) * chunkSize + chunkSize / 2;
        const key = this.getChunkKey(chunkX, chunkZ);

        if (!activeChunkKeys.has(key)) {
          activeChunkKeys.add(key);

          if (!this.chunks.has(key) || !this.chunks.get(key)!.isActive) {
            this.activateChunk(chunkX, chunkZ, i);
          }
        }
      }
    }

    for (const [key, chunk] of this.chunks.entries()) {
      if (!activeChunkKeys.has(key) && chunk.isActive) {
        this.deactivateChunk(key);
      }
    }
  }

  protected populateChunk(chunk: ChunkData, centerX: number, centerZ: number): void {
    const halfSize = this.config.chunkSize / 2;
    const chunkBounds = new THREE.Box3(
      new THREE.Vector3(centerX - halfSize, -Infinity, centerZ - halfSize),
      new THREE.Vector3(centerX + halfSize, Infinity, centerZ + halfSize)
    );

    const chunkSeed = ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
    const rng = new SeededRandom(chunkSeed);

    for (let i = 0; i < this.splinePoints.length; i++) {
      const point = this.splinePoints[i];
      if (!chunkBounds.containsPoint(point)) continue;

      const tangent = this.splineTangents[i];
      const normal = this.splineNormals[i];
      const binormal = this.splineBinormals[i];
      const t = i / (this.splinePoints.length - 1);

      const bank = this.bankAngle * Math.sin(t * Math.PI * 2);

      for (let w = 0; w < this.distributionsPerSegment; w++) {
        const instanceId = this.instancePool.acquire();
        if (instanceId === null) break;

        const position = point.clone();

        if (this.width > 0 && this.distributionsPerSegment > 1) {
          const widthT = w / (this.distributionsPerSegment - 1);
          const widthOffset = (widthT - 0.5) * this.width;
          position.add(normal.clone().multiplyScalar(widthOffset));
        }

        if (this.offsetCurve) {
          const customOffset = this.offsetCurve(t);
          position.add(binormal.clone().multiplyScalar(customOffset));
        }

        const rotation = new THREE.Euler();

        if (this.followTangent) {
          const quaternion = new THREE.Quaternion();
          const matrix = new THREE.Matrix4().lookAt(
            new THREE.Vector3(0, 0, 0),
            tangent,
            binormal
          );
          quaternion.setFromRotationMatrix(matrix);
          rotation.setFromQuaternion(quaternion);
          rotation.z += bank;
        }

        rotation.y += rng.range(...this.config.rotationRange);

        const baseScale = rng.range(...this.config.scaleRange);
        const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

        position.y += this.config.heightOffset;

        this.converter.setInstanceTransform(instanceId, position, rotation, scale);
        chunk.instances.push(instanceId);
      }
    }
  }

  /**
   * Update the spline and regenerate
   */
  updateSpline(
    spline: THREE.CatmullRomCurve3 | THREE.CubicBezierCurve3 | THREE.QuadraticBezierCurve3,
    segmentCount?: number
  ): void {
    this.spline = spline;
    if (segmentCount) this.segmentCount = segmentCount;
    this.generateSplineData();
    this.regenerateAll();
  }

  /**
   * Set the bank angle and regenerate
   */
  setBankAngle(angle: number): void {
    this.bankAngle = angle;
    this.regenerateAll();
  }
}
