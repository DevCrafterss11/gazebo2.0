import type { MapReference, Position } from '../types/collaboration';

const earthRadius = 6378137;
const radians = Math.PI / 180;
const circumference = 2 * Math.PI * earthRadius;

/** Teaching scene only. A real adapter must provide its Gazebo world's georeference. */
export const teachingMapReference: MapReference = { origin: [108.8289653, 34.1251589], axes: 'ENU' };

/** One tangent-metre frame for tiles, aircraft, routes and inverse drawing coordinates.
 * Mercator's local scale is corrected at the scene origin (campus-sized ENU scene).
 * Gazebo frames not already ENU must be normalized by the runtime adapter first.
 */
export function collaborationMapFrame(reference: MapReference) {
  const [longitude, latitude] = reference.origin;
  const localScale = Math.cos(latitude * radians);
  const originY = Math.log(Math.tan(Math.PI / 4 + latitude * radians / 2));
  return {
    toGeo: (position: Pick<Position, 'x' | 'y'>): [number, number] => [
      longitude + position.x / (earthRadius * localScale * radians),
      (2 * Math.atan(Math.exp(originY + position.y / (earthRadius * localScale))) - Math.PI / 2) / radians,
    ],
    toLocal: ([lng, lat]: [number, number]): Pick<Position, 'x' | 'y'> => ({
      x: (lng - longitude) * radians * earthRadius * localScale,
      y: (Math.log(Math.tan(Math.PI / 4 + lat * radians / 2)) - originY) * earthRadius * localScale,
    }),
    camera: (pan: { x: number; y: number }, pixelsPerMetre: number) => ({
      center: [longitude - pan.x / pixelsPerMetre / (earthRadius * localScale * radians),
        (2 * Math.atan(Math.exp(originY + pan.y / pixelsPerMetre / (earthRadius * localScale))) - Math.PI / 2) / radians] as [number, number],
      zoom: Math.log2(circumference * localScale * pixelsPerMetre / 512),
    }),
  };
}

export function mapMetreScale(width: number, height: number): number {
  return Math.max(width / 200, height / 140);
}

export function mapPixelToLocal(pixel: { x: number; y: number }, size: { width: number; height: number }, pan: { x: number; y: number }, zoom: number): Pick<Position, 'x' | 'y'> {
  const scale = mapMetreScale(size.width, size.height) * zoom;
  return { x: (pixel.x - size.width / 2 - pan.x) / scale, y: (size.height / 2 + pan.y - pixel.y) / scale };
}

export function mapScaleBar(pixelsPerMetre: number): { metres: number; pixels: number } {
  const target = 100 / pixelsPerMetre;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const metres = [5, 2, 1].map(n => n * magnitude).find(n => n <= target) ?? magnitude;
  return { metres, pixels: metres * pixelsPerMetre };
}

/** Screen-space grid derived from the same ENU camera as the imagery and aircraft. */
export function mapGridLines(size: { width: number; height: number }, pan: { x: number; y: number }, pixelsPerMetre: number): { axis: 'E' | 'N'; value: number; pixel: number }[] {
  const spacing = mapScaleBar(pixelsPerMetre).metres;
  const result: { axis: 'E' | 'N'; value: number; pixel: number }[] = [];
  for (const axis of ['E', 'N'] as const) {
    const extent = axis === 'E' ? size.width : size.height;
    const origin = extent / 2 + (axis === 'E' ? pan.x : pan.y);
    const direction = axis === 'E' ? 1 : -1;
    const bounds = [-origin / pixelsPerMetre * direction, (extent - origin) / pixelsPerMetre * direction];
    const from = Math.ceil(Math.min(...bounds) / spacing), to = Math.floor(Math.max(...bounds) / spacing);
    for (let i = from; i <= to; i++) result.push({ axis, value: i * spacing, pixel: origin + direction * i * spacing * pixelsPerMetre });
  }
  return result;
}
