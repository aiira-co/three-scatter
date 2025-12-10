import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for curve-based scatter
 */
export interface CurveScatterConfig extends BaseScatterConfig {
  /** Curve to scatter along */
  curve: THREE.Curve<THREE.Vector3>;
  /** Optional handles for rotation interpolation */
  handles?: THREE.Object3D[];
  /** Number of segments along the curve */
  segmentCount?: number;
  /** Alternative: spacing between instances */
  spacing?: number;
  /** Perpendicular offset range */
  offsetRange?: [number, number];
  /** Distribution width perpendicular to curve */
  width?: number;
}

/**
 * Scatter system distributing instances along a curve
 */
export class CurveScatterSystem extends BaseScatterSystem {
  private curve: THREE.Curve<THREE.Vector3>;
  private handles?: THREE.Object3D[];
  private curvePoints: THREE.Vector3[] = [];
  private curveTangents: THREE.Vector3[] = [];
  private segmentCount: number;
  private spacing?: number;
  private offsetRange?: [number, number];
  private width?: number;

  constructor(config: CurveScatterConfig) {
    super(config);
    this.curve = config.curve;
    this.handles = config.handles;
    this.segmentCount = config.segmentCount ?? 50;
    this.spacing = config.spacing;
    this.offsetRange = config.offsetRange;
    this.width = config.width;

    this.init();
  }

  protected async initializeDistribution(): Promise<void> {
    this.generateCurvePoints();
  }

  private generateCurvePoints(): void {
    const pointCount = this.spacing
      ? Math.floor(this.curve.getLength() / this.spacing)
      : this.segmentCount;

    this.curvePoints = this.curve.getPoints(pointCount);

    this.curveTangents = this.curvePoints.map((pos, index) => {
      if (index === this.curvePoints.length - 1) {
        const prevPos = this.curvePoints[index - 1];
        return new THREE.Vector3().subVectors(pos, prevPos).normalize();
      }
      const nextPos = this.curvePoints[index + 1];
      return new THREE.Vector3().subVectors(nextPos, pos).normalize();
    });
  }

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    const cameraPos = camera.position;
    const visRange = this.config.visibilityRange;
    const chunkSize = this.config.chunkSize;

    const activeChunkKeys = new Set<string>();

    for (let i = 0; i < this.curvePoints.length; i++) {
      const point = this.curvePoints[i];
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

    for (let i = 0; i < this.curvePoints.length; i++) {
      const point = this.curvePoints[i];

      if (!chunkBounds.containsPoint(point)) continue;

      const tangent = this.curveTangents[i];
      const t = i / (this.curvePoints.length - 1);

      const distributionsPerPoint = this.width
        ? Math.max(1, Math.ceil(this.width * this.config.density))
        : 1;

      for (let w = 0; w < distributionsPerPoint; w++) {
        const instanceId = this.instancePool.acquire();
        if (instanceId === null) break;

        const position = point.clone();

        // Apply width distribution
        if (this.width && distributionsPerPoint > 1) {
          const widthT = w / (distributionsPerPoint - 1);
          const widthOffset = (widthT - 0.5) * this.width;
          const perpendicular = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
          position.add(perpendicular.multiplyScalar(widthOffset));
        }

        // Apply random offset
        if (this.offsetRange) {
          const perpendicular = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
          const offset = rng.range(...this.offsetRange);
          position.add(perpendicular.multiplyScalar(offset));
        }

        // Calculate rotation aligned with tangent
        const rotation = new THREE.Euler();

        if (this.config.alignToNormal) {
          const up = new THREE.Vector3(0, 1, 0);
          const matrix = new THREE.Matrix4().lookAt(
            new THREE.Vector3(0, 0, 0),
            tangent,
            up
          );
          const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
          rotation.setFromQuaternion(quaternion);
        } else if (this.handles && this.handles.length > 1) {
          const handleIndex = Math.floor(t * (this.handles.length - 1));
          const nextHandleIndex = Math.min(handleIndex + 1, this.handles.length - 1);
          const handleT = (t * (this.handles.length - 1)) % 1;

          const quaternion = new THREE.Quaternion();
          quaternion.copy(this.handles[handleIndex].quaternion);
          quaternion.slerp(this.handles[nextHandleIndex].quaternion, handleT);
          rotation.setFromQuaternion(quaternion);
        }

        rotation.y += rng.range(...this.config.rotationRange);

        // Scale
        let baseScale = rng.range(...this.config.scaleRange);

        if (this.handles && this.handles.length > 1) {
          const handleIndex = Math.floor(t * (this.handles.length - 1));
          const nextHandleIndex = Math.min(handleIndex + 1, this.handles.length - 1);
          const handleT = (t * (this.handles.length - 1)) % 1;

          const handleScale = new THREE.Vector3();
          handleScale.copy(this.handles[handleIndex].scale);
          handleScale.lerp(this.handles[nextHandleIndex].scale, handleT);
          baseScale *= handleScale.x;
        }

        position.y += this.config.heightOffset;

        const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

        this.converter.setInstanceTransform(instanceId, position, rotation, scale);
        chunk.instances.push(instanceId);
      }
    }
  }

  /**
   * Update the curve and regenerate
   */
  updateCurve(curve: THREE.Curve<THREE.Vector3>, segmentCount?: number): void {
    this.curve = curve;
    if (segmentCount) this.segmentCount = segmentCount;
    this.generateCurvePoints();
    this.regenerateAll();
  }
}
