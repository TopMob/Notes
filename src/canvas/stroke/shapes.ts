import { ShapeObject, Point, AABB } from '../../types/canvas';

export function computeShapeBounds(anchor: Point, end: Point, strokeWidth = 2): AABB {
  const minX = Math.min(anchor.x, end.x) - strokeWidth;
  const minY = Math.min(anchor.y, end.y) - strokeWidth;
  const maxX = Math.max(anchor.x, end.x) + strokeWidth;
  const maxY = Math.max(anchor.y, end.y) + strokeWidth;
  return { minX, minY, maxX, maxY };
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
