import type { CityData, LocalPoint } from './types';

export type RoutePoint = LocalPoint & { y: number };
export function geographicRoutes(city: CityData): { cars: RoutePoint[][]; pedestrians: RoutePoint[][] } {
  const graph = new Map<string, { point: RoutePoint; next: Set<string> }>();
  const key = (point: LocalPoint, layer: number) => `${point.x.toFixed(3)},${point.z.toFixed(3)},${layer}`;
  for (const road of city.roads.filter(road => road.drive)) {
    const keys = road.points.map((point, index) => {
      const id = key(point, road.bridge && (index === 0 || index === road.points.length - 1) ? 0 : road.layer);
      if (!graph.has(id)) graph.set(id, { point: { ...point, y: road.heights[index] }, next: new Set() });
      return id;
    });
    for (let i = 1; i < keys.length; i++) {
      if (road.oneway !== -1) graph.get(keys[i - 1])!.next.add(keys[i]);
      if (road.oneway !== 1) graph.get(keys[i])!.next.add(keys[i - 1]);
    }
  }
  const cars: RoutePoint[][] = [], signatures = new Set<string>();
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
        const points = cycle.map(id => graph.get(id)!.point);
        const length = points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length];
          return sum + Math.hypot(next.x - point.x, next.z - point.z);
        }, 0);
        if (cycle.length > 2 && length > 60 && !signatures.has(signature)) { cars.push(points); signatures.add(signature); }
        break;
      }
      visited.set(node, path.length); path.push(node);
      const next = [...graph.get(node)!.next].filter(id => id !== previous);
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
