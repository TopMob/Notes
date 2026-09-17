import { create } from 'zustand';
import { Notebook, Section, Page, SECTION_COLORS } from '../types/notebook';
import {
  initStorage,
  loadNotebooks,
  loadSections,
  loadPages,
  createSection as dbCreateSection,
  createPage as dbCreatePage,
  deleteSection as dbDeleteSection,
  deletePage as dbDeletePage,
  updatePageMetadata,
} from '../db/storage';
import { useCanvasStore } from './useCanvasStore';

interface NotebookState {
  notebooks: Notebook[];
  activeNotebook: Notebook | null;

  sections: Section[];
  activeSection: Section | null;

  pages: Page[];
  activePage: Page | null;

  isLoading: boolean;

  // Действия
  init: () => Promise<void>;
  selectNotebook: (notebook: Notebook) => Promise<void>;
  selectSection: (section: Section) => Promise<void>;
  selectPage: (page: Page) => Promise<void>;

  addSection: (title?: string, color?: string) => Promise<Section>;
  addPage: (title?: string) => Promise<Page>;

  removeSection: (sectionId: string) => Promise<void>;
  removePage: (pageId: string) => Promise<void>;

  renamePage: (pageId: string, newTitle: string) => Promise<void>;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebooks: [],
  activeNotebook: null,
  sections: [],
  activeSection: null,
  pages: [],
  activePage: null,
  isLoading: true,

  init: async () => {
    // Предотвращаем повторную инициализацию
    if (get().notebooks.length > 0 && !get().isLoading) return;

    set({ isLoading: true });
    await initStorage();

    const notebooks = await loadNotebooks();
    const activeNotebook = notebooks[0] || null;

    let sections: Section[] = [];
    let activeSection: Section | null = null;
    let pages: Page[] = [];
    let activePage: Page | null = null;

    if (activeNotebook) {
      sections = await loadSections(activeNotebook.id);
      activeSection = sections[0] || null;

      if (activeSection) {
        pages = await loadPages(activeSection.id);
        // По умолчанию активируем первую страницу
        activePage = pages[0] || null;
      }
    }

    if (activePage) {
      await useCanvasStore.getState().loadPage(activePage.id, activePage.camera, activePage.background);
    }

    set({
      notebooks,
      activeNotebook,
      sections,
      activeSection,
      pages,
      activePage,
      isLoading: false,
    });
  },

  selectNotebook: async (notebook) => {
    set({ activeNotebook: notebook });
    const sections = await loadSections(notebook.id);
    const activeSection = sections[0] || null;

    let pages: Page[] = [];
    let activePage: Page | null = null;

    if (activeSection) {
      pages = await loadPages(activeSection.id);
      activePage = pages[0] || null;
    }

    set({ sections, activeSection, pages, activePage });

    if (activePage) {
      await useCanvasStore.getState().loadPage(activePage.id, activePage.camera, activePage.background);
    }
  },

  selectSection: async (section) => {
    set({ activeSection: section });
    const pages = await loadPages(section.id);
    const activePage = pages[0] || null;

    set({ pages, activePage });

    if (activePage) {
      await useCanvasStore.getState().loadPage(activePage.id, activePage.camera, activePage.background);
    }
  },

  selectPage: async (page) => {
    set({ activePage: page });
    await useCanvasStore.getState().loadPage(page.id, page.camera, page.background);
  },

  addSection: async (title = 'Новый раздел', color) => {
    const { activeNotebook, sections } = get();
    if (!activeNotebook) throw new Error('No active notebook');

    const nextColor = color || SECTION_COLORS[sections.length % SECTION_COLORS.length];
    const newSection: Section = {
      id: `sec-${Date.now()}`,
      notebookId: activeNotebook.id,
      title,
      color: nextColor,
      order: sections.length,
    };

    await dbCreateSection(newSection);

    // Автоматически создаем первую страницу для нового раздела
    const today = new Date();
    const formattedDate = `${String(today.getDate()).padStart(2, '0')}.${String(
      today.getMonth() + 1
    ).padStart(2, '0')}.${today.getFullYear()}`;

    const newPage: Page = {
      id: `page-${Date.now()}`,
      sectionId: newSection.id,
      title: formattedDate,
      createdAt: Date.now(),
      order: 0,
      camera: { x: 0, y: 0, zoom: 1 },
      background: 'plain',
    };

    await dbCreatePage(newPage);

    const updatedSections = [...sections, newSection];
    set({
      sections: updatedSections,
      activeSection: newSection,
      pages: [newPage],
      activePage: newPage,
    });

    await useCanvasStore.getState().loadPage(newPage.id, newPage.camera, newPage.background);

    return newSection;
  },

  addPage: async (title) => {
    const { activeSection, pages } = get();
    if (!activeSection) throw new Error('No active section');

    const today = new Date();
    const formattedDate = `${String(today.getDate()).padStart(2, '0')}.${String(
      today.getMonth() + 1
    ).padStart(2, '0')}.${today.getFullYear()}`;

    const newPage: Page = {
      id: `page-${Date.now()}`,
      sectionId: activeSection.id,
      title: title || formattedDate,
      createdAt: Date.now(),
      order: pages.length,
      camera: { x: 0, y: 0, zoom: 1 },
      background: 'plain',
    };

    await dbCreatePage(newPage);

    const updatedPages = [...pages, newPage];
    set({
      pages: updatedPages,
      activePage: newPage,
    });

    await useCanvasStore.getState().loadPage(newPage.id, newPage.camera, newPage.background);

    return newPage;
  },

  removeSection: async (sectionId) => {
    await dbDeleteSection(sectionId);
    const { sections, activeSection } = get();
    const remaining = sections.filter((s) => s.id !== sectionId);

    let nextActive = activeSection;
    if (activeSection?.id === sectionId) {
      nextActive = remaining[0] || null;
    }

    set({ sections: remaining, activeSection: nextActive });

    if (nextActive) {
      const pages = await loadPages(nextActive.id);
      const activePage = pages[0] || null;
      set({ pages, activePage });
      if (activePage) {
        await useCanvasStore.getState().loadPage(activePage.id, activePage.camera, activePage.background);
      }
    } else {
      set({ pages: [], activePage: null });
    }
  },

  removePage: async (pageId) => {
    await dbDeletePage(pageId);
    const { pages, activePage } = get();
    const remaining = pages.filter((p) => p.id !== pageId);

    let nextActive = activePage;
    if (activePage?.id === pageId) {
      nextActive = remaining[0] || null;
    }

    set({ pages: remaining, activePage: nextActive });

    if (nextActive) {
      await useCanvasStore.getState().loadPage(nextActive.id, nextActive.camera, nextActive.background);
    }
  },

  renamePage: async (pageId, newTitle) => {
    await updatePageMetadata(pageId, { title: newTitle });
    set((state) => ({
      pages: state.pages.map((p) => (p.id === pageId ? { ...p, title: newTitle } : p)),
      activePage: state.activePage?.id === pageId ? { ...state.activePage, title: newTitle } : state.activePage,
    }));
  },
}));
