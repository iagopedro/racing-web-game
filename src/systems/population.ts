import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { roundedLoop, seeded, signalAllows } from '../world/map';
import type { MapDefinition, Point } from '../world/map';
import { carGeometries, glassMaterial, trimMaterial, headlightMaterial, tailMaterial, tireGeometry, tireMaterial, createPerson, animatePerson } from '../world/models';
import type { PersonModel } from '../world/models';
import { geographicRoutes } from '../geo/routes';

export class LoopRoute {
  points: (Point & { y?: number })[];
  lengths: number[];
  length: number;
  constructor(points: (Point & { y?: number })[]) {
    this.points = points;
    this.lengths = points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.hypot(next.x - point.x, next.z - point.z);
    });
    this.length = this.lengths.reduce((sum, length) => sum + length, 0);
  }
  sample(distance: number): Point & { yaw: number; y: number } {
    let remaining = ((distance % this.length) + this.length) % this.length;
    for (let index = 0; index < this.points.length; index++) {
      if (remaining <= this.lengths[index]) {
        const point = this.points[index];
        const next = this.points[(index + 1) % this.points.length];
        const fraction = remaining / this.lengths[index];
        return { x: point.x + (next.x - point.x) * fraction, z: point.z + (next.z - point.z) * fraction, y: (point.y ?? 0) + ((next.y ?? 0) - (point.y ?? 0)) * fraction, yaw: Math.atan2(next.x - point.x, next.z - point.z) };
      }
      remaining -= this.lengths[index];
    }
    return { ...this.points[0], y: this.points[0].y ?? 0, yaw: 0 };
  }
}

export interface TrafficCar {
  body: CANNON.Body;
  route: LoopRoute;
  distance: number;
  speed: number;
  cruise: number;
  yaw: number;
  pause: number;
  active: boolean;
  traveled: number;
}

export interface Pedestrian {
  model: PersonModel;
  body: CANNON.Body;
  route: LoopRoute;
  distance: number;
  speed: number;
  direction: number;
  phase: number;
  crossing: boolean;
  moved: number;
}

export class Population {
  cars: TrafficCar[] = [];
  pedestrians: Pedestrian[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private wheels: THREE.InstancedMesh;
  private transform = new THREE.Object3D();
  private map: MapDefinition;

  constructor(scene: THREE.Scene, world: CANNON.World, map: MapDefinition) {
    this.map = map;
    const random = seeded(41);
    const realRoutes = map.kind === 'real' ? geographicRoutes(map.data) : undefined;
    const count = realRoutes ? realRoutes.cars.length : 30;
    const colors = [0xe9d9b8, 0xd68361, 0x5c8798, 0xb7b9a1, 0x8c5451, 0x46685f, 0xd9b154];
    const materials = [new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2 }), glassMaterial, trimMaterial, headlightMaterial, tailMaterial];
    Object.values(carGeometries).forEach((geometry, index) => {
      const mesh = new THREE.InstancedMesh(geometry, materials[index], count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (index === 0) {
        for (let car = 0; car < count; car++) mesh.setColorAt(car, new THREE.Color(colors[car % colors.length]));
      }
      this.meshes.push(mesh);
      scene.add(mesh);
    });
    this.wheels = new THREE.InstancedMesh(tireGeometry, tireMaterial, count * 4);
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheels.frustumCulled = false;
    scene.add(this.wheels);
    for (let index = 0; index < count; index++) {
      const column = index % 5;
      const row = Math.floor(index / 5) % 5;
      const route = new LoopRoute(map.kind === 'grid' ? roundedLoop(map.roads[column] + 4.2, map.roads[row] + 4.2, map.roads[Math.min(5, column + (index >= 25 ? 2 : 1))] - 4.2, map.roads[row + 1] - 4.2, 10) : realRoutes!.cars[index]);
      const distance = route.length * random();
      const point = route.sample(distance);
      const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, allowSleep: false, shape: new CANNON.Box(new CANNON.Vec3(0.94, 0.68, 2.1)), position: new CANNON.Vec3(point.x, point.y + 0.82, point.z) });
      body.quaternion.setFromEuler(0, point.yaw, 0);
      body.aabbNeedsUpdate = true;
      world.addBody(body);
      const car: TrafficCar = { body, route, distance, speed: 0, cruise: 6.5 + random() * 4, yaw: point.yaw, pause: 0, active: true, traveled: 0 };
      body.addEventListener('collide', (event: { body: CANNON.Body }) => {
        if (event.body.type === CANNON.Body.DYNAMIC) car.pause = 1.5;
      });
      this.cars.push(car);
    }

    for (let index = 0; index < (realRoutes ? realRoutes.pedestrians.length : 64); index++) {
      const column = index % 5;
      const row = Math.floor(index / 5) % 5;
      const crossStreet = index % 4 === 0 && column < 4;
      const rightColumn = column + (crossStreet ? 2 : 1);
      const route = new LoopRoute(map.kind === 'grid'
        ? roundedLoop(map.roads[column] + 12, map.roads[row] + 12, map.roads[rightColumn] - 12, map.roads[row + 1] - 12, 1)
        : realRoutes!.pedestrians[index]);
      const person = createPerson([0xd4a15b, 0xc36655, 0x8db6a6, 0xe9ddc9, 0x5e829d][index % 5], [0xbb8765, 0x805b49, 0xd6ac87][index % 3]);
      scene.add(person.group);
      const distance = random() * route.length;
      const point = route.sample(distance);
      person.group.position.set(point.x, point.y + 0.17, point.z);
      const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, allowSleep: false, shape: new CANNON.Sphere(0.35), position: new CANNON.Vec3(point.x, point.y + 0.65, point.z) });
      world.addBody(body);
      this.pedestrians.push({ model: person, body, route, distance, speed: 0.9 + random() * 0.65, direction: index % 2 ? 1 : -1, phase: random() * 6, crossing: false, moved: 0 });
    }
  }

  update(delta: number, seconds: number, player: CANNON.Body, focus: THREE.Vector3, night: number, walker?: CANNON.Body): void {
    for (let index = 0; index < this.cars.length; index++) {
      const car = this.cars[index];
      const distanceToPlayer = Math.hypot(car.body.position.x - focus.x, car.body.position.z - focus.z);
      if (distanceToPlayer > 230) car.active = index < (night > 0.7 ? 17 : 30);
      car.body.collisionResponse = car.active;
      if (!car.active) { car.body.velocity.setZero(); continue; }
      car.pause = Math.max(0, car.pause - delta);
      const point = car.route.sample(car.distance);
      const directionX = Math.sin(point.yaw);
      const directionZ = Math.cos(point.yaw);
      let desired = car.pause > 0 ? 0 : car.cruise;
      const axis = Math.abs(directionX) > 0.8 ? 'x' : 'z';
      const position = axis === 'x' ? point.x : point.z;
      const sign = axis === 'x' ? Math.sign(directionX) : Math.sign(directionZ);
      if (this.map.kind === 'grid' && !signalAllows(axis, seconds)) {
        for (const road of this.map.roads) {
          const ahead = (road - position) * sign;
          if (ahead > 8 && ahead < 38) desired = Math.min(desired, Math.sqrt(Math.max(0, (ahead - 15) * 5)));
        }
      }
      const avoid = (obstacleX: number, obstacleZ: number, width: number) => {
        const offsetX = obstacleX - point.x;
        const offsetZ = obstacleZ - point.z;
        const ahead = offsetX * directionX + offsetZ * directionZ;
        const across = Math.abs(offsetX * directionZ - offsetZ * directionX);
        if (ahead > 0 && ahead < 26 && across < width) desired = Math.min(desired, Math.max(0, (ahead - 7) * 0.8));
      };
      avoid(player.position.x, player.position.z, 2.7);
      if (walker) avoid(walker.position.x, walker.position.z, 1.5);
      for (const other of this.cars) {
        if (other !== car && other.active) avoid(other.body.position.x, other.body.position.z, 2.3);
      }
      for (const pedestrian of this.pedestrians) {
        if (pedestrian.crossing) avoid(pedestrian.model.group.position.x, pedestrian.model.group.position.z, 1.8);
      }
      car.speed = THREE.MathUtils.damp(car.speed, desired, desired < car.speed ? 5 : 1.2, delta);
      car.distance = (car.distance + car.speed * delta) % car.route.length;
      car.traveled += car.speed * delta;
      const next = car.route.sample(car.distance);
      car.body.velocity.set((next.x - car.body.position.x) / delta, (next.y + 0.82 - car.body.position.y) / delta, (next.z - car.body.position.z) / delta);
      const yawDelta = Math.atan2(Math.sin(next.yaw - car.yaw), Math.cos(next.yaw - car.yaw));
      car.yaw += yawDelta * Math.min(1, delta * 9);
      car.body.quaternion.setFromEuler(0, car.yaw, 0);
      car.body.aabbNeedsUpdate = true;
    }

    for (const pedestrian of this.pedestrians) {
      const group = pedestrian.model.group;
      const point = pedestrian.route.sample(pedestrian.distance);
      const upcoming = pedestrian.route.sample(pedestrian.distance + pedestrian.direction * 3);
      const insideRoad = (candidate: Point) => this.map.kind === 'grid' && this.map.roads.some(road => Math.abs(candidate.x - road) < 9 || Math.abs(candidate.z - road) < 9);
      pedestrian.crossing = insideRoad(point);
      let moving = true;
      if (!pedestrian.crossing && insideRoad(upcoming)) {
        const axis = Math.abs(upcoming.x - point.x) > Math.abs(upcoming.z - point.z) ? 'x' : 'z';
        moving = signalAllows(axis, seconds);
        for (const car of this.cars) {
          if (car.active && Math.hypot(car.body.position.x - upcoming.x, car.body.position.z - upcoming.z) < 16) moving = false;
        }
      }
      const playerDistance = Math.hypot(point.x - player.position.x, point.z - player.position.z);
      if (!pedestrian.crossing && playerDistance < 8 && player.velocity.length() > 2) moving = false;
      if (!pedestrian.crossing && Math.hypot(upcoming.x - player.position.x, upcoming.z - player.position.z) < 8) moving = false;
      const pace = pedestrian.crossing && playerDistance < 10 ? pedestrian.speed * 2.4 : pedestrian.speed;
      if (moving) {
        pedestrian.distance += pace * delta * pedestrian.direction;
        pedestrian.moved += pace * delta;
        pedestrian.phase += delta * pace * 6;
      }
      const next = pedestrian.route.sample(pedestrian.distance);
      group.position.set(next.x, next.y + 0.17, next.z);
      pedestrian.body.velocity.set((next.x - pedestrian.body.position.x) / delta, (next.y + 0.65 - pedestrian.body.position.y) / delta, (next.z - pedestrian.body.position.z) / delta);
      group.rotation.y = next.yaw + (pedestrian.direction < 0 ? Math.PI : 0);
      group.visible = Math.hypot(next.x - focus.x, next.z - focus.z) < 125;
      if (group.visible) animatePerson(pedestrian.model, pedestrian.phase, moving);
    }
  }

  render(focus: THREE.Vector3): void {
    this.cars.forEach((car, index) => {
      const visible = car.active && Math.hypot(car.body.position.x - focus.x, car.body.position.z - focus.z) < 240;
      this.transform.position.set(car.body.position.x, car.body.position.y - 0.19, car.body.position.z);
      this.transform.rotation.set(0, car.yaw, 0);
      this.transform.scale.setScalar(visible ? 1 : 0);
      this.transform.updateMatrix();
      this.meshes.forEach(mesh => mesh.setMatrixAt(index, this.transform.matrix));
      for (let wheel = 0; wheel < 4; wheel++) {
        const localX = wheel % 2 ? 0.94 : -0.94;
        const localZ = wheel < 2 ? 1.36 : -1.35;
        this.transform.position.set(car.body.position.x + Math.cos(car.yaw) * localX + Math.sin(car.yaw) * localZ, car.body.position.y - 0.46, car.body.position.z - Math.sin(car.yaw) * localX + Math.cos(car.yaw) * localZ);
        this.transform.rotation.set(0, car.yaw, 0);
        this.transform.rotateX(car.distance / 0.36);
        this.transform.updateMatrix();
        this.wheels.setMatrixAt(index * 4 + wheel, this.transform.matrix);
      }
    });
    this.meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    this.wheels.instanceMatrix.needsUpdate = true;
  }
}