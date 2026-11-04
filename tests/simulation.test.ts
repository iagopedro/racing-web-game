import { describe, expect, it } from 'vitest';
import { CarPhysics, createPhysics, FIXED_STEP, staticBox } from '../src/core/physics';
import { blocks, roundedLoop, SANTA_BRISA, signalAllows } from '../src/world/map';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LoopRoute, Population } from '../src/systems/population';
import { Daylight, timeLighting } from '../src/systems/daylight';
import { Player } from '../src/systems/player';

describe('driving simulation', () => {
  it('settles on suspension, accelerates forward and brakes', () => {
    const world = createPhysics();
    const car = new CarPhysics(world, 0, 0, 0);
    const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    for (let frame = 0; frame < 120; frame++) { car.update(input, FIXED_STEP); world.step(FIXED_STEP); }
    expect(car.body.position.y).toBeGreaterThan(0.3);
    expect(car.body.position.y).toBeLessThan(1);
    input.throttle = 1;
    for (let frame = 0; frame < 300; frame++) { car.update(input, FIXED_STEP); world.step(FIXED_STEP); }
    expect(car.speed).toBeGreaterThan(10);
    expect(car.body.position.z).toBeGreaterThan(20);
    input.throttle = 0;
    input.brake = 1;
    for (let frame = 0; frame < 180; frame++) { car.update(input, FIXED_STEP); world.step(FIXED_STEP); }
    expect(Math.abs(car.speed)).toBeLessThan(0.5);
    expect(car.body.quaternion.w).toBeGreaterThan(0.95);
  });

  it('cannot drive through a static wall', () => {
    const world = createPhysics();
    staticBox(world, 0, 2, 22, 30, 4, 2);
    const car = new CarPhysics(world, 0, 0, 0);
    for (let frame = 0; frame < 600; frame++) {
      car.update({ throttle: 1, brake: 0, steer: 0, handbrake: false }, FIXED_STEP);
      world.step(FIXED_STEP);
    }
    expect(car.body.position.z).toBeLessThan(20);
    expect(Number.isFinite(car.body.position.y)).toBe(true);
  });

  it('keeps bounded speeds and permits reversing', () => {
    const world = createPhysics();
    const car = new CarPhysics(world, 0, 0, 0);
    for (let frame = 0; frame < 1800; frame++) {
      car.update({ throttle: 1, brake: 0, steer: 0, handbrake: false }, FIXED_STEP);
      world.step(FIXED_STEP);
    }
    expect(car.speed).toBeLessThan(37);
    car.reset(0, 0, 0);
    for (let frame = 0; frame < 300; frame++) {
      car.update({ throttle: -1, brake: 0, steer: 0, handbrake: false }, FIXED_STEP);
      world.step(FIXED_STEP);
    }
    expect(car.speed).toBeLessThan(-2);
    expect(car.speed).toBeGreaterThan(-10);
  });
});

describe('city layout', () => {
  it('has a connected street grid and closed routes', () => {
    expect(blocks(SANTA_BRISA)).toHaveLength(25);
    const route = roundedLoop(-50, -50, 50, 50);
    expect(route).toHaveLength(28);
    expect(route.every(point => Math.abs(point.x) <= 50 && Math.abs(point.z) <= 50)).toBe(true);
  });

  it('never gives conflicting directions a green light', () => {
    for (let seconds = 0; seconds < 240; seconds += 0.1) {
      expect(signalAllows('x', seconds) && signalAllows('z', seconds)).toBe(false);
    }
  });
});

describe('population and continuous world', () => {
  it('samples a route continuously across its closing segment', () => {
    const route = new LoopRoute(roundedLoop(-50, -50, 50, 50));
    expect(route.sample(0)).toEqual(route.sample(route.length));
    const before = route.sample(route.length - 0.1);
    const after = route.sample(0.1);
    expect(Math.hypot(before.x - after.x, before.z - after.z)).toBeLessThan(0.21);
  });

  it('keeps every traffic route progressing for three simulated minutes', () => {
    const scene = new THREE.Scene();
    const world = createPhysics();
    const population = new Population(scene, world, SANTA_BRISA);
    const player = new CANNON.Body({ position: new CANNON.Vec3(1000, 0, 1000) });
    const focus = new THREE.Vector3();
    for (let frame = 0; frame < 60 * 180; frame++) {
      population.update(FIXED_STEP, frame * FIXED_STEP, player, focus, 0);
      world.step(FIXED_STEP);
    }
    const stalled = population.cars.map((car, index) => ({ index, traveled: car.traveled })).filter(car => car.traveled < 80);
    expect(stalled).toEqual([]);
    for (const car of population.cars) {
      const point = car.route.sample(car.distance);
      expect(Math.hypot(car.body.position.x - point.x, car.body.position.z - point.z)).toBeLessThan(0.01);
    }
    expect(population.pedestrians.every(person => person.moved > 30)).toBe(true);
    expect(population.cars.every(car => Number.isFinite(car.body.position.x) && Math.abs(car.body.position.x) < 290)).toBe(true);
  }, 30000);

  it('slows traffic for a car blocking its lane and resumes when cleared', () => {
    const world = createPhysics();
    const population = new Population(new THREE.Scene(), world, SANTA_BRISA);
    const car = population.cars[0];
    car.distance = 20;
    const point = car.route.sample(car.distance);
    car.body.position.set(point.x, 0.82, point.z);
    const ahead = car.route.sample(car.distance + 14);
    const player = new CANNON.Body({ position: new CANNON.Vec3(ahead.x, 1, ahead.z) });
    population.cars = [car];
    population.pedestrians = [];
    const focus = new THREE.Vector3(point.x, 0, point.z);
    for (let frame = 0; frame < 300; frame++) { population.update(FIXED_STEP, 14, player, focus, 0); world.step(FIXED_STEP); }
    expect(car.speed).toBeLessThan(0.5);
    expect(Math.hypot(car.body.position.x - player.position.x, car.body.position.z - player.position.z)).toBeGreaterThan(5);
    player.position.set(1000, 0, 1000);
    for (let frame = 0; frame < 180; frame++) { population.update(FIXED_STEP, 14, player, focus, 0); world.step(FIXED_STEP); }
    expect(car.speed).toBeGreaterThan(3);
  });

  it('changes lighting throughout a complete day without player movement', () => {
    const day = new Daylight(new THREE.Scene());
    const start = day.hours;
    for (let second = 0; second < 720; second++) day.update(1, new THREE.Vector3());
    expect(day.hours).toBeCloseTo(start, 5);
    expect(timeLighting(0).night).toBe(1);
    expect(timeLighting(12).night).toBe(0);
    expect(timeLighting(6).night).toBeGreaterThan(0);
    expect(timeLighting(6).night).toBeLessThan(1);
  });

  it('keeps nighttime surfaces lit without changing daytime lighting', () => {
    const scene = new THREE.Scene();
    const day = new Daylight(scene);
    const ambient = scene.children.find(child => child instanceof THREE.HemisphereLight) as THREE.HemisphereLight;
    const focus = new THREE.Vector3(20, 1, 40);
    day.hours = 12;
    day.update(0, focus);
    expect(ambient.intensity).toBeCloseTo(2);
    expect(ambient.color.getHex()).toBe(0xccecf3);
    expect(ambient.groundColor.getHex()).toBe(0x69785a);
    expect(day.sun.intensity).toBeCloseTo(2.83);
    for (const hours of [0, 3, 21, 23]) {
      day.hours = hours;
      day.update(0, focus);
      expect(day.night).toBe(1);
      expect(ambient.intensity).toBeGreaterThanOrEqual(1);
      expect(ambient.intensity).toBeLessThan(2);
      expect(day.sun.position.y).toBeGreaterThan(focus.y);
      expect(day.sun.intensity).toBeGreaterThan(0.5);
      expect(day.sun.intensity).toBeLessThan(1);
    }
    let previous: THREE.Color | undefined;
    for (let hours = 17; hours <= 19; hours += 0.01) {
      day.hours = hours;
      day.update(0, focus);
      if (previous) {
        const difference = Math.abs(ambient.color.r - previous.r) + Math.abs(ambient.color.g - previous.g) + Math.abs(ambient.color.b - previous.b);
        expect(difference).toBeLessThan(0.025);
      }
      previous = ambient.color.clone();
    }
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('walks left and right relative to camera yaw %s', cameraYaw => {
    const world = createPhysics();
    const player = new Player(new THREE.Scene(), world, SANTA_BRISA);
    player.walker.position.set(0, 0.45, 0);
    player.walker.aabbNeedsUpdate = true;
    const left = new CANNON.Vec3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    for (const steer of [1, -1]) {
      const start = player.walker.position.clone();
      for (let frame = 0; frame < 60; frame++) {
        player.update({ throttle: 0, brake: 0, steer, handbrake: false }, FIXED_STEP, cameraYaw);
        world.step(FIXED_STEP);
      }
      const displacement = player.walker.position.vsub(start);
      expect(displacement.dot(left) * steer).toBeGreaterThan(5.5);
      expect(displacement.dot(left) * steer).toBeLessThanOrEqual(6.01);
    }
  });

  it.each([[1, 0], [-1, 0], [1, 1], [1, -1]])('walks at a consistent speed with throttle %s and steer %s', (throttle, steer) => {
    const world = createPhysics();
    const player = new Player(new THREE.Scene(), world, SANTA_BRISA);
    player.walker.position.set(0, 0.45, 0);
    player.walker.aabbNeedsUpdate = true;
    for (let frame = 0; frame < 60; frame++) {
      player.update({ throttle, brake: 0, steer, handbrake: false }, FIXED_STEP, 0);
      world.step(FIXED_STEP);
    }
    const distance = Math.hypot(player.walker.position.x, player.walker.position.z);
    expect(distance).toBeGreaterThan(5.5);
    expect(distance).toBeLessThanOrEqual(6.01);
    expect(Math.sign(player.walker.position.z)).toBe(Math.sign(throttle));
    const stopped = player.walker.position.clone();
    for (let frame = 0; frame < 60; frame++) {
      player.update({ throttle: 0, brake: 0, steer: 0, handbrake: false }, FIXED_STEP, 0);
      world.step(FIXED_STEP);
    }
    expect(player.walker.position.distanceTo(stopped)).toBeLessThan(0.05);
  });

  it('keeps walking collisions at the increased speed', () => {
    const world = createPhysics();
    const player = new Player(new THREE.Scene(), world, SANTA_BRISA);
    player.walker.position.set(0, 0.45, 0);
    player.walker.aabbNeedsUpdate = true;
    staticBox(world, 0, 2, 6, 20, 4, 1);
    for (let frame = 0; frame < 180; frame++) {
      player.update({ throttle: 1, brake: 0, steer: 0, handbrake: false }, FIXED_STEP, 0);
      world.step(FIXED_STEP);
    }
    expect(player.walker.position.z).toBeGreaterThan(4.5);
    expect(player.walker.position.z).toBeLessThan(5.2);
  });

  it('enters, prevents a moving exit, and exits on a clear side', () => {
    const world = createPhysics();
    const player = new Player(new THREE.Scene(), world, SANTA_BRISA);
    expect(player.nearby).toBe(true);
    expect(player.interact()).toBeNull();
    expect(player.driving).toBe(true);
    expect(world.bodies.includes(player.walker)).toBe(false);
    player.transitioning = 0;
    player.car.body.velocity.set(10, 0, 0);
    expect(player.interact()).toContain('Pare');
    player.car.body.velocity.setZero();
    expect(player.interact()).toBeNull();
    expect(player.driving).toBe(false);
    expect(world.bodies.includes(player.walker)).toBe(true);
  });
});