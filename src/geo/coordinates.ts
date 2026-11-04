import type { Bounds, GeoPoint, LocalPoint, Terrain } from './types.ts';

const DEG = Math.PI / 180;

export function projection(center: GeoPoint) {
  const sin = Math.sin(center.lat * DEG);
  const factor = 1 - 0.00669437999014 * sin * sin;
  const east = DEG * 6378137 / Math.sqrt(factor) * Math.cos(center.lat * DEG);
  const north = DEG * 6378137 * (1 - 0.00669437999014) / factor ** 1.5;
  return {
    project: (point: GeoPoint): LocalPoint => ({ x: (point.lon - center.lon) * east, z: (center.lat - point.lat) * north }),
    unproject: (point: LocalPoint): GeoPoint => ({ lon: center.lon + point.x / east, lat: center.lat - point.z / north }),
  };
}

export function regionBounds(center: GeoPoint, size: number): Bounds {
  const { unproject } = projection(center);
  const southwest = unproject({ x: -size / 2, z: size / 2 });
  const northeast = unproject({ x: size / 2, z: -size / 2 });
  if (southwest.lon < -180 || northeast.lon > 180) throw new Error('Recortes que cruzam o antimeridiano nao sao suportados.');
  return [southwest.lon, southwest.lat, northeast.lon, northeast.lat];
}

// The same diagonal is used by the render mesh and Cannon Heightfield.
export function terrainHeight(terrain: Terrain, x: number, z: number): number {
  const n = terrain.segments;
  const u = Math.max(0, Math.min(n, (x / terrain.size + 0.5) * n));
  const v = Math.max(0, Math.min(n, (0.5 - z / terrain.size) * n));
  const i = Math.min(n - 1, Math.floor(u));
  const j = Math.min(n - 1, Math.floor(v));
  const a = u - i;
  const b = v - j;
  const h = (dx: number, dz: number) => terrain.heights[(j + dz) * (n + 1) + i + dx];
  return a + b <= 1
    ? h(0, 0) + a * (h(1, 0) - h(0, 0)) + b * (h(0, 1) - h(0, 0))
    : h(1, 1) + (1 - a) * (h(0, 1) - h(1, 1)) + (1 - b) * (h(1, 0) - h(1, 1));
}

export function flatTerrain(size: number): Terrain {
  const segments = Math.ceil(size / 30);
  return { size, segments, datum: 0, heights: Array((segments + 1) ** 2).fill(0), source: 'flat' };
}

export function nearestOnSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint): LocalPoint & { t: number; distance: number } {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared)) : 0;
  const x = start.x + t * dx;
  const z = start.z + t * dz;
  return { x, z, t, distance: Math.hypot(point.x - x, point.z - z) };
}
