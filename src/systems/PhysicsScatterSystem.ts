import * as THREE from 'three';
import { BaseScatterSystem, BaseScatterConfig, ChunkData } from '../core';
import { SeededRandom } from '../utils';

/**
 * Configuration for physics-based scatter
 */
export interface PhysicsScatterConfig extends BaseScatterConfig {
  /** Height to drop instances from */
  dropHeight: number;
  /** Bounds for dropping instances */
  dropBounds: THREE.Box3;
  /** Number of physics simulation steps */
  simulationSteps?: number;
  /** Gravity vector */
  gravity?: THREE.Vector3;
  /** Enable collisions between instances */
  enableCollisions?: boolean;
  /** Mesh to use as ground for collision */
  groundMesh?: THREE.Mesh;
  /** Callback before simulation starts */
  beforeSimulation?: (body: PhysicsBody, index: number) => void;
  /** Callback after simulation completes */
  afterSimulation?: (position: THREE.Vector3, rotation: THREE.Quaternion, index: number) => void;
}

/**
 * Physics body for simulation
 */
export interface PhysicsBody {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  mass: number;
  restitution: number;
  friction: number;
}

/**
 * Scatter system using physics simulation for natural placement
 */
export class PhysicsScatterSystem extends BaseScatterSystem {
  private dropHeight: number;
  private dropBounds: THREE.Box3;
  private simulationSteps: number;
  private gravity: THREE.Vector3;
  private enableCollisions: boolean;
  private groundMesh?: THREE.Mesh;
  private beforeSimulation?: (body: PhysicsBody, index: number) => void;
  private afterSimulation?: (position: THREE.Vector3, rotation: THREE.Quaternion, index: number) => void;

  private simulatedPositions: Map<string, Array<{ position: THREE.Vector3; rotation: THREE.Quaternion }>> = new Map();
  private isSimulated: boolean = false;

  constructor(config: PhysicsScatterConfig) {
    super(config);
    this.dropHeight = config.dropHeight;
    this.dropBounds = config.dropBounds;
    this.simulationSteps = config.simulationSteps ?? 120;
    this.gravity = config.gravity ?? new THREE.Vector3(0, -9.81, 0);
    this.enableCollisions = config.enableCollisions ?? true;
    this.groundMesh = config.groundMesh;
    this.beforeSimulation = config.beforeSimulation;
    this.afterSimulation = config.afterSimulation;

    this.init();
  }

  protected async initializeDistribution(): Promise<void> {
    await this.runPhysicsSimulation();
  }

  private async runPhysicsSimulation(): Promise<void> {
    console.log('Running physics simulation...');

    const volume = this.dropBounds.getSize(new THREE.Vector3());
    const targetCount = Math.floor(volume.x * volume.z * this.config.density);

    const chunkSeed = this.config.randomSeed;
    const rng = new SeededRandom(chunkSeed);

    const bodies: PhysicsBody[] = [];

    for (let i = 0; i < targetCount; i++) {
      const x = rng.range(this.dropBounds.min.x, this.dropBounds.max.x);
      const z = rng.range(this.dropBounds.min.z, this.dropBounds.max.z);
      const y = this.dropHeight;

      const body: PhysicsBody = {
        position: new THREE.Vector3(x, y, z),
        velocity: new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)),
        rotation: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            rng.range(0, Math.PI * 2),
            rng.range(0, Math.PI * 2),
            rng.range(0, Math.PI * 2)
          )
        ),
        angularVelocity: new THREE.Vector3(
          rng.range(-1, 1),
          rng.range(-1, 1),
          rng.range(-1, 1)
        ),
        mass: 1.0,
        restitution: 0.3,
        friction: 0.5
      };

      bodies.push(body);

      if (this.beforeSimulation) {
        this.beforeSimulation(body, i);
      }
    }

    const dt = 1 / 60;
    const raycaster = new THREE.Raycaster();

    for (let step = 0; step < this.simulationSteps; step++) {
      for (const body of bodies) {
        body.velocity.add(this.gravity.clone().multiplyScalar(dt));
        body.position.add(body.velocity.clone().multiplyScalar(dt));

        const angularVelocityQuat = new THREE.Quaternion(
          body.angularVelocity.x * dt * 0.5,
          body.angularVelocity.y * dt * 0.5,
          body.angularVelocity.z * dt * 0.5,
          0
        );
        const deltaRotation = angularVelocityQuat.multiply(body.rotation);
        body.rotation.x += deltaRotation.x;
        body.rotation.y += deltaRotation.y;
        body.rotation.z += deltaRotation.z;
        body.rotation.w += deltaRotation.w;
        body.rotation.normalize();

        if (this.groundMesh) {
          raycaster.set(body.position, new THREE.Vector3(0, -1, 0));
          const intersects = raycaster.intersectObject(this.groundMesh, true);

          if (intersects.length > 0) {
            const groundHeight = intersects[0].point.y;

            if (body.position.y <= groundHeight) {
              body.position.y = groundHeight;
              body.velocity.y *= -body.restitution;
              body.velocity.x *= body.friction;
              body.velocity.z *= body.friction;
              body.angularVelocity.multiplyScalar(0.95);
            }
          }
        } else if (body.position.y <= this.dropBounds.min.y) {
          body.position.y = this.dropBounds.min.y;
          body.velocity.y *= -body.restitution;
          body.velocity.x *= body.friction;
          body.velocity.z *= body.friction;
          body.angularVelocity.multiplyScalar(0.95);
        }

        body.position.x = Math.max(this.dropBounds.min.x, Math.min(this.dropBounds.max.x, body.position.x));
        body.position.z = Math.max(this.dropBounds.min.z, Math.min(this.dropBounds.max.z, body.position.z));

        if (body.velocity.length() < 0.01 && body.angularVelocity.length() < 0.01) {
          body.velocity.set(0, 0, 0);
          body.angularVelocity.set(0, 0, 0);
        }
      }

      if (this.enableCollisions) {
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            const distance = bodies[i].position.distanceTo(bodies[j].position);
            const minDistance = 1.0;

            if (distance < minDistance) {
              const normal = new THREE.Vector3()
                .subVectors(bodies[j].position, bodies[i].position)
                .normalize();

              const relativeVelocity = new THREE.Vector3()
                .subVectors(bodies[j].velocity, bodies[i].velocity);

              const velocityAlongNormal = relativeVelocity.dot(normal);

              if (velocityAlongNormal < 0) {
                const impulse = -(1 + bodies[i].restitution) * velocityAlongNormal;
                const impulseVector = normal.multiplyScalar(impulse * 0.5);

                bodies[i].velocity.sub(impulseVector);
                bodies[j].velocity.add(impulseVector);
              }
            }
          }
        }
      }
    }

    const chunkSize = this.config.chunkSize;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const chunkX = Math.floor(body.position.x / chunkSize) * chunkSize + chunkSize / 2;
      const chunkZ = Math.floor(body.position.z / chunkSize) * chunkSize + chunkSize / 2;
      const key = this.getChunkKey(chunkX, chunkZ);

      if (!this.simulatedPositions.has(key)) {
        this.simulatedPositions.set(key, []);
      }

      if (this.afterSimulation) {
        this.afterSimulation(body.position, body.rotation, i);
      }

      this.simulatedPositions.get(key)!.push({
        position: body.position.clone(),
        rotation: body.rotation.clone()
      });
    }

    this.isSimulated = true;
    console.log(`Physics simulation complete: ${bodies.length} instances settled`);
  }

  protected updateChunks(): void {
    const camera = this.getCurrentCamera();
    if (!camera) return;
    const cameraPos = camera.position;
    const visRange = this.config.visibilityRange;
    const chunkSize = this.config.chunkSize;

    const activeChunkKeys = new Set<string>();

    const minX = Math.floor(this.dropBounds.min.x / chunkSize) * chunkSize;
    const maxX = Math.ceil(this.dropBounds.max.x / chunkSize) * chunkSize;
    const minZ = Math.floor(this.dropBounds.min.z / chunkSize) * chunkSize;
    const maxZ = Math.ceil(this.dropBounds.max.z / chunkSize) * chunkSize;

    for (let x = minX; x <= maxX; x += chunkSize) {
      for (let z = minZ; z <= maxZ; z += chunkSize) {
        const chunkX = x + chunkSize / 2;
        const chunkZ = z + chunkSize / 2;

        const dx = chunkX - cameraPos.x;
        const dz = chunkZ - cameraPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance <= visRange) {
          // Frustum culling
          const chunkBounds = new THREE.Box3(
            new THREE.Vector3(chunkX - chunkSize / 2, this.dropBounds.min.y, chunkZ - chunkSize / 2),
            new THREE.Vector3(chunkX + chunkSize / 2, this.dropHeight, chunkZ + chunkSize / 2)
          );
          if (!this.isChunkInFrustum(chunkBounds)) continue;

          const key = this.getChunkKey(chunkX, chunkZ);
          activeChunkKeys.add(key);

          if (!this.chunks.has(key) || !this.chunks.get(key)!.isActive) {
            this.activateChunk(chunkX, chunkZ);
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
    const key = this.getChunkKey(centerX, centerZ);
    const instances = this.simulatedPositions.get(key);

    if (!instances) return;

    const chunkSeed = ((centerX * 73856093) ^ (centerZ * 19349663) ^ this.config.randomSeed) >>> 0;
    const rng = new SeededRandom(chunkSeed);

    for (const instance of instances) {
      const instanceId = this.instancePool.acquire();
      if (instanceId === null) break;

      const position = instance.position.clone();
      position.y += this.config.heightOffset;

      const rotation = new THREE.Euler().setFromQuaternion(instance.rotation);

      const baseScale = rng.range(...this.config.scaleRange);
      const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

      this.converter.setInstanceTransform(instanceId, position, rotation, scale);
      chunk.instances.push(instanceId);
    }
  }

  /**
   * Re-run the physics simulation
   */
  resimulate(): void {
    this.simulatedPositions.clear();
    this.isSimulated = false;
    this.regenerateAll();
    this.runPhysicsSimulation();
  }
}
