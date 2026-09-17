import { getStroke } from 'perfect-freehand';
import { Stroke } from '../../types/canvas';

/**
 * Отрисовка каллиграфического штриха на Canvas 2D контексте
 */
export function drawStrokeToCanvas(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  if (!stroke.points || stroke.points.length === 0) return;

  ctx.save();
  ctx.fillStyle = stroke.color;
  ctx.strokeStyle = stroke.color;
  ctx.globalAlpha = stroke.opacity;
  if (stroke.blendMode === 'multiply') {
    ctx.globalCompositeOperation = 'multiply';
  }

  // Одиночная точка (клик)
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, stroke.baseWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Два первых штриха: плавный сегмент линии
  if (stroke.points.length === 2) {
    const [p0, p1] = stroke.points;
    ctx.lineWidth = stroke.baseWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const rawPoints = stroke.points.map((p) => [p.x, p.y, p.pressure]);

  try {
    const outlinePoints = getStroke(rawPoints, {
      size: stroke.baseWidth,
      thinning: 0,
      smoothing: 0.6,
      streamline: 0.4,
      easing: (t) => t,
      simulatePressure: false,
    });

    if (outlinePoints && outlinePoints.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(outlinePoints[0][0], outlinePoints[0][1]);
      for (let i = 1; i < outlinePoints.length; i++) {
        ctx.lineTo(outlinePoints[i][0], outlinePoints[i][1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
  } catch (err) {
    console.error('getStroke error:', err);
  }

  // Надежный fallback: плавная полилиния через квадратичные кривые
  ctx.lineWidth = stroke.baseWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

  for (let i = 1; i < stroke.points.length - 1; i++) {
    const p0 = stroke.points[i];
    const p1 = stroke.points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
  }

  const last = stroke.points[stroke.points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();

  ctx.restore();
}
