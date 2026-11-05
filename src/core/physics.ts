import * as CANNON from 'cannon-es';
import type { MapDefinition } from '../world/map';
import { DrivingWorld } from './terrain-ray';

export const FIXED_STEP = 1 / 60;

export function createPhysics(flatFloor = true): CANNON.World {
  const world = new DrivingWorld({ gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true });
  world.broadphase = new CANNON.SAPBroadphase(world);
  (world.solver as CANNON.GSSolver).iterations = 12;
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0.04;
  if (flatFloor) {
    const floor = new CANNON.Body({ mass: 0, material: world.defaultMaterial, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floor.aabbNeedsUpdate = true;
    world.addBody(floor);
  }
  return world;
}

export function staticBox(world: CANNON.World, x: number, y: number, z: number, width: number, height: number, depth: number): CANNON.Body {
  const body = new CANNON.Body({ mass: 0, material: world.defaultMaterial, shape: new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)) });
  body.position.set(x, y, z);
  body.aabbNeedsUpdate = true;
  world.addBody(body);
  return body;
}

export function addBoundaries(world: CANNON.World, map: MapDefinition): void {
  const edge = map.extent;
  staticBox(world, -edge, 2, 0, 2, 4, edge * 2);
  staticBox(world, edge, 2, 0, 2, 4, edge * 2);
  staticBox(world, 0, 2, -edge, edge * 2, 4, 2);
  staticBox(world, 0, 2, edge, edge * 2, 4, 2);
}

export interface DriveInput { throttle: number; brake: number; steer: number; handbrake: boolean }

export class CarPhysics {
  readonly body: CANNON.Body;
  readonly vehicle: CANNON.RaycastVehicle;
  steering = 0;
  engine = 0;
  private forward = new CANNON.Vec3();

  constructor(world: CANNON.World, x: number, z: number, yaw: number, y = 0) {
    this.body = new CANNON.Body({ mass: 1250, linearDamping: 0.12, angularDamping: 0.5, allowSleep: false });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.94, 0.38, 2.05)), new CANNON.Vec3(0, 0.24, 0));
    this.vehicle = new CANNON.RaycastVehicle({ chassisBody: this.body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const front of [true, false]) {
      for (const side of [-1, 1]) {
        this.vehicle.addWheel({
          chassisConnectionPointLocal: new CANNON.Vec3(side * 0.94, 0.05, front ? 1.36 : -1.35),
          directionLocal: new CANNON.Vec3(0, -1, 0), axleLocal: new CANNON.Vec3(-1, 0, 0),
          radius: 0.36, suspensionRestLength: 0.32, suspensionStiffness: 32,
          dampingRelaxation: 2.3, dampingCompression: 4.4, frictionSlip: 3.8,
          rollInfluence: 0.025, maxSuspensionForce: 70000, maxSuspensionTravel: 0.22,
          isFrontWheel: front,
        });
      }
    }
    this.vehicle.addToWorld(world);
    this.reset(x, z, yaw, y);
  }

  get speed(): number {
    this.body.quaternion.vmult(new CANNON.Vec3(0, 0, 1), this.forward);
    return this.body.velocity.dot(this.forward);
  }

  update(input: DriveInput, delta: number): void {
    const speed = this.speed;
    const targetSteer = input.steer * (0.48 / (1 + Math.abs(speed) * 0.055));
    this.steering += (targetSteer - this.steering) * Math.min(1, delta * 6);
    this.engine += (input.throttle - this.engine) * Math.min(1, delta * 3);
    const opposing = (input.throttle < 0 && speed > 1) || (input.throttle > 0 && speed < -1);
    const limited = (speed > 36 && this.engine > 0) || (speed < -9 && this.engine < 0);
    const force = opposing || limited ? 0 : -this.engine * (this.engine < 0 ? 1900 : 3600);
    for (let wheel = 0; wheel < 4; wheel++) {
      this.vehicle.setSteeringValue(wheel < 2 ? this.steering : 0, wheel);
      this.vehicle.applyEngineForce(wheel >= 2 ? force : 0, wheel);
      this.vehicle.setBrake(input.handbrake && wheel >= 2 ? 110 : (opposing ? 50 : input.brake * 65) + (Math.abs(input.throttle) < 0.01 ? 2 : 0), wheel);
      this.vehicle.wheelInfos[wheel].frictionSlip = input.handbrake && wheel >= 2 ? 1.5 : 3.8;
    }
  }

  reset(x: number, z: number, yaw: number, y = 0): void {
    this.body.position.set(x, y + 0.95, z);
    this.body.quaternion.setFromEuler(0, yaw, 0);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.force.setZero();
    this.body.torque.setZero();
    this.body.previousPosition.copy(this.body.position);
    this.body.interpolatedPosition.copy(this.body.position);
    this.body.aabbNeedsUpdate = true;
    this.body.wakeUp();
    this.engine = 0;
    this.steering = 0;
    for (let wheel = 0; wheel < 4; wheel++) {
      this.vehicle.applyEngineForce(0, wheel);
      this.vehicle.setBrake(10, wheel);
      this.vehicle.setSteeringValue(0, wheel);
    }
  }
}