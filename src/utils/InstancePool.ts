/**
 * Pool for managing instance IDs efficiently
 * Reuses released IDs to minimize fragmentation
 */
export class InstancePool {
  private activeInstances: Set<number> = new Set();
  private freeIds: number[] = [];
  private nextId: number = 0;
  private maxInstances: number;

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
      return id;
    }
    
    // Otherwise allocate a new ID if under limit
    if (this.nextId < this.maxInstances) {
      const id = this.nextId++;
      this.activeInstances.add(id);
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
   * Clear all instances from the pool
   */
  clear(): void {
    this.activeInstances.clear();
    this.freeIds = [];
    this.nextId = 0;
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
