import type { Building, CityData, LocalPoint, Road } from './types';
import { terrainHeight } from './coordinates';
import { insidePolygon } from './geometry';
import { SpatialIndex } from './spatial';
import { bridgeHeight, roadLanes } from './roads';

export type RoutePoint = LocalPoint & { y: number };
export function geographicRoutes(city: CityData): { cars: RoutePoint[][]; pedestrians: RoutePoint[][] } {
  const graph = new Map<string, { point: RoutePoint; next: Map<string, Road> }>();
  const key = (point: LocalPoint, layer: number) => `${point.x.toFixed(3)},${point.z.toFixed(3)},${layer}`;
  for (const road of city.roads.filter(road => road.drive && road.width >= (road.oneway ? 3.2 : 5.5))) {
    const keys = road.points.map((point, index) => {
      const id = key(point, road.bridge && (index === 0 || index === road.points.length - 1) ? 0 : road.layer);
      if (!graph.has(id)) graph.set(id, { point: { ...point, y: road.heights[index] }, next: new Map() });
      return id;
    });
    for (let i = 1; i < keys.length; i++) {
      if (road.oneway !== -1) graph.get(keys[i - 1])!.next.set(keys[i], road);
      if (road.oneway !== 1) graph.get(keys[i])!.next.set(keys[i - 1], road);
    }
  }
  const cars: RoutePoint[][] = [], signatures = new Set<string>();
  const buildings = new SpatialIndex<Building>();
  city.buildings.forEach(building => buildings.add(building, building.polygon[0], 2));
  const clear = (point: RoutePoint) => ![...buildings.at(point)].some(building =>
    building.minHeight < 2 && [-1.1, 0, 1.1].some(dx => [-1.1, 0, 1.1].some(dz => insidePolygon({ x: point.x + dx, z: point.z + dz }, building.polygon))));
  const starts = [...graph.keys()];
  for (let attempt = 0; attempt < Math.min(starts.length, 100) && cars.length < 20; attempt++) {
    let node = starts[Math.floor(attempt * starts.length / Math.min(starts.length, 100))];
    let previous = '';
    const path: string[] = [], visited = new Map<string, number>();
    for (let step = 0; step < 1500; step++) {
      const seen = visited.get(node);
      if (seen !== undefined) {
        const cycle = path.slice(seen);
        const signature = [...cycle].sort().join('|');
        const points = cycle.map((id, index) => {
          const point = graph.get(id)!.point, previous = graph.get(cycle[(index + cycle.length - 1) % cycle.length])!.point;
          const nextId = cycle[(index + 1) % cycle.length], next = graph.get(nextId)!.point;
          const road = graph.get(id)!.next.get(nextId)!;
          const distance = Math.hypot(next.x - previous.x, next.z - previous.z);
          const lane = road.width / 2 - road.width / roadLanes(road) / 2;
          const x = point.x + (next.z - previous.z) / Math.max(distance, 0.001) * lane;
          const z = point.z - (next.x - previous.x) / Math.max(distance, 0.001) * lane;
          return { x, z, y: road.bridge ? bridgeHeight(road, x, z) ?? point.y : terrainHeight(city.terrain, x, z) };
        });
        const length = points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length];
          return sum + Math.hypot(next.x - point.x, next.z - point.z);
        }, 0);
        if (cycle.length > 2 && length > 60 && !signatures.has(signature) && points.every(clear)) {
          const dense = points.flatMap((point, index) => {
            const next = points[(index + 1) % points.length], steps = Math.max(1, Math.ceil(Math.hypot(next.x - point.x, next.z - point.z) / 6));
            return Array.from({ length: steps }, (_, j) => ({ x: point.x + (next.x - point.x) * j / steps, z: point.z + (next.z - point.z) * j / steps, y: point.y + (next.y - point.y) * j / steps }));
          });
          if (dense.every(clear)) { cars.push(dense); signatures.add(signature); }
        }
        break;
      }
      visited.set(node, path.length); path.push(node);
      const next = [...graph.get(node)!.next.keys()].filter(id => id !== previous);
      if (!next.length) break;
      previous = node;
      node = next[(attempt + step) % next.length];
    }
  }
  const pedestrians = city.roads.filter(road => road.walk && !road.bridge).slice(0, 40).map(road => {
    const points = road.points.map((point, index) => ({ ...point, y: road.heights[index] }));
    return [...points, ...points.slice(1, -1).reverse()];
  }).filter(points => points.length >= 2);
  return { cars, pedestrians };
}
