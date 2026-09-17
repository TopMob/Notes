import { Notebook, Section, Page } from '../types/notebook';
import { Stroke, Point } from '../types/canvas';
import { TextBlock } from '../types/textblock';
import { Viewport } from '../canvas/engine/Viewport';

export const INITIAL_NOTEBOOK: Notebook = {
  id: 'nb-college',
  title: 'колледж',
  createdAt: 1726050000000,
  order: 0,
};

export const INITIAL_SECTIONS: Section[] = [
  {
    id: 'sec-math',
    notebookId: 'nb-college',
    title: 'Математика',
    color: '#0078D4', // Signature blue as in screenshot
    order: 0,
  },
  {
    id: 'sec-physics',
    notebookId: 'nb-college',
    title: 'Физика',
    color: '#107C41',
    order: 1,
  },
  {
    id: 'sec-informatics',
    notebookId: 'nb-college',
    title: 'Информатика',
    color: '#5C2D91',
    order: 2,
  },
];

export const INITIAL_PAGES: Page[] = [
  {
    id: 'page-11-09',
    sectionId: 'sec-math',
    title: '11.09.2026',
    createdAt: 1726050000000,
    order: 0,
    camera: { x: 0, y: 0, zoom: 1 },
    background: 'plain',
  },
  {
    id: 'page-17-09',
    sectionId: 'sec-math',
    title: '17.09.2026',
    createdAt: 1726568400000,
    order: 1,
    camera: { x: 260, y: 150, zoom: 1 },
    background: 'plain',
  },
];

function makeStroke(id: string, pageId: string, pts: Array<[number, number]>, baseWidth = 3, color = '#201f1e'): Stroke {
  const points: Point[] = pts.map(([x, y]) => ({
    x,
    y,
    pressure: 0.5,
    t: Date.now(),
  }));

  return {
    id,
    pageId,
    tool: 'pen',
    points,
    color,
    baseWidth,
    opacity: 1,
    blendMode: 'source-over',
    bounds: Viewport.computeBounds(points),
    createdAt: Date.now(),
  };
}

export function generateInitialStrokes(pageId: string): Stroke[] {
  // Рукописные формулы из скриншота image.png:
  // X_2 = -4 / -4 = 1
  // X_3 = -12 / -4 = 3
  const strokes: Stroke[] = [];
  let sId = 1;

  // --- X2 ---
  // X: stroke 1
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [10, -110], [18, -90], [28, -68], [36, -50]
  ]));
  // X: stroke 2
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [34, -108], [24, -86], [16, -68], [8, -50]
  ]));
  // subscript 2
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [38, -62], [44, -70], [50, -66], [44, -54], [38, -46], [52, -46]
  ], 2.5));

  // =
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[64, -82], [88, -82]]));
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[64, -70], [88, -70]]));

  // Fraction 1: numerator -4
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[102, -108], [116, -108]])); // minus
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [134, -122], [124, -102], [144, -102]
  ])); // 4 top
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[138, -122], [138, -92]])); // 4 stem

  // Fraction bar
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[100, -78], [152, -78]], 3.5));

  // denominator -4
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[102, -58], [116, -58]])); // minus
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [134, -68], [124, -52], [144, -52]
  ])); // 4 top
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[138, -68], [138, -42]])); // 4 stem

  // =
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[166, -82], [190, -82]]));
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[166, -70], [190, -70]]));

  // 1
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [208, -102], [218, -112], [218, -48]
  ]));

  // --- X3 ---
  // X: stroke 1
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [12, 12], [20, 32], [30, 54], [38, 72]
  ]));
  // X: stroke 2
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [36, 14], [26, 36], [18, 54], [10, 72]
  ]));
  // subscript 3
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [40, 58], [48, 56], [52, 64], [44, 70], [54, 76], [48, 86], [38, 84]
  ], 2.5));

  // =
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[64, 40], [88, 40]]));
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[64, 52], [88, 52]]));

  // Fraction 2: numerator -12
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[100, 18], [114, 18]])); // minus
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[124, 8], [124, 30]])); // 1
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [134, 12], [144, 10], [148, 16], [138, 24], [132, 30], [150, 30]
  ])); // 2

  // Fraction bar
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[98, 44], [156, 44]], 3.5));

  // denominator -4
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[102, 64], [116, 64]])); // minus
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [134, 54], [124, 70], [144, 70]
  ])); // 4 top
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[138, 54], [138, 80]])); // 4 stem

  // =
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[170, 40], [194, 40]]));
  strokes.push(makeStroke(`str-${sId++}`, pageId, [[170, 52], [194, 52]]));

  // 3
  strokes.push(makeStroke(`str-${sId++}`, pageId, [
    [210, 12], [230, 12], [218, 36], [232, 48], [230, 72], [210, 74]
  ]));

  return strokes;
}

export const INITIAL_TEXT_BLOCK: TextBlock = {
  id: 'tb-gauss-intro',
  pageId: 'page-17-09',
  x: -40,
  y: 110,
  width: 780,
  contentHTML: `<h2>Метод Гаусса для систем линейных уравнений</h2><p>Этот метод заключается в том, что бы привести матрицу к ступеньчатому виду, то есть обратить элементы подглавной диагональю в нули</p><p>Это называется прямым ходом, обратным ходом называется наоборот приведение над главной диагональю к нулю</p>`,
  zIndex: 1,
};
