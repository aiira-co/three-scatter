import * as THREE from 'three';
import { BaseScatterSystem } from '../core';
import { SeededRandom } from '../utils';

/**
 * Brush configuration
 */
export interface BrushConfig {
    /** Brush radius in world units */
    radius: number;
    /** Brush strength (0-1) */
    strength?: number;
    /** Instances per paint stroke */
    density?: number;
    /** Falloff type */
    falloff?: 'constant' | 'linear' | 'smooth';
}

/**
 * Painted instance data
 */
export interface PaintedInstance {
    id: number;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
}

/**
 * Brush tool for runtime scatter editing (paint/erase instances)
 */
export class ScatterBrush {
    private system: BaseScatterSystem;
    private paintedInstances: Map<number, PaintedInstance> = new Map();
    private radius: number;
    private strength: number;
    private density: number;
    private falloff: 'constant' | 'linear' | 'smooth';
    private rng: SeededRandom;
    private nextPaintedId: number = 0;

    constructor(system: BaseScatterSystem, config: BrushConfig) {
        this.system = system;
        this.radius = config.radius;
        this.strength = config.strength ?? 1.0;
        this.density = config.density ?? 5;
        this.falloff = config.falloff ?? 'smooth';
        this.rng = new SeededRandom(Date.now());
    }

    /**
     * Set brush radius
     */
    setRadius(radius: number): void {
        this.radius = Math.max(0.1, radius);
    }

    /**
     * Set brush strength
     */
    setStrength(strength: number): void {
        this.strength = Math.max(0, Math.min(1, strength));
    }

    /**
     * Set brush density
     */
    setDensity(density: number): void {
        this.density = Math.max(1, Math.floor(density));
    }

    /**
     * Get falloff multiplier at distance from brush center
     */
    private getFalloff(distance: number): number {
        const t = distance / this.radius;
        if (t >= 1) return 0;

        switch (this.falloff) {
            case 'constant':
                return 1;
            case 'linear':
                return 1 - t;
            case 'smooth':
            default:
                // Smooth step falloff
                return 1 - (3 * t * t - 2 * t * t * t);
        }
    }

    /**
     * Paint instances at the given world position
     */
    paint(center: THREE.Vector3, heightProvider?: (x: number, z: number) => number): PaintedInstance[] {
        const newInstances: PaintedInstance[] = [];
        const converter = this.system.getConverter();
        const config = (this.system as any).config;

        const count = Math.floor(this.density * this.strength);

        for (let i = 0; i < count; i++) {
            // Random position within radius
            const angle = this.rng.range(0, Math.PI * 2);
            const r = this.radius * Math.sqrt(this.rng.next()); // Square root for uniform distribution
            const x = center.x + r * Math.cos(angle);
            const z = center.z + r * Math.sin(angle);

            // Check falloff
            const distance = Math.sqrt((x - center.x) ** 2 + (z - center.z) ** 2);
            if (this.rng.next() > this.getFalloff(distance)) continue;

            // Get height if provider exists
            const y = heightProvider ? heightProvider(x, z) : center.y;

            // Acquire instance from pool
            const instanceId = (this.system as any).instancePool.acquire();
            if (instanceId === null) break;

            const position = new THREE.Vector3(x, y + (config.heightOffset ?? 0), z);
            const rotation = new THREE.Euler(0, this.rng.range(0, Math.PI * 2), 0);
            const scaleRange = (config.scaleRange ?? [0.8, 1.2]) as [number, number];
            const baseScale = this.rng.range(scaleRange[0], scaleRange[1]);
            const scale = new THREE.Vector3(baseScale, baseScale, baseScale);

            converter.setInstanceTransform(instanceId, position, rotation, scale);

            const painted: PaintedInstance = {
                id: this.nextPaintedId++,
                position,
                rotation,
                scale,
            };

            this.paintedInstances.set(instanceId, painted);
            newInstances.push(painted);
        }

        return newInstances;
    }

    /**
     * Erase instances within radius of the given position
     */
    erase(center: THREE.Vector3): number {
        const converter = this.system.getConverter();
        let erasedCount = 0;

        const toRemove: number[] = [];

        for (const [instanceId, painted] of this.paintedInstances.entries()) {
            const dx = painted.position.x - center.x;
            const dz = painted.position.z - center.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance <= this.radius) {
                // Check falloff probability
                if (this.rng.next() <= this.getFalloff(distance) * this.strength) {
                    toRemove.push(instanceId);
                }
            }
        }

        for (const instanceId of toRemove) {
            converter.hideInstance(instanceId);
            (this.system as any).instancePool.release(instanceId);
            this.paintedInstances.delete(instanceId);
            erasedCount++;
        }

        return erasedCount;
    }

    /**
     * Clear all painted instances
     */
    clearAll(): void {
        const converter = this.system.getConverter();

        for (const [instanceId] of this.paintedInstances.entries()) {
            converter.hideInstance(instanceId);
            (this.system as any).instancePool.release(instanceId);
        }

        this.paintedInstances.clear();
    }

    /**
     * Get count of painted instances
     */
    getPaintedCount(): number {
        return this.paintedInstances.size;
    }

    /**
     * Get all painted instance positions
     */
    getPaintedPositions(): THREE.Vector3[] {
        return Array.from(this.paintedInstances.values()).map(p => p.position.clone());
    }

    /**
     * Raycast helper to find intersection point
     */
    static getIntersection(
        raycaster: THREE.Raycaster,
        surfaces: THREE.Object3D[]
    ): THREE.Vector3 | null {
        const intersects = raycaster.intersectObjects(surfaces, true);
        if (intersects.length > 0) {
            return intersects[0].point.clone();
        }
        return null;
    }
}
