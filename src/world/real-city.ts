import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { staticBox } from '../core/physics';
import { terrainHeight } from '../geo/coordinates';
import type { Building, LocalPoint, Polygon, Terrain } from '../geo/types';
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
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Heightfield(data, { elementSize: terrain.size / n }) });
  body.position.set(-terrain.size / 2, 0, terrain.size / 2);
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  body.aabbNeedsUpdate = true;
  return body;
}

export function buildingBody(building: Building, terrain: Terrain): CANNON.Body {
  const rings = building.polygon.map(ring => {
    const points = ring.map(point => new THREE.Vector2(point.x, point.z));
    if (points.length && points[0].equals(points.at(-1)!)) points.pop();
    return points;
  });
  const triangles = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1));
  const points = rings.flat();
  const origin = points[0];
  const y = baseHeight(building, terrain) + building.minHeight;
  const height = building.height - building.minHeight;
  const body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(origin.x, y, origin.y) });
  for (const triangle of triangles) {
    let [a, b, c] = triangle.map(index => points[index]);
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) [b, c] = [c, b];
    const centerX = (a.x + b.x + c.x) / 3, centerZ = (a.y + b.y + c.y) / 3;
    const vertices = [-height / 2, height / 2].flatMap(level => [a, b, c].map(point => new CANNON.Vec3(point.x - centerX, level, point.y - centerZ)));
    body.addShape(new CANNON.ConvexPolyhedron({ vertices, faces: [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]] }),
      new CANNON.Vec3(centerX - origin.x, height / 2, centerZ - origin.y));
  }
  return body;
}

export function createRealCity(scene: THREE.Scene, world: CANNON.World, map: RealMapDefinition, texture?: THREE.Texture): City {
  const { data } = map;
  const terrain = data.terrain;
  const colliders: CANNON.Body[] = [];
  const ground = terrainBody(terrain);
  ground.material = world.defaultMaterial;
  world.addBody(ground); colliders.push(ground);
  const groundMesh = new THREE.Mesh(terrainGeometry(terrain), new THREE.MeshStandardMaterial({ color: texture ? 0xffffff : 0xb4b49a, map: texture ?? null, roughness: 1 }));
  groundMesh.receiveShadow = true; scene.add(groundMesh);
  const chunks = new Map<string, { group: THREE.Group; bounds: THREE.Box3; parts: Map<number, THREE.BufferGeometry[]>; buildings: Building[]; bodies: CANNON.Body[]; active: boolean }>();
  const chunkAt = (x: number, z: number) => {
    const key = `${Math.floor(x / 128)}:${Math.floor(z / 128)}`;
    if (!chunks.has(key)) chunks.set(key, { group: new THREE.Group(), bounds: new THREE.Box3(), parts: new Map(), buildings: [], bodies: [], active: false });
    return chunks.get(key)!;
  };
  const add = (geometry: THREE.BufferGeometry, color: number, x: number, z: number) => {
    const chunk = chunkAt(x, z);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    if (flat !== geometry) geometry.dispose();
    const parts = chunk.parts.get(color) ?? []; parts.push(flat); chunk.parts.set(color, parts);
  };
  for (const area of data.areas) {
    const geometry = drapedGeometry(area.polygon, terrain, 0.04);
    const point = area.polygon[0][0];
    add(geometry, area.kind === 'water' ? 0x448f9a : 0x739767, point.x, point.z);
  }
  for (const road of data.roads) {
    if (road.tunnel) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.01) continue;
      const offsetAt = (index: number) => {
        const point = road.points[index], previous = road.points[Math.max(0, index - 1)], next = road.points[Math.min(road.points.length - 1, index + 1)];
        const beforeLength = Math.hypot(point.x - previous.x, point.z - previous.z);
        const afterLength = Math.hypot(next.x - point.x, next.z - point.z);
        const nx = beforeLength ? (point.z - previous.z) / beforeLength : (b.z - a.z) / length;
        const nz = beforeLength ? -(point.x - previous.x) / beforeLength : -(b.x - a.x) / length;
        const mx = nx + (afterLength ? (next.z - point.z) / afterLength : nx);
        const mz = nz + (afterLength ? -(next.x - point.x) / afterLength : nz);
        const magnitude = Math.hypot(mx, mz);
        if (magnitude < 0.01) return { x: nx * road.width / 2, z: nz * road.width / 2 };
        const factor = Math.min(road.width, road.width / 2 / Math.max(0.1, (mx * nx + mz * nz) / magnitude)) / magnitude;
        return { x: mx * factor, z: mz * factor };
      };
      const startOffset = offsetAt(i - 1), endOffset = offsetAt(i);
      const corners = [[a.x + startOffset.x, a.z + startOffset.z, i - 1], [a.x - startOffset.x, a.z - startOffset.z, i - 1], [b.x + endOffset.x, b.z + endOffset.z, i], [b.x - endOffset.x, b.z - endOffset.z, i]];
      const positions = corners.flatMap(([x, z, index]) => [x, (road.bridge ? road.heights[index] : terrainHeight(terrain, x, z)) + 0.07, z]);
      const geometry = road.bridge ? new THREE.BufferGeometry() : drapedGeometry([[corners[0], corners[1], corners[3], corners[2]].map(([x, z]) => ({ x, z }))], terrain, 0.07);
      if (road.bridge) {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex([0, 2, 1, 1, 2, 3]); geometry.computeVertexNormals();
      }
      add(geometry, road.kind === 'waterway' ? 0x448f9a : road.drive ? 0x505c60 : 0xbeb9a3, (a.x + b.x) / 2, (a.z + b.z) / 2);
      if (road.bridge) {
        const rise = road.heights[i] - road.heights[i - 1];
        const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(road.width / 2, 0.15, Math.hypot(length, rise) / 2 + 0.05)) });
        body.position.set((a.x + b.x) / 2, (road.heights[i] + road.heights[i - 1]) / 2 - 0.15, (a.z + b.z) / 2);
        body.quaternion.setFromEuler(-Math.atan2(rise, length), Math.atan2(b.x - a.x, b.z - a.z), 0, 'YXZ');
        body.collisionFilterGroup = 2;
        body.aabbNeedsUpdate = true;
        world.addBody(body); colliders.push(body);
      }
    }
  }
  for (const building of data.buildings) {
    const geometry = new THREE.ExtrudeGeometry(shapeOf(building.polygon), { depth: building.height - building.minHeight, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, baseHeight(building, terrain) + building.minHeight, 0);
    const point = building.polygon[0][0];
    add(geometry, building.source === 'osm' ? 0xd6cabb : 0xb5c4c7, point.x, point.z);
    chunkAt(point.x, point.z).buildings.push(building);
  }
  const material = new Map<number, THREE.MeshStandardMaterial>();
  for (const chunk of chunks.values()) {
    for (const [color, parts] of chunk.parts) {
      const geometry = mergeGeometries(parts);
      parts.forEach(part => part.dispose());
      if (!geometry) throw new Error('Falha ao agrupar geometria da cidade.');
      if (!material.has(color)) material.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }));
      const mesh = new THREE.Mesh(geometry, material.get(color));
      mesh.castShadow = color === 0xd6cabb || color === 0xb5c4c7; mesh.receiveShadow = true;
      chunk.group.add(mesh);
    }
    chunk.parts.clear();
    chunk.bounds.setFromObject(chunk.group);
    scene.add(chunk.group);
  }
  const top = Math.max(...terrain.heights) + 10;
  const edge = map.extent;
  colliders.push(
    staticBox(world, -edge, top / 2, 0, 2, top, edge * 2), staticBox(world, edge, top / 2, 0, 2, top, edge * 2),
    staticBox(world, 0, top / 2, -edge, edge * 2, top, 2), staticBox(world, 0, top / 2, edge, edge * 2, top, 2),
  );
  const update = (_seconds: number, _night: number, focus: THREE.Vector3) => {
    for (const chunk of chunks.values()) {
      const distance = chunk.bounds.distanceToPoint(focus);
      chunk.group.visible = distance < 850;
      const active = distance < 260;
      if (active === chunk.active) continue;
      chunk.active = active;
      if (active) {
        chunk.bodies = chunk.buildings.map(building => buildingBody(building, terrain));
        chunk.bodies.forEach(body => world.addBody(body));
      } else {
        chunk.bodies.forEach(body => world.removeBody(body));
        chunk.bodies = [];
      }
    }
  };
  update(0, 0, new THREE.Vector3(map.spawn.x, 0, map.spawn.z));
  return { colliders, update };
}
