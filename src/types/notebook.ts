import { Camera, CanvasBackground } from './canvas';

export interface Notebook {
  id: string;
  title: string;
  createdAt: number;
  order: number;
}

export interface Section {
  id: string;
  notebookId: string;
  title: string;
  color: string;
  order: number;
}

export interface Page {
  id: string;
  sectionId: string;
  title: string;
  createdAt: number;
  order: number;
  camera: Camera;
  background: CanvasBackground;
}

export const SECTION_COLORS = [
  '#0078D4', // Blue (как на скриншоте)
  '#107C41', // Green
  '#D83B01', // Orange
  '#80397B', // Purple
  '#E3008C', // Magenta
  '#008272', // Teal
  '#A80000', // Red
  '#498205', // Olive
  '#5C2D91', // Indigo
];
