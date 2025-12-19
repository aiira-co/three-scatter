import * as THREE from 'three';
import { BaseScatterSystem } from '../core';

/**
 * Layer configuration for biome blending
 */
export interface ScatterLayer {
    /** Unique identifier for this layer */
    name: string;
    /** The scatter system for this layer */
    system: BaseScatterSystem;
    /** Base weight for this layer (0-1) */
    weight: number;
}

/**
 * Blending configuration
 */
export interface BlenderConfig {
    /** Blend mask texture URL (each channel can represent a different layer) */
    blendMaskUrl?: string;
    /** How world coordinates map to mask UV */
    worldBounds?: THREE.Box2;
    /** Default update interval in frames (for performance) */
    updateInterval?: number;
}

/**
 * Manages multiple scatter layers with weight-based blending
 * Allows smooth transitions between biomes using mask textures
 */
export class ScatterBlender extends THREE.Group {
    private scatterLayers: Map<string, ScatterLayer> = new Map();
    private blendMask: THREE.Texture | null = null;
    private blendMaskData: Uint8Array | null = null;
    private worldBounds: THREE.Box2;
    private updateInterval: number;
    private frameCount: number = 0;
    private isInitialized: boolean = false;

    constructor(config: BlenderConfig = {}) {
        super();
        this.worldBounds = config.worldBounds ?? new THREE.Box2(
            new THREE.Vector2(-500, -500),
            new THREE.Vector2(500, 500)
        );
        this.updateInterval = config.updateInterval ?? 1;
    }

    /**
     * Initialize the blender and load blend mask
     */
    async init(blendMaskUrl?: string): Promise<void> {
        if (blendMaskUrl) {
            await this.loadBlendMask(blendMaskUrl);
        }

        // Initialize all layers
        for (const layer of this.scatterLayers.values()) {
            if (!layer.system.parent) {
                this.add(layer.system);
            }
        }

        this.isInitialized = true;
    }

    /**
     * Load blend mask texture
     */
    async loadBlendMask(url: string): Promise<void> {
        const loader = new THREE.TextureLoader();
        this.blendMask = await loader.loadAsync(url);

        const canvas = document.createElement('canvas');
        const img = this.blendMask.image as HTMLImageElement;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        this.blendMaskData = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    }

    /**
     * Add a scatter layer
     */
    addLayer(name: string, system: BaseScatterSystem, weight: number = 1.0): void {
        this.scatterLayers.set(name, { name, system, weight });
        if (this.isInitialized) {
            this.add(system);
        }
    }

    /**
     * Remove a scatter layer
     */
    removeLayer(name: string): void {
        const layer = this.scatterLayers.get(name);
        if (layer) {
            this.remove(layer.system);
            this.scatterLayers.delete(name);
        }
    }

    /**
     * Get a layer by name
     */
    getLayer(name: string): ScatterLayer | undefined {
        return this.scatterLayers.get(name);
    }

    /**
     * Set layer weight dynamically
     */
    setLayerWeight(name: string, weight: number): void {
        const layer = this.scatterLayers.get(name);
        if (layer) {
            layer.weight = Math.max(0, Math.min(1, weight));
        }
    }

    /**
     * Sample blend mask at world position
     * Returns RGBA values (0-1) for each channel
     */
    sampleBlendMask(worldX: number, worldZ: number): { r: number; g: number; b: number; a: number } {
        if (!this.blendMaskData || !this.blendMask) {
            return { r: 1, g: 1, b: 1, a: 1 };
        }

        const u = (worldX - this.worldBounds.min.x) / (this.worldBounds.max.x - this.worldBounds.min.x);
        const v = (worldZ - this.worldBounds.min.y) / (this.worldBounds.max.y - this.worldBounds.min.y);

        if (u < 0 || u > 1 || v < 0 || v > 1) {
            return { r: 1, g: 1, b: 1, a: 1 };
        }

        const img = this.blendMask.image as HTMLImageElement;
        const px = Math.floor(u * (img.width - 1));
        const py = Math.floor((1 - v) * (img.height - 1));
        const idx = (py * img.width + px) * 4;

        return {
            r: this.blendMaskData[idx] / 255,
            g: this.blendMaskData[idx + 1] / 255,
            b: this.blendMaskData[idx + 2] / 255,
            a: this.blendMaskData[idx + 3] / 255,
        };
    }

    /**
     * Update all layers
     */
    update(camera: THREE.Camera): void {
        if (!this.isInitialized) return;

        this.frameCount++;
        if (this.frameCount % this.updateInterval !== 0) return;

        for (const layer of this.scatterLayers.values()) {
            // Apply weight by modifying visibility or density
            // Each layer system is updated independently
            layer.system.update(camera);
        }
    }

    /**
     * Get all layer names
     */
    getLayerNames(): string[] {
        return Array.from(this.scatterLayers.keys());
    }

    /**
     * Get combined statistics
     */
    getStats(): {
        layers: number;
        totalInstances: number;
        totalChunks: number;
    } {
        let totalInstances = 0;
        let totalChunks = 0;

        for (const layer of this.scatterLayers.values()) {
            const stats = layer.system.getStats();
            totalInstances += stats.instances.active;
            totalChunks += stats.chunks.active;
        }

        return {
            layers: this.scatterLayers.size,
            totalInstances,
            totalChunks,
        };
    }

    /**
     * Dispose all layers
     */
    dispose(): void {
        for (const layer of this.scatterLayers.values()) {
            layer.system.dispose();
            this.remove(layer.system);
        }
        this.scatterLayers.clear();
        this.blendMask?.dispose();
        this.blendMask = null;
        this.blendMaskData = null;
        this.isInitialized = false;
    }
}
