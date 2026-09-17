import { AABB, Stroke, ShapeObject } from '../../types/canvas';

export type SpatialItem = Stroke | ShapeObject;

export function aabbIntersects(a: AABB, b: AABB): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

export function aabbContains(container: AABB, child: AABB): boolean {
  return (
    child.minX >= container.minX &&
    child.maxX <= container.maxX &&
    child.minY >= container.minY &&
    child.maxY <= container.maxY
  );
}

const DEFAULT_CELL_SIZE = 500;

/**
 * Пространственный индекс на основе разреженной равномерной сетки (Spatial Hash Grid).
 * В отличие от QuadTree с фиксированными границами, не имеет лимитов по координатам (-100k..+100k)
 * и одинаково эффективно и стабильно работает в любой области бесконечного холста.
 */
export class SpatialIndex {
  private cellSize: number;
  private grid = new Map<string, Set<SpatialItem>>();
  private items = new Map<string, SpatialItem>();

  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  private cellKey(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  insert(item: SpatialItem): void {
    this.items.set(item.id, item);
    const minCx = Math.floor(item.bounds.minX / this.cellSize);
    const maxCx = Math.floor(item.bounds.maxX / this.cellSize);
    const minCy = Math.floor(item.bounds.minY / this.cellSize);
    const maxCy = Math.floor(item.bounds.maxY / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.cellKey(cx, cy);
        let cell = this.grid.get(key);
        if (!cell) {
          cell = new Set();
          this.grid.set(key, cell);
        }
        cell.add(item);
      }
    }
  }

  query(range: AABB): SpatialItem[] {
    const minCx = Math.floor(range.minX / this.cellSize);
    const maxCx = Math.floor(range.maxX / this.cellSize);
    const minCy = Math.floor(range.minY / this.cellSize);
    const maxCy = Math.floor(range.maxY / this.cellSize);

    const found = new Map<string, SpatialItem>();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.cellKey(cx, cy);
        const cell = this.grid.get(key);
        if (!cell) continue;

        for (const item of cell) {
          if (!found.has(item.id) && aabbIntersects(item.bounds, range)) {
            found.set(item.id, item);
          }
        }
      }
    }

    return Array.from(found.values());
  }

  clear(): void {
    this.grid.clear();
    this.items.clear();
  }

  rebuild(items: SpatialItem[]): void {
    this.clear();
    for (const item of items) {
      this.insert(item);
    }
  }
}
