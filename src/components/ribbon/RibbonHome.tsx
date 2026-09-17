import React from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  CheckSquare,
  Type,
  Plus,
} from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export const RibbonHome: React.FC = () => {
  const { addTextBlock, camera, currentPageId } = useCanvasStore();

  const handleCreateTextBlock = () => {
    if (!currentPageId) return;
    addTextBlock({
      id: `tb-${Date.now()}`,
      pageId: currentPageId,
      x: camera.x - 100,
      y: camera.y - 50,
      width: 480,
      contentHTML: '<p>Введите ваш текст здесь...</p>',
      zIndex: 10,
    });
  };

  const applyCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
  };

  return (
    <div className="ribbon-toolbar">
      {/* Быстрое добавление блока */}
      <div className="toolbar-group">
        <button
          className="tool-btn highlight"
          onClick={handleCreateTextBlock}
          title="Создать текстовый блок"
        >
          <Plus size={16} />
          <span className="tool-btn-label">Новая заметка</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Форматирование шрифта */}
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('bold');
          }}
          title="Полужирный (Ctrl+B)"
        >
          <Bold size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('italic');
          }}
          title="Курсив (Ctrl+I)"
        >
          <Italic size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('underline');
          }}
          title="Подчёркнутый (Ctrl+U)"
        >
          <Underline size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Стили заголовков */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('formatBlock', '<h1>');
          }}
          title="Заголовок 1 (H1)"
        >
          <Type size={16} />
          <span className="tool-btn-label">Заголовок 1</span>
        </button>
        <button
          className="tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('formatBlock', '<h2>');
          }}
          title="Заголовок 2 (H2)"
        >
          <Type size={14} />
          <span className="tool-btn-label">Заголовок 2</span>
        </button>
        <button
          className="tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('formatBlock', '<p>');
          }}
          title="Обычный текст"
        >
          <span className="tool-btn-label">Текст</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Списки и чекбоксы */}
      <div className="toolbar-group">
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('insertUnorderedList');
          }}
          title="Маркированный список"
        >
          <List size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand('insertOrderedList');
          }}
          title="Нумерованный список"
        >
          <ListOrdered size={16} />
        </button>
        <button
          className="tool-btn icon-only"
          onMouseDown={(e) => {
            e.preventDefault();
            applyCommand(
              'insertHTML',
              '<div class="todo-item"><input type="checkbox" /> <span>Новая задача</span></div>'
            );
          }}
          title="Список дел (To-Do)"
        >
          <CheckSquare size={16} />
        </button>
      </div>
    </div>
  );
};
