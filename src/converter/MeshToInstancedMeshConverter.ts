import {
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  Scene
} from 'three';

/**
 * Transformation data for an instance
 */
export interface ITransformationData {
  position: Vector3;
  rotation: Euler;
  quaternion: Quaternion;
  scale: Vector3;
}

/**
 * Internal mesh info storing relative transforms
 */
interface IMeshInfo {
  instancedMesh: InstancedMesh;
  relativePosition: Vector3;
  relativeRotation: Quaternion;
  relativeScale: Vector3;
  originalMesh: Mesh;
}

/**
 * Converts a Mesh or Group into InstancedMesh(es)
 * Preserves relative transforms within groups
 */
export class MeshToInstancedMeshConverter {
  private _sourceMesh: Mesh | Group;
  private _instanceCount: number;
  private _meshInfos: IMeshInfo[] = [];
  private _instanceTransforms: ITransformationData[] = [];
  private _tempMatrix: Matrix4 = new Matrix4();
  private _tempPosition: Vector3 = new Vector3();
  private _tempQuaternion: Quaternion = new Quaternion();
  private _tempScale: Vector3 = new Vector3();

  constructor(sourceMesh: Mesh | Group, instanceCount: number) {
    this._sourceMesh = sourceMesh;
    this._instanceCount = instanceCount;

    // Initialize instance transforms
    for (let i = 0; i < instanceCount; i++) {
      this._instanceTransforms.push({
        position: new Vector3(0, 0, 0),
        rotation: new Euler(0, 0, 0),
        quaternion: new Quaternion(),
        scale: new Vector3(1, 1, 1)
      });
    }

    this.convertToInstancedMesh();
  }

  private convertToInstancedMesh(): void {
    const meshes: Mesh[] = [];

    if (this._sourceMesh instanceof Mesh) {
      meshes.push(this._sourceMesh);

      this._sourceMesh.traverse((child) => {
        if (child instanceof Mesh && child !== this._sourceMesh) {
          meshes.push(child);
        }
      });
    } else if (this._sourceMesh instanceof Group) {
      this._sourceMesh.traverse((child) => {
        if (child instanceof Mesh) {
          meshes.push(child);
        }
      });
    }

    for (const mesh of meshes) {
      this.createInstancedMeshFromMesh(mesh);
    }

    this.resetAllInstances();
  }

  private createInstancedMeshFromMesh(mesh: Mesh): void {
    const instancedMesh = new InstancedMesh(
      mesh.geometry,
      mesh.material,
      this._instanceCount
    );

    instancedMesh.castShadow = mesh.castShadow;
    instancedMesh.receiveShadow = mesh.receiveShadow;
    instancedMesh.frustumCulled = mesh.frustumCulled;

    const relativePosition = mesh.position.clone();
    const relativeRotation = new Quaternion().setFromEuler(mesh.rotation);
    const relativeScale = mesh.scale.clone();

    if (mesh.parent && mesh.parent !== this._sourceMesh) {
      const worldMatrix = new Matrix4();
      mesh.updateMatrixWorld(true);
      worldMatrix.copy(mesh.matrixWorld);

      if (this._sourceMesh.parent) {
        const parentInverse = new Matrix4();
        this._sourceMesh.parent.updateMatrixWorld(true);
        parentInverse.copy(this._sourceMesh.parent.matrixWorld).invert();
        worldMatrix.premultiply(parentInverse);
      }

      worldMatrix.decompose(relativePosition, relativeRotation, relativeScale);
    }

    this._meshInfos.push({
      instancedMesh,
      relativePosition,
      relativeRotation,
      relativeScale,
      originalMesh: mesh
    });
  }

  private resetAllInstances(): void {
    for (let i = 0; i < this._instanceCount; i++) {
      this.updateInstanceTransform(i);
    }
  }

  private updateInstanceTransform(instanceIndex: number): void {
    const transform = this._instanceTransforms[instanceIndex];
    transform.quaternion.setFromEuler(transform.rotation);

    for (const meshInfo of this._meshInfos) {
      this.applyTransformToMesh(instanceIndex, meshInfo);
    }
  }

  private applyTransformToMesh(instanceIndex: number, meshInfo: IMeshInfo): void {
    const baseTransform = this._instanceTransforms[instanceIndex];

    this._tempPosition.copy(meshInfo.relativePosition);
    this._tempPosition.multiply(baseTransform.scale);
    this._tempPosition.applyQuaternion(baseTransform.quaternion);
    this._tempPosition.add(baseTransform.position);

    this._tempQuaternion.copy(baseTransform.quaternion);
    this._tempQuaternion.multiply(meshInfo.relativeRotation);

    this._tempScale.copy(baseTransform.scale);
    this._tempScale.multiply(meshInfo.relativeScale);

    this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
    meshInfo.instancedMesh.setMatrixAt(instanceIndex, this._tempMatrix);
    meshInfo.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Set transform for a specific instance
   */
  setInstanceTransform(
    instanceIndex: number,
    position: Vector3,
    rotation: Euler,
    scale: Vector3
  ): void {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) {
      console.error(`Invalid instance index: ${instanceIndex}`);
      return;
    }

    const transform = this._instanceTransforms[instanceIndex];
    transform.position.copy(position);
    transform.rotation.copy(rotation);
    transform.scale.copy(scale);

    this.updateInstanceTransform(instanceIndex);
  }

  setInstancePosition(instanceIndex: number, position: Vector3): void {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) return;
    this._instanceTransforms[instanceIndex].position.copy(position);
    this.updateInstanceTransform(instanceIndex);
  }

  setInstanceRotation(instanceIndex: number, rotation: Euler): void {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) return;
    this._instanceTransforms[instanceIndex].rotation.copy(rotation);
    this.updateInstanceTransform(instanceIndex);
  }

  setInstanceScale(instanceIndex: number, scale: Vector3): void {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) return;
    this._instanceTransforms[instanceIndex].scale.copy(scale);
    this.updateInstanceTransform(instanceIndex);
  }

  setInstanceMatrix(instanceIndex: number, matrix: Matrix4): void {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) return;

    const transform = this._instanceTransforms[instanceIndex];
    matrix.decompose(transform.position, transform.quaternion, transform.scale);
    transform.rotation.setFromQuaternion(transform.quaternion);

    this.updateInstanceTransform(instanceIndex);
  }

  /**
   * Batch update multiple instances
   */
  setInstanceTransforms(transforms: Array<{
    instanceIndex: number;
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
  }>): void {
    for (const t of transforms) {
      if (t.instanceIndex >= 0 && t.instanceIndex < this._instanceCount) {
        const transform = this._instanceTransforms[t.instanceIndex];
        transform.position.copy(t.position);
        transform.rotation.copy(t.rotation);
        transform.scale.copy(t.scale);
      }
    }

    for (const t of transforms) {
      if (t.instanceIndex >= 0 && t.instanceIndex < this._instanceCount) {
        this.updateInstanceTransform(t.instanceIndex);
      }
    }
  }

  /**
   * Hide an instance by scaling to zero
   */
  hideInstance(instanceIndex: number): void {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) return;

    const zeroMatrix = new Matrix4().scale(new Vector3(0, 0, 0));
    for (const meshInfo of this._meshInfos) {
      meshInfo.instancedMesh.setMatrixAt(instanceIndex, zeroMatrix);
      meshInfo.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Show a previously hidden instance
   */
  showInstance(instanceIndex: number): void {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) return;
    this.updateInstanceTransform(instanceIndex);
  }

  /**
   * Add all instanced meshes to a scene
   */
  addToScene(scene: Scene): void {
    for (const meshInfo of this._meshInfos) {
      scene.add(meshInfo.instancedMesh);
    }
  }

  /**
   * Remove all instanced meshes from a scene
   */
  removeFromScene(scene: Scene): void {
    for (const meshInfo of this._meshInfos) {
      scene.remove(meshInfo.instancedMesh);
    }
  }

  /**
   * Get all instanced meshes
   */
  getInstancedMeshes(): InstancedMesh[] {
    return this._meshInfos.map(info => info.instancedMesh);
  }

  getInstanceCount(): number {
    return this._instanceCount;
  }

  getInstanceTransform(instanceIndex: number): ITransformationData | null {
    if (instanceIndex < 0 || instanceIndex >= this._instanceCount) return null;
    return this._instanceTransforms[instanceIndex];
  }

  getMeshCount(): number {
    return this._meshInfos.length;
  }

  /**
   * Dynamically resize instance count
   */
  setInstanceCount(newCount: number): void {
    if (newCount === this._instanceCount) return;

    if (newCount > this._instanceCount) {
      const toAdd = newCount - this._instanceCount;
      for (let i = 0; i < toAdd; i++) {
        this._instanceTransforms.push({
          position: new Vector3(0, 0, 0),
          rotation: new Euler(0, 0, 0),
          quaternion: new Quaternion(),
          scale: new Vector3(1, 1, 1)
        });
      }
    } else {
      this._instanceTransforms.splice(newCount);
    }

    this._instanceCount = newCount;

    for (const meshInfo of this._meshInfos) {
      meshInfo.instancedMesh.count = newCount;
      meshInfo.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    for (const meshInfo of this._meshInfos) {
      meshInfo.instancedMesh.dispose();
    }
    this._meshInfos = [];
    this._instanceTransforms = [];
  }
}
