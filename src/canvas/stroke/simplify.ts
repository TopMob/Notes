import { Point } from '../../types/canvas';

/**
 * Расстояние от точки p до отрезка lineStart-lineEnd
 */
function getPerpendicularDistance(p: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = p.x - lineStart.x;
    const py = p.y - lineStart.y;
    return Math.sqrt(px * px + py * py);
  }

  // Проекция точки p на отрезок
  const t = Math.max(0, Math.min(1, ((p.x - lineStart.x) * dx + (p.y - lineStart.y) * dy) / lengthSquared));
  const projectionX = lineStart.x + t * dx;
  const projectionY = lineStart.y + t * dy;

  const distX = p.x - projectionX;
  const distY = p.y - projectionY;

  return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Алгоритм Дугласа-Пекера для сжатия массива точек штриха
 * Сокращает количество точек в 3-6 раз без визуальной потери формы линии
 */
export function simplifyDouglasPeucker(points: Point[], epsilon = 0.8): Point[] {
  if (points.length <= 2) {
    return points;
  }

  let maxDistance = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = getPerpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDistance) {
      index = i;
      maxDistance = d;
    }
  }

  if (maxDistance > epsilon) {
    const leftRecursive = simplifyDouglasPeucker(points.slice(0, index + 1), epsilon);
    const rightRecursive = simplifyDouglasPeucker(points.slice(index), epsilon);

    return [...leftRecursive.slice(0, -1), ...rightRecursive];
  }

  return [points[0], points[end]];
}
