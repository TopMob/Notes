import type { Camera, ViewportSize, Stroke, ShapeObject } from '../../types/canvas';

export interface ContentSnapshot {
  camera: Camera;
  viewportSize: ViewportSize;
  dpr: number;
  strokes: Stroke[];
  shapes: ShapeObject[];
  latestTime: number;
}

export function itemTime(item: Stroke | ShapeObject): number {
  return item.createdAt ?? (parseInt(item.id.replace('shape-', ''), 10) || 0);
}

/** Append only when compositing is provably identical to a full redraw. */
export function appendOnlyItem(previous: ContentSnapshot | null, next: Omit<ContentSnapshot, 'latestTime'>): Stroke | ShapeObject | null {
  if (!previous || previous.camera !== next.camera || previous.viewportSize !== next.viewportSize || previous.dpr !== next.dpr) return null;
  let added: Stroke | ShapeObject;
  if (previous.shapes === next.shapes && next.strokes.length === previous.strokes.length + 1 && previous.strokes.every((s,i) => next.strokes[i] === s)) {
    added = next.strokes[next.strokes.length - 1];
    // Markers belong below all pens/shapes, so appending them would change pixels.
    if (added.tool === 'highlighter') return null;
  } else if (previous.strokes === next.strokes && next.shapes.length === previous.shapes.length + 1 && previous.shapes.every((s,i) => next.shapes[i] === s)) {
    added = next.shapes[next.shapes.length - 1];
  } else return null;
  // Equal timestamps can depend on query order: retain the canonical full draw.
  return itemTime(added) > previous.latestTime ? added : null;
}
