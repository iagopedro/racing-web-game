import clipping from 'polygon-clipping';
import { clipPolygon, cropLine, cropPolygon, localPolygon, signedArea } from './geometry.ts';
import type { LocalPoint, Polygon } from './types.ts';

export function coastlineWater(lines: LocalPoint[][], size: number): { polygons: Polygon[]; incomplete: number } {
  const key = (point: LocalPoint) => `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
  const chains = lines.filter(line => line.length > 1).map(line => [...line]);
  // Coastline ways are directed: land is on the left in geographic coordinates,
  // hence water is on the left after north is mapped to negative Z.
  const byStart = new Map(chains.map((line, index) => [key(line[0]), index]));
  const consumed = new Set<number>();
  const joined: LocalPoint[][] = [];
  for (let i = 0; i < chains.length; i++) {
    if (consumed.has(i)) continue;
    const chain = [...chains[i]]; consumed.add(i);
    while (true) {
      const next = byStart.get(key(chain.at(-1)!));
      if (next === undefined || consumed.has(next)) break;
      chain.push(...chains[next].slice(1)); consumed.add(next);
    }
    joined.push(chain);
  }
  // Join again when the original source happened to list the tail before the head.
  for (let i = 0; i < joined.length; i++) {
    const next = joined.findIndex((line, j) => i !== j && key(joined[i].at(-1)!) === key(line[0]));
    if (next >= 0) { joined[i].push(...joined[next].slice(1)); joined.splice(next, 1); i = -1; }
  }
  const half = size / 2;
  const box: Polygon = [[{ x: -half, z: -half }, { x: half, z: -half }, { x: half, z: half }, { x: -half, z: half }, { x: -half, z: -half }]];
  const perimeter = (p: LocalPoint) => {
    if (Math.abs(p.z + half) < 0.01) return p.x + half;
    if (Math.abs(p.x - half) < 0.01) return size + p.z + half;
    if (Math.abs(p.z - half) < 0.01) return 2 * size + half - p.x;
    if (Math.abs(p.x + half) < 0.01) return 3 * size + half - p.z;
    return undefined;
  };
  const water: Polygon[] = [], islands: Polygon[] = [];
  const paths: { points: LocalPoint[]; start: number; end: number }[] = [];
  let incomplete = 0;
  for (const chain of joined) {
    if (key(chain[0]) === key(chain.at(-1)!)) {
      if (signedArea(chain) < 0) islands.push([chain]);
      else water.push(...cropPolygon([chain], size));
      continue;
    }
    for (const part of cropLine(chain, size)) {
      const start = perimeter(part[0]), end = perimeter(part.at(-1)!);
      if (start === undefined || end === undefined) { incomplete++; continue; }
      paths.push({ points: part, start, end });
    }
  }
  const used = new Set<number>();
  const nextPath = paths.map(path => paths.map((next, index) => ({ index, distance: (next.start - path.end + 4 * size) % (4 * size) }))
    .sort((a, b) => a.distance - b.distance)[0].index);
  for (let first = 0; first < paths.length; first++) {
    if (used.has(first)) continue;
    const ring: LocalPoint[] = [];
    let index = first;
    while (!used.has(index)) {
      used.add(index);
      const path = paths[index], next = paths[nextPath[index]];
      ring.push(...path.points);
      const finish = next.start < path.end ? next.start + 4 * size : next.start;
      for (let corner = Math.floor(path.end / size) + 1; corner * size < finish; corner++) ring.push(box[0][corner % 4]);
      index = nextPath[index];
    }
    if (index !== first) { incomplete++; continue; }
    ring.push(ring[0]); water.push([ring]);
  }
  if (!water.length && !paths.length && islands.length && !incomplete) water.push(box);
  if (!water.length) return { polygons: [], incomplete };
  let result = clipping.union(clipPolygon(water[0]), ...water.slice(1).map(clipPolygon));
  if (islands.length) result = clipping.difference(result, ...islands.map(clipPolygon));
  return { polygons: result.map(localPolygon).flatMap(polygon => cropPolygon(polygon, size)), incomplete };
}
