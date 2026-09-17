export interface TextBlock {
  id: string;
  pageId: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  contentHTML: string;
  zIndex: number;
}
