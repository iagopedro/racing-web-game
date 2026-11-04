import { afterAll, describe, expect, it, vi } from 'vitest';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projection, regionBounds, flatTerrain, terrainHeight } from '../src/geo/coordinates';
import { parseRegion } from '../src/geo/types';
import { buildingHeight, addMicrosoft, normalizeOSM, finishCity } from '../src/geo/normalize';
import { cropLine, cropPolygon, insidePolygon, polygonArea } from '../src/geo/geometry';
import { geographicRoutes } from '../src/geo/routes';
import { realMap, recoveryPoint, surfaceHeight } from '../src/world/map';
import { terrainBody, terrainGeometry, buildingBody, createRealCity, drapedGeometry } from '../src/world/real-city';
import { createPhysics, CarPhysics, FIXED_STEP } from '../src/core/physics';
import { Player } from '../src/systems/player';
import { Population } from '../src/systems/population';
import { Cache, GeoService } from '../server/service';
import * as providers from '../server/providers';
import { region, ring, osmFixture, cityFixture } from './geo-fixture';

describe('geographic coordinates and request limits', () => {
  it.each([-75, -8.0631, 0, 60, 75])('preserves local meters and round trips at latitude %s', lat => {
    const center = { lon: -34.87, lat }, projectionAt = projection(center);
    const bounds = regionBounds(center, 5000);
    const sw = projectionAt.project({ lon: bounds[0], lat: bounds[1] });
    const ne = projectionAt.project({ lon: bounds[2], lat: bounds[3] });
    expect(ne.x - sw.x).toBeCloseTo(5000, 6);
    expect(sw.z - ne.z).toBeCloseTo(5000, 6);
    const source = { x: 127.5, z: -432.8 };
    const result = projectionAt.project(projectionAt.unproject(source));
    expect(result.x).toBeCloseTo(source.x, 6); expect(result.z).toBeCloseTo(source.z, 6);
  });
  it('rejects invalid input, NaN, excessive extents and antimeridian crossings', () => {
    expect(parseRegion(region)).toEqual(region);
    for (const sizeKm of [0, -1, 5.01, NaN, Infinity, '1']) expect(() => parseRegion({ ...region, sizeKm })).toThrow();
    expect(() => parseRegion({ ...region, center: { lat: 80, lon: 0 } })).toThrow();
    expect(() => parseRegion({ ...region, elevation: 'false' })).toThrow();
    expect(() => regionBounds({ lat: 0, lon: 179.999 }, 5000)).toThrow(/antimeridiano/);
  });
  it('uses the DEM southwest tile, not truncation toward zero', () => {
    expect(providers.demTile(Math.floor(-8.06), Math.floor(-34.87))).toContain('S09_00_W035_00');
    expect([...providers.quadkeys(regionBounds(region.center, 5000))].every(key => key.length === 9)).toBe(true);
    expect(providers.quadkeys([-0.01, -0.01, 0.01, 0.01]).size).toBe(4);
    expect(providers.overpassQuery([-35, -9, -34, -8])).toContain('(-9,-35,-8,-34)');
  });
});

describe('real geometry normalization', () => {
  it('clips lines without inventing closing segments', () => {
    const parts = cropLine([{ x: -300, z: 0 }, { x: 300, z: 0 }, { x: 300, z: 300 }, { x: 0, z: 0 }], 400);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual([{ x: -200, z: 0 }, { x: 200, z: 0 }]);
  });
  it('preserves polygon holes, clips boundaries, and interprets height provenance', () => {
    const city = cityFixture();
    expect(city.buildings).toHaveLength(3);
    expect(city.areas).toHaveLength(2);
    const courtyard = city.buildings.find(building => building.polygon.length === 2)!;
    expect(courtyard).toBeDefined();
    expect(insidePolygon({ x: 50, z: -50 }, courtyard.polygon)).toBe(false);
    expect(insidePolygon({ x: 15, z: -50 }, courtyard.polygon)).toBe(true);
    expect(city.roads.every(road => road.points.every(point => Math.abs(point.x) <= 200.00001 && Math.abs(point.z) <= 200.00001))).toBe(true);
    expect(city.buildings.map(building => building.height).sort((a, b) => a - b)).toEqual([9, 12, 18]);
    expect(buildingHeight({ height: '30 ft', 'building:levels': '10' }, 'osm').height).toBeCloseTo(9.144);
    expect(buildingHeight({ height: -1 }, 'microsoft').heightSource).toBe('estimated');
    expect(buildingHeight({ height: 20 }, 'microsoft').heightSource).toBe('ml');
    expect(cropPolygon([[{ x: -300, z: -300 }, { x: 300, z: -300 }, { x: 300, z: 300 }, { x: -300, z: 300 }, { x: -300, z: -300 }]], 400).map(polygonArea)).toEqual([160000]);
  });
  it('adds only missing Microsoft footprints and prefers OSM geometry', () => {
    const city = cityFixture();
    const added = addMicrosoft(city, [
      { type: 'Feature', properties: { height: 100 }, geometry: { type: 'Polygon', coordinates: [ring(32, 46, 72, 81)] } },
      { type: 'Feature', properties: { height: 15 }, geometry: { type: 'Polygon', coordinates: [ring(-100, 40, -70, 70)] } },
    ]);
    expect(added).toBe(1);
    expect(city.buildings.find(building => building.source === 'microsoft')?.height).toBe(15);
    expect(city.buildings.find(building => building.id === 'way/103/0')?.height).toBe(18);
  });
  it('rejects partial Overpass errors and maps without a valid drivable spawn', () => {
    expect(() => normalizeOSM({ elements: [], remark: 'runtime error: timeout' }, region, flatTerrain(400), 'id')).toThrow(/incompletos/);
    const city = normalizeOSM({ elements: [] }, region, flatTerrain(400), 'id');
    expect(() => finishCity(city)).toThrow(/via dirigivel/);
  });
  it('builds continuous one-way cycles and never joins disconnected road endpoints', () => {
    const city = cityFixture(), routes = geographicRoutes(city);
    expect(routes.cars.length).toBeGreaterThan(0);
    for (const route of routes.cars) {
      for (let i = 0; i < route.length; i++) {
        const a = route[i], b = route[(i + 1) % route.length];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThanOrEqual(8.01);
      }
    }
    expect(routes.pedestrians.length).toBe(1);
    city.roads = city.roads.filter(road => road.id.startsWith('way/101'));
    expect(geographicRoutes(city).cars).toHaveLength(0);
  });
});

describe('terrain and navigable city physics', () => {
  it('matches rendered and physical terrain triangles, including negative z orientation', () => {
    const terrain = { segments: 1, size: 100, heights: [0, 10, 20, 40], datum: 0, source: 'copernicus' as const };
    const world = createPhysics(false); world.addBody(terrainBody(terrain));
    const mesh = new THREE.Mesh(terrainGeometry(terrain), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const uv = mesh.geometry.getAttribute('uv');
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0]);
    expect([uv.getX(3), uv.getY(3)]).toEqual([1, 1]);
    mesh.updateMatrixWorld();
    for (const [x, z] of [[-25, 30], [20, -35], [0, 0]]) {
      const result = new CANNON.RaycastResult();
      expect(world.raycastClosest(new CANNON.Vec3(x, 100, z), new CANNON.Vec3(x, -100, z), {}, result)).toBe(true);
      expect(result.hitPointWorld.y).toBeCloseTo(terrainHeight(terrain, x, z), 5);
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0];
      expect(hit.point.y).toBeCloseTo(result.hitPointWorld.y, 5);
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  });
  it('keeps courtyards open in colliders instead of replacing buildings with bounding boxes', () => {
    const errors = vi.spyOn(console, 'error');
    const city = cityFixture(), courtyard = city.buildings.find(building => building.polygon.length === 2)!;
    const world = createPhysics(false); world.addBody(buildingBody(courtyard, city.terrain));
    const ray = new CANNON.RaycastResult();
    expect(world.raycastClosest(new CANNON.Vec3(50, 30, -50), new CANNON.Vec3(50, -10, -50), {}, ray)).toBe(false);
    expect(world.raycastClosest(new CANNON.Vec3(15, 30, -50), new CANNON.Vec3(15, -10, -50), {}, ray)).toBe(true);
    expect(ray.hitPointWorld.y).toBeCloseTo(9);
    expect(errors).not.toHaveBeenCalled(); errors.mockRestore();
  });
  it('drapes every surface triangle precisely on the DEM rather than cutting across it', () => {
    const terrain = { segments: 2, size: 100, heights: [0, 1, 8, 3, 25, 1, 2, 9, 0], datum: 0, source: 'copernicus' as const };
    const geometry = drapedGeometry([[{ x: -45, z: -45 }, { x: 45, z: -40 }, { x: 40, z: 45 }, { x: -40, z: 40 }]], terrain, 0.07);
    const points = geometry.getAttribute('position');
    expect(points.count).toBeGreaterThan(6);
    for (let i = 0; i < points.count; i += 3) {
      const x = (points.getX(i) + points.getX(i + 1) + points.getX(i + 2)) / 3;
      const z = (points.getZ(i) + points.getZ(i + 1) + points.getZ(i + 2)) / 3;
      const y = (points.getY(i) + points.getY(i + 1) + points.getY(i + 2)) / 3;
      expect(y).toBeCloseTo(terrainHeight(terrain, x, z) + 0.07, 4);
    }
    geometry.dispose();
  });
  it('settles and drives on elevated terrain, and permits entering, exiting and recovery', () => {
    const city = cityFixture();
    city.terrain.heights.fill(25); finishCity(city);
    const map = realMap(city), world = createPhysics(false), scene = new THREE.Scene();
    createRealCity(scene, world, map);
    const player = new Player(scene, world, map);
    for (let i = 0; i < 120; i++) { player.update({ throttle: 0, brake: 1, steer: 0, handbrake: false }, FIXED_STEP, 0); world.step(FIXED_STEP); }
    expect(player.walker.position.y).toBeGreaterThan(25);
    expect(player.walker.position.y).toBeLessThan(26);
    expect(player.interact()).toBeNull(); expect(player.driving).toBe(true);
    player.transitioning = 0;
    expect(player.interact()).toBeNull(); expect(player.driving).toBe(false);
    player.car.body.position.set(10000, -100, 10000);
    player.recover();
    expect(player.car.body.position.y).toBeCloseTo(25.95);
    expect(recoveryPoint(map, { x: 10000, z: 10000 })).toEqual(city.spawn);
    expect(surfaceHeight(map, city.spawn.x, city.spawn.z)).toBe(25);
    const car = new CarPhysics(world, -20, 0, -Math.PI / 2, 25);
    for (let i = 0; i < 120; i++) { car.update({ throttle: 1, brake: 0, steer: 0, handbrake: false }, FIXED_STEP); world.step(FIXED_STEP); }
    expect(car.speed).toBeGreaterThan(4); expect(car.body.position.y).toBeGreaterThan(25);
  });
  it('runs geographic traffic at the sampled elevation without fictional grid routes', () => {
    const city = cityFixture(); city.terrain.heights.fill(18); finishCity(city);
    const world = createPhysics(false), population = new Population(new THREE.Scene(), world, realMap(city));
    const player = new CANNON.Body({ position: new CANNON.Vec3(900, 0, 900) });
    for (let i = 0; i < 300; i++) { population.update(FIXED_STEP, i / 60, player, new THREE.Vector3(), 0); world.step(FIXED_STEP); }
    expect(population.cars.length).toBeGreaterThan(0);
    for (const car of population.cars) expect(car.body.position.y).toBeCloseTo(18.82);
    expect(population.pedestrians).toHaveLength(1);
  });
  it('keeps approximated bridge decks aligned with their physical driving surface', () => {
    const city = cityFixture();
    city.roads.push({
      id: 'bridge-test', name: 'bridge', kind: 'residential', points: [{ x: -100, z: 130 }, { x: 120, z: 170 }],
      heights: [], width: 8, oneway: 0, layer: 1, bridge: true, tunnel: false, drive: true, walk: false,
    });
    finishCity(city);
    const map = realMap(city), world = createPhysics(false);
    createRealCity(new THREE.Scene(), world, map);
    const bridge = city.roads.at(-1)!;
    expect(bridge.heights[0]).toBe(0);
    expect(bridge.heights.at(-1)).toBeCloseTo(0);
    for (let i = 1; i < bridge.points.length; i++) {
      const a = bridge.points[i - 1], b = bridge.points[i];
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const ray = new CANNON.RaycastResult();
      expect(world.raycastClosest(new CANNON.Vec3(x, 100, z), new CANNON.Vec3(x, -10, z), {}, ray)).toBe(true);
      expect(ray.hitPointWorld.y).toBeCloseTo((bridge.heights[i - 1] + bridge.heights[i]) / 2, 2);
      expect(surfaceHeight(map, x, z)).toBeCloseTo(ray.hitPointWorld.y, 2);
    }
    const midpoint = bridge.points[Math.floor(bridge.points.length / 2)];
    expect(surfaceHeight(map, midpoint.x, midpoint.z, 1)).toBe(0);
  });
});

const cacheDirectory = await mkdtemp(join(tmpdir(), 'santa-brisa-geo-test-'));
afterAll(() => rm(cacheDirectory, { recursive: true, force: true }));
describe('local pipeline and durable cache', () => {
  it('uses a cached region without additional upstream calls and supports explicit refresh', async () => {
    const osm = vi.fn(async () => osmFixture());
    const service = new GeoService(new Cache(cacheDirectory), { ...providers, osm });
    const first = await service.generate(region, AbortSignal.timeout(10000));
    const second = await service.generate(region, AbortSignal.timeout(10000));
    expect(second).toEqual(first); expect(osm).toHaveBeenCalledTimes(1);
    await service.generate(region, AbortSignal.timeout(10000), true);
    expect(osm).toHaveBeenCalledTimes(2);
    await expect(service.cache.read('../outside')).rejects.toThrow(/Identificador/);
  });
  it('fails explicitly when requested DEM fails, rather than silently using flat terrain', async () => {
    const service = new GeoService(new Cache(cacheDirectory), { ...providers, osm: async () => osmFixture(), elevation: async () => { throw new Error('DEM unavailable'); } });
    await expect(service.generate({ ...region, elevation: true }, AbortSignal.timeout(10000))).rejects.toThrow('DEM unavailable');
  });
  it('reports absent optional sources and never presents them as successfully loaded', async () => {
    const service = new GeoService(new Cache(cacheDirectory), {
      ...providers, osm: async () => osmFixture(), microsoft: async () => { throw new Error('source unavailable'); },
      aerial: async () => [], sentinel: async () => [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const city = await service.generate({ ...region, microsoft: true, imagery: true }, AbortSignal.timeout(10000));
      expect(city.warnings.some(warning => warning.includes('Microsoft footprints indisponivel'))).toBe(true);
      expect(city.warnings.some(warning => warning.includes('OpenAerialMap: nenhuma'))).toBe(true);
      expect(city.attribution.some(credit => credit.label.includes('Microsoft'))).toBe(false);
    } finally { warn.mockRestore(); }
  });
});
