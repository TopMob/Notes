export interface Point {
  x: number;
  y: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  t: number;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ToolType =
  | 'cursor'
  | 'lasso'
  | 'stroke-eraser'
  | 'point-eraser'
  | 'pen'
  | 'highlighter'
  | 'shape'
  | 'pan';

export type ShapeType = 'line' | 'arrow' | 'rect' | 'ellipse' | 'axis';

export interface Stroke {
  id: string;
  pageId: string;
  tool: 'pen' | 'highlighter';
  points: Point[];
  color: string;
  baseWidth: number;
  opacity: number;
  blendMode: 'source-over' | 'multiply';
  bounds: AABB;
  createdAt: number;
}

export interface ShapeObject {
  id: string;
  pageId: string;
  type: ShapeType;
  anchor: Point;
  end: Point;
  style: {
    color: string;
    width: number;
    dashed?: boolean;
  };
  bounds: AABB;
  createdAt?: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type CanvasBackground = 'plain' | 'ruled' | 'grid-small' | 'grid-large';

export interface ViewportSize {
  w: number;
  h: number;
}

export type PenCursorStyle = 'crosshair' | 'circle';

export type RightClickAction = 'point-eraser' | 'stroke-eraser' | 'pan' | 'none';
