import type { LocalPoint } from './types.ts';

export class SpatialIndex<T> {
  private cells = new Map<string, Set<T>>();
  add(value: T, points: LocalPoint[], padding = 0): void {
    const xs = points.map(point => point.x), zs = points.map(point => point.z);
    for (let x = Math.floor((Math.min(...xs) - padding) / 64); x <= Math.floor((Math.max(...xs) + padding) / 64); x++) {
      for (let z = Math.floor((Math.min(...zs) - padding) / 64); z <= Math.floor((Math.max(...zs) + padding) / 64); z++) {
        const key = `${x}:${z}`, cell = this.cells.get(key) ?? new Set<T>();
        cell.add(value); this.cells.set(key, cell);
      }
    }
  }
  at(point: LocalPoint): Iterable<T> {
    return this.cells.get(`${Math.floor(point.x / 64)}:${Math.floor(point.z / 64)}`) ?? [];
  }
}
