export type Vec2 = { x: number; z: number };

export type Rect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type Bounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type FindGuardPathArgs = {
  start: Vec2;
  target: Vec2;
  walls: Rect[];
  radius: number;
  bounds: Bounds;
  step?: number;
  maxIterations?: number;
};

type Cell = {
  x: number;
  z: number;
};

const DEFAULT_STEP = 0.5;
const DEFAULT_MAX_ITERATIONS = 20_000;
const EPSILON = 1e-6;

export function hasClearPath(start: Vec2, target: Vec2, walls: Rect[], radius: number): boolean {
  return !walls.some((wall) => lineIntersectsExpandedRect(start, target, wall, radius));
}

export function findGuardPath({
  start,
  target,
  walls,
  radius,
  bounds,
  step = DEFAULT_STEP,
  maxIterations = DEFAULT_MAX_ITERATIONS,
}: FindGuardPathArgs): Vec2[] {
  const startCell = findNearestWalkableCell(start, walls, radius, bounds, step);
  const goalCell = findNearestWalkableCell(target, walls, radius, bounds, step);

  const startCenter = cellToPoint(startCell, step);
  const goalCenter = cellToPoint(goalCell, step);

  if (hasClearPath(start, target, walls, radius)) {
    return [target];
  }

  const frontier: Cell[] = [startCell];
  const openSet = new Set([cellKey(startCell)]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[cellKey(startCell), 0]]);
  const fScore = new Map<string, number>([[cellKey(startCell), distance(startCenter, goalCenter)]]);

  let iterations = 0;
  while (frontier.length > 0 && iterations < maxIterations) {
    iterations += 1;
    frontier.sort((left, right) => (fScore.get(cellKey(left)) ?? Number.POSITIVE_INFINITY) - (fScore.get(cellKey(right)) ?? Number.POSITIVE_INFINITY));
    const current = frontier.shift()!;
    const currentKey = cellKey(current);
    openSet.delete(currentKey);

    if (current.x === goalCell.x && current.z === goalCell.z) {
      const rawPath = reconstructPath(cameFrom, current).slice(1).map((cell) => cellToPoint(cell, step));
      const withGoal = rawPath.length === 0 ? [goalCenter] : [...rawPath, goalCenter];
      const simplified = simplifyPath(start, withGoal, walls, radius);
      if (simplified.length === 0) {
        return [goalCenter];
      }
      simplified[simplified.length - 1] = goalCenter;
      return simplified;
    }

    for (const neighbor of getNeighbors(current, walls, radius, bounds, step)) {
      const neighborKey = cellKey(neighbor);
      const tentativeScore = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + distance(cellToPoint(current, step), cellToPoint(neighbor, step));
      if (tentativeScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentativeScore);
      fScore.set(neighborKey, tentativeScore + distance(cellToPoint(neighbor, step), goalCenter));
      if (!openSet.has(neighborKey)) {
        frontier.push(neighbor);
        openSet.add(neighborKey);
      }
    }
  }

  return [goalCenter];
}

function simplifyPath(start: Vec2, path: Vec2[], walls: Rect[], radius: number): Vec2[] {
  const result: Vec2[] = [];
  let anchor = start;
  let index = 0;

  while (index < path.length) {
    let farthest = index;
    for (let candidate = index; candidate < path.length; candidate += 1) {
      if (!hasClearPath(anchor, path[candidate], walls, radius)) {
        break;
      }
      farthest = candidate;
    }

    const waypoint = path[farthest];
    result.push(waypoint);
    anchor = waypoint;
    index = farthest + 1;
  }

  return result;
}

function reconstructPath(cameFrom: Map<string, string>, current: Cell): Cell[] {
  const path = [current];
  let key = cellKey(current);

  while (cameFrom.has(key)) {
    key = cameFrom.get(key)!;
    path.push(keyToCell(key));
  }

  path.reverse();
  return path;
}

function getNeighbors(cell: Cell, walls: Rect[], radius: number, bounds: Bounds, step: number): Cell[] {
  const neighbors: Cell[] = [];

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (dx === 0 && dz === 0) {
        continue;
      }

      const candidate = { x: cell.x + dx, z: cell.z + dz };
      if (!isWalkable(candidate, walls, radius, bounds, step)) {
        continue;
      }

      if (dx !== 0 && dz !== 0) {
        const horizontal = { x: cell.x + dx, z: cell.z };
        const vertical = { x: cell.x, z: cell.z + dz };
        if (!isWalkable(horizontal, walls, radius, bounds, step) || !isWalkable(vertical, walls, radius, bounds, step)) {
          continue;
        }
      }

      neighbors.push(candidate);
    }
  }

  return neighbors;
}

function findNearestWalkableCell(point: Vec2, walls: Rect[], radius: number, bounds: Bounds, step: number): Cell {
  const origin = pointToCell(point, step);
  if (isWalkable(origin, walls, radius, bounds, step)) {
    return origin;
  }

  let best: Cell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const maxRadius = Math.ceil(Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / step);

  for (let ring = 1; ring <= maxRadius; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) {
          continue;
        }

        const candidate = { x: origin.x + dx, z: origin.z + dz };
        if (!isWalkable(candidate, walls, radius, bounds, step)) {
          continue;
        }

        const candidatePoint = cellToPoint(candidate, step);
        const candidateDistance = distance(point, candidatePoint);
        if (candidateDistance < bestDistance) {
          bestDistance = candidateDistance;
          best = candidate;
        }
      }
    }

    if (best) {
      return best;
    }
  }

  return origin;
}

function isWalkable(cell: Cell, walls: Rect[], radius: number, bounds: Bounds, step: number): boolean {
  const point = cellToPoint(cell, step);
  if (point.x < bounds.minX + radius || point.x > bounds.maxX - radius || point.z < bounds.minZ + radius || point.z > bounds.maxZ - radius) {
    return false;
  }

  return !walls.some((wall) => pointInExpandedRect(point, wall, radius));
}

function pointInExpandedRect(point: Vec2, wall: Rect, radius: number): boolean {
  return point.x >= wall.minX - radius - EPSILON
    && point.x <= wall.maxX + radius + EPSILON
    && point.z >= wall.minZ - radius - EPSILON
    && point.z <= wall.maxZ + radius + EPSILON;
}

function lineIntersectsExpandedRect(start: Vec2, target: Vec2, wall: Rect, radius: number): boolean {
  const expanded = {
    minX: wall.minX - radius,
    maxX: wall.maxX + radius,
    minZ: wall.minZ - radius,
    maxZ: wall.maxZ + radius,
  };

  if (pointInExpandedRect(start, wall, radius) || pointInExpandedRect(target, wall, radius)) {
    return true;
  }

  const edges: Array<[Vec2, Vec2]> = [
    [{ x: expanded.minX, z: expanded.minZ }, { x: expanded.maxX, z: expanded.minZ }],
    [{ x: expanded.maxX, z: expanded.minZ }, { x: expanded.maxX, z: expanded.maxZ }],
    [{ x: expanded.maxX, z: expanded.maxZ }, { x: expanded.minX, z: expanded.maxZ }],
    [{ x: expanded.minX, z: expanded.maxZ }, { x: expanded.minX, z: expanded.minZ }],
  ];

  return edges.some(([from, to]) => segmentsIntersect(start, target, from, to));
}

function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const denominator = determinant(a1.x - a2.x, a1.z - a2.z, b1.x - b2.x, b1.z - b2.z);
  if (Math.abs(denominator) < EPSILON) {
    return false;
  }

  const pre = determinant(a1.x, a1.z, a2.x, a2.z);
  const post = determinant(b1.x, b1.z, b2.x, b2.z);
  const x = determinant(pre, a1.x - a2.x, post, b1.x - b2.x) / denominator;
  const z = determinant(pre, a1.z - a2.z, post, b1.z - b2.z) / denominator;

  return within(x, a1.x, a2.x)
    && within(x, b1.x, b2.x)
    && within(z, a1.z, a2.z)
    && within(z, b1.z, b2.z);
}

function within(value: number, start: number, end: number): boolean {
  return value >= Math.min(start, end) - EPSILON && value <= Math.max(start, end) + EPSILON;
}

function determinant(a: number, b: number, c: number, d: number): number {
  return a * d - b * c;
}

function pointToCell(point: Vec2, step: number): Cell {
  return {
    x: Math.round(point.x / step),
    z: Math.round(point.z / step),
  };
}

function cellToPoint(cell: Cell, step: number): Vec2 {
  return {
    x: cell.x * step,
    z: cell.z * step,
  };
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.z}`;
}

function keyToCell(key: string): Cell {
  const [x, z] = key.split(',').map((value) => Number.parseInt(value, 10));
  return { x, z };
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(right.x - left.x, right.z - left.z);
}
