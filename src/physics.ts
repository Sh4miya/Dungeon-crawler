export type Vec2 = { x: number; z: number };

export type Rect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const EPSILON = 1e-6;

export function moveCircle(position: Vec2, velocity: Vec2, radius: number, delta: number, walls: Rect[]): Vec2 {
  const totalMoveX = velocity.x * delta;
  const totalMoveZ = velocity.z * delta;
  const maxStep = Math.max(radius * 0.5, 0.08);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(totalMoveX), Math.abs(totalMoveZ)) / maxStep));
  const stepX = totalMoveX / steps;
  const stepZ = totalMoveZ / steps;

  const next = { ...position };
  for (let index = 0; index < steps; index += 1) {
    next.x += stepX;
    resolveCircleCollisions(next, radius, walls, 'x');
    next.z += stepZ;
    resolveCircleCollisions(next, radius, walls, 'z');
  }

  return next;
}

function resolveCircleCollisions(position: Vec2, radius: number, walls: Rect[], axis: 'x' | 'z'): void {
  for (const wall of walls) {
    resolveCircleVsRect(position, radius, wall, axis);
  }
}

function resolveCircleVsRect(position: Vec2, radius: number, wall: Rect, axis: 'x' | 'z'): void {
  const closestX = clamp(position.x, wall.minX, wall.maxX);
  const closestZ = clamp(position.z, wall.minZ, wall.maxZ);
  const dx = position.x - closestX;
  const dz = position.z - closestZ;
  const distanceSq = dx * dx + dz * dz;

  if (distanceSq >= radius * radius) {
    return;
  }

  if (distanceSq > EPSILON) {
    const distance = Math.sqrt(distanceSq);
    const overlap = radius - distance;
    if (axis === 'x') {
      position.x += (dx / distance) * overlap;
    } else {
      position.z += (dz / distance) * overlap;
    }
    return;
  }

  const pushLeft = Math.abs(position.x - wall.minX);
  const pushRight = Math.abs(wall.maxX - position.x);
  const pushDown = Math.abs(position.z - wall.minZ);
  const pushUp = Math.abs(wall.maxZ - position.z);
  const nearest = Math.min(pushLeft, pushRight, pushDown, pushUp);

  if ((nearest === pushLeft || nearest === pushRight) && axis === 'x') {
    position.x = nearest === pushLeft ? wall.minX - radius : wall.maxX + radius;
    return;
  }

  if ((nearest === pushDown || nearest === pushUp) && axis === 'z') {
    position.z = nearest === pushDown ? wall.minZ - radius : wall.maxZ + radius;
    return;
  }

  if (axis === 'x') {
    position.x = pushLeft <= pushRight ? wall.minX - radius : wall.maxX + radius;
  } else {
    position.z = pushDown <= pushUp ? wall.minZ - radius : wall.maxZ + radius;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
