import test from 'node:test';
import assert from 'node:assert/strict';

import { findGuardPath, hasClearPath, type Rect, type Vec2 } from '../src/guardNavigation.ts';

const radius = 0.42;
const walls: Rect[] = [
  { minX: 10, maxX: 12, minZ: 9, maxZ: 15 },
];

const start: Vec2 = { x: 8, z: 12 };
const target: Vec2 = { x: 14, z: 12 };

test('hasClearPath reports a blocked straight-line route through a wall', () => {
  assert.equal(hasClearPath(start, target, walls, radius), false);
});

test('findGuardPath routes around blocking walls without any segment cutting through them', () => {
  const path = findGuardPath({
    start,
    target,
    walls,
    radius,
    bounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 24 },
    step: 0.5,
  });

  assert.ok(path.length >= 2, 'expected at least one intermediate waypoint to go around the wall');

  let previous = start;
  for (const waypoint of path) {
    assert.equal(hasClearPath(previous, waypoint, walls, radius), true, `segment ${JSON.stringify(previous)} -> ${JSON.stringify(waypoint)} should stay clear of walls`);
    previous = waypoint;
  }

  const final = path[path.length - 1];
  assert.ok(Math.abs(final.x - target.x) <= 0.51 && Math.abs(final.z - target.z) <= 0.51, 'path should finish at the target cell');
});
