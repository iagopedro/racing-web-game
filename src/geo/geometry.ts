import clipping from 'polygon-clipping';
import type { Polygon as ClipPolygon } from 'polygon-clipping';
import type { LocalPoint, Polygon, Ring } from './types.ts';

export const clipPolygon = (polygon: Polygon): ClipPolygon => polygon.map(ring => ring.map(point => [point.x, point.z]));
export const localPolygon = (polygon: ClipPolygon): Polygon => polygon.map(ring => ring.map(([x, z]) => ({ x, z })));

export function signedArea(ring: Ring): number {
  return ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0) / 2;
}
export function polygonArea(polygon: Polygon): number {
  return Math.abs(signedArea(polygon[0])) - polygon.slice(1).reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0);
}
export function insideRing(point: LocalPoint, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export function insidePolygon(point: LocalPoint, polygon: Polygon): boolean {
  return insideRing(point, polygon[0]) && !polygon.slice(1).some(ring => insideRing(point, ring));
}
export function cropPolygon(polygon: Polygon, size: number): Polygon[] {
  const h = size / 2;
  return clipping.intersection(clipPolygon(polygon), [[[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]]])
    .map(localPolygon).filter(part => polygonArea(part) > 0.5);
}
export function overlapArea(a: Polygon, b: Polygon): number {
  return clipping.intersection(clipPolygon(a), clipPolygon(b)).map(localPolygon).reduce((sum, part) => sum + polygonArea(part), 0);
}

export function cropLine(points: LocalPoint[], size: number): LocalPoint[][] {
  const result: LocalPoint[][] = [];
  const h = size / 2;
  let current: LocalPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    if (Math.hypot(dx, dz) < 0.01) continue;
    let lo = 0, hi = 1;
    for (const [p, q] of [[-dx, a.x + h], [dx, h - a.x], [-dz, a.z + h], [dz, h - a.z]]) {
      if (p === 0) { if (q < 0) { hi = -1; break; } }
      else if (p < 0) lo = Math.max(lo, q / p);
      else hi = Math.min(hi, q / p);
    }
    if (lo > hi) { if (current.length) result.push(current); current = []; continue; }
    const start = { x: a.x + dx * lo, z: a.z + dz * lo };
    const end = { x: a.x + dx * hi, z: a.z + dz * hi };
    if (Math.hypot(end.x - start.x, end.z - start.z) < 0.01) continue;
    const previous = current.at(-1);
    if (previous && Math.hypot(previous.x - start.x, previous.z - start.z) > 0.01) { result.push(current); current = []; }
    if (!current.length) current.push(start);
    current.push(end);
    if (hi < 1) { result.push(current); current = []; }
  }
  if (current.length) result.push(current);
  return result;
}
