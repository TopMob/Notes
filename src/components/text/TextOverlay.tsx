import React from 'react';
import { Camera, ViewportSize } from '../../types/canvas';
import { useCanvasStore } from '../../store/useCanvasStore';
import { TextBlockView } from './TextBlockView';

interface TextOverlayProps {
  camera: Camera;
  viewportSize: ViewportSize;
}

export const TextOverlay: React.FC<TextOverlayProps> = ({
  camera,
  viewportSize,
}) => {
  const {
    textBlocks,
    selectedTextBlockIds,
    setSelection,
    clearSelection,
  } = useCanvasStore();

  return (
    <div
      className="dom-text-overlay"
      style={{
        width: `${viewportSize.w}px`,
        height: `${viewportSize.h}px`,
      }}
      onClick={(e) => {
        // Если кликнули на свободную область оверлея
        if (e.target === e.currentTarget) {
          clearSelection();
        }
      }}
    >
      {textBlocks.map((block) => {
        const isSelected = selectedTextBlockIds.includes(block.id);
        return (
          <TextBlockView
            key={block.id}
            block={block}
            camera={camera}
            viewportSize={viewportSize}
            isActive={isSelected}
            onSelect={() => setSelection([], [], [block.id])}
          />
        );
      })}
    </div>
  );
};
