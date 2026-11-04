export interface Point { x: number; z: number }
export interface Block { x: number; z: number; row: number; column: number; park: boolean }
export interface MapDefinition {
  id: string;
  name: string;
  roads: number[];
  roadWidth: number;
  extent: number;
  spawn: Point & { yaw: number };
}

export const SANTA_BRISA: MapDefinition = {
  id: 'santa-brisa', name: 'Santa Brisa',
  roads: [-280, -168, -56, 56, 168, 280],
  roadWidth: 18, extent: 316,
  spawn: { x: 8, z: 284.2, yaw: Math.PI / 2 },
};

export function blocks(map: MapDefinition): Block[] {
  return map.roads.slice(0, -1).flatMap((road, column) =>
    map.roads.slice(0, -1).map((cross, row) => ({
      x: (road + map.roads[column + 1]) / 2,
      z: (cross + map.roads[row + 1]) / 2,
      column, row, park: (column === 2 && row === 2) || (column === 0 && row === 3),
    })),
  );
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