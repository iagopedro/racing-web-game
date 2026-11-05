import type { LocalPoint, Polygon, Road } from './types.ts';

export function roadWidth(tags: Record<string, unknown>, measure: (value: unknown) => number | undefined): Pick<Road, 'width' | 'widthSource'> {
  const explicit = measure(tags.width) ?? measure(tags['width:carriageway']);
  if (explicit) return { width: Math.max(0.5, Math.min(60, explicit)), widthSource: 'tag' };
  const lanes = typeof tags.lanes === 'string' && /^\d+$/.test(tags.lanes) ? Number(tags.lanes) : undefined;
  if (lanes && lanes <= 12) return { width: lanes * (['motorway', 'trunk'].includes(String(tags.highway)) ? 3.5 : 3.1), widthSource: 'lanes' };
  const kind = String(tags.highway ?? tags.waterway);
  if (tags.waterway) return { width: kind === 'river' ? 16 : 4, widthSource: 'estimated' };
  const oneway = ['yes', '1', 'true', '-1'].includes(String(tags.oneway)) || tags.junction === 'roundabout';
  const widths: Record<string, number> = {
    motorway: 10.5, trunk: 10.5, primary: oneway ? 7 : 10,
    secondary: oneway ? 6.2 : 9.3, tertiary: oneway ? 6.2 : 7,
    residential: oneway ? 4.5 : 6.2, living_street: 5, service: tags.service === 'driveway' ? 3 : 4.5,
    footway: 2, path: 2, cycleway: 2.5, steps: 2, pedestrian: 6,
  };
  return { width: widths[kind] ?? (kind.endsWith('_link') ? 4.5 : 6.2), widthSource: 'estimated' };
}

export function roadOffsets(road: Pick<Road, 'points' | 'width'>): LocalPoint[] {
  const points = road.points;
  const closed = points.length > 2 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].z - points.at(-1)!.z) < 0.001;
  return points.map((point, index) => {
    const previous = points[index ? index - 1 : closed ? points.length - 2 : 0];
    const next = points[index < points.length - 1 ? index + 1 : closed ? 1 : index];
    const lengthA = Math.hypot(point.x - previous.x, point.z - previous.z);
    const lengthB = Math.hypot(next.x - point.x, next.z - point.z);
    const a = lengthA ? { x: (point.z - previous.z) / lengthA, z: -(point.x - previous.x) / lengthA } : undefined;
    const b = lengthB ? { x: (next.z - point.z) / lengthB, z: -(next.x - point.x) / lengthB } : undefined;
    const first = a ?? b, second = b ?? a;
    if (!first || !second) throw new Error('Via com segmento de comprimento zero.');
    const x = first.x + second.x, z = first.z + second.z, magnitude = Math.hypot(x, z);
    if (magnitude < 0.01) return { x: first.x * road.width / 2, z: first.z * road.width / 2 };
    const scale = Math.min(road.width, road.width / 2 / Math.max(0.1, (x * first.x + z * first.z) / magnitude)) / magnitude;
    return { x: x * scale, z: z * scale };
  });
}

export function roadSegment(road: Pick<Road, 'points' | 'width'>, index: number, offsets = roadOffsets(road)): Polygon {
  const a = road.points[index - 1], b = road.points[index], da = offsets[index - 1], db = offsets[index];
  return [[{ x: a.x + da.x, z: a.z + da.z }, { x: a.x - da.x, z: a.z - da.z },
    { x: b.x - db.x, z: b.z - db.z }, { x: b.x + db.x, z: b.z + db.z }]];
}

export function bridgeHeight(road: Road, x: number, z: number): number | undefined {
  const offsets = roadOffsets(road);
  for (let i = 1; i < road.points.length; i++) {
    const ring = roadSegment(road, i, offsets)[0];
    for (const indices of [[0, 3, 1], [1, 3, 2]]) {
      const [a, b, c] = indices.map(index => ring[index]);
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(denominator) < 1e-8) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
      if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
      const heights = indices.map(index => road.heights[index < 2 ? i - 1 : i]);
      return u * heights[0] + v * heights[1] + (1 - u - v) * heights[2];
    }
  }
  return undefined;
}
