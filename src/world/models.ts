import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const box = new THREE.BoxGeometry(1, 1, 1);
export const tireGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 12).rotateZ(Math.PI / 2);
export const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x242a2d, roughness: 0.95 });
export const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xd4dbd7, metalness: 0.6, roughness: 0.3 });

function parts(dimensions: number[][]): THREE.BufferGeometry {
  return mergeGeometries(dimensions.map(([width, height, depth, x, y, z]) =>
    box.clone().scale(width, height, depth).translate(x, y, z),
  ));
}

export const carGeometries = {
  paint: parts([
    [1.87, 0.52, 4.12, 0, 0.22, 0], [1.78, 0.16, 1.15, 0, 0.56, 1.4],
    [1.61, 0.1, 1.4, 0, 1.05, -0.3], [0.07, 0.5, 0.1, -0.79, 0.78, 0.45],
    [0.07, 0.5, 0.1, 0.79, 0.78, 0.45], [0.07, 0.5, 0.1, -0.79, 0.78, -1],
    [0.07, 0.5, 0.1, 0.79, 0.78, -1], [1.8, 0.12, 0.65, 0, 0.55, -1.65],
  ]),
  glass: parts([[1.52, 0.43, 1.85, 0, 0.8, -0.25]]),
  trim: parts([
    [1.9, 0.13, 0.12, 0, 0.05, 2.08], [1.9, 0.13, 0.12, 0, 0.05, -2.08],
    [0.24, 0.12, 0.22, -1, 0.76, 0.55], [0.24, 0.12, 0.22, 1, 0.76, 0.55],
    [1, 0.16, 0.04, 0, 0.24, 2.08], [0.1, 0.48, 0.12, -0.82, 0.78, -0.15],
    [0.1, 0.48, 0.12, 0.82, 0.78, -0.15],
    [0.035, 0.06, 3.6, -0.94, 0.23, 0], [0.035, 0.06, 3.6, 0.94, 0.23, 0],
    [0.04, 0.045, 0.22, -0.96, 0.43, -0.2], [0.04, 0.045, 0.22, 0.96, 0.43, -0.2],
  ]),
  headlights: parts([[0.55, 0.19, 0.05, -0.58, 0.39, 2.08], [0.55, 0.19, 0.05, 0.58, 0.39, 2.08]]),
  taillights: parts([[0.56, 0.18, 0.05, -0.58, 0.37, -2.08], [0.56, 0.18, 0.05, 0.58, 0.37, -2.08]]),
};

const glassVertices = carGeometries.glass.getAttribute('position');
for (let vertex = 0; vertex < glassVertices.count; vertex++) {
  if (glassVertices.getY(vertex) > 0.8) {
    const depth = glassVertices.getZ(vertex);
    glassVertices.setZ(vertex, depth > 0 ? depth - 0.3 : depth + 0.18);
  }
}
carGeometries.glass.computeVertexNormals();

export const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x284e59, metalness: 0.4, roughness: 0.18 });
export const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x303b3c, metalness: 0.3, roughness: 0.45 });
export const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xfff0cc, emissive: 0xffdfa0, emissiveIntensity: 0.3 });
export const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xbb3e2d, emissive: 0xff3322, emissiveIntensity: 0.5 });

export function createCar(color: number): THREE.Group {
  const group = new THREE.Group();
  const materials = [new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.28 }), glassMaterial, trimMaterial, headlightMaterial, tailMaterial];
  Object.values(carGeometries).forEach((geometry, index) => {
    const mesh = new THREE.Mesh(geometry, materials[index]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

export function createWheel(): THREE.Group {
  const group = new THREE.Group();
  const tire = new THREE.Mesh(tireGeometry, tireMaterial);
  tire.castShadow = true;
  group.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.258, 8).rotateZ(Math.PI / 2), rimMaterial);
  group.add(rim);
  return group;
}

export interface PersonModel { group: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[] }

export function createPerson(shirt = 0xe7d2a3, skin = 0xb47c5e): PersonModel {
  const group = new THREE.Group();
  const torsoMaterial = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 1 });
  const pantsMaterial = new THREE.MeshStandardMaterial({ color: 0x354b58 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  add(new THREE.CapsuleGeometry(0.22, 0.38, 2, 6), torsoMaterial, 0, 1.15, 0);
  add(new THREE.SphereGeometry(0.19, 8, 6), skinMaterial, 0, 1.72, 0);
  add(new THREE.SphereGeometry(0.196, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), trimMaterial, 0, 1.76, -0.02);
  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.12, 0.9, 0);
    add(new THREE.CapsuleGeometry(0.085, 0.57, 2, 5), pantsMaterial, 0, -0.36, 0, leg);
    add(new THREE.BoxGeometry(0.18, 0.12, 0.3), tireMaterial, 0, -0.8, 0.06, leg);
    group.add(leg);
    legs.push(leg);
    const arm = new THREE.Group();
    arm.position.set(side * 0.29, 1.42, 0);
    add(new THREE.CapsuleGeometry(0.07, 0.45, 2, 5), skinMaterial, 0, -0.28, 0, arm);
    group.add(arm);
    arms.push(arm);
  }
  return { group, legs, arms };
}

export function animatePerson(person: PersonModel, phase: number, moving: boolean): void {
  person.legs.forEach((limb, index) => { limb.rotation.x = moving ? Math.sin(phase + index * Math.PI) * 0.5 : 0; });
  person.arms.forEach((limb, index) => { limb.rotation.x = moving ? -Math.sin(phase + index * Math.PI) * 0.4 : 0; });
}