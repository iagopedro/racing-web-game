import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { staticBox, addBoundaries } from '../core/physics';
import { blocks, seeded, signalAllows } from './map';
import type { MapDefinition } from './map';

interface Instance { position: number[]; scale: number[]; color: number; rotation: number[] }

class Batch {
  instances: Instance[] = [];
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  shadow: boolean;
  constructor(geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, shadow = true) {
    this.geometry = geometry;
    this.material = material;
    this.shadow = shadow;
  }
  add(x: number, y: number, z: number, width: number, height: number, depth: number, color: number, rx = 0, ry = 0, rz = 0): void {
    this.instances.push({ position: [x, y, z], scale: [width, height, depth], color, rotation: [rx, ry, rz] });
  }
  build(scene: THREE.Scene): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.instances.length);
    const dummy = new THREE.Object3D();
    this.instances.forEach((instance, index) => {
      dummy.position.fromArray(instance.position);
      dummy.scale.fromArray(instance.scale);
      dummy.rotation.set(instance.rotation[0], instance.rotation[1], instance.rotation[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, new THREE.Color(instance.color));
    });
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
}

export interface City {
  colliders: CANNON.Body[];
  update: (seconds: number, night: number, focus: THREE.Vector3) => void;
}

export function createCity(scene: THREE.Scene, physics: CANNON.World, map: MapDefinition): City {
  const random = seeded(712);
  const matte = new THREE.MeshStandardMaterial({ roughness: 0.88 });
  const windowsMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc973, emissiveIntensity: 0, roughness: 0.35, metalness: 0.2 });
  const lampMaterial = new THREE.MeshStandardMaterial({ emissive: 0xffd18a, emissiveIntensity: 0.5 });
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const solid = new Batch(cube, matte);
  const flat = new Batch(cube, matte, false);
  const windows = new Batch(cube, windowsMaterial, false);
  const trunks = new Batch(new THREE.CylinderGeometry(0.7, 1, 1, 6), matte);
  const leaves = new Batch(new THREE.SphereGeometry(1, 6, 4), matte);
  const lamps = new Batch(cube, lampMaterial, false);
  const colliderStart = physics.bodies.length;
  const lampPositions: THREE.Vector3[] = [];
  const signals: { x: number; z: number; axis: 'x' | 'z' }[] = [];
  const colorPalette = [0xe8c5a5, 0xe3e0cf, 0xc3d8d0, 0xd1a09a, 0xa6c8c8, 0xe4c579, 0xbbc5d3, 0xd6cabb];

  flat.add(0, -0.12, 0, 632, 0.2, 632, 0xb3ba9a);
  for (const road of map.roads) {
    flat.add(road, 0.006, 0, map.roadWidth, 0.01, 578, 0x505c60);
    flat.add(0, 0.008, road, 578, 0.01, map.roadWidth, 0x505c60);
    for (let mark = -276; mark < 280; mark += 8) {
      if (map.roads.some(cross => Math.abs(mark - cross) < 14)) continue;
      flat.add(road, 0.025, mark, 0.15, 0.01, 3.8, 0xe7d49b);
      flat.add(mark, 0.026, road, 3.8, 0.01, 0.15, 0xe7d49b);
    }
    for (const cross of map.roads) {
      for (const side of [-1, 1]) {
        for (let stripe = -7; stripe <= 7; stripe += 2) {
          flat.add(road + stripe, 0.03, cross + side * 11.5, 1.05, 0.015, 3.4, 0xe1e0cf);
          flat.add(road + side * 11.5, 0.031, cross + stripe, 3.4, 0.015, 1.05, 0xe1e0cf);
        }
        solid.add(road + side * 10, 2.5, cross + side * 14, 0.16, 5, 0.16, 0x394b48);
        solid.add(road + side * 10, 4.5, cross + side * 14, 0.5, 1.1, 0.4, 0x263e3e);
        signals.push({ x: road + side * 10, z: cross + side * 14, axis: 'z' });
        solid.add(road + side * 14, 2.5, cross - side * 10, 0.16, 5, 0.16, 0x394b48);
        solid.add(road + side * 14, 4.5, cross - side * 10, 0.4, 1.1, 0.5, 0x263e3e);
        signals.push({ x: road + side * 14, z: cross - side * 10, axis: 'x' });
      }
    }
  }

  const tree = (x: number, z: number, palm = false) => {
    const height = palm ? 8 + random() * 3 : 4 + random() * 2;
    trunks.add(x, height / 2, z, 0.27, height, 0.27, palm ? 0x8e8067 : 0x796c59);
    if (palm) {
      for (let frond = 0; frond < 6; frond++) {
        const angle = frond * Math.PI / 3;
        leaves.add(x + Math.sin(angle) * 1.4, height, z + Math.cos(angle) * 1.4, 0.65, 0.28, 2.7, 0x3c7b65, 0.18, angle);
      }
    } else {
      leaves.add(x, height, z, 2.7, 3.5, 2.7, [0x578b67, 0x688f60, 0x3e7d65][Math.floor(random() * 3)]);
    }
  };

  const streetLamp = (x: number, z: number) => {
    trunks.add(x, 3.5, z, 0.1, 7, 0.1, 0x4a5a55);
    solid.add(x, 7, z, 1.4, 0.15, 0.6, 0x394d4d);
    lamps.add(x, 6.9, z, 1.2, 0.08, 0.5, 0xffe6a8);
    lampPositions.push(new THREE.Vector3(x, 6.6, z));
  };

  for (const block of blocks(map)) {
    const { x, z, row, column } = block;
    flat.add(x, 0.085, z, 94, 0.16, 94, 0xc6c7b5);
    flat.add(x, 0.17, z, 82, 0.01, 82, block.park ? 0x87a86c : 0xaeb69b);
    for (const side of [-1, 1]) {
      streetLamp(x + side * 42, z - 22);
      streetLamp(x - 22, z + side * 42);
      tree(x + side * 43, z + 23, row === 4);
      tree(x + 24, z + side * 43, row === 4);
      solid.add(x + side * 41, 0.65, z + 8, 0.65, 0.14, 2.5, 0x8b7b62);
      solid.add(x + side * 41, 0.96, z + 8.6, 0.65, 0.5, 0.15, 0x8b7b62);
    }
    if (block.park) {
      flat.add(x, 0.19, z, 7, 0.02, 82, 0xd3cbb1);
      flat.add(x, 0.2, z, 82, 0.02, 7, 0xd3cbb1);
      for (let count = 0; count < 17; count++) tree(x + (random() - 0.5) * 70, z + (random() - 0.5) * 70);
      solid.add(x, 0.5, z, 12, 0.7, 12, 0xc6d5cb);
      flat.add(x, 0.87, z, 10.5, 0.02, 10.5, 0x5cadb1);
      trunks.add(x, 2.2, z, 0.7, 3, 0.7, 0xd8ded2);
      staticBox(physics, x, 0.5, z, 12, 1, 12);
      continue;
    }
    for (const offsetX of [-23, 23]) {
      for (const offsetZ of [-23, 23]) {
        const buildingX = x + offsetX;
        const buildingZ = z + offsetZ;
        const central = column >= 1 && column <= 3 && row >= 1 && row <= 3;
        const height = row === 4 ? 8 + random() * 15 : central ? 18 + random() * 50 : 7 + random() * 18;
        const width = 23 + random() * 9;
        const depth = 23 + random() * 9;
        const color = colorPalette[Math.floor(random() * colorPalette.length)];
        solid.add(buildingX, height / 2 + 0.18, buildingZ, width, height, depth, color);
        solid.add(buildingX, height + 0.4, buildingZ, width + 0.8, 0.5, depth + 0.8, 0xe0ded0);
        solid.add(buildingX, 2.3, buildingZ, width + 0.2, 4.3, depth + 0.2, 0x8b9b94);
        solid.add(buildingX + 3, height + 1, buildingZ, 5, 1.5, 4, 0x89938d);
        staticBox(physics, buildingX, height / 2, buildingZ, width, height, depth);
        for (let floor = 5; floor < height - 1; floor += 3.8) {
          for (let offset = -8; offset <= 8; offset += 4) {
            const tint = random() > 0.32 ? 0x486e76 : 0x819d9c;
            windows.add(buildingX + offset, floor, buildingZ + depth / 2 + 0.03, 1.7, 1.9, 0.05, tint);
            windows.add(buildingX + offset, floor, buildingZ - depth / 2 - 0.03, 1.7, 1.9, 0.05, tint);
            windows.add(buildingX + width / 2 + 0.03, floor, buildingZ + offset, 0.05, 1.9, 1.7, tint);
            windows.add(buildingX - width / 2 - 0.03, floor, buildingZ + offset, 0.05, 1.9, 1.7, tint);
          }
        }
        for (const side of [-1, 1]) {
          windows.add(buildingX, 2, buildingZ + side * (depth / 2 + 0.15), width * 0.65, 2.8, 0.06, 0x315f65);
          if (row === 4 || column === 4) {
            solid.add(buildingX, 3.8, buildingZ + side * (depth / 2 + 0.8), width * 0.8, 0.3, 2, (column + row) % 2 ? 0xbc6955 : 0x398f85);
          }
        }
      }
    }
  }

  flat.add(0, 0.08, 302, 630, 0.14, 25, 0xd3cdb6);
  flat.add(0, 0.16, 299, 630, 0.02, 3, 0xba8771);
  for (let x = -300; x < 310; x += 22) {
    tree(x, 306, true);
    streetLamp(x + 9, 294);
    solid.add(x, 0.7, 309, 3.5, 0.16, 0.75, 0x987e60);
    solid.add(x, 1.1, 309.3, 3.5, 0.6, 0.14, 0x987e60);
  }
  for (const side of [-1, 1]) {
    solid.add(side * 316, 0.8, 0, 1.5, 1.6, 632, 0xc1bba4);
    solid.add(0, 0.8, side * 316, 632, 1.6, 1.5, 0xc1bba4);
  }
  addBoundaries(physics, map);

  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), new THREE.MeshStandardMaterial({ color: 0x398f9e, roughness: 0.32, metalness: 0.25 }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.7, 0);
  scene.add(ocean);
  for (let wave = 0; wave < 65; wave++) {
    flat.add((random() - 0.5) * 1700, -0.64, 330 + random() * 900, 12 + random() * 65, 0.015, 0.22, 0x8ec9c5);
  }
  const hills = new Batch(new THREE.ConeGeometry(1, 1, 7), matte, false);
  for (let hill = 0; hill < 18; hill++) {
    hills.add(-900 + hill * 110, 30, -520 - random() * 250, 140 + random() * 100, 100 + random() * 180, 130, 0x739c94);
  }
  hills.build(scene);

  const label = (text: string, x: number, y: number, z: number, width: number, background: string, facing = 0) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 192;
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, 1024, 192);
    context.font = '600 94px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f6f1db';
    context.fillText(text, 512, 100, 960);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 192 / 1024), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = facing;
    scene.add(mesh);
  };
  label('SANTA BRISA', 85, 5.2, 312, 24, '#327e76', Math.PI);
  solid.add(76, 2.5, 312, 0.25, 5, 0.25, 0x617c70);
  solid.add(94, 2.5, 312, 0.25, 5, 0.25, 0x617c70);
  label('HOTEL AURORA', -21, 12, 262.5, 19, '#b7634c');
  label('CAFE DA ORLA', 24, 4, 262.8, 15, '#35675c');
  label('MERCADO', 132, 4, 262.8, 15, '#a76d49');

  const clockTower = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 48, 8), new THREE.MeshStandardMaterial({ color: 0xdec99d }));
  tower.position.y = 24;
  tower.castShadow = true;
  clockTower.add(tower);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(8, 14, 8), new THREE.MeshStandardMaterial({ color: 0x4e8d80 }));
  crown.position.y = 55;
  clockTower.add(crown);
  clockTower.position.set(0, 0, 0);
  scene.add(clockTower);
  staticBox(physics, 0, 24, 0, 12, 48, 12);

  solid.build(scene);
  flat.build(scene);
  windows.build(scene);
  trunks.build(scene);
  leaves.build(scene);
  lamps.build(scene);
  const signalMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 5, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), signals.length * 2);
  const transform = new THREE.Object3D();
  signals.forEach((signal, index) => {
    for (let side = 0; side < 2; side++) {
      transform.position.set(signal.x + (signal.axis === 'x' ? (side ? 0.26 : -0.26) : 0), 4.65, signal.z + (signal.axis === 'z' ? (side ? 0.26 : -0.26) : 0));
      transform.updateMatrix();
      signalMesh.setMatrixAt(index * 2 + side, transform.matrix);
    }
  });
  scene.add(signalMesh);
  const nearbyLights = Array.from({ length: 8 }, () => {
    const light = new THREE.PointLight(0xffd99b, 0, 24, 2);
    scene.add(light);
    return light;
  });
  let lastLightUpdate = -10;
  let lastPhase = -1;
  return {
    colliders: physics.bodies.slice(colliderStart),
    update(seconds, night, focus) {
      windowsMaterial.emissiveIntensity = night * 1.4;
      lampMaterial.emissiveIntensity = 0.3 + night * 4;
      nearbyLights.forEach(light => { light.intensity = night * 85; });
      if (seconds - lastLightUpdate > 1) {
        lampPositions.sort((first, second) => first.distanceToSquared(focus) - second.distanceToSquared(focus));
        nearbyLights.forEach((light, index) => light.position.copy(lampPositions[index]));
        lastLightUpdate = seconds;
      }
      const phase = Math.floor(seconds % 24);
      if (phase !== lastPhase) {
        signals.forEach((signal, index) => {
          const color = new THREE.Color(signalAllows(signal.axis, seconds) ? 0x7affae : 0xff553e);
          signalMesh.setColorAt(index * 2, color);
          signalMesh.setColorAt(index * 2 + 1, color);
        });
        signalMesh.instanceColor!.needsUpdate = true;
        lastPhase = phase;
      }
    },
  };
}