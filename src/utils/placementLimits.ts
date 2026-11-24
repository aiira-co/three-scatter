import * as THREE from 'three';

export interface ScatterPoint2 {
  x: number;
  z: number;
}

/** True when (x, z) is closer than minSpacing to a point already accepted. */
export function violatesMinSpacing(
  x: number,
  z: number,
  placed: readonly ScatterPoint2[],
  minSpacing: number,
): boolean {
  if (minSpacing <= 0 || placed.length === 0) {
    return false;
  }

  const minSq = minSpacing * minSpacing;
  for (const point of placed) {
    const dx = x - point.x;
    const dz = z - point.z;
    if ((dx * dx) + (dz * dz) < minSq) {
      return true;
    }
  }
  return false;
}

/**
 * Keep a surface normal's lean from world up inside maxDegrees.
 * 90 leaves a downward-free slope untouched. 0 stands the normal straight up.
 */
export function clampNormalTilt(
  x: number,
  y: number,
  z: number,
  maxDegrees: number,
): { x: number; y: number; z: number } {
  const length = Math.hypot(x, y, z);
  if (length < 1e-8) {
    return { x: 0, y: 1, z: 0 };
  }

  const nx = x / length;
  const ny = y / length;
  const nz = z / length;
  const maxAngle = Math.max(0, Math.min(90, maxDegrees)) * Math.PI / 180;
  const angle = Math.acos(Math.max(-1, Math.min(1, ny)));
  if (angle <= maxAngle + 1e-4) {
    return { x: nx, y: ny, z: nz };
  }

  const horizontal = Math.hypot(nx, nz);
  if (horizontal < 1e-8) {
    return { x: 0, y: 1, z: 0 };
  }

  const scale = Math.sin(maxAngle) / horizontal;
  return {
    x: nx * scale,
    y: Math.cos(maxAngle),
    z: nz * scale,
  };
}

/**
 * Yaw around the aligned up axis.
 * Euler Y after alignment spins in the parent frame and increases tilt.
 */
export function composeAlignedYaw(
  normalX: number,
  normalY: number,
  normalZ: number,
  yawRadians: number,
): { x: number; y: number; z: number; w: number } {
  const axis = new THREE.Vector3(normalX, normalY, normalZ);
  if (axis.lengthSq() < 1e-8) {
    axis.set(0, 1, 0);
  } else {
    axis.normalize();
  }

  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const yaw = new THREE.Quaternion().setFromAxisAngle(axis, yawRadians);
  yaw.multiply(align);
  return { x: yaw.x, y: yaw.y, z: yaw.z, w: yaw.w };
}
