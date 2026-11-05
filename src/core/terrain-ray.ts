import * as CANNON from 'cannon-es';

class TerrainRay extends CANNON.Ray {
  override _intersectHeightfield(shape: CANNON.Heightfield, quaternion: CANNON.Quaternion, origin: CANNON.Vec3, body: CANNON.Body, reportedShape: CANNON.Shape): void {
    const from = new CANNON.Vec3(), to = new CANNON.Vec3();
    CANNON.Transform.pointToLocalFrame(origin, quaternion, this.from, from);
    CANNON.Transform.pointToLocalFrame(origin, quaternion, this.to, to);
    const delta = to.vsub(from), size = shape.elementSize, tolerance = 1e-9;
    const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) / size - tolerance));
    const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) / size - tolerance));
    const maxX = Math.min(shape.data.length - 2, Math.floor(Math.max(from.x, to.x) / size + tolerance));
    const maxY = Math.min(shape.data[0].length - 2, Math.floor(Math.max(from.y, to.y) / size + tolerance));
    const a = new CANNON.Vec3(), b = new CANNON.Vec3(), c = new CANNON.Vec3();
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (const upper of [false, true]) {
      shape.getTriangle(x, y, upper, a, b, c);
      const normal = b.vsub(a).cross(c.vsub(a));
      if (normal.z < 0) normal.negate(normal);
      const denominator = normal.dot(delta);
      if (Math.abs(denominator) < 1e-12 || (this.skipBackfaces && denominator >= 0)) continue;
      const t = normal.dot(a.vsub(from)) / denominator;
      if (t < -tolerance || t > 1 + tolerance) continue;
      const point = delta.scale(Math.max(0, Math.min(1, t))).vadd(from);
      const u = point.x / size - x, v = point.y / size - y;
      // Include shared grid/diagonal edges. Cannon's strict triangle test can
      // reject both neighboring faces and drop a wheel through a visible road.
      if (u < -tolerance || v < -tolerance || u > 1 + tolerance || v > 1 + tolerance ||
          (upper ? u + v < 1 - tolerance : u + v > 1 + tolerance)) continue;
      const worldPoint = new CANNON.Vec3(), worldNormal = new CANNON.Vec3();
      CANNON.Transform.pointToWorldFrame(origin, quaternion, point, worldPoint);
      quaternion.vmult(normal, worldNormal); worldNormal.normalize();
      const distance = this.from.distanceTo(worldPoint);
      if (!this.result.hasHit || distance < this.result.distance) {
        this.result.set(this.from, this.to, worldNormal, worldPoint, reportedShape, body, distance);
        this.result.hasHit = true; this.hasHit = true;
      }
    }
  }
}

export class DrivingWorld extends CANNON.World {
  private terrainRay = new TerrainRay();
  override raycastClosest(from = new CANNON.Vec3(), to = new CANNON.Vec3(), options: CANNON.RayOptions = {}, result = new CANNON.RaycastResult()): boolean {
    return this.terrainRay.intersectWorld(this, { ...options, from, to, result, mode: CANNON.Ray.CLOSEST });
  }
}
