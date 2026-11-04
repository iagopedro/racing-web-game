import { projection, flatTerrain } from '../src/geo/coordinates.ts';
import { finishCity, normalizeOSM } from '../src/geo/normalize.ts';
import type { RegionRequest } from '../src/geo/types.ts';

export const region: RegionRequest = {
  name: 'Recife test fixture', center: { lat: -8.0631, lon: -34.8712 }, sizeKm: 0.4,
  elevation: false, microsoft: false, imagery: false,
};
const { unproject } = projection(region.center);
export const position = (x: number, z: number) => { const p = unproject({ x, z }); return [p.lon, p.lat]; };
export const ring = (left: number, top: number, right: number, bottom: number) => [
  position(left, top), position(right, top), position(right, bottom), position(left, bottom), position(left, top),
];

export function osmFixture() {
  const ids = new Map<string, number>();
  const way = (id: number, tags: Record<string, string>, points: number[][]) => ({
    type: 'way', id, tags,
    nodes: points.map(point => {
      const key = point.join(',');
      if (!ids.has(key)) ids.set(key, ids.size + 1);
      return ids.get(key)!;
    }),
    geometry: points.map(([lon, lat]) => ({ lon, lat })),
  });
  return { elements: [
    way(100, { highway: 'residential', name: 'Rua real', oneway: 'yes', width: '8' }, ring(-120, -100, 120, 100)),
    way(101, { highway: 'residential', name: 'Rua curva', width: '7' }, [position(-300, 0), position(-20, 0), position(20, 30), position(300, 30)]),
    way(102, { highway: 'footway' }, [position(-80, -80), position(0, -70), position(80, -80)]),
    way(103, { building: 'yes', height: '18 m' }, ring(30, 45, 70, 80)),
    way(104, { building: 'yes', 'building:levels': '4' }, ring(-180, 130, -140, 180)),
    way(105, { leisure: 'park' }, ring(-50, 40, 0, 80)),
    way(106, { natural: 'water' }, ring(140, -50, 230, 160)),
    { type: 'relation', id: 200, tags: { type: 'multipolygon', building: 'yes' }, members: [
      { type: 'way', ref: 201, role: 'outer', geometry: ring(10, -90, 90, -20).map(([lon, lat]) => ({ lon, lat })) },
      { type: 'way', ref: 202, role: 'inner', geometry: ring(30, -70, 70, -40).map(([lon, lat]) => ({ lon, lat })) },
    ] },
  ] };
}
export function cityFixture() {
  const city = normalizeOSM(osmFixture(), region, flatTerrain(400), 'a'.repeat(32));
  city.warnings.push('Modo plano escolhido: elevacao real NAO carregada.');
  finishCity(city);
  return city;
}
