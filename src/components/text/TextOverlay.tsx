import { useShallow } from 'zustand/react/shallow';
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
          useCanvasStore.getState().clearSelection();
        }
      }}
    >
      <div style={{
        position: 'absolute', transformOrigin: '0 0',
        transform: `translate(${viewportSize.w / 2 - camera.x * camera.zoom}px, ${viewportSize.h / 2 - camera.y * camera.zoom}px) scale(${camera.zoom})`,
      }}>
        <TextBlocks />
      </div>
    </div>
  );
};

// Camera changes transform one parent; they never reconcile block contents.
const TextBlocks = React.memo(function TextBlocks() {
  const {
    textBlocks,
    selectedTextBlockIds,
  } = useCanvasStore(useShallow(state => ({
    textBlocks: state.textBlocks,
    selectedTextBlockIds: state.selectedTextBlockIds,
  })));

  const selected = new Set(selectedTextBlockIds);
  return <>{textBlocks.map(block => <TextBlockView key={block.id} block={block} isActive={selected.has(block.id)} />)}</>;
});
