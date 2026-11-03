import type { Drone, Position, TrajectorySample } from '../types/collaboration';

export function navigationPosition(drone: Drone): Position {
  const offset = drone.gpsAttack?.offset;
  return offset ? { x: drone.position.x + offset.x, y: drone.position.y + offset.y, z: drone.position.z + offset.z } : drone.position;
}
/** Split at attack boundaries so stopping never repaints the recorded history. */
export function attackedTrajectorySegments(samples: TrajectorySample[]): TrajectorySample[][] {
  const segments: TrajectorySample[][] = [];
  for (let i = 0; i < samples.length; i++) {
    const point = samples[i]!;
    if (!point.gpsAttackId) continue;
    const previous = samples[i - 1];
    if (!previous || previous.gpsAttackId !== point.gpsAttackId) segments.push(previous ? [previous, point] : [point]);
    else segments[segments.length - 1]!.push(point);
  }
  return segments;
}
