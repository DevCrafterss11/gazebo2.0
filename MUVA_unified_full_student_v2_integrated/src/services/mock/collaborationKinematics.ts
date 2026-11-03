import type { Drone, Position } from '../../types/collaboration';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Kinematic teaching simulation, not flight-certified autopilot dynamics.
 * ENU metres / seconds: bounded acceleration, climb/descent and actual heading.
 */
export function moveDrone(drone: Drone, target: Position, dt: number, returning = false, headingTarget?: number) {
  const offset = !returning && drone.gpsAttack?.phase === 'active' ? drone.gpsAttack.offset : undefined;
  if (offset) target = { x: target.x - offset.x, y: target.y - offset.y, z: Math.max(drone.homePosition.z, target.z - offset.z) };
  const dx = target.x - drone.position.x, dy = target.y - drone.position.y;
  const distance = Math.hypot(dx, dy);
  const previousSpeed = Math.hypot(drone.velocity.x, drone.velocity.y);
  const horizontalSpeed = Math.min(drone.speed, previousSpeed + 2.5 * dt, Math.sqrt(2 * 2.5 * distance));
  const factor = Math.min(1, horizontalSpeed * dt / Math.max(.0001, distance));
  const position = { x: drone.position.x + dx * factor, y: drone.position.y + dy * factor,
    z: drone.position.z + clamp(target.z - drone.position.z, -(returning ? 2.5 : 3) * dt, 3 * dt) };
  const velocity = { x: (position.x - drone.position.x) / dt, y: (position.y - drone.position.y) / dt, z: (position.z - drone.position.z) / dt };
  const speed = Math.hypot(velocity.x, velocity.y);
  const heading = headingTarget ?? (speed > .05 ? (Math.atan2(velocity.x, velocity.y) * 180 / Math.PI + 360) % 360 : drone.attitude[2]);
  const turn = ((heading - drone.attitude[2] + 540) % 360) - 180;
  const yaw = (drone.attitude[2] + clamp(turn, -90 * dt, 90 * dt) + 360) % 360;
  const ax = (velocity.x - drone.velocity.x) / dt, ay = (velocity.y - drone.velocity.y) / dt;
  const radians = yaw * Math.PI / 180;
  const forwardAcceleration = ax * Math.sin(radians) + ay * Math.cos(radians);
  const rightAcceleration = ax * Math.cos(radians) - ay * Math.sin(radians);
  const attitude: Drone['attitude'] = [clamp(Math.atan2(rightAcceleration, 9.81) * 180 / Math.PI, -14, 14), clamp(-Math.atan2(forwardAcceleration, 9.81) * 180 / Math.PI, -14, 14), yaw];
  const consumption = dt * 100 / (drone.endurance * 60) * (1 + speed / Math.max(1, drone.speed) * .15);
  return { position, velocity, attitude, battery: Math.max(0, drone.battery - consumption), updatedAt: Date.now() };
}

