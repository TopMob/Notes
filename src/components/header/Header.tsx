import React from 'react';
import {
  Maximize2,
  Minimize2,
  Trash2,
  Settings,
} from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { SyncStatusBadge } from '../auth/SyncStatusBadge';
import { AuthControls } from '../auth/AuthControls';

export const Header: React.FC = () => {
  const { activeNotebook } = useNotebookStore();
  const {
    isZenMode,
    toggleZenMode,
    setTrashOpen,
    setSettingsOpen,
  } = useUiStore();

  return (
    <header className="app-header">
      {/* Левая группа: бренд OneNote и название блокнота */}
      <div className="header-left">
        <div className="brand-group">
          <div className="onenote-logo" title="OneNote">
            <span>N</span>
          </div>
          <span className="app-title-text">{activeNotebook?.title || 'Записная книжка'}</span>
        </div>
      </div>

      {/* Центральная группа (свободное пространство для чистого вида) */}
      <div className="header-center" />

      {/* Правая группа: Статус синхронизации, Корзина, Zen-режим, Настройки, Авторизация */}
      <div className="header-right">
        {/* Индикатор синхронизации с облаком / локально */}
        <SyncStatusBadge />

        {/* Корзина (удалённые разделы и страницы) */}
        <button
          className="header-icon-btn trash-header-btn"
          onClick={() => setTrashOpen(true)}
          title="Корзина (удалённые разделы и страницы)"
        >
          <Trash2 size={16} />
        </button>

        {/* Zen-режим */}
        <button
          className="header-icon-btn zen-btn"
          onClick={toggleZenMode}
          title={isZenMode ? 'Выйти из Zen-режима' : 'Zen-режим (во весь экран)'}
        >
          {isZenMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        {/* Настройки */}
        <button
          className="header-icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="Параметры и настройки"
        >
          <Settings size={16} />
        </button>

        {/* Авторизация Clerk (Вход / Профиль) */}
        <AuthControls />
      </div>
    </header>
  );
};

