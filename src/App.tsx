import React, { useEffect } from 'react';
import { Minimize2 } from 'lucide-react';
import { useNotebookStore } from './store/useNotebookStore';
import { useUiStore } from './store/useUiStore';
import { Header } from './components/header/Header';
import { Ribbon } from './components/ribbon/Ribbon';
import { Sidebar } from './components/sidebar/Sidebar';
import { InfiniteCanvas } from './components/canvas/InfiniteCanvas';
import { FloatingPalette } from './components/canvas/FloatingPalette';
import { SearchModal } from './components/modals/SearchModal';
import { ExportModal } from './components/modals/ExportModal';
import './styles/app.css';

export const App: React.FC = () => {
  const { init, isLoading } = useNotebookStore();
  const { isZenMode, toggleZenMode, theme } = useUiStore();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Выход из Zen-режима по клавише Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isZenMode) {
        toggleZenMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZenMode, toggleZenMode]);

  if (isLoading) {
    return (
      <div className="app-loading-screen">
        <div className="loading-spinner">
          <div className="onenote-logo">
            <span>N</span>
          </div>
          <p>Загрузка OneNote...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container ${isZenMode ? 'zen-mode' : ''}`}>
      {/* Шапка приложения */}
      <Header />

      {/* Лента вкладок Ribbon */}
      <Ribbon />

      {/* Основная рабочая область: Сайдбар + Бесконечный холст */}
      <main className="app-main-layout">
        <Sidebar />
        <InfiniteCanvas />
      </main>

      {/* Плавающие панели и модальные окна */}
      <FloatingPalette />
      <SearchModal />
      <ExportModal />

      {/* Кнопка выхода из Zen-режима (всегда видна в полноэкранном режиме) */}
      {isZenMode && (
        <button
          className="zen-mode-exit-btn"
          onClick={toggleZenMode}
          title="Выйти из Zen-режима (Esc)"
        >
          <Minimize2 size={16} />
          <span>Выйти из Zen-режима (Esc)</span>
        </button>
      )}
    </div>
  );
};

export default App;
