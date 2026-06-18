import test from 'node:test';
import assert from 'node:assert/strict';

import { moveCircle, type Rect, type Vec2 } from '../src/physics.ts';

const radius = 0.42;
const walls: Rect[] = [
  { minX: 10, maxX: 12, minZ: 9, maxZ: 15 },
];

test('moveCircle stops knockback before a blocking wall instead of tunneling through it', () => {
  const start: Vec2 = { x: 9.2, z: 12 };
  const velocity: Vec2 = { x: 2.3, z: 0 };

  const end = moveCircle(start, velocity, radius, 1, walls);

  assert.ok(end.x <= walls[0].minX - radius + 1e-6, `expected x=${end.x} to stay on the near side of the wall`);
  assert.equal(end.z, start.z);
});

test('moveCircle still allows free movement when no wall blocks the path', () => {
  const start: Vec2 = { x: 5, z: 5 };
  const velocity: Vec2 = { x: 1.2, z: -0.4 };

  const end = moveCircle(start, velocity, radius, 1, walls);

  assert.ok(Math.abs(end.x - 6.2) <= 1e-9);
  assert.ok(Math.abs(end.z - 4.6) <= 1e-9);
});
