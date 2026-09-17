import React, { useState } from 'react';
import {
  Grid,
  Search,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  Share2,
  ChevronDown,
  Edit3,
  BookOpen,
  Settings,
} from 'lucide-react';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useUiStore } from '../../store/useUiStore';
import { SyncStatusBadge } from '../auth/SyncStatusBadge';
import { AuthControls } from '../auth/AuthControls';

export const Header: React.FC = () => {
  const { notebooks, activeNotebook, selectNotebook } = useNotebookStore();
  const {
    theme,
    toggleTheme,
    isZenMode,
    toggleZenMode,
    setSearchOpen,
    setExportOpen,
    setSettingsOpen,
  } = useUiStore();

  const [isNotebookMenuOpen, setIsNotebookMenuOpen] = useState(false);

  return (
    <header className="app-header">
      {/* Левая группа: лаунчер, бренд OneNote, текущий блокнот */}
      <div className="header-left">
        <button
          className="header-icon-btn launcher-btn"
          title="Панель приложений"
          aria-label="Панель приложений"
        >
          <Grid size={18} />
        </button>

        <div className="brand-group">
          <div className="onenote-logo" title="Microsoft OneNote">
            <span>N</span>
          </div>

          <div className="notebook-selector-wrapper">
            <button
              className="notebook-selector-btn"
              onClick={() => setIsNotebookMenuOpen(!isNotebookMenuOpen)}
              title="Переключить блокнот"
            >
              <span className="notebook-title">{activeNotebook?.title || 'колледж'}</span>
              <ChevronDown size={14} className="chevron-icon" />
            </button>

            {isNotebookMenuOpen && (
              <div className="dropdown-menu notebook-dropdown">
                <div className="dropdown-header">Блокноты</div>
                {notebooks.map((nb) => (
                  <button
                    key={nb.id}
                    className={`dropdown-item ${nb.id === activeNotebook?.id ? 'active' : ''}`}
                    onClick={() => {
                      selectNotebook(nb);
                      setIsNotebookMenuOpen(false);
                    }}
                  >
                    <BookOpen size={16} />
                    <span>{nb.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Центральная группа: Поиск */}
      <div className="header-center">
        <div className="search-bar" onClick={() => setSearchOpen(true)}>
          <Search size={15} className="search-icon" />
          <span className="search-placeholder">Что вы хотите сделать?</span>
          <kbd className="search-shortcut">Ctrl+K</kbd>
        </div>
      </div>

      {/* Правая группа: Статус синхронизации, режим, поделиться, тема, Zen, настройки, авторизация */}
      <div className="header-right">
        {/* Индикатор синхронизации с облаком / локально */}
        <SyncStatusBadge />

        {/* Режим: Редактирование */}
        <div className="mode-badge" title="Режим работы">
          <Edit3 size={14} />
          <span>Редактирование</span>
          <ChevronDown size={12} />
        </div>

        {/* Кнопка Поделиться / Экспорт */}
        <button
          className="btn-share"
          onClick={() => setExportOpen(true)}
          title="Экспортировать или поделиться"
        >
          <Share2 size={14} />
          <span>Поделиться</span>
          <ChevronDown size={12} />
        </button>

        {/* Переключатель темы */}
        <button
          className="header-icon-btn"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
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
