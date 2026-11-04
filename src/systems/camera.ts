import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Player } from './player';

export class CameraRig {
  camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.15, 6500);
  mode = 0;
  yaw = Math.PI / 2;
  orbit = 0;
  private position = new THREE.Vector3();
  private target = new THREE.Vector3();
  private initialized = false;
  private world: CANNON.World;
  private ray = new CANNON.RaycastResult();

  constructor(world: CANNON.World, canvas: HTMLCanvasElement) {
    this.world = world;
    let dragging = false;
    let lastX = 0;
    canvas.addEventListener('pointerdown', event => { dragging = true; lastX = event.clientX; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => {
      if (!dragging) return;
      this.orbit -= (event.clientX - lastX) * 0.007;
      lastX = event.clientX;
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
  }

  update(player: Player, delta: number, started: boolean): void {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.model.quaternion);
    const carYaw = Math.atan2(forward.x, forward.z);
    if (player.driving) {
      const difference = Math.atan2(Math.sin(carYaw - this.yaw), Math.cos(carYaw - this.yaw));
      this.yaw += difference * (1 - Math.exp(-delta * 3));
      if (Math.abs(player.car.speed) > 1) this.orbit *= Math.exp(-delta * 0.7);
    }
    const angle = this.yaw + this.orbit;
    const close = this.mode === 1 && player.driving;
    const distance = started ? (player.driving ? (close ? 5.2 : 10.5 + Math.min(Math.abs(player.car.speed) * 0.07, 2.5)) : 7.5) : 14;
    const height = started ? (player.driving ? (close ? 1.8 : 3.5) : 3.4) : 4.3;
    this.target.copy(player.focus).add(new THREE.Vector3(0, player.driving ? 0.9 : 1.1, 0));
    if (!started) { this.target.copy(player.model.position).add(new THREE.Vector3(0, 0.8, 0)); }
    this.position.copy(this.target).add(new THREE.Vector3(-Math.sin(angle) * distance, height, -Math.cos(angle) * distance));
    const from = new CANNON.Vec3(this.target.x, this.target.y, this.target.z);
    const to = new CANNON.Vec3(this.position.x, this.position.y, this.position.z);
    const carResponse = player.car.body.collisionResponse;
    player.car.body.collisionResponse = false;
    player.walker.collisionResponse = false;
    this.ray.reset();
    if (this.world.raycastClosest(from, to, { skipBackfaces: true }, this.ray)) {
      const fraction = Math.max(0.15, (this.ray.distance - 0.7) / from.distanceTo(to));
      this.position.lerpVectors(this.target, this.position, fraction);
    }
    player.car.body.collisionResponse = carResponse;
    player.walker.collisionResponse = true;
    this.camera.position.lerp(this.position, this.initialized ? 1 - Math.exp(-delta * 7) : 1);
    this.initialized = true;
    this.camera.lookAt(this.target);
    const fov = 54 + (player.driving ? Math.min(Math.abs(player.car.speed) * 0.4, 12) : 0);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 3, delta);
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}