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

const MAX_ITEMS = 16;
const MAX_DEPTH = 8;

export class QuadTreeNode {
  bounds: AABB;
  depth: number;
  items: SpatialItem[] = [];
  children: QuadTreeNode[] | null = null;

  constructor(bounds: AABB, depth = 0) {
    this.bounds = bounds;
    this.depth = depth;
  }

  subdivide(): void {
    const { minX, minY, maxX, maxY } = this.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    this.children = [
      new QuadTreeNode({ minX, minY, maxX: midX, maxY: midY }, this.depth + 1), // NW
      new QuadTreeNode({ minX: midX, minY, maxX: maxX, maxY: midY }, this.depth + 1), // NE
      new QuadTreeNode({ minX, minY: midY, maxX: midX, maxY }, this.depth + 1), // SW
      new QuadTreeNode({ minX: midX, minY: midY, maxX, maxY }, this.depth + 1), // SE
    ];

    // Перераспределяем существующие элементы в дочерние узлы
    const oldItems = this.items;
    this.items = [];

    for (const item of oldItems) {
      this.insert(item);
    }
  }

  insert(item: SpatialItem): boolean {
    if (!aabbIntersects(this.bounds, item.bounds)) {
      return false;
    }

    if (this.children !== null) {
      let insertedIntoChild = false;
      for (const child of this.children) {
        if (aabbIntersects(child.bounds, item.bounds)) {
          child.insert(item);
          insertedIntoChild = true;
        }
      }
      return insertedIntoChild;
    }

    this.items.push(item);

    if (this.items.length > MAX_ITEMS && this.depth < MAX_DEPTH) {
      this.subdivide();
    }

    return true;
  }

  query(range: AABB, foundMap: Map<string, SpatialItem>): void {
    if (!aabbIntersects(this.bounds, range)) {
      return;
    }

    for (const item of this.items) {
      if (aabbIntersects(item.bounds, range)) {
        foundMap.set(item.id, item);
      }
    }

    if (this.children !== null) {
      for (const child of this.children) {
        child.query(range, foundMap);
      }
    }
  }

  clear(): void {
    this.items = [];
    if (this.children !== null) {
      for (const child of this.children) {
        child.clear();
      }
      this.children = null;
    }
  }
}

export class SpatialIndex {
  private root: QuadTreeNode;
  private readonly defaultBounds: AABB = {
    minX: -100000,
    minY: -100000,
    maxX: 100000,
    maxY: 100000,
  };

  constructor() {
    this.root = new QuadTreeNode(this.defaultBounds);
  }

  insert(item: SpatialItem): void {
    this.root.insert(item);
  }

  query(range: AABB): SpatialItem[] {
    const found = new Map<string, SpatialItem>();
    this.root.query(range, found);
    return Array.from(found.values());
  }

  clear(): void {
    this.root.clear();
  }

  rebuild(items: SpatialItem[]): void {
    this.clear();
    for (const item of items) {
      this.insert(item);
    }
  }
}
