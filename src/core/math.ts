import type { Vector2 } from './types';

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const randomRange = (min: number, max: number) => min + Math.random() * (max - min);

export const distanceSquared = (a: Vector2, b: Vector2) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const normalize = (vector: Vector2): Vector2 => {
  const length = Math.hypot(vector.x, vector.y);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
};

export const wrapPosition = (position: Vector2, width: number, height: number): Vector2 => ({
  x: (position.x + width) % width,
  y: (position.y + height) % height,
});
