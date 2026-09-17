import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Grid,
  AlignJustify,
  File,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  Sliders,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useUiStore } from '../../store/useUiStore';
import { CanvasBackground } from '../../types/canvas';

export const RibbonView: React.FC = () => {
  const { camera, setCamera, background, setBackground } = useCanvasStore();
  const {
    theme,
    toggleTheme,
    isZenMode,
    toggleZenMode,
    isFloatingPaletteOpen,
    toggleFloatingPalette,
  } = useUiStore();

  const handleZoomIn = () => {
    setCamera((prev) => ({
      ...prev,
      zoom: Math.min(5.0, Math.round((prev.zoom + 0.15) * 100) / 100),
    }));
  };

  const handleZoomOut = () => {
    setCamera((prev) => ({
      ...prev,
      zoom: Math.max(0.2, Math.round((prev.zoom - 0.15) * 100) / 100),
    }));
  };

  const handleZoomReset = () => {
    setCamera((prev) => ({
      ...prev,
      zoom: 1.0,
    }));
  };

  const handleCenterView = () => {
    setCamera({
      x: 0,
      y: 0,
      zoom: 1.0,
    });
  };

  const backgrounds: Array<{ id: CanvasBackground; label: string; icon: React.ReactNode }> = [
    { id: 'plain', label: 'Чистый', icon: <File size={16} /> },
    { id: 'ruled', label: 'В линейку', icon: <AlignJustify size={16} /> },
    { id: 'grid-small', label: 'Клетка 20px', icon: <Grid size={16} /> },
    { id: 'grid-large', label: 'Клетка 40px', icon: <Grid size={16} /> },
  ];

  return (
    <div className="ribbon-toolbar">
      {/* Тип фона холста */}
      <div className="toolbar-group">
        {backgrounds.map((bg) => (
          <button
            key={bg.id}
            className={`tool-btn ${background === bg.id ? 'active' : ''}`}
            onClick={() => setBackground(bg.id)}
            title={`Фон: ${bg.label}`}
          >
            {bg.icon}
            <span className="tool-btn-label">{bg.label}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-divider" />

      {/* Масштабирование */}
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onClick={handleZoomOut}
          title="Уменьшить масштаб (Ctrl + Колесо вниз)"
        >
          <ZoomOut size={16} />
        </button>

        <button
          className="tool-btn"
          onClick={handleZoomReset}
          title="Сбросить масштаб на 100%"
        >
          <span className="tool-btn-label font-mono">
            {Math.round(camera.zoom * 100)}%
          </span>
        </button>

        <button
          className="tool-btn icon-only"
          onClick={handleZoomIn}
          title="Увеличить масштаб (Ctrl + Колесо вверх)"
        >
          <ZoomIn size={16} />
        </button>

        <button
          className="tool-btn icon-only"
          onClick={handleCenterView}
          title="Вернуться к центру координат (0, 0)"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Визуальные режимы */}
      <div className="toolbar-group">
        <button
          className={`tool-btn ${isFloatingPaletteOpen ? 'active' : ''}`}
          onClick={toggleFloatingPalette}
          title="Плавающая мини-палитра инструментов"
        >
          <Sliders size={16} />
          <span className="tool-btn-label">Мини-палитра</span>
        </button>

        <button
          className="tool-btn"
          onClick={toggleTheme}
          title="Переключить тему оформления"
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          <span className="tool-btn-label">{theme === 'light' ? 'Тёмная' : 'Светлая'}</span>
        </button>

        <button
          className={`tool-btn ${isZenMode ? 'active' : ''}`}
          onClick={toggleZenMode}
          title="Полноэкранный режим без панелей"
        >
          {isZenMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          <span className="tool-btn-label">Zen-режим</span>
        </button>
      </div>
    </div>
  );
};
