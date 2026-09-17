import { Camera, Point, ViewportSize, AABB } from '../../types/canvas';

export class Viewport {
  /**
   * Конвертирует точку из мировых координат в экранные пиксели
   */
  static worldToScreen(p: { x: number; y: number }, camera: Camera, viewport: ViewportSize): { x: number; y: number } {
    return {
      x: (p.x - camera.x) * camera.zoom + viewport.w / 2,
      y: (p.y - camera.y) * camera.zoom + viewport.h / 2,
    };
  }

  /**
   * Конвертирует экранные пиксели в мировые координаты
   */
  static screenToWorld(p: { x: number; y: number }, camera: Camera, viewport: ViewportSize): { x: number; y: number } {
    return {
      x: (p.x - viewport.w / 2) / camera.zoom + camera.x,
      y: (p.y - viewport.h / 2) / camera.zoom + camera.y,
    };
  }

  /**
   * Масштабирование относительно точки курсора
   */
  static zoomAtPoint(camera: Camera, screenPoint: { x: number; y: number }, factor: number, viewport: ViewportSize): Camera {
    const MIN_ZOOM = 0.2;
    const MAX_ZOOM = 5.0;

    const worldBefore = this.screenToWorld(screenPoint, camera, viewport);
    const newZoom = Math.min(Math.max(camera.zoom * factor, MIN_ZOOM), MAX_ZOOM);

    // Вычисляем новую позицию камеры, чтобы мировая точка под курсором осталась на том же экранном месте
    const newCamera: Camera = { ...camera, zoom: newZoom };
    const worldAfter = this.screenToWorld(screenPoint, newCamera, viewport);

    newCamera.x += worldBefore.x - worldAfter.x;
    newCamera.y += worldBefore.y - worldAfter.y;

    return newCamera;
  }

  /**
   * Возвращает AABB видимой области холста в мировых координатах (с опциональным запасом)
   */
  static getVisibleWorldBounds(camera: Camera, viewport: ViewportSize, marginRatio = 0.2): AABB {
    const topLeft = this.screenToWorld({ x: 0, y: 0 }, camera, viewport);
    const bottomRight = this.screenToWorld({ x: viewport.w, y: viewport.h }, camera, viewport);

    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    const marginX = width * marginRatio;
    const marginY = height * marginRatio;

    return {
      minX: topLeft.x - marginX,
      minY: topLeft.y - marginY,
      maxX: bottomRight.x + marginX,
      maxY: bottomRight.y + marginY,
    };
  }

  /**
   * Настройка матрицы трансформации 2D контекста canvas с учетом devicePixelRatio
   */
  static applyTransform(ctx: CanvasRenderingContext2D, camera: Camera, viewport: ViewportSize, dpr: number): void {
    ctx.setTransform(
      camera.zoom * dpr,
      0,
      0,
      camera.zoom * dpr,
      (viewport.w / 2 - camera.x * camera.zoom) * dpr,
      (viewport.h / 2 - camera.y * camera.zoom) * dpr
    );
  }

  /**
   * Расчет AABB для набора точек
   */
  static computeBounds(points: Point[], padding = 4): AABB {
    if (points.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    };
  }
}
