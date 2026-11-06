import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight } from '../geo/coordinates';
import { roadLanes, roadNetwork, roadOffsets, roadSegment } from '../geo/roads';
import type { Building, LocalPoint, Polygon, Road, Terrain } from '../geo/types';
import type { RealMapDefinition } from './map';
import type { City } from './city';

function shapeOf(polygon: Polygon): THREE.Shape {
  const shape = new THREE.Shape(polygon[0].map(point => new THREE.Vector2(point.x, -point.z)));
  shape.holes = polygon.slice(1).map(ring => new THREE.Path(ring.map(point => new THREE.Vector2(point.x, -point.z))));
  return shape;
}
function baseHeight(building: Building, terrain: Terrain): number {
  return Math.min(...building.polygon[0].map(point => terrainHeight(terrain, point.x, point.z)));
}

// Clip each surface triangle to the terrain grid so roads cannot cut through hills.
export function drapedGeometry(polygon: Polygon, terrain: Terrain, offset: number): THREE.BufferGeometry {
  const rings = polygon.map(ring => {
    const points = ring.map(point => new THREE.Vector2(point.x, point.z));
    if (points.length && points[0].equals(points.at(-1)!)) points.pop();
    return points;
  });
  const triangles = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1));
  const points = rings.flat().map(point => ({ x: point.x, z: point.y }));
  const positions: number[] = [];
  const n = terrain.segments, step = terrain.size / n, half = terrain.size / 2;
  const clip = (subject: LocalPoint[], triangle: LocalPoint[]) => {
    let result = subject;
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge], b = triangle[(edge + 1) % 3];
      const cross = (p: LocalPoint) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
      const source = result; result = [];
      for (let i = 0; i < source.length; i++) {
        const from = source[i], to = source[(i + 1) % source.length], d0 = cross(from), d1 = cross(to);
        if (d0 <= 1e-8) result.push(from);
        if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
          const t = d0 / (d0 - d1);
          result.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
        }
      }
    }
    return result;
  };
  for (const indices of triangles) {
    const triangle = indices.map(index => points[index]);
    const xs = triangle.map(point => (point.x + half) / step), ys = triangle.map(point => (half - point.z) / step);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(n - 1, Math.floor(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(n - 1, Math.floor(Math.max(...xs))); x++) {
        const a = { x: -half + x * step, z: half - y * step }, b = { x: a.x + step, z: a.z };
        const c = { x: a.x, z: a.z - step }, d = { x: b.x, z: c.z };
        for (const cell of [[a, b, c], [b, d, c]]) {
          const clipped = clip(triangle, cell);
          for (let i = 1; i < clipped.length - 1; i++) {
            const vertices = [clipped[0], clipped[i], clipped[i + 1]];
            const [p, q, r] = vertices;
            const area = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
            if (Math.abs(area) < 1e-8) continue;
            if (area > 0) vertices.reverse();
            for (const point of vertices) positions.push(point.x, terrainHeight(terrain, point.x, point.z) + offset, point.z);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function terrainGeometry(terrain: Terrain): THREE.BufferGeometry {
  const n = terrain.segments, positions: number[] = [], indices: number[] = [], uvs: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    positions.push((i / n - 0.5) * terrain.size, terrain.heights[j * (n + 1) + i], (0.5 - j / n) * terrain.size);
    uvs.push(i / n, j / n);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function terrainBody(terrain: Terrain): CANNON.Body {
  const n = terrain.segments;
  const data = Array.from({ length: n + 1 }, (_, x) => Array.from({ length: n + 1 }, (_, y) => terrain.heights[y * (n + 1) + x]));
  const body = new CANNON.Body({ mass: 0, shape: new GroundHeightfield(data, { elementSize: terrain.size / n }) });
  body.position.set(-terrain.size / 2, 0, terrain.size / 2);
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  body.aabbNeedsUpdate = true;
  return body;
}

export class GroundHeightfield extends CANNON.Heightfield {
  override getAabbAtIndex(x: number, y: number, bounds: CANNON.AABB): void {
    // Cannon uses only diagonal endpoints here, missing short suspension rays
    // in descending or saddle-shaped cells. All four heights must bound a cell.
    const heights = [this.data[x][y], this.data[x + 1][y], this.data[x][y + 1], this.data[x + 1][y + 1]];
    bounds.lowerBound.set(x * this.elementSize, y * this.elementSize, Math.min(...heights));
    bounds.upperBound.set((x + 1) * this.elementSize, (y + 1) * this.elementSize, Math.max(...heights));
  }
}

export function surfaceBody(geometry: THREE.BufferGeometry, depth: number): CANNON.Body {
  const positions = geometry.getAttribute('position'), indices = geometry.getIndex();
  const count = indices ? indices.count : positions.count;
  const origin = new CANNON.Vec3(positions.getX(0), positions.getY(0), positions.getZ(0));
  const body = new CANNON.Body({ mass: 0, position: origin });
  for (let i = 0; i < count; i += 3) {
    let [a, b, c] = [i, i + 1, i + 2].map(value => new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(value) : value));
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(area) < 1e-8) continue;
    if (area < 0) [b, c] = [c, b];
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3); center.y -= depth / 2;
    const vertices = [-depth, 0].flatMap(level => [a, b, c].map(point => new CANNON.Vec3(point.x - center.x, point.y + level - center.y, point.z - center.z)));
    body.addShape(new CANNON.ConvexPolyhedron({ vertices, faces: [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]] }),
      new CANNON.Vec3(center.x - origin.x, center.y - origin.y, center.z - origin.z));
  }
  return body;
}

// Colliders reach below the ground: with the bottom face at ground level, a car
// overlapping a wall is resolved downward and trapped under the terrain.
export const BUILDING_FOUNDATION = 4;

export function buildingBody(building: Building, terrain: Terrain): CANNON.Body {
  const roof = new THREE.ShapeGeometry(shapeOf(building.polygon));
  roof.rotateX(-Math.PI / 2);
  roof.translate(0, baseHeight(building, terrain) + building.height, 0);
  // Gaps lower than a car cannot be driven through, so they are closed as well.
  const bottom = building.minHeight < 2.5 ? -BUILDING_FOUNDATION : building.minHeight;
  const body = surfaceBody(roof, building.height - bottom);
  roof.dispose();
  return body;
}

export function bridgeGeometry(road: import('../geo/types').Road, index: number, offsets = roadOffsets(road)): THREE.BufferGeometry {
  const polygon = roadSegment(road, index, offsets);
  const corners = polygon[0], positions = corners.flatMap((point, i) => [point.x, road.heights[i < 2 ? index - 1 : index], point.z]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 3, 1, 1, 3, 2]); geometry.computeVertexNormals();
  return geometry;
}

export function roadGeometry(road: Road, index: number, terrain: Terrain, offsets = roadOffsets(road), start = 0, limits = [-1e8, 1e8]): THREE.BufferGeometry {
  const geometry = road.bridge ? bridgeGeometry(road, index, offsets) : drapedGeometry(roadSegment(road, index, offsets), terrain, 0.025);
  const positions = geometry.getAttribute('position');
  const paint = new Float32Array(positions.count * 4), separation = new Float32Array(positions.count * 4);
  const lanes = roadLanes(road), laneWidth = road.width / lanes;
  if (road.drive && !road.tunnel && road.laneMarkings !== false && laneWidth >= 2.5) {
    const corners = roadSegment(road, index, offsets)[0];
    const length = Math.hypot(road.points[index].x - road.points[index - 1].x, road.points[index].z - road.points[index - 1].z);
    const forward = road.lanesForward && road.lanesForward < lanes ? road.lanesForward : Math.ceil(lanes / 2);
    const divider = road.oneway === 0 && lanes > 1 ? road.width / 2 - forward * laneWidth : 1e5;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex), z = positions.getZ(vertex);
      for (const indices of [[0, 3, 1], [1, 3, 2]]) {
        const [first, second, third] = indices.map(corner => corners[corner]);
        const denominator = (second.z - third.z) * (first.x - third.x) + (third.x - second.x) * (first.z - third.z);
        if (Math.abs(denominator) < 1e-8) continue;
        const weightFirst = ((second.z - third.z) * (x - third.x) + (third.x - second.x) * (z - third.z)) / denominator;
        const weightSecond = ((third.z - first.z) * (x - third.x) + (first.x - third.x) * (z - third.z)) / denominator;
        const weights = [weightFirst, weightSecond, 1 - weightFirst - weightSecond];
        if (Math.min(...weights) < -0.002 && indices[0] === 0) continue;
        let across = 0, along = start;
        indices.forEach((corner, offset) => {
          across += weights[offset] * (corner === 0 || corner === 3 ? road.width / 2 : -road.width / 2);
          if (corner >= 2) along += weights[offset] * length;
        });
        paint.set([across, along, laneWidth, lanes], vertex * 4);
        separation.set([divider, road.width, limits[0], limits[1]], vertex * 4);
        break;
      }
    }
  }
  geometry.setAttribute('roadPaint', new THREE.BufferAttribute(paint, 4));
  geometry.setAttribute('roadSeparation', new THREE.BufferAttribute(separation, 4));
  return geometry;
}

function paintRoads(material: THREE.MeshStandardMaterial): void {
  material.customProgramCacheKey = () => 'road-paint-v1';
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 roadPaint;
attribute vec4 roadSeparation;
varying vec4 vRoadPaint;
varying vec4 vRoadSeparation;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vRoadPaint = roadPaint;
vRoadSeparation = roadSeparation;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec4 vRoadPaint;
varying vec4 vRoadSeparation;`).replace('#include <color_fragment>', `#include <color_fragment>
if (vRoadPaint.w > 0.5 && vRoadPaint.y > vRoadSeparation.z && vRoadPaint.y < vRoadSeparation.w) {
  float across = vRoadPaint.x;
  float laneWidth = vRoadPaint.z;
  float width = vRoadSeparation.y;
  float antialias = max(fwidth(across), 0.015);
  float edge = abs(abs(across) - (width * 0.5 - 0.18));
  float boundary = floor((across + width * 0.5) / laneWidth + 0.5);
  float lane = abs(across + width * 0.5 - boundary * laneWidth);
  float white = 1.0 - smoothstep(0.06, 0.06 + antialias, edge);
  if (boundary > 0.5 && boundary < vRoadPaint.w - 0.5 && mod(vRoadPaint.y, 6.0) < 3.0 && abs(across - vRoadSeparation.x) > 0.3)
    white = max(white, 1.0 - smoothstep(0.06, 0.06 + antialias, lane));
  float yellow = 1.0 - smoothstep(0.05, 0.05 + antialias, abs(abs(across - vRoadSeparation.x) - 0.12));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88), white);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.65, 0.035), yellow);
}`);
  };
}

export function createRealCity(scene: THREE.Scene, world: CANNON.World, map: RealMapDefinition, texture?: THREE.Texture): City {
  const { data } = map;
  const terrain = data.terrain;
  const colliders: CANNON.Body[] = [];
  const colliderLabels = new Map<number, string>();
  const ground = terrainBody(terrain);
  ground.material = world.defaultMaterial;
  world.addBody(ground); colliders.push(ground);
  colliderLabels.set(ground.id, 'terrain');
  const groundMesh = new THREE.Mesh(terrainGeometry(terrain), new THREE.MeshStandardMaterial({ color: texture ? 0xffffff : 0xb4b49a, map: texture ?? null, roughness: 1 }));
  groundMesh.receiveShadow = true; scene.add(groundMesh);
  const chunks = new Map<string, { group: THREE.Group; bounds: THREE.Box3; collisionBounds: THREE.Box3; parts: Map<number, THREE.BufferGeometry[]>; buildings: Building[]; built: number; bodies: CANNON.Body[]; labels: Map<CANNON.Body, string>; active: boolean }>();
  const chunkAt = (x: number, z: number) => {
    const key = `${Math.floor(x / 128)}:${Math.floor(z / 128)}`;
    if (!chunks.has(key)) chunks.set(key, { group: new THREE.Group(), bounds: new THREE.Box3(), collisionBounds: new THREE.Box3(), parts: new Map(), buildings: [], built: 0, bodies: [], labels: new Map(), active: false });
    return chunks.get(key)!;
  };
  type Chunk = ReturnType<typeof chunkAt>;
  const buildNext = (chunk: Chunk) => {
    const building = chunk.buildings[chunk.built++];
    const body = buildingBody(building, terrain);
    chunk.labels.set(body, building.id); chunk.bodies.push(body);
  };
  const addStatic = (body: CANNON.Body, label: string, x: number, z: number) => {
    const chunk = chunkAt(x, z);
    body.updateAABB();
    chunk.collisionBounds.expandByPoint(new THREE.Vector3(body.aabb.lowerBound.x, body.aabb.lowerBound.y, body.aabb.lowerBound.z));
    chunk.collisionBounds.expandByPoint(new THREE.Vector3(body.aabb.upperBound.x, body.aabb.upperBound.y, body.aabb.upperBound.z));
    chunk.bodies.push(body); chunk.labels.set(body, label);
  };
  const add = (geometry: THREE.BufferGeometry, color: number, x: number, z: number) => {
    const chunk = chunkAt(x, z);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    if (color !== 0x505c60 && color !== 0xbeb9a3) {
      flat.deleteAttribute('roadPaint'); flat.deleteAttribute('roadSeparation');
    }
    for (const name of color === 0x505c60 || color === 0xbeb9a3 ? ['roadPaint', 'roadSeparation'] : []) {
      if (!flat.hasAttribute(name)) flat.setAttribute(name, new THREE.BufferAttribute(new Float32Array(flat.getAttribute('position').count * 4), 4));
    }
    if (flat !== geometry) geometry.dispose();
    const parts = chunk.parts.get(color) ?? []; parts.push(flat); chunk.parts.set(color, parts);
  };
  for (const area of data.areas) {
    const geometry = drapedGeometry(area.polygon, terrain, 0.04);
    const point = area.polygon[0][0];
    add(geometry, area.kind === 'water' ? 0x448f9a : area.kind === 'paved' ? 0xcbbfa6 : 0x739767, point.x, point.z);
  }
  const network = roadNetwork(data.roads);
  for (const road of data.roads) {
    if (road.tunnel) continue;
    const { offsets, junctions } = network.get(road)!;
    const distances = [0];
    for (let index = 1; index < road.points.length; index++) distances.push(distances[index - 1] + Math.hypot(road.points[index].x - road.points[index - 1].x, road.points[index].z - road.points[index - 1].z));
    const crossings = [...junctions].map(([index, radius]) => ({ distance: distances[index], radius })).sort((first, second) => first.distance - second.distance);
    let crossingIndex = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.01) continue;
      const midpoint = (distances[i - 1] + distances[i]) / 2;
      while (crossingIndex < crossings.length && crossings[crossingIndex].distance <= midpoint) crossingIndex++;
      const before = crossings[crossingIndex - 1];
      const after = crossings[crossingIndex];
      const geometry = roadGeometry(road, i, terrain, offsets, distances[i - 1], [before ? before.distance + before.radius : -1e8, after ? after.distance - after.radius : 1e8]);
      if (road.bridge) {
        const body = surfaceBody(geometry, 0.3);
        body.collisionFilterGroup = 2;
        addStatic(body, road.id, (a.x + b.x) / 2, (a.z + b.z) / 2);
      }
      add(geometry, road.kind === 'waterway' ? 0x448f9a : road.surface === 'paving_stones' || !road.drive ? 0xbeb9a3 : 0x505c60, (a.x + b.x) / 2, (a.z + b.z) / 2);
    }
  }
  for (const building of data.buildings) {
    const geometry = new THREE.ExtrudeGeometry(shapeOf(building.polygon), { depth: building.height - building.minHeight, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, baseHeight(building, terrain) + building.minHeight, 0);
    const point = building.polygon[0][0];
    const palette = [0xd6cabb, 0xe2c4ac, 0xced4bd, 0xdbc2bb, 0xc4d2d0, 0xd9cfaf];
    const hash = [...building.id].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
    add(geometry, building.color ? new THREE.Color(building.color).getHex() : palette[hash % palette.length], point.x, point.z);
    const roof = new THREE.ShapeGeometry(shapeOf(building.polygon));
    roof.rotateX(-Math.PI / 2); roof.translate(0, baseHeight(building, terrain) + building.height + 0.015, 0);
    add(roof, 0x8c8175, point.x, point.z);
    const chunk = chunkAt(point.x, point.z), base = baseHeight(building, terrain);
    chunk.buildings.push(building);
    for (const point of building.polygon[0]) {
      chunk.collisionBounds.expandByPoint(new THREE.Vector3(point.x, base + building.minHeight, point.z));
      chunk.collisionBounds.expandByPoint(new THREE.Vector3(point.x, base + building.height, point.z));
    }
  }
  const material = new Map<number, THREE.MeshStandardMaterial>();
  for (const chunk of chunks.values()) {
    for (const [color, parts] of chunk.parts) {
      const geometry = mergeGeometries(parts);
      parts.forEach(part => part.dispose());
      if (!geometry) throw new Error('Falha ao agrupar geometria da cidade.');
      if (!material.has(color)) {
        const layer = color === 0x505c60 ? 3 : [0xcbbfa6, 0xbeb9a3].includes(color) ? 2 : [0x448f9a, 0x739767, 0x8c8175].includes(color) ? 1 : 0;
        material.set(color, new THREE.MeshStandardMaterial({
          color, roughness: 0.9, side: THREE.DoubleSide,
          polygonOffset: layer > 0, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer,
        }));
        if (color === 0x505c60 || color === 0xbeb9a3) paintRoads(material.get(color)!);
      }
      const mesh = new THREE.Mesh(geometry, material.get(color));
      mesh.castShadow = ![0x448f9a, 0x739767, 0xcbbfa6, 0xbeb9a3, 0x505c60].includes(color); mesh.receiveShadow = true;
      chunk.group.add(mesh);
    }
    chunk.parts.clear();
    chunk.bounds.setFromObject(chunk.group);
    scene.add(chunk.group);
  }
  const edge = map.extent;
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xdca655, roughness: 0.85 });
  const segments = Math.ceil(data.size / 30), step = data.size / segments;
  for (const side of [-1, 1]) for (let index = 0; index < segments; index++) for (const axis of ['x', 'z'] as const) {
    const start = -edge + index * step, end = start + step, along = (start + end) / 2;
    const x = axis === 'x' ? side * edge : along, z = axis === 'z' ? side * edge : along;
    const elevations = [start, along, end].map(value => terrainHeight(terrain, axis === 'x' ? x : value, axis === 'z' ? z : value));
    const bottom = Math.min(...elevations) - 0.2, top = Math.max(...elevations) + 1.4;
    const width = axis === 'x' ? 0.6 : step + 0.02, depth = axis === 'z' ? 0.6 : step + 0.02;
    const body = new CANNON.Body({ mass: 0, material: world.defaultMaterial, shape: new CANNON.Box(new CANNON.Vec3(width / 2, (top - bottom) / 2, depth / 2)) });
    body.position.set(x, (bottom + top) / 2, z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, top - bottom, depth), barrierMaterial);
    mesh.name = 'Limite visivel do recorte'; mesh.position.copy(body.position); mesh.receiveShadow = true;
    scene.add(mesh); addStatic(body, 'boundary', x, z);
  }
  // Only colliders near the player or the parked car take part in the simulation;
  // building colliders of approaching sectors are prepared in small time slices.
  const update = (_seconds: number, _night: number, focus: THREE.Vector3, parkedCar?: THREE.Vector3) => {
    const pending: Chunk[] = [];
    for (const chunk of chunks.values()) {
      const distance = chunk.bounds.distanceToPoint(focus);
      const carDistance = parkedCar ? chunk.bounds.distanceToPoint(parkedCar) : Infinity;
      chunk.group.visible = Math.min(distance, carDistance) < 850;
      const collisionDistance = Math.min(chunk.collisionBounds.distanceToPoint(focus), parkedCar ? chunk.collisionBounds.distanceToPoint(parkedCar) : Infinity);
      const active = (chunk.buildings.length > 0 || chunk.bodies.length > 0) && collisionDistance < 260;
      if (!active && collisionDistance < 480 && chunk.built < chunk.buildings.length) pending.push(chunk);
      if (active === chunk.active) continue;
      chunk.active = active;
      if (active) {
        while (chunk.built < chunk.buildings.length) buildNext(chunk);
        chunk.bodies.forEach(body => { world.addBody(body); colliders.push(body); colliderLabels.set(body.id, chunk.labels.get(body)!); });
      } else {
        chunk.bodies.forEach(body => { world.removeBody(body); colliders.splice(colliders.indexOf(body), 1); colliderLabels.delete(body.id); });
      }
    }
    const deadline = performance.now() + 1;
    for (const chunk of pending) while (chunk.built < chunk.buildings.length && performance.now() < deadline) buildNext(chunk);
  };
  update(0, 0, new THREE.Vector3(map.spawn.x, 0, map.spawn.z));
  return { colliders, colliderLabels, update };
}
