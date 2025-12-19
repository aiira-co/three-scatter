import * as THREE from 'three';
import type { BaseScatterConfig, LODConfig, NoiseDistributionConfig, DensityMapConfig, ScatterEvents } from '../core';

/**
 * Serialized scatter system data
 */
export interface ScatterSaveData {
    /** System type identifier */
    type: string;
    /** Serialized configuration */
    config: SerializedScatterConfig;
    /** Snapshot of instance transforms (optional) */
    instances?: SerializedInstance[];
}

/**
 * Serialized instance transform
 */
export interface SerializedInstance {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
}

/**
 * Serialized configuration (JSON-safe version of BaseScatterConfig)
 */
export interface SerializedScatterConfig {
    density: number;
    maxInstances?: number;
    visibilityRange: number;
    chunkSize?: number;
    scaleRange?: [number, number];
    rotationRange?: [number, number];
    heightOffset?: number;
    alignToNormal?: boolean;
    randomSeed?: number;
    showChunksDebug?: boolean;
    noiseDistribution?: NoiseDistributionConfig;
    lod?: LODConfig;
    densityMap?: Omit<DensityMapConfig, 'worldBounds'> & {
        worldBounds: { min: [number, number]; max: [number, number] };
    };
    // System-specific config fields serialized separately
    [key: string]: unknown;
}

/**
 * Utility class for serializing and deserializing scatter system configurations
 */
export class ScatterSerializer {
    /**
     * Serialize a BaseScatterConfig to a JSON-safe object
     */
    static serializeConfig(config: BaseScatterConfig): SerializedScatterConfig {
        const serialized: SerializedScatterConfig = {
            density: config.density,
            visibilityRange: config.visibilityRange,
        };

        if (config.maxInstances !== undefined) serialized.maxInstances = config.maxInstances;
        if (config.chunkSize !== undefined) serialized.chunkSize = config.chunkSize;
        if (config.scaleRange !== undefined) serialized.scaleRange = config.scaleRange;
        if (config.rotationRange !== undefined) serialized.rotationRange = config.rotationRange;
        if (config.heightOffset !== undefined) serialized.heightOffset = config.heightOffset;
        if (config.alignToNormal !== undefined) serialized.alignToNormal = config.alignToNormal;
        if (config.randomSeed !== undefined) serialized.randomSeed = config.randomSeed;
        if (config.showChunksDebug !== undefined) serialized.showChunksDebug = config.showChunksDebug;
        if (config.noiseDistribution) serialized.noiseDistribution = config.noiseDistribution;
        if (config.lod) serialized.lod = config.lod;

        if (config.densityMap) {
            serialized.densityMap = {
                textureUrl: config.densityMap.textureUrl,
                channel: config.densityMap.channel,
                multiplier: config.densityMap.multiplier,
                worldBounds: {
                    min: [config.densityMap.worldBounds.min.x, config.densityMap.worldBounds.min.y],
                    max: [config.densityMap.worldBounds.max.x, config.densityMap.worldBounds.max.y],
                }
            };
        }

        return serialized;
    }

    /**
     * Deserialize a configuration back to Three.js objects
     */
    static deserializeConfig(
        serialized: SerializedScatterConfig,
        source: THREE.Mesh | THREE.Group,
        events?: ScatterEvents
    ): BaseScatterConfig {
        const config: BaseScatterConfig = {
            source,
            density: serialized.density,
            visibilityRange: serialized.visibilityRange,
            events,
        };

        if (serialized.maxInstances !== undefined) config.maxInstances = serialized.maxInstances;
        if (serialized.chunkSize !== undefined) config.chunkSize = serialized.chunkSize;
        if (serialized.scaleRange !== undefined) config.scaleRange = serialized.scaleRange;
        if (serialized.rotationRange !== undefined) config.rotationRange = serialized.rotationRange;
        if (serialized.heightOffset !== undefined) config.heightOffset = serialized.heightOffset;
        if (serialized.alignToNormal !== undefined) config.alignToNormal = serialized.alignToNormal;
        if (serialized.randomSeed !== undefined) config.randomSeed = serialized.randomSeed;
        if (serialized.showChunksDebug !== undefined) config.showChunksDebug = serialized.showChunksDebug;
        if (serialized.noiseDistribution) config.noiseDistribution = serialized.noiseDistribution;
        if (serialized.lod) config.lod = serialized.lod;

        if (serialized.densityMap) {
            config.densityMap = {
                textureUrl: serialized.densityMap.textureUrl,
                channel: serialized.densityMap.channel,
                multiplier: serialized.densityMap.multiplier,
                worldBounds: new THREE.Box2(
                    new THREE.Vector2(serialized.densityMap.worldBounds.min[0], serialized.densityMap.worldBounds.min[1]),
                    new THREE.Vector2(serialized.densityMap.worldBounds.max[0], serialized.densityMap.worldBounds.max[1])
                ),
            };
        }

        return config;
    }

    /**
     * Serialize to JSON string
     */
    static toJSON(config: BaseScatterConfig, type: string): string {
        const saveData: ScatterSaveData = {
            type,
            config: this.serializeConfig(config),
        };
        return JSON.stringify(saveData, null, 2);
    }

    /**
     * Deserialize from JSON string
     */
    static fromJSON(
        json: string,
        source: THREE.Mesh | THREE.Group,
        events?: ScatterEvents
    ): { type: string; config: BaseScatterConfig } {
        const saveData: ScatterSaveData = JSON.parse(json);
        return {
            type: saveData.type,
            config: this.deserializeConfig(saveData.config, source, events),
        };
    }
}
