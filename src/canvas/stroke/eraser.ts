import { Stroke, Point } from '../../types/canvas';
import { Viewport } from '../engine/Viewport';

/**
 * Точечный ластик с субпиксельной точностью:
 * разбивает отрезок на мелкие шаги (~3px) и вырезает всё,
 * что попадает в окружность ластика радиуса radius.
 */
export function erasePointsFromStroke(
  stroke: Stroke,
  center: { x: number; y: number },
  radius: number
): Stroke[] {
  const { points } = stroke;
  if (!points || points.length === 0) return [];

  // Контур чернил выходит наружу от центральных точек на половину ширины штриха
  const strokeHalfWidth = stroke.baseWidth / 2;
  const effectiveAabbRadius = radius + strokeHalfWidth;

  // Быстрая AABB отсечка
  if (
    center.x + effectiveAabbRadius < stroke.bounds.minX ||
    center.x - effectiveAabbRadius > stroke.bounds.maxX ||
    center.y + effectiveAabbRadius < stroke.bounds.minY ||
    center.y - effectiveAabbRadius > stroke.bounds.maxY
  ) {
    return [stroke];
  }

  // Плотная интерполяция точек вдоль контура штриха для идеально ровного среза
  const densePoints: Point[] = [];
  const step = Math.max(2, Math.min(4, radius / 4));

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    if (i === 0) {
      densePoints.push(curr);
      continue;
    }
    const prev = points[i - 1];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dist = Math.hypot(dx, dy);

    if (dist > step) {
      const numSteps = Math.floor(dist / step);
      for (let s = 1; s <= numSteps; s++) {
        const t = s / (numSteps + 1);
        densePoints.push({
          x: prev.x + dx * t,
          y: prev.y + dy * t,
          pressure: prev.pressure + ((curr.pressure ?? 0.5) - prev.pressure) * t,
          t: prev.t + ((curr.t ?? 0) - prev.t) * t,
        });
      }
    }
    densePoints.push(curr);
  }

  // Точка считается стёртой, если контур её чернил пересекает окружность ластика.
  // Это обеспечивает 100% совпадение видимого кружка на экране с физически стираемой областью.
  const isErased = (p: Point) => {
    const pointInkRadius = (stroke.baseWidth * (p.pressure ?? 0.5)) * 0.45;
    return Math.hypot(p.x - center.x, p.y - center.y) <= (radius + pointInkRadius);
  };

  let anyErased = false;
  const segments: Point[][] = [];
  let currentSegment: Point[] = [];

  for (let i = 0; i < densePoints.length; i++) {
    const pt = densePoints[i];
    if (isErased(pt)) {
      anyErased = true;
      if (currentSegment.length > 1) {
        segments.push(currentSegment);
      }
      currentSegment = [];
    } else {
      currentSegment.push(pt);
    }
  }

  if (currentSegment.length > 1) {
    segments.push(currentSegment);
  }

  // Если ластик ничего не задел
  if (!anyErased) {
    return [stroke];
  }

  // Преобразуем уцелевшие сегменты обратно в штрихи
  const survivingStrokes: Stroke[] = [];
  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const seg = segments[sIdx];
    // Отсеиваем микро-осколки длиной меньше 3px
    let segLen = 0;
    for (let k = 1; k < seg.length; k++) {
      segLen += Math.hypot(seg[k].x - seg[k - 1].x, seg[k].y - seg[k - 1].y);
    }
    if (segLen < 3) continue;

    survivingStrokes.push({
      ...stroke,
      id: segments.length === 1 && sIdx === 0 ? stroke.id : `${stroke.id}-p${sIdx}-${Date.now().toString(36)}`,
      points: seg,
      bounds: Viewport.computeBounds(seg, stroke.baseWidth),
    });
  }

  return survivingStrokes;
}
