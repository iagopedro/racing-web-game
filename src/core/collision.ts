import * as CANNON from 'cannon-es';
import { Triangle, Vector3 } from 'three';

export function bodyOverlapsSphere(body: CANNON.Body, center: CANNON.Vec3, radius: number): boolean {
  if (!body.collisionResponse) return false;
  const local = new CANNON.Vec3(), rotation = new CANNON.Quaternion(), origin = new CANNON.Vec3();
  const closest = new Vector3();
  return body.shapes.some((shape, index) => {
    body.quaternion.vmult(body.shapeOffsets[index], origin); origin.vadd(body.position, origin);
    body.quaternion.mult(body.shapeOrientations[index], rotation);
    rotation.conjugate().vmult(center.vsub(origin), local);
    if (shape instanceof CANNON.Sphere) return local.lengthSquared() < (shape.radius + radius) ** 2;
    if (shape instanceof CANNON.Box) {
      return Math.max(0, Math.abs(local.x) - shape.halfExtents.x) ** 2 +
        Math.max(0, Math.abs(local.y) - shape.halfExtents.y) ** 2 +
        Math.max(0, Math.abs(local.z) - shape.halfExtents.z) ** 2 < radius ** 2;
    }
    if (!(shape instanceof CANNON.ConvexPolyhedron)) return false;
    if (shape.faces.every((face, i) => shape.faceNormals[i].dot(local.vsub(shape.vertices[face[0]])) <= 0)) return true;
    const point = new Vector3(local.x, local.y, local.z);
    return shape.faces.some(face => {
      for (let i = 1; i < face.length - 1; i++) {
        const [a, b, c] = [face[0], face[i], face[i + 1]].map(vertex => {
          const value = shape.vertices[vertex]; return new Vector3(value.x, value.y, value.z);
        });
        new Triangle(a, b, c).closestPointToPoint(point, closest);
        if (closest.distanceToSquared(point) < radius ** 2) return true;
      }
      return false;
    });
  });
}
