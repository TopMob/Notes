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
 * Алгоритм Дугласа-Пекера для сжатия массива точек штриха.
 * Итеративная реализация с явным стеком: устраняет создание сотен временных массивов slice
 * и исключает риск переполнения стека вызовов на сверхдлинных штрихах.
 */
export function simplifyDouglasPeucker(points: Point[], epsilon = 0.8): Point[] {
  const len = points.length;
  if (len <= 2) {
    return points;
  }

  const keep = new Uint8Array(len);
  keep[0] = 1;
  keep[len - 1] = 1;

  const stack: [number, number][] = [[0, len - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    let maxDist = 0;
    let maxIdx = start;
    const pStart = points[start];
    const pEnd = points[end];

    for (let i = start + 1; i < end; i++) {
      const d = getPerpendicularDistance(points[i], pStart, pEnd);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < len; i++) {
    if (keep[i] === 1) {
      result.push(points[i]);
    }
  }

  return result;
}
