import type { CityData } from '../geo/types';
import { nearestOnSegment, terrainHeight } from '../geo/coordinates';

export interface Point { x: number; z: number }
export interface Block { x: number; z: number; row: number; column: number; park: boolean }
interface MapBase {
  id: string;
  name: string;
  extent: number;
  spawn: Point & { yaw: number; y?: number };
}
export interface GridMapDefinition extends MapBase { kind: 'grid'; roads: number[]; roadWidth: number }
export interface RealMapDefinition extends MapBase { kind: 'real'; data: CityData }
export type MapDefinition = GridMapDefinition | RealMapDefinition;

export const SANTA_BRISA: GridMapDefinition = {
  kind: 'grid',
  id: 'santa-brisa', name: 'Santa Brisa',
  roads: [-280, -168, -56, 56, 168, 280],
  roadWidth: 18, extent: 316,
  spawn: { x: 8, z: 284.2, yaw: Math.PI / 2 },
};

export function blocks(map: GridMapDefinition): Block[] {
  return map.roads.slice(0, -1).flatMap((road, column) =>
    map.roads.slice(0, -1).map((cross, row) => ({
      x: (road + map.roads[column + 1]) / 2,
      z: (cross + map.roads[row + 1]) / 2,
      column, row, park: (column === 2 && row === 2) || (column === 0 && row === 3),
    })),
  );
}

export function realMap(data: CityData): RealMapDefinition {
  return { kind: 'real', id: data.id, name: data.name, extent: data.size / 2, spawn: data.spawn, data };
}

export function groundHeight(map: MapDefinition, x: number, z: number): number {
  return map.kind === 'real' ? terrainHeight(map.data.terrain, x, z) : 0;
}

export function surfaceHeight(map: MapDefinition, x: number, z: number, maxY = Infinity): number {
  let height = groundHeight(map, x, z);
  if (map.kind === 'real') for (const road of map.data.roads) {
    if (!road.bridge || road.tunnel) continue;
    let distance = Infinity, deckHeight = height;
    for (let i = 1; i < road.points.length; i++) {
      const nearest = nearestOnSegment({ x, z }, road.points[i - 1], road.points[i]);
      if (nearest.distance < distance) {
        distance = nearest.distance;
        deckHeight = road.heights[i - 1] + (road.heights[i] - road.heights[i - 1]) * nearest.t;
      }
    }
    if (distance <= road.width / 2 && deckHeight <= maxY) height = Math.max(height, deckHeight);
  }
  return height;
}

export function recoveryPoint(map: MapDefinition, point: Point): Point & { yaw: number; y: number } {
  if (map.kind === 'real') {
    // Only the validated start location is guaranteed clear of footprints and map edges.
    return { ...map.data.spawn };
  }
  const road = map.roads.reduce((best, value) => Math.abs(value - point.z) < Math.abs(best - point.z) ? value : best, map.roads[0]);
  return { x: Math.max(-260, Math.min(260, point.x)), z: road + 4.2, yaw: Math.PI / 2, y: 0 };
}

export function district(point: Point): string {
  if (point.z > 225) return 'Orla do Sol';
  if (point.x < -140) return 'Jardins';
  if (point.z < -145) return 'Vila Aurora';
  if (point.x > 145) return 'Distrito das Artes';
  return 'Centro';
}

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223 >>> 0;
    return state / 4294967296;
  };
}

export function roundedLoop(left: number, top: number, right: number, bottom: number, radius = 10): Point[] {
  const corners = [
    { x: right - radius, z: top + radius, angle: -Math.PI / 2 },
    { x: right - radius, z: bottom - radius, angle: 0 },
    { x: left + radius, z: bottom - radius, angle: Math.PI / 2 },
    { x: left + radius, z: top + radius, angle: Math.PI },
  ];
  return corners.flatMap(corner => Array.from({ length: 7 }, (_, index) => {
    const angle = corner.angle + index / 6 * Math.PI / 2;
    return { x: corner.x + Math.cos(angle) * radius, z: corner.z + Math.sin(angle) * radius };
  }));
}

export function signalAllows(axis: 'x' | 'z', seconds: number): boolean {
  const phase = ((seconds % 24) + 24) % 24;
  return axis === 'x' ? phase < 10 : phase >= 12 && phase < 22;
}