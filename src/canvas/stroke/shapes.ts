import { ShapeObject, Point, AABB } from '../../types/canvas';

export function computeShapeBounds(anchor: Point, end: Point, strokeWidth = 2): AABB {
  const minX = Math.min(anchor.x, end.x) - strokeWidth;
  const minY = Math.min(anchor.y, end.y) - strokeWidth;
  const maxX = Math.max(anchor.x, end.x) + strokeWidth;
  const maxY = Math.max(anchor.y, end.y) + strokeWidth;
  return { minX, minY, maxX, maxY };
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const l2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

export function isShapeHitByEraser(shape: ShapeObject, center: { x: number; y: number }, radius: number): boolean {
  const effRadius = radius + (shape.style.width || 2) / 2;
  const { anchor, end, type } = shape;

  // Быстрый AABB тест
  if (
    center.x + effRadius < shape.bounds.minX ||
    center.x - effRadius > shape.bounds.maxX ||
    center.y + effRadius < shape.bounds.minY ||
    center.y - effRadius > shape.bounds.maxY
  ) {
    return false;
  }

  if (type === 'line' || type === 'arrow') {
    return distToSegment(center, anchor, end) <= effRadius;
  }

  if (type === 'rect') {
    const x1 = Math.min(anchor.x, end.x);
    const x2 = Math.max(anchor.x, end.x);
    const y1 = Math.min(anchor.y, end.y);
    const y2 = Math.max(anchor.y, end.y);
    const dTop = distToSegment(center, { x: x1, y: y1 }, { x: x2, y: y1 });
    const dBottom = distToSegment(center, { x: x1, y: y2 }, { x: x2, y: y2 });
    const dLeft = distToSegment(center, { x: x1, y: y1 }, { x: x1, y: y2 });
    const dRight = distToSegment(center, { x: x2, y: y1 }, { x: x2, y: y2 });
    return Math.min(dTop, dBottom, dLeft, dRight) <= effRadius;
  }

  if (type === 'ellipse') {
    const rx = Math.abs(end.x - anchor.x) / 2;
    const ry = Math.abs(end.y - anchor.y) / 2;
    if (rx === 0 || ry === 0) return false;
    const cx = Math.min(anchor.x, end.x) + rx;
    const cy = Math.min(anchor.y, end.y) + ry;
    // Расстояние от центра эллипса до точки
    const angle = Math.atan2(center.y - cy, center.x - cx);
    const perimeterX = cx + rx * Math.cos(angle);
    const perimeterY = cy + ry * Math.sin(angle);
    return Math.hypot(center.x - perimeterX, center.y - perimeterY) <= effRadius;
  }

  if (type === 'axis') {
    const originX = Math.min(anchor.x, end.x);
    const originY = Math.max(anchor.y, end.y);
    const topY = Math.min(anchor.y, end.y);
    const rightX = Math.max(anchor.x, end.x);
    const dY = distToSegment(center, { x: originX, y: originY }, { x: originX, y: topY });
    const dX = distToSegment(center, { x: originX, y: originY }, { x: rightX, y: originY });
    return Math.min(dY, dX) <= effRadius;
  }

  return false;
}

export function snapShapeEndPoint(anchor: Point, current: Point, type: ShapeObject['type']): Point {
  const dx = current.x - anchor.x;
  const dy = current.y - anchor.y;

  if (type === 'rect' || type === 'ellipse') {
    // При зажатом Shift делаем 1:1 (квадрат или круг)
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      ...current,
      x: anchor.x + Math.sign(dx || 1) * size,
      y: anchor.y + Math.sign(dy || 1) * size,
    };
  }

  if (type === 'line' || type === 'arrow') {
    // Привязка угла с шагом 15 градусов
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 12; // 15 градусов
    const snappedAngle = Math.round(angle / step) * step;
    const distance = Math.hypot(dx, dy);

    return {
      ...current,
      x: anchor.x + Math.cos(snappedAngle) * distance,
      y: anchor.y + Math.sin(snappedAngle) * distance,
    };
  }

  return current;
}

export function drawShapeToCanvas(ctx: CanvasRenderingContext2D, shape: ShapeObject): void {
  const { anchor, end, type, style } = shape;
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (style.dashed) {
    ctx.setLineDash([8, 6]);
  } else {
    ctx.setLineDash([]);
  }

  switch (type) {
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }

    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Наконечник стрелки
      const angle = Math.atan2(end.y - anchor.y, end.x - anchor.x);
      const headLength = Math.max(12, style.width * 3.5);
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle - Math.PI / 6),
        end.y - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        end.x - headLength * Math.cos(angle + Math.PI / 6),
        end.y - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'rect': {
      const x = Math.min(anchor.x, end.x);
      const y = Math.min(anchor.y, end.y);
      const w = Math.abs(end.x - anchor.x);
      const h = Math.abs(end.y - anchor.y);
      ctx.strokeRect(x, y, w, h);
      break;
    }

    case 'ellipse': {
      const rx = Math.abs(end.x - anchor.x) / 2;
      const ry = Math.abs(end.y - anchor.y) / 2;
      const cx = Math.min(anchor.x, end.x) + rx;
      const cy = Math.min(anchor.y, end.y) + ry;

      if (rx > 0 && ry > 0) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'axis': {
      // Координатные оси X и Y
      const originX = Math.min(anchor.x, end.x);
      const originY = Math.max(anchor.y, end.y);
      const topY = Math.min(anchor.y, end.y);
      const rightX = Math.max(anchor.x, end.x);

      // Ось Y (вверх)
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(originX, topY);
      ctx.stroke();

      // Стрелка Y
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.moveTo(originX, topY);
      ctx.lineTo(originX - 5, topY + 10);
      ctx.lineTo(originX + 5, topY + 10);
      ctx.closePath();
      ctx.fill();

      // Ось X (вправо)
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(rightX, originY);
      ctx.stroke();

      // Стрелка X
      ctx.beginPath();
      ctx.moveTo(rightX, originY);
      ctx.lineTo(rightX - 10, originY - 5);
      ctx.lineTo(rightX - 10, originY + 5);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}
