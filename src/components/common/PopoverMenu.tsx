import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopoverMenuProps {
  /** Элемент (кнопка «⋮»), к которому привязано меню */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  width?: number;
  className?: string;
  children: React.ReactNode;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

/**
 * Всплывающее меню, отрисовываемое в document.body (portal) с position: fixed.
 * Благодаря этому меню не обрезается контейнерами с overflow (колонки сайдбара),
 * прижимается к краям окна и при нехватке места раскрывается вверх.
 */
export const PopoverMenu: React.FC<PopoverMenuProps> = ({
  anchorEl,
  onClose,
  width = 200,
  className = '',
  children,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    const menu = menuRef.current;
    if (!anchorEl || !menu) return;

    const anchor = anchorEl.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;

    // Выравниваем правый край меню по правому краю кнопки и не даём выйти за окно
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - width, maxLeft));

    let top = anchor.bottom + ANCHOR_GAP;
    if (top + menuHeight > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, anchor.top - menuHeight - ANCHOR_GAP);
    }

    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [anchorEl, width]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition, children]);

  useEffect(() => {
    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      // Клик по самой кнопке обрабатывается её собственным onClick (переключение)
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('touchstart', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('touchstart', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [anchorEl, onClose]);

  // События React всплывают через portal к предкам в дереве компонентов
  // (например, к строке раздела с onClick/onDoubleClick) — гасим их здесь.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      ref={menuRef}
      className={`dropdown-menu popover-menu ${className}`}
      style={{
        position: 'fixed',
        top: pos ? `${pos.top}px` : 0,
        left: pos ? `${pos.left}px` : 0,
        right: 'auto',
        width: `${width}px`,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body
  );
};
