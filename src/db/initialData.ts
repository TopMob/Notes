import { Notebook, Section, Page } from '../types/notebook';

export const INITIAL_NOTEBOOK: Notebook = {
  id: 'nb-my-notebook',
  title: 'Мой блокнот',
  createdAt: Date.now(),
  order: 0,
};

export const INITIAL_SECTIONS: Section[] = [
  {
    id: 'sec-quick-notes',
    notebookId: 'nb-my-notebook',
    title: 'Быстрые заметки',
    color: '#0078D4',
    order: 0,
  },
];

export const INITIAL_PAGES: Page[] = [
  {
    id: 'page-default',
    sectionId: 'sec-quick-notes',
    title: 'Новая страница',
    createdAt: Date.now(),
    order: 0,
    camera: { x: 0, y: 0, zoom: 1 },
    background: 'ruled',
  },
];
