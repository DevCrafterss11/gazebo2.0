import { taskTypeNames, type Drone, type DronePayload, type DroneType, type TaskType } from '../types/collaboration';

/**
 * Teaching-only drone resource rules. Type and payload are independent labels (6 combinations);
 * a seat in a task asks for a type and, optionally, a payload. Nothing here is hardware discovery.
 *
 * Seat names are the same strings as `taskRoles` in collaborationMission.ts (index = task order).
 * This single table drives eligibility, the resource panel, the role picker and the example loader.
 */
export interface SeatSpec { role: string; type: DroneType; /** null = any payload. */ payload: DronePayload | null; primary?: boolean }

export const seatRequirements: Record<TaskType, readonly SeatSpec[]> = {
  '区域巡逻': [
    { role: '领航机', type: '侦察', payload: '摄像头', primary: true },
    { role: '协同机', type: '侦察', payload: '摄像头' },
    { role: '侦察机', type: '侦察', payload: '摄像头' },
  ],
  '目标搜索': [
    { role: '搜索机', type: '侦察', payload: '摄像头', primary: true },
    { role: '协同机', type: '侦察', payload: '摄像头' },
    // A relay holds at its auto-planned station; it neither scans nor confirms targets.
    { role: '中继机', type: '中继', payload: null },
  ],
  '定点监测': [
    { role: '监测机', type: '侦察', payload: '摄像头', primary: true },
    { role: '协同机', type: '侦察', payload: '摄像头' },
    { role: '交接机', type: '侦察', payload: '摄像头' },
  ],
  '物资运输': [
    { role: '运输机', type: '运输', payload: '抛投器', primary: true },
    { role: '协同机', type: '运输', payload: '抛投器' },
    { role: '护航机', type: '中继', payload: null },
  ],
  '应急救援': [
    { role: '救援机', type: '运输', payload: '抛投器', primary: true },
    { role: '侦察机', type: '侦察', payload: '摄像头' },
    { role: '中继机', type: '中继', payload: null },
  ],
};

export const defaultPayload: Record<DroneType, DronePayload> = { '侦察': '摄像头', '运输': '抛投器', '中继': '摄像头' };
/** Default fleet: uav101-109 recon, uav110-112 transport, uav113-115 relay. Five tasks of 3 drones fit exactly. */
export const defaultDroneType = (index: number): DroneType => index < 9 ? '侦察' : index < 12 ? '运输' : '中继';

type Loadout = Pick<Drone, 'droneType' | 'payload'>;
export const seatFits = (drone: Loadout, seat: SeatSpec): boolean => drone.droneType === seat.type && (seat.payload === null || drone.payload === seat.payload);
export const seatsFor = (drone: Loadout, type: TaskType): SeatSpec[] => seatRequirements[type].filter(seat => seatFits(drone, seat));
export const seatNeed = (seat: SeatSpec): string => `${seat.type}类型${seat.payload ? ` + ${seat.payload}` : ''}`;

/** Empty string = fits. Otherwise a student-readable reason naming the seat that is closest. */
export function resourceCompatibility(drone: Loadout, type: TaskType): string {
  if (seatsFor(drone, type).length) return '';
  const seats = seatRequirements[type];
  const sameType = seats.filter(seat => seat.type === drone.droneType);
  if (!sameType.length) {
    const types = [...new Set(seats.map(seat => seat.type))].join(' / ');
    return `${type}需要${types}类型，该机是${drone.droneType}类型`;
  }
  const seat = sameType.find(item => item.primary) ?? sameType[0]!;
  return `${seat.role}需要${seat.payload}，该机载荷是${drone.payload}`;
}

/** The seat a drone takes when added: the primary seat if it is free and fits, else the first other seat that fits. */
export function pickSeat(drone: Loadout, type: TaskType, taken: readonly string[]): string {
  const fits = seatsFor(drone, type);
  const primary = fits.find(seat => seat.primary);
  if (primary && !taken.includes(primary.role)) return primary.role;
  return (fits.find(seat => !seat.primary) ?? fits[0])?.role ?? '';
}

export const isDroneType = (value: unknown): value is DroneType => typeof value === 'string' && (['侦察', '运输', '中继'] as readonly string[]).includes(value);
export const isDronePayload = (value: unknown): value is DronePayload => typeof value === 'string' && (['摄像头', '抛投器'] as readonly string[]).includes(value);
export const knownTaskTypes: readonly TaskType[] = taskTypeNames;
