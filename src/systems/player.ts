import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarPhysics } from '../core/physics';
import type { DriveInput } from '../core/physics';
import { createCar, createWheel, createPerson, animatePerson, headlightMaterial, tailMaterial } from '../world/models';
import type { PersonModel } from '../world/models';
import type { MapDefinition } from '../world/map';
import { recoveryPoint, surfaceHeight } from '../world/map';
import { bodyOverlapsSphere } from '../core/collision';

const WALK_SPEED = 6;
const bodyPosition = new THREE.Vector3();
const bodyRotation = new THREE.Quaternion();
const inverseRotation = new THREE.Quaternion();
const previousRotation = new THREE.Quaternion();

export class Player {
  readonly car: CarPhysics;
  readonly model: THREE.Group;
  readonly person: PersonModel;
  readonly walker: CANNON.Body;
  readonly focus = new THREE.Vector3();
  readonly wheels: THREE.Group[];
  driving = false;
  transitioning = 0;
  private world: CANNON.World;
  private map: MapDefinition;
  private lights: THREE.SpotLight[];
  private walkPhase = 0;

  constructor(scene: THREE.Scene, world: CANNON.World, map: MapDefinition) {
    this.world = world;
    this.map = map;
    this.car = new CarPhysics(world, map.spawn.x, map.spawn.z, map.spawn.yaw, map.spawn.y);
    this.model = createCar(0x298f89);
    scene.add(this.model);
    this.wheels = Array.from({ length: 4 }, () => {
      const wheel = createWheel();
      scene.add(wheel);
      return wheel;
    });
    this.person = createPerson(0xf0d6a5, 0xb98261);
    scene.add(this.person.group);
    const walkerMaterial = new CANNON.Material({ friction: 0, restitution: 0 });
    world.addContactMaterial(new CANNON.ContactMaterial(walkerMaterial, world.defaultMaterial, { friction: 0, restitution: 0 }));
    this.walker = new CANNON.Body({ mass: 78, material: walkerMaterial, shape: new CANNON.Sphere(0.42), fixedRotation: true, linearDamping: 0, position: new CANNON.Vec3(map.spawn.x, 0.45, map.spawn.z + 3.2) });
    if (map.kind === 'real') {
      const x = map.spawn.x - Math.sin(map.spawn.yaw) * 3.2, z = map.spawn.z - Math.cos(map.spawn.yaw) * 3.2;
      this.walker.position.set(x, surfaceHeight(map, x, z, map.data.spawn.y + 1) + 0.55, z);
      // Real maps do not step physics before the start, so interpolation would blend with the old pose.
      this.walker.previousPosition.copy(this.walker.position);
      this.walker.interpolatedPosition.copy(this.walker.position);
    }
    world.addBody(this.walker);
    this.lights = [-0.6, 0.6].map(side => {
      const light = new THREE.SpotLight(0xffedc7, 0, 60, 0.48, 0.6, 1.2);
      light.position.set(side, 0.4, 2.1);
      light.target.position.set(side, -0.3, 35);
      this.model.add(light, light.target);
      return light;
    });
    this.sync(0);
  }

  get nearby(): boolean { return this.walker.position.distanceTo(this.car.body.position) < 5; }

  interact(): string | null {
    if (this.transitioning > 0) return null;
    if (this.driving) {
      if (Math.abs(this.car.speed) > 1.1) return 'Pare o carro para sair.';
      const origin = this.car.body.position;
      for (const side of [-1, 1]) {
        const offset = this.car.body.quaternion.vmult(new CANNON.Vec3(side * 2.5, 0, 0));
        const destination = origin.vadd(offset);
        destination.y = surfaceHeight(this.map, destination.x, destination.z, origin.y + 1) + 0.55;
        if (Math.abs(destination.x) > this.map.extent - 1 || Math.abs(destination.z) > this.map.extent - 1) continue;
        const blocked = this.world.bodies.some(body => {
          if (body === this.car.body || body === this.walker || !body.collisionResponse || body.shapes[0] instanceof CANNON.Plane || body.shapes[0] instanceof CANNON.Heightfield) return false;
          if (body.aabbNeedsUpdate) body.updateAABB();
          const bounds = body.aabb;
          const broadOverlap = destination.x > bounds.lowerBound.x - 0.5 && destination.x < bounds.upperBound.x + 0.5 && destination.z > bounds.lowerBound.z - 0.5 && destination.z < bounds.upperBound.z + 0.5 &&
            destination.y + 1.3 > bounds.lowerBound.y && destination.y - 0.5 < bounds.upperBound.y;
          return broadOverlap && (bodyOverlapsSphere(body, destination, 0.42) ||
            bodyOverlapsSphere(body, new CANNON.Vec3(destination.x, destination.y + 0.8, destination.z), 0.42));
        });
        if (blocked) continue;
        this.walker.position.copy(destination);
        this.walker.previousPosition.copy(destination);
        this.walker.velocity.setZero();
        this.walker.aabbNeedsUpdate = true;
        this.world.addBody(this.walker);
        this.driving = false;
        this.transitioning = 0.45;
        return null;
      }
      return 'Sem espaco para abrir a porta.';
    }
    if (!this.nearby) return 'Aproxime-se do seu carro.';
    this.driving = true;
    this.transitioning = 0.45;
    this.world.removeBody(this.walker);
    return null;
  }

  update(input: DriveInput, delta: number, cameraYaw: number): void {
    this.transitioning = Math.max(0, this.transitioning - delta);
    if (this.driving && this.transitioning === 0) {
      this.car.update(input, delta);
    } else {
      this.car.update({ throttle: 0, brake: 1, steer: 0, handbrake: true }, delta);
    }
    if (!this.driving) {
      const forward = input.throttle;
      const horizontal = input.steer;
      const length = Math.max(1, Math.hypot(forward, horizontal));
      const velocityX = (Math.sin(cameraYaw) * forward + Math.cos(cameraYaw) * horizontal) / length * WALK_SPEED;
      const velocityZ = (Math.cos(cameraYaw) * forward - Math.sin(cameraYaw) * horizontal) / length * WALK_SPEED;
      this.walker.velocity.x = velocityX;
      this.walker.velocity.z = velocityZ;
      this.walkPhase += Math.hypot(velocityX, velocityZ) * delta * 2.5;
      if (Math.hypot(velocityX, velocityZ) > 0.1) this.person.group.rotation.y = Math.atan2(velocityX, velocityZ);
      animatePerson(this.person, this.walkPhase, Math.hypot(velocityX, velocityZ) > 0.1);
      this.walker.wakeUp();
    }
  }

  sync(night: number, alpha = 1): void {
    // Render between the last two fixed steps so motion stays smooth at any refresh rate.
    const body = this.car.body;
    bodyPosition.set(body.position.x, body.position.y, body.position.z);
    bodyRotation.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    this.model.position.set(body.previousPosition.x, body.previousPosition.y, body.previousPosition.z).lerp(bodyPosition, alpha);
    previousRotation.set(body.previousQuaternion.x, body.previousQuaternion.y, body.previousQuaternion.z, body.previousQuaternion.w);
    this.model.quaternion.slerpQuaternions(previousRotation, bodyRotation, alpha);
    inverseRotation.copy(bodyRotation).invert();
    this.wheels.forEach((wheel, index) => {
      this.car.vehicle.updateWheelTransform(index);
      const transform = this.car.vehicle.wheelInfos[index].worldTransform;
      wheel.position.copy(transform.position).sub(bodyPosition).applyQuaternion(inverseRotation).applyQuaternion(this.model.quaternion).add(this.model.position);
      wheel.quaternion.copy(transform.quaternion).premultiply(inverseRotation).premultiply(this.model.quaternion);
    });
    this.person.group.visible = !this.driving && this.transitioning < 0.25;
    const walker = this.walker;
    this.person.group.position.set(walker.previousPosition.x, walker.previousPosition.y - 0.42, walker.previousPosition.z)
      .lerp(bodyPosition.set(walker.position.x, walker.position.y - 0.42, walker.position.z), alpha);
    this.focus.copy(this.driving ? this.model.position : this.person.group.position);
    this.lights.forEach(light => { light.intensity = night * 55; });
    headlightMaterial.emissiveIntensity = 0.2 + night * 3;
    tailMaterial.emissiveIntensity = 0.5 + night;
  }

  recover(): void {
    const point = recoveryPoint(this.map, this.car.body.position);
    this.car.reset(point.x, point.z, point.yaw, point.y);
    if (!this.driving) {
      const x = this.map.kind === 'real' ? point.x - Math.sin(point.yaw) * 3.2 : point.x;
      const z = this.map.kind === 'real' ? point.z - Math.cos(point.yaw) * 3.2 : point.z + 3.3;
      this.walker.position.set(x, surfaceHeight(this.map, x, z, point.y + 1) + 0.55, z);
      this.walker.previousPosition.copy(this.walker.position);
      this.walker.velocity.setZero();
      this.walker.aabbNeedsUpdate = true;
    }
  }
}