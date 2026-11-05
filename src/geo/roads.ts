import type { LocalPoint, Polygon, Road } from './types.ts';

export const ROAD_PIPELINE_VERSION = 1;

export function roadLanes(road: Pick<Road, 'width' | 'oneway'> & { lanes?: number }): number {
  if (road.lanes && Number.isInteger(road.lanes) && road.lanes > 0 && road.lanes <= 12) return road.lanes;
  return Math.max(1, Math.floor(road.width / 3));
}

export function laneTags(tags: Record<string, unknown>): Pick<Road, 'lanes' | 'lanesForward' | 'laneMarkings'> {
  const count = (value: unknown) => /^(?:[1-9]|1[0-2])$/.test(String(value)) ? Number(value) : undefined;
  return { lanes: count(tags.lanes), lanesForward: count(tags['lanes:forward']), laneMarkings: tags.lane_markings === 'no' ? false : undefined };
}

export function roadNetwork(roads: Road[]): Map<Road, { offsets: LocalPoint[]; junctions: Map<number, number> }> {
  const network = new Map(roads.map(road => [road, { offsets: roadOffsets(road), junctions: new Map<number, number>() }]));
  const nodes = new Map<string, { road: Road; index: number }[]>();
  for (const road of roads) {
    if (!road.drive || road.tunnel) continue;
    road.points.forEach((point, index) => {
      const key = `${Math.round(point.x * 100)}:${Math.round(point.z * 100)}:${road.layer}`;
      const entries = nodes.get(key) ?? [];
      entries.push({ road, index }); nodes.set(key, entries);
    });
  }
  for (const entries of nodes.values()) {
    const degree = entries.reduce((sum, entry) => sum + (entry.index > 0 ? 1 : 0) + (entry.index < entry.road.points.length - 1 ? 1 : 0), 0);
    if (degree > 2) {
      const radius = Math.max(...entries.map(entry => entry.road.width)) / 2 + 1;
      for (const entry of entries) network.get(entry.road)!.junctions.set(entry.index, radius);
    } else if (degree === 2 && entries.length === 2) {
      const [first, second] = entries;
      if (first.road.bridge || second.road.bridge) continue;
      const previous = first.road.points[first.index === 0 ? 1 : first.index - 1];
      const point = first.road.points[first.index];
      const next = second.road.points[second.index === 0 ? 1 : second.index - 1];
      const offset = roadOffsets({ points: [previous, point, next], width: Math.min(first.road.width, second.road.width) })[1];
      for (const entry of entries) {
        const sign = entry === first ? (entry.index === 0 ? -1 : 1) : (entry.index === 0 ? 1 : -1);
        network.get(entry.road)!.offsets[entry.index] = { x: offset.x * sign, z: offset.z * sign };
      }
    }
  }
  return network;
}

export function roadWarnings(roads: Road[]): string[] {
  const drive = roads.filter(road => road.drive && !road.tunnel);
  const estimated = drive.filter(road => !road.lanes).length;
  const narrow = drive.filter(road => road.width / roadLanes(road) < 2.5).length;
  return [
    `Demarcacao viaria aproximada, nao levantamento da sinalizacao real. ${estimated} trechos sem contagem de faixas preservada: divisao estimada pela largura. Gere novamente recortes antigos para recuperar tags de faixas.`,
    ...(narrow ? [`${narrow} trechos com menos de 2,5 m por faixa: dimensoes da fonte preservadas, demarcacao omitida; requerem revisao dos dados.`] : []),
  ];
}

export function roadWidth(tags: Record<string, unknown>, measure: (value: unknown) => number | undefined): Pick<Road, 'width' | 'widthSource'> {
  const explicit = measure(tags['width:carriageway']) ?? measure(tags.width);
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
