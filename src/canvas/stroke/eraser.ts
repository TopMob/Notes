import { Stroke, Point } from '../../types/canvas';
import { Viewport } from '../engine/Viewport';

/**
 * Проверяет, пересекает ли отрезок p1-p2 круг с центром center и радиусом r
 */
export function segmentIntersectsCircle(
  p1: Point,
  p2: Point,
  center: { x: number; y: number },
  r: number
): boolean {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p1.x - center.x, p1.y - center.y) <= r;
  }

  const t = Math.max(0, Math.min(1, ((center.x - p1.x) * dx + (center.y - p1.y) * dy) / lenSq));
  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  return Math.hypot(center.x - projX, center.y - projY) <= r;
}

/**
 * Точечный ластик: стирает точки штриха внутри радиуса ластика,
 * разрезая исходный штрих на сохранившиеся непрерывные части (суб-штрихи).
 */
export function erasePointsFromStroke(
  stroke: Stroke,
  center: { x: number; y: number },
  radius: number
): Stroke[] {
  const effectiveRadius = radius + stroke.baseWidth / 2;
  const { points } = stroke;
  if (!points || points.length === 0) return [];

  // Быстрая проверка AABB
  if (
    center.x + effectiveRadius < stroke.bounds.minX ||
    center.x - effectiveRadius > stroke.bounds.maxX ||
    center.y + effectiveRadius < stroke.bounds.minY ||
    center.y - effectiveRadius > stroke.bounds.maxY
  ) {
    return [stroke]; // Никакого пересечения с AABB
  }

  const isErased = (p: Point) => {
    return Math.hypot(p.x - center.x, p.y - center.y) <= effectiveRadius;
  };

  // Проверяем, задевает ли вообще ластик хоть какую-то точку или отрезок
  let anyErased = false;
  for (let i = 0; i < points.length; i++) {
    if (isErased(points[i])) {
      anyErased = true;
      break;
    }
    if (i > 0 && segmentIntersectsCircle(points[i - 1], points[i], center, effectiveRadius)) {
      anyErased = true;
      break;
    }
  }

  if (!anyErased) {
    return [stroke]; // Штрих не задет
  }

  // Разрезаем массив точек на непрерывные сегменты уцелевших точек
  const segments: Point[][] = [];
  let currentSegment: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (isErased(pt)) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    } else {
      // Проверяем, не пересёк ли отрезок круг ластика между предыдущей и текущей точкой
      if (currentSegment.length > 0) {
        const prev = points[i - 1];
        if (segmentIntersectsCircle(prev, pt, center, effectiveRadius)) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      }
      currentSegment.push(pt);
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // Преобразуем выжившие сегменты в штрихи
  const survivingStrokes: Stroke[] = [];
  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const seg = segments[sIdx];
    if (seg.length > 0) {
      survivingStrokes.push({
        ...stroke,
        id: segments.length === 1 && sIdx === 0 ? stroke.id : `${stroke.id}-p${sIdx}-${Date.now().toString(36)}`,
        points: seg,
        bounds: Viewport.computeBounds(seg, stroke.baseWidth),
      });
    }
  }

  return survivingStrokes;
}
