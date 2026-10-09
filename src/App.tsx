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
import { SettingsModal } from './components/modals/SettingsModal';
import { CloudSettingsModal } from './components/modals/CloudSettingsModal';
import { CreateSectionModal } from './components/modals/CreateSectionModal';
import { ConfirmDeleteModal } from './components/modals/ConfirmDeleteModal';
import { TrashModal } from './components/modals/TrashModal';
import './styles/app.css';
import { useCanvasStore } from './store/useCanvasStore';

export const App: React.FC = () => {
  const { init, isLoading } = useNotebookStore();
  const { isZenMode, toggleZenMode, theme } = useUiStore();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const save = () => { void useCanvasStore.getState().flushAllSaves().catch(() => {}); };
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (useCanvasStore.getState().saveStatus !== 'saved') {
        save();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

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
      <SettingsModal />
      <CloudSettingsModal />
      <CreateSectionModal />
      <ConfirmDeleteModal />
      <TrashModal />

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
