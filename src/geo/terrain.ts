import type { Terrain } from './types.ts';

// An opening removes roof/tree peaks; the subsequent convolution preserves a
// plane's grade rather than treating a DSM as a surveyed bare-earth DTM.
export function urbanGround(terrain: Terrain): Terrain {
  if (terrain.source === 'flat' || terrain.processing === 'urban-ground') return terrain;
  const side = terrain.segments + 1;
  const raw = terrain.heights;
  const filter = (values: number[], radius: number, minimum: boolean) => values.map((_, index) => {
    const x = index % side, y = Math.floor(index / side);
    let value = minimum ? Infinity : -Infinity;
    for (let j = Math.max(0, y - radius); j <= Math.min(side - 1, y + radius); j++) {
      for (let i = Math.max(0, x - radius); i <= Math.min(side - 1, x + radius); i++) {
        value = minimum ? Math.min(value, values[j * side + i]) : Math.max(value, values[j * side + i]);
      }
    }
    return value;
  });
  let heights = filter(filter(raw, 2, true), 2, false);
  for (let pass = 0; pass < 3; pass++) {
    const previous = heights;
    heights = previous.map((_, index) => {
      const x = index % side, y = Math.floor(index / side);
      let total = 0, weight = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const i = x + dx, j = y + dy;
        if (i < 0 || j < 0 || i >= side || j >= side) continue;
        const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
        total += previous[j * side + i] * w; weight += w;
      }
      return total / weight;
    });
  }
  return { ...terrain, processing: 'urban-ground', rawHeights: [...raw], heights };
}
