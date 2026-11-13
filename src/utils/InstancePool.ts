/**
 * Pool for managing instance IDs efficiently
 * Reuses released IDs to minimize fragmentation
 */
export class InstancePool {
  private activeInstances: Set<number> = new Set();
  private freeIds: number[] = [];
  private nextId: number = 0;
  private maxInstances: number;
  /** Highest active id, or -1. Only trusted while highestActiveStale is false. */
  private highestActive: number = -1;
  private highestActiveStale: boolean = false;

  constructor(maxInstances: number) {
    this.maxInstances = maxInstances;
  }

  /**
   * Acquire a new instance ID
   * @returns Instance ID or null if pool is exhausted
   */
  acquire(): number | null {
    // First try to reuse a freed ID
    if (this.freeIds.length > 0) {
      const id = this.freeIds.pop()!;
      this.activeInstances.add(id);
      if (id > this.highestActive) this.highestActive = id;
      return id;
    }
    
    // Otherwise allocate a new ID if under limit
    if (this.nextId < this.maxInstances) {
      const id = this.nextId++;
      this.activeInstances.add(id);
      if (id > this.highestActive) this.highestActive = id;
      return id;
    }
    
    return null;
  }

  /**
   * Release an instance ID back to the pool
   * @param id - Instance ID to release
   */
  release(id: number): void {
    if (this.activeInstances.delete(id)) {
      this.freeIds.push(id);
      if (id === this.highestActive) this.highestActiveStale = true;
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): { active: number; total: number; max: number } {
    return {
      active: this.activeInstances.size,
      total: this.nextId,
      max: this.maxInstances
    };
  }

  /**
   * Get highest active instance ID.
   * Returns -1 when no instances are active.
   */
  getHighestActiveId(): number {
    // Called every frame. The answer is kept between calls and recounted only after the top id
    // was released; spreading the whole set into Math.max allocated it each frame and overflowed
    // the argument limit on very large pools.
    if (this.activeInstances.size === 0) {
      this.highestActive = -1;
      this.highestActiveStale = false;
      return -1;
    }
    if (this.highestActiveStale) {
      let highest = -1;
      for (const id of this.activeInstances) {
        if (id > highest) highest = id;
      }
      this.highestActive = highest;
      this.highestActiveStale = false;
    }
    return this.highestActive;
  }

  /**
   * Clear all instances from the pool
   */
  clear(): void {
    this.activeInstances.clear();
    this.freeIds = [];
    this.nextId = 0;
    this.highestActive = -1;
    this.highestActiveStale = false;
  }

  /**
   * Check if the pool has available capacity
   */
  hasCapacity(): boolean {
    return this.freeIds.length > 0 || this.nextId < this.maxInstances;
  }

  /**
   * Get the number of active instances
   */
  getActiveCount(): number {
    return this.activeInstances.size;
  }
}
