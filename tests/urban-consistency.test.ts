import { describe, expect, it } from 'vitest';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { urbanGround } from '../src/geo/terrain';
import { coastlineWater } from '../src/geo/coastline';
import { insidePolygon, polygonArea } from '../src/geo/geometry';
import { roadOffsets, roadSegment, roadWidth, bridgeHeight, roadLanes, laneTags, roadNetwork } from '../src/geo/roads';
import { flatTerrain, terrainHeight } from '../src/geo/coordinates';
import { lengthMeters, normalizeOSM, finishCity } from '../src/geo/normalize';
import { bridgeGeometry, buildingBody, createRealCity, roadGeometry, surfaceBody, terrainBody } from '../src/world/real-city';
import { bodyOverlapsSphere } from '../src/core/collision';
import { CarPhysics, createPhysics, FIXED_STEP } from '../src/core/physics';
import { Player } from '../src/systems/player';
import { LoopRoute, Population } from '../src/systems/population';
import { realMap } from '../src/world/map';
import type { Building, Road } from '../src/geo/types';
import { cityFixture, osmFixture, region, ring } from './geo-fixture';
import { geographicRoutes } from '../src/geo/routes';

describe('street dimensions and missing geographic features', () => {
  it('keeps paint in metre coordinates across curve segments and on the physical bridge', () => {
    const city = cityFixture();
    const road = { ...city.roads.find(road => road.drive)!, width: 6.2, lanes: 2, points: [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 55, z: 10 }], heights: [0, 1, 3] };
    for (const bridge of [false, true]) {
      const geometry = roadGeometry({ ...road, bridge }, 2, city.terrain, roadOffsets(road), 30);
      const paint = geometry.getAttribute('roadPaint');
      for (let index = 0; index < paint.count; index++) {
        expect(paint.getY(index)).toBeGreaterThanOrEqual(29.99);
        expect(paint.getY(index)).toBeLessThanOrEqual(30 + Math.hypot(25, 10) + 0.01);
        expect(Math.abs(paint.getX(index))).toBeLessThanOrEqual(3.101);
        expect(paint.getZ(index)).toBeCloseTo(3.1);
      }
      if (bridge) expect(Array.from(geometry.getAttribute('position').array)).toEqual(Array.from(bridgeGeometry({ ...road, bridge }, 2).getAttribute('position').array));
      geometry.dispose();
    }
    const unmarked = roadGeometry({ ...road, laneMarkings: false }, 1, city.terrain);
    expect(Array.from(unmarked.getAttribute('roadPaint').array).every(value => value === 0)).toBe(true);
    unmarked.dispose();
  });
  it('retains explicit lane information without accepting malformed counts', () => {
    expect(laneTags({ lanes: '3', 'lanes:forward': '2', lane_markings: 'no' })).toEqual({ lanes: 3, lanesForward: 2, laneMarkings: false });
    expect(laneTags({ lanes: '2;3' }).lanes).toBeUndefined();
  });
  it('places the two-way divider according to the declared forward lanes', () => {
    const city = cityFixture(), road = { ...city.roads.find(road => road.drive)!, width: 9.3, lanes: 3, lanesForward: 2, oneway: 0 as const };
    const geometry = roadGeometry(road, 1, city.terrain);
    expect(geometry.getAttribute('roadSeparation').getX(0)).toBeCloseTo(-1.55);
    geometry.dispose();
  });
  it('shares a cross-section across angled way endpoints and marks intersections separately', () => {
    const base = cityFixture().roads.find(road => road.drive)!;
    const first = { ...base, width: 6.2, points: [{ x: -30, z: 0 }, { x: 0, z: 0 }] };
    const second = { ...base, width: 6.2, points: [{ x: 0, z: 0 }, { x: 25, z: 10 }] };
    const network = roadNetwork([first, second]);
    expect(network.get(first)!.offsets[1]).toEqual(network.get(second)!.offsets[0]);
    const branch = { ...base, points: [{ x: 0, z: 0 }, { x: 0, z: -30 }] };
    expect(roadNetwork([first, second, branch]).get(first)!.junctions.get(1)).toBeGreaterThan(3);
    expect(roadNetwork([first, { ...branch, layer: 1 }]).get(first)!.junctions.size).toBe(0);
  });
  it('uses carriageway width and leaves estimated lanes wider than the 1.88 m vehicle', () => {
    expect(roadWidth({ width: '12', 'width:carriageway': '6.2' }, lengthMeters).width).toBe(6.2);
    for (const width of [3, 4.5, 6.2, 7, 9.3, 10.5]) {
      expect(width / roadLanes({ width, oneway: 0 })).toBeGreaterThanOrEqual(3);
    }
    expect(roadLanes({ width: 7, oneway: 1, lanes: 3 })).toBe(3);
  });
  it('distinguishes measured width, lanes and estimates without inflating a footpath into a street', () => {
    expect(roadWidth({ width: '12 ft', lanes: '8' }, lengthMeters)).toEqual({ width: 3.6576000000000004, widthSource: 'tag' });
    expect(roadWidth({ highway: 'secondary', lanes: '3' }, lengthMeters).width).toBeCloseTo(9.3);
    expect(roadWidth({ highway: 'residential', oneway: 'yes' }, lengthMeters).width).toBe(4.5);
    expect(roadWidth({ highway: 'residential', oneway: 'no' }, lengthMeters).width).toBe(6.2);
    expect(roadWidth({ highway: 'footway', lanes: '2;3' }, lengthMeters)).toEqual({ width: 2, widthSource: 'estimated' });
  });
  it('preserves paved squares and their names rather than throwing their polygons away', () => {
    const raw = osmFixture();
    raw.elements.push({
      type: 'way', id: 888, tags: { highway: 'pedestrian', area: 'yes', name: 'Praca Rio Branco' },
      nodes: [900, 901, 902, 903, 900], geometry: ring(-30, -30, 30, 30).map(([lon, lat]) => ({ lon, lat })),
    });
    const city = normalizeOSM(raw, region, flatTerrain(400), 'test');
    expect(new Set(city.warnings).size).toBe(city.warnings.length);
    const square = city.areas.find(area => area.name === 'Praca Rio Branco')!;
    expect(square.kind).toBe('paved'); expect(polygonArea(square.polygon)).toBeCloseTo(3600);
  });
  it('assembles coastline once after collecting all source ways', () => {
    const raw = osmFixture();
    const points = [ring(0, -300, 1, 0)[0], ring(0, 0, 1, 300)[0], ring(0, 0, 1, 300)[3]];
    raw.elements.push({ type: 'way', id: 990, tags: { natural: 'coastline' }, nodes: [991, 992, 993], geometry: points.map(([lon, lat]) => ({ lon, lat })) });
    const city = normalizeOSM(raw, region, flatTerrain(400), 'test');
    expect(city.areas.filter(area => area.id.startsWith('coastline/'))).toHaveLength(1);
    expect(city.warnings.some(warning => warning.startsWith('Sem costa'))).toBe(false);
    expect(new Set(city.warnings).size).toBe(city.warnings.length);
  });
  it('keeps carriageway width perpendicular to straight roads in any orientation', () => {
    for (const angle of [0, Math.PI / 7, Math.PI / 2, Math.PI]) {
      const road = { points: [{ x: 0, z: 0 }, { x: Math.sin(angle) * 100, z: Math.cos(angle) * 100 }], width: 9.3 };
      const [a, b, c, d] = roadSegment(road, 1)[0];
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(9.3);
      expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeCloseTo(9.3);
      expect(polygonArea([[a, b, c, d]])).toBeCloseTo(930);
    }
  });
  it('closes road rings continuously at their seam', () => {
    const offsets = roadOffsets({ width: 6, points: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }, { x: 0, z: 0 }] });
    expect(offsets[0]).toEqual(offsets.at(-1));
  });
});

describe('coastline and urban terrain', () => {
  it('fills only the sea side of a directed coastline, even if source ways arrive out of order', () => {
    const result = coastlineWater([
      [{ x: 0, z: 0 }, { x: 0, z: 300 }],
      [{ x: 0, z: -300 }, { x: 0, z: 0 }],
    ], 400);
    expect(result.incomplete).toBe(0);
    expect(result.polygons.reduce((sum, p) => sum + polygonArea(p), 0)).toBeCloseTo(80000);
    expect(result.polygons.some(p => insidePolygon({ x: -100, z: 0 }, p))).toBe(true);
    expect(result.polygons.some(p => insidePolygon({ x: 100, z: 0 }, p))).toBe(false);
  });
  it('does not fill islands or fabricate an inland closing edge for missing coastline', () => {
    const island = [{ x: -20, z: -20 }, { x: -20, z: 20 }, { x: 20, z: 20 }, { x: 20, z: -20 }, { x: -20, z: -20 }];
    const result = coastlineWater([island], 400);
    expect(result.polygons.some(p => insidePolygon({ x: 0, z: 0 }, p))).toBe(false);
    expect(result.polygons.some(p => insidePolygon({ x: 50, z: 0 }, p))).toBe(true);
    expect(coastlineWater([[{ x: 0, z: 0 }, { x: 0, z: 300 }]], 400)).toEqual({ polygons: [], incomplete: 1 });
  });
  it('connects coastal fragments along the crop boundary without unioning complementary seas', () => {
    const result = coastlineWater([
      [{ x: 0, z: -200 }, { x: 0, z: -50 }, { x: 200, z: -50 }],
      [{ x: 200, z: 50 }, { x: 0, z: 50 }, { x: 0, z: 200 }],
    ], 200);
    expect(result.incomplete).toBe(0);
    expect(result.polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0)).toBeCloseTo(30000);
    expect(result.polygons.some(polygon => insidePolygon({ x: 50, z: -80 }, polygon))).toBe(false);
    expect(result.polygons.some(polygon => insidePolygon({ x: 50, z: 0 }, polygon))).toBe(true);
  });
  it('removes isolated roof peaks while retaining raw data and broad terrain grades', () => {
    const terrain = { ...flatTerrain(600), source: 'copernicus' as const };
    const side = terrain.segments + 1;
    terrain.heights = terrain.heights.map((_, i) => (i % side) * 0.9 + Math.floor(i / side) * 0.3);
    const center = 10 * side + 10, original = [...terrain.heights];
    terrain.heights[center] += 24;
    const ground = urbanGround(terrain);
    expect(ground.processing).toBe('urban-ground');
    expect(ground.rawHeights).toEqual(terrain.heights);
    expect(Math.abs(ground.heights[center] - original[center])).toBeLessThan(0.05);
    const clean = urbanGround({ ...terrain, heights: original });
    expect(clean.heights[center]).toBeCloseTo(original[center], 5);
    expect(clean.heights[center + 1] - clean.heights[center - 1]).toBeCloseTo(1.8, 5);
    expect(terrain.heights[center]).toBe(original[center] + 24);
    expect(urbanGround(ground)).toBe(ground);
  });
});

describe('visible surfaces and physical obstacles share geometry', () => {
  it.each([[20, 10, 10, 0], [10, 0, 20, 10], [0, 20, 10, 0]])('does not drop short wheel rays on descending or saddle cells %s', (...heights) => {
    const terrain = { segments: 1, size: 30, datum: 0, source: 'copernicus' as const, heights };
    const world = createPhysics(false); world.addBody(terrainBody(terrain));
    for (let x = -13; x <= 13; x += 2.5) for (let z = -13; z <= 13; z += 2.5) {
      const height = terrainHeight(terrain, x, z), ray = new CANNON.RaycastResult();
      expect(world.raycastClosest(new CANNON.Vec3(x, height + 0.6, z), new CANNON.Vec3(x, height - 0.1, z), {}, ray), `missed suspension ray ${x},${z}`).toBe(true);
      expect(ray.hitPointWorld.y).toBeCloseTo(height, 6);
    }
  });
  it('respects ray masks, backfaces and nearer obstacles with the terrain raycaster', () => {
    const world = createPhysics(false), terrain = terrainBody(flatTerrain(200));
    world.addBody(terrain);
    const from = new CANNON.Vec3(0, 5, 0), to = new CANNON.Vec3(0, -5, 0), result = new CANNON.RaycastResult();
    expect(world.raycastClosest(to, from, { skipBackfaces: true }, result)).toBe(false);
    terrain.collisionFilterGroup = 2;
    expect(world.raycastClosest(from, to, { collisionFilterMask: 1 }, result)).toBe(false);
    const obstacle = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(0, 2, 0), shape: new CANNON.Box(new CANNON.Vec3(1, 0.5, 1)) });
    world.addBody(obstacle);
    expect(world.raycastClosest(from, to, {}, result)).toBe(true);
    expect(result.body).toBe(obstacle);
    obstacle.collisionResponse = false;
    expect(world.raycastClosest(from, to, {}, result)).toBe(true);
    expect(result.body).toBe(terrain);
  });
  const bridge: Road = {
    id: 'curved', name: 'Ponte', kind: 'residential', width: 8, widthSource: 'tag',
    points: [{ x: -30, z: 0 }, { x: 0, z: 0 }, { x: 30, z: 22 }], heights: [2, 4, 3],
    bridge: true, tunnel: false, layer: 1, oneway: 0, drive: true, walk: false,
  };
  it('matches curved bridge collision to the actual tapered mesh, including the edges', () => {
    const world = createPhysics(false), group = new THREE.Group();
    for (let i = 1; i < bridge.points.length; i++) {
      const geometry = bridgeGeometry(bridge, i);
      group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
      world.addBody(surfaceBody(geometry, 0.3));
    }
    group.updateMatrixWorld(true);
    let hits = 0;
    for (let x = -29; x < 30; x += 2.7) for (let z = -7; z < 28; z += 1.7) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0)).intersectObject(group, true)[0];
      const physical = new CANNON.RaycastResult();
      const found = world.raycastClosest(new CANNON.Vec3(x, 20, z), new CANNON.Vec3(x, -10, z), {}, physical);
      expect(found, `bridge footprint at ${x}, ${z}`).toBe(Boolean(hit));
      if (hit) {
        expect(physical.hitPointWorld.y).toBeCloseTo(hit.point.y, 4);
        expect(bridgeHeight(bridge, x, z)).toBeCloseTo(hit.point.y, 4); hits++;
      }
    }
    expect(hits).toBeGreaterThan(70);
  });
  it('pushes a car overlapping a wall sideways instead of trapping it under the ground', () => {
    const terrain = flatTerrain(2000), world = createPhysics(false);
    world.addBody(terrainBody(terrain));
    const building: Building = {
      id: 'wall', height: 9, minHeight: 0, heightSource: 'height', source: 'osm',
      polygon: [[{ x: -10, z: -2.5 }, { x: 10, z: -2.5 }, { x: 10, z: 12 }, { x: -10, z: 12 }]],
    };
    world.addBody(buildingBody(building, terrain));
    const car = new CarPhysics(world, 0, -1.5, 0);
    let lowest = Infinity;
    for (let frame = 0; frame < 360; frame++) {
      car.update({ throttle: 0, brake: 1, steer: 0, handbrake: false }, FIXED_STEP);
      world.step(FIXED_STEP);
      lowest = Math.min(lowest, car.body.position.y);
    }
    expect(lowest).toBeGreaterThan(0.3);
    expect(car.body.position.z).toBeLessThan(-4.6);
    expect(car.vehicle.wheelInfos.every(wheel => wheel.isInContact)).toBe(true);
  });
  it('starts the walker on a real map with a matching interpolation pose', () => {
    const player = new Player(new THREE.Scene(), createPhysics(false), realMap(cityFixture()));
    expect(player.walker.previousPosition.almostEquals(player.walker.position, 1e-9)).toBe(true);
    for (const alpha of [0, 0.37, 0.81]) {
      player.sync(0, alpha);
      expect(player.person.group.position.y).toBeCloseTo(player.walker.position.y - 0.42, 9);
    }
  });
  it('allows opening the door in a courtyard inside a building bounding box', () => {
    const city = cityFixture();
    city.buildings = [{
      id: 'courtyard', height: 9, minHeight: 0, heightSource: 'height', source: 'osm',
      polygon: [[{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }],
        [{ x: -8, z: -8 }, { x: -8, z: 8 }, { x: 8, z: 8 }, { x: 8, z: -8 }]],
    }];
    const world = createPhysics(), map = realMap(city);
    world.addBody(buildingBody(city.buildings[0], city.terrain));
    const player = new Player(new THREE.Scene(), world, map);
    player.driving = true; world.removeBody(player.walker); player.car.reset(0, 0, 0);
    expect(player.interact()).toBeNull(); expect(player.driving).toBe(false);
    expect(player.walker.position.x).toBe(-2.5);
    expect(bodyOverlapsSphere(world.bodies[1], new CANNON.Vec3(12, 1, 0), 0.42)).toBe(true);
  });
  it('does not unload a parked car obstacles when the player walks into another sector', () => {
    const city = cityFixture(); const map = realMap(city), world = createPhysics(false), scene = new THREE.Scene();
    const urban = createRealCity(scene, world, map);
    const parked = new THREE.Vector3(0, 0, 0);
    const before = world.bodies.length;
    urban.update(0, 0, new THREE.Vector3(1000, 0, 1000), parked);
    expect(world.bodies.length).toBe(before);
    const boundaries = scene.children.filter(object => object.name === 'Limite visivel do recorte');
    expect(boundaries.length).toBeGreaterThan(4);
    for (const object of boundaries) {
      const bounds = new THREE.Box3().setFromObject(object);
      expect(world.bodies.some(body => {
        body.updateAABB();
        return Math.abs(body.aabb.lowerBound.x - bounds.min.x) < 0.001 && Math.abs(body.aabb.upperBound.z - bounds.max.z) < 0.001 &&
          Math.abs(body.aabb.upperBound.y - bounds.max.y) < 0.001;
      })).toBe(true);
    }
  });
  it('does not activate distant buildings because a water polygon spans their rendering sector', () => {
    const city = cityFixture();
    city.size = 1000; city.terrain = flatTerrain(1000);
    const polygon = [[{ x: 400, z: 400 }, { x: 410, z: 400 }, { x: 410, z: 410 }, { x: 400, z: 410 }]];
    city.buildings = [{ id: 'distant', height: 9, minHeight: 0, polygon, source: 'osm', heightSource: 'height' }];
    city.areas = [{ id: 'water', kind: 'water', polygon: [[{ x: 400, z: 400 }, { x: -400, z: 400 }, { x: -400, z: -400 }, { x: 400, z: -400 }]] }];
    const world = createPhysics(false), urban = createRealCity(new THREE.Scene(), world, realMap(city));
    urban.update(0, 0, new THREE.Vector3());
    expect([...urban.colliderLabels!.values()]).not.toContain('distant');
    urban.update(0, 0, new THREE.Vector3(390, 0, 390));
    expect([...urban.colliderLabels!.values()]).toContain('distant');
  });
});

describe('population and navigation dynamics', () => {
  it('has nonzero route segments even when input repeats its closing node', () => {
    const route = new LoopRoute([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 0 }]);
    expect(route.sample(0)).toEqual({ x: 0, z: 0, y: 0, yaw: Math.PI / 2 });
    expect(route.lengths.every(length => length > 0)).toBe(true);
    expect(() => new LoopRoute([{ x: 0, z: 0 }])).toThrow();
  });
  it('places traffic inside a lane rather than on the shared street centerline', () => {
    const city = cityFixture();
    city.buildings = [];
    const routes = geographicRoutes(city);
    expect(routes.cars.length).toBeGreaterThan(0);
    const top = routes.cars.flat().filter(point => Math.abs(point.x) < 70 && Math.abs(point.z + 100) < 10);
    expect(top.length).toBeGreaterThan(5);
    expect(top.every(point => point.z < -100 && point.z > -104)).toBe(true);
  });
  it('does not make traffic stop for a player on a different bridge level', () => {
    const city = cityFixture(), world = createPhysics(false), population = new Population(new THREE.Scene(), world, realMap(city));
    population.pedestrians = []; population.cars = [population.cars[0]];
    const car = population.cars[0];
    car.distance = 20;
    const origin = car.route.sample(20), ahead = car.route.sample(34);
    car.body.position.set(origin.x, origin.y + 0.82, origin.z);
    const player = new CANNON.Body({ position: new CANNON.Vec3(ahead.x, ahead.y + 15, ahead.z) });
    for (let i = 0; i < 180; i++) { population.update(FIXED_STEP, 0, player, new THREE.Vector3(origin.x, 0, origin.z), 0); world.step(FIXED_STEP); }
    expect(car.speed).toBeGreaterThan(3);
  });
  it('never leaves hidden population colliders active near the player', () => {
    const city = cityFixture(), world = createPhysics(false), population = new Population(new THREE.Scene(), world, realMap(city));
    const player = new CANNON.Body({ position: new CANNON.Vec3(1000, 0, 1000) });
    population.update(FIXED_STEP, 0, player, new THREE.Vector3(1000, 0, 1000), 0);
    population.render(new THREE.Vector3(1000, 0, 1000), player.position);
    expect(population.cars.every(car => !car.body.collisionResponse)).toBe(true);
    expect(population.pedestrians.every(person => person.model.group.visible === person.body.collisionResponse)).toBe(true);
  });
  it('can walk and drive for a sustained interval on a filtered sloped urban surface', () => {
    const city = cityFixture(); city.buildings = []; city.areas = [];
    city.terrain = urbanGround({ ...city.terrain, source: 'copernicus', heights: city.terrain.heights.map((_, i) => (i % (city.terrain.segments + 1)) * 0.4) });
    finishCity(city);
    const world = createPhysics(false), scene = new THREE.Scene(), map = realMap(city);
    const urban = createRealCity(scene, world, map), player = new Player(scene, world, map);
    player.driving = true; world.removeBody(player.walker);
    player.car.reset(-100, 0, Math.PI / 2, terrainHeight(city.terrain, -100, 0));
    const forward = { throttle: 1, brake: 0, steer: 0, handbrake: false };
    for (let i = 0; i < 420; i++) {
      player.focus.copy(player.car.body.position);
      urban.update(i / 60, 0, player.focus);
      player.update(forward, FIXED_STEP, 0); world.step(FIXED_STEP);
    }
    expect(player.car.body.position.x).toBeGreaterThan(-40);
    expect(player.car.body.position.y).toBeGreaterThan(terrainHeight(city.terrain, player.car.body.position.x, 0));
    expect(player.car.body.quaternion.w).toBeGreaterThan(0.65);
  });
});
