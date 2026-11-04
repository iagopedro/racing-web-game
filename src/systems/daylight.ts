import * as THREE from 'three';

export function timeLighting(hours: number): { sun: number; night: number } {
  const sun = Math.sin((hours - 6) / 24 * Math.PI * 2);
  return { sun, night: 1 - THREE.MathUtils.smoothstep(sun, -0.16, 0.24) };
}

export class Daylight {
  hours = 16.4;
  rate = 120;
  night = 0;
  readonly sun: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sunDisc: THREE.Mesh;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sun = new THREE.DirectionalLight(0xffe4bd, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 600 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.ambient = new THREE.HemisphereLight(0xd0edf5, 0x69785a, 1.8);
    scene.add(this.sun, this.sun.target, this.ambient);
    scene.fog = new THREE.Fog(0xc9d8cc, 120, 690);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x74b7cb) }, bottom: { value: new THREE.Color(0xf1d3ac) } },
      vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vPosition; void main(){float h=pow(max(normalize(vPosition).y,0.0),0.55);gl_FragColor=vec4(mix(bottom,top,h),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    }));
    scene.add(this.sky);
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(22, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffedc4, fog: false }));
    scene.add(this.sunDisc);
  }

  update(delta: number, focus: THREE.Vector3): void {
    this.hours = (this.hours + delta * this.rate / 3600) % 24;
    const light = timeLighting(this.hours);
    this.night = light.night;
    const angle = (this.hours - 6) / 24 * Math.PI * 2;
    const direction = new THREE.Vector3(Math.cos(angle) * -0.8, light.sun, 0.5).normalize();
    const lightingDirection = direction.clone();
    lightingDirection.y = Math.max(lightingDirection.y, light.night * 0.65);
    lightingDirection.normalize();
    this.sun.position.copy(focus).addScaledVector(lightingDirection, 230);
    this.sun.target.position.copy(focus);
    this.sun.intensity = Math.max(0, light.sun) * 2.7 + 0.13 + light.night * 0.65;
    this.sun.color.set(light.sun < 0.3 ? 0xffc398 : 0xffefd7).lerp(new THREE.Color(0xb9cfee), light.night);
    this.ambient.intensity = 1.05 + (1 - light.night) * 0.95;
    this.ambient.color.set(0xccecf3).lerp(new THREE.Color(0xb5c9df), light.night);
    this.ambient.groundColor.set(0x69785a).lerp(new THREE.Color(0x778a99), light.night);
    const dusk = 1 - THREE.MathUtils.smoothstep(Math.abs(light.sun), 0.04, 0.6);
    const top = new THREE.Color(0x78b5c8).lerp(new THREE.Color(0x111d35), light.night);
    const bottom = new THREE.Color(0xd2dfcf).lerp(new THREE.Color(0xe4ad86), dusk * (1 - light.night)).lerp(new THREE.Color(0x293d53), light.night);
    this.sky.material.uniforms.top.value.copy(top);
    this.sky.material.uniforms.bottom.value.copy(bottom);
    this.sky.position.copy(focus);
    (this.scene.fog as THREE.Fog).color.copy(bottom);
    this.sunDisc.position.copy(focus).addScaledVector(direction, 2200);
    this.sunDisc.visible = light.sun > -0.08;
  }

  get formattedTime(): string {
    const hours = Math.floor(this.hours);
    const minutes = Math.floor((this.hours % 1) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
}