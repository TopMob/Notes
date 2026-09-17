import React, { useEffect, useRef } from 'react';
import { Camera, CanvasBackground, ViewportSize } from '../../types/canvas';
import { Viewport } from '../../canvas/engine/Viewport';

interface BackgroundLayerProps {
  camera: Camera;
  background: CanvasBackground;
  viewportSize: ViewportSize;
  dpr: number;
}

export const BackgroundLayer: React.FC<BackgroundLayerProps> = ({
  camera,
  background,
  viewportSize,
  dpr,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Очистка
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (background === 'plain') return;

    Viewport.applyTransform(ctx, camera, viewportSize, dpr);

    const bounds = Viewport.getVisibleWorldBounds(camera, viewportSize, 0.1);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    if (background === 'ruled') {
      // Тетрадь в линейку
      const lineSpacing = 32;
      const startY = Math.floor(bounds.minY / lineSpacing) * lineSpacing;
      const endY = Math.ceil(bounds.maxY / lineSpacing) * lineSpacing;

      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(99, 179, 237, 0.18)' : 'rgba(0, 120, 212, 0.2)';
      ctx.lineWidth = 1 / camera.zoom;

      ctx.beginPath();
      for (let y = startY; y <= endY; y += lineSpacing) {
        ctx.moveTo(bounds.minX, y);
        ctx.lineTo(bounds.maxX, y);
      }
      ctx.stroke();

      // Красная вертикальная линия полей (как в школьной тетради)
      ctx.strokeStyle = isDark ? 'rgba(239, 68, 68, 0.25)' : 'rgba(216, 59, 1, 0.25)';
      ctx.beginPath();
      ctx.moveTo(0, bounds.minY);
      ctx.lineTo(0, bounds.maxY);
      ctx.stroke();

      ctx.restore();
    } else if (background === 'grid-small' || background === 'grid-large') {
      // Тетрадь в клетку
      const gridSize = background === 'grid-small' ? 24 : 40;
      const startX = Math.floor(bounds.minX / gridSize) * gridSize;
      const endX = Math.ceil(bounds.maxX / gridSize) * gridSize;
      const startY = Math.floor(bounds.minY / gridSize) * gridSize;
      const endY = Math.ceil(bounds.maxY / gridSize) * gridSize;

      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
      ctx.lineWidth = 1 / camera.zoom;

      ctx.beginPath();
      // Вертикальные линии
      for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, bounds.minY);
        ctx.lineTo(x, bounds.maxY);
      }
      // Горизонтальные линии
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(bounds.minX, y);
        ctx.lineTo(bounds.maxX, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [camera, background, viewportSize, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-layer canvas-background"
      width={viewportSize.w * dpr}
      height={viewportSize.h * dpr}
      style={{
        width: viewportSize.w,
        height: viewportSize.h,
      }}
    />
  );
};
