import { create } from 'zustand';
import { Notebook, Section, Page, SECTION_COLORS } from '../types/notebook';
import {
  initStorage,
  loadNotebooks,
  loadSections,
  loadPages,
  loadAllPages,
  createNotebook as dbCreateNotebook,
  renameNotebook as dbRenameNotebook,
  deleteNotebook as dbDeleteNotebook,
  createSection as dbCreateSection,
  createPage as dbCreatePage,
  deleteSection as dbDeleteSection,
  deletePage as dbDeletePage,
  updatePageMetadata,
  updateSection as dbUpdateSection,
  moveToTrashSection as dbMoveToTrashSection,
  restoreSection as dbRestoreSection,
  moveToTrashPage as dbMoveToTrashPage,
  restorePage as dbRestorePage,
  loadTrash as dbLoadTrash,
} from '../db/storage';
import { getDB } from '../db/idb';
import { useCanvasStore } from './useCanvasStore';
import {
  getSlugFromPathname,
  findPageBySlugOrAlias,
  generateUniqueSlug,
  titleToSlug,
  formatPageUrl,
} from '../utils/slug';

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
  addNotebook: (title?: string) => Promise<Notebook>;
  renameNotebook: (notebookId: string, newTitle: string) => Promise<void>;
  removeNotebook: (notebookId: string) => Promise<void>;
  selectSection: (section: Section) => Promise<void>;
  selectPage: (page: Page, updateUrl?: boolean) => Promise<void>;
  navigateToPage: (pageId: string, updateUrl?: boolean) => Promise<void>;

  addSection: (title?: string, color?: string) => Promise<Section>;
  addPage: (title?: string) => Promise<Page>;

  renameSection: (sectionId: string, newTitle: string) => Promise<void>;
  setSectionColor: (sectionId: string, color: string) => Promise<void>;
  moveToTrashSection: (sectionId: string) => Promise<void>;
  restoreSection: (sectionId: string) => Promise<void>;
  permanentDeleteSection: (sectionId: string) => Promise<void>;

  moveToTrashPage: (pageId: string) => Promise<void>;
  restorePage: (pageId: string) => Promise<void>;
  permanentDeletePage: (pageId: string) => Promise<void>;
  getTrashItems: () => Promise<{ sections: Section[]; pages: Page[] }>;

  removeSection: (sectionId: string) => Promise<void>;
  removePage: (pageId: string) => Promise<void>;

  renamePage: (pageId: string, newTitle: string) => Promise<void>;
  refreshFromStorage: () => Promise<void>;
}

let isPopStateBound = false;

function setupPopStateListener() {
  if (isPopStateBound || typeof window === 'undefined') return;
  isPopStateBound = true;

  window.addEventListener('popstate', async () => {
    const slug = getSlugFromPathname(window.location.pathname);
    if (!slug) return;

    const currentActive = useNotebookStore.getState().activePage;
    if (
      currentActive &&
      ((currentActive.slug && currentActive.slug.toLowerCase() === slug.toLowerCase()) ||
        titleToSlug(currentActive.title) === slug.toLowerCase())
    ) {
      return;
    }

    const allPages = await loadAllPages();
    const matched = findPageBySlugOrAlias(allPages, slug);
    if (matched && matched.id !== currentActive?.id) {
      await useNotebookStore.getState().navigateToPage(matched.id, false);
    }
  });
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

    setupPopStateListener();

    set({ isLoading: true });
    await initStorage();

    const notebooks = await loadNotebooks();
    const allPages = await loadAllPages();

    // Мягкая миграция: гарантируем наличие уникального slug у всех существующих страниц
    const existingSlugs: string[] = [];
    const existingAliases: string[] = [];
    for (const p of allPages) {
      if (p.slug) existingSlugs.push(p.slug);
      if (p.slugAliases) existingAliases.push(...p.slugAliases);
    }

    for (const p of allPages) {
      if (!p.slug) {
        p.slug = generateUniqueSlug(p.title, existingSlugs, undefined, existingAliases);
        existingSlugs.push(p.slug);
        if (!p.slugAliases) p.slugAliases = [];
        await updatePageMetadata(p.id, { slug: p.slug, slugAliases: p.slugAliases });
      }
    }

    // Проверяем URL: если передан слаг, ищем целевую страницу
    const targetSlug = typeof window !== 'undefined' ? getSlugFromPathname(window.location.pathname) : null;
    let targetPage = targetSlug ? findPageBySlugOrAlias(allPages, targetSlug) : null;

    let activeNotebook: Notebook | null = null;
    let sections: Section[] = [];
    let activeSection: Section | null = null;
    let pages: Page[] = [];
    let activePage: Page | null = null;

    if (targetPage) {
      const db = await getDB();
      const section = await db.get('sections', targetPage.sectionId);
      if (section) {
        const notebook = await db.get('notebooks', section.notebookId);
        if (notebook) {
          activeNotebook = notebook;
          sections = await loadSections(notebook.id);
          activeSection = section;
          pages = await loadPages(section.id);
          activePage = pages.find((p) => p.id === targetPage!.id) || targetPage;
        }
      }
    }

    // Если страница не найдена по URL — открываем первую страницу по умолчанию
    if (!activePage && notebooks.length > 0) {
      activeNotebook = notebooks[0];
      sections = await loadSections(activeNotebook.id);
      activeSection = sections[0] || null;

      if (activeSection) {
        pages = await loadPages(activeSection.id);
        activePage = pages[0] || null;
      }
    }

    if (activePage) {
      await useCanvasStore.getState().loadPage(activePage.id, activePage.camera, activePage.background);
      if (typeof window !== 'undefined') {
        const canonicalPath = formatPageUrl(activePage.slug || titleToSlug(activePage.title));
        if (window.location.pathname !== canonicalPath) {
          window.history.replaceState({ pageId: activePage.id }, '', canonicalPath);
        }
      }
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
      if (typeof window !== 'undefined') {
        const canonicalPath = formatPageUrl(activePage.slug || titleToSlug(activePage.title));
        if (window.location.pathname !== canonicalPath) {
          window.history.pushState({ pageId: activePage.id }, '', canonicalPath);
        }
      }
    }
  },

  addNotebook: async (title = 'Новый блокнот') => {
    const { notebooks } = get();
    const cleanTitle = title.trim() || 'Новый блокнот';
    const now = Date.now();
    const newNotebook: Notebook = {
      id: `nb-${now}`,
      title: cleanTitle,
      createdAt: now,
      updatedAt: now,
      order: notebooks.length,
    };

    await dbCreateNotebook(newNotebook);

    // Начальный раздел
    const firstSection: Section = {
      id: `sec-${now}`,
      notebookId: newNotebook.id,
      title: 'Быстрые заметки',
      color: SECTION_COLORS[0],
      order: 0,
      updatedAt: now,
    };
    await dbCreateSection(firstSection);

    // Начальная страница
    const today = new Date();
    const formattedDate = `${String(today.getDate()).padStart(2, '0')}.${String(
      today.getMonth() + 1
    ).padStart(2, '0')}.${today.getFullYear()}`;

    const allExistingPages = await loadAllPages();
    const existingSlugs = allExistingPages.map((p) => p.slug || titleToSlug(p.title));
    const existingAliases = allExistingPages.flatMap((p) => p.slugAliases || []);
    const firstPageSlug = generateUniqueSlug(formattedDate, existingSlugs, undefined, existingAliases);

    const firstPage: Page = {
      id: `page-${now}`,
      sectionId: firstSection.id,
      title: formattedDate,
      createdAt: now,
      updatedAt: now,
      order: 0,
      camera: { x: 0, y: 0, zoom: 1 },
      background: 'plain',
      slug: firstPageSlug,
      slugAliases: [],
    };
    await dbCreatePage(firstPage);

    const updatedNotebooks = [...notebooks, newNotebook];
    set({
      notebooks: updatedNotebooks,
      activeNotebook: newNotebook,
      sections: [firstSection],
      activeSection: firstSection,
      pages: [firstPage],
      activePage: firstPage,
    });

    await useCanvasStore.getState().loadPage(firstPage.id, firstPage.camera, firstPage.background);

    if (typeof window !== 'undefined') {
      window.history.pushState({ pageId: firstPage.id }, '', formatPageUrl(firstPageSlug));
    }

    return newNotebook;
  },

  renameNotebook: async (notebookId: string, newTitle: string) => {
    const cleanTitle = newTitle.trim() || 'Блокнот';
    await dbRenameNotebook(notebookId, cleanTitle);
    const now = Date.now();
    set((state) => ({
      notebooks: state.notebooks.map((nb) =>
        nb.id === notebookId ? { ...nb, title: cleanTitle, updatedAt: now } : nb
      ),
      activeNotebook:
        state.activeNotebook?.id === notebookId
          ? { ...state.activeNotebook, title: cleanTitle, updatedAt: now }
          : state.activeNotebook,
    }));
  },

  removeNotebook: async (notebookId: string) => {
    await dbDeleteNotebook(notebookId);
    const { notebooks, activeNotebook } = get();
    const remaining = notebooks.filter((nb) => nb.id !== notebookId);
    let nextActive = activeNotebook;
    if (activeNotebook?.id === notebookId) {
      nextActive = remaining[0] || null;
    }
    set({ notebooks: remaining, activeNotebook: nextActive });
    if (nextActive) {
      await get().selectNotebook(nextActive);
    } else {
      set({ sections: [], activeSection: null, pages: [], activePage: null });
    }
  },

  selectSection: async (section) => {
    set({ activeSection: section });
    const pages = await loadPages(section.id);
    const activePage = pages[0] || null;

    set({ pages, activePage });

    if (activePage) {
      await useCanvasStore.getState().loadPage(activePage.id, activePage.camera, activePage.background);
      if (typeof window !== 'undefined') {
        const canonicalPath = formatPageUrl(activePage.slug || titleToSlug(activePage.title));
        if (window.location.pathname !== canonicalPath) {
          window.history.pushState({ pageId: activePage.id }, '', canonicalPath);
        }
      }
    }
  },

  selectPage: async (page, updateUrl = true) => {
    set({ activePage: page });
    await useCanvasStore.getState().loadPage(page.id, page.camera, page.background);
    if (updateUrl && typeof window !== 'undefined') {
      const canonicalPath = formatPageUrl(page.slug || titleToSlug(page.title));
      if (window.location.pathname !== canonicalPath) {
        window.history.pushState({ pageId: page.id }, '', canonicalPath);
      }
    }
  },

  navigateToPage: async (pageId: string, updateUrl = true) => {
    const db = await getDB();
    const page = await db.get('pages', pageId);
    if (!page) return;

    const section = await db.get('sections', page.sectionId);
    if (!section) return;

    const notebook = await db.get('notebooks', section.notebookId);
    if (!notebook) return;

    const sections = await loadSections(notebook.id);
    const pages = await loadPages(section.id);

    set({
      activeNotebook: notebook,
      sections,
      activeSection: section,
      pages,
      activePage: page,
    });

    await useCanvasStore.getState().loadPage(page.id, page.camera, page.background);

    if (updateUrl && typeof window !== 'undefined') {
      const canonicalPath = formatPageUrl(page.slug || titleToSlug(page.title));
      if (window.location.pathname !== canonicalPath) {
        window.history.pushState({ pageId: page.id }, '', canonicalPath);
      }
    }
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

    const allExistingPages = await loadAllPages();
    const existingSlugs = allExistingPages.map((p) => p.slug || titleToSlug(p.title));
    const existingAliases = allExistingPages.flatMap((p) => p.slugAliases || []);
    const pageSlug = generateUniqueSlug(formattedDate, existingSlugs, undefined, existingAliases);

    const newPage: Page = {
      id: `page-${Date.now()}`,
      sectionId: newSection.id,
      title: formattedDate,
      createdAt: Date.now(),
      order: 0,
      camera: { x: 0, y: 0, zoom: 1 },
      background: 'plain',
      slug: pageSlug,
      slugAliases: [],
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

    if (typeof window !== 'undefined') {
      window.history.pushState({ pageId: newPage.id }, '', formatPageUrl(pageSlug));
    }

    return newSection;
  },

  addPage: async (title) => {
    const { activeSection, pages } = get();
    if (!activeSection) throw new Error('No active section');

    const today = new Date();
    const formattedDate = `${String(today.getDate()).padStart(2, '0')}.${String(
      today.getMonth() + 1
    ).padStart(2, '0')}.${today.getFullYear()}`;
    const pageTitle = title || formattedDate;

    const allExistingPages = await loadAllPages();
    const existingSlugs = allExistingPages.map((p) => p.slug || titleToSlug(p.title));
    const existingAliases = allExistingPages.flatMap((p) => p.slugAliases || []);
    const pageSlug = generateUniqueSlug(pageTitle, existingSlugs, undefined, existingAliases);

    const newPage: Page = {
      id: `page-${Date.now()}`,
      sectionId: activeSection.id,
      title: pageTitle,
      createdAt: Date.now(),
      order: pages.length,
      camera: { x: 0, y: 0, zoom: 1 },
      background: 'plain',
      slug: pageSlug,
      slugAliases: [],
    };

    await dbCreatePage(newPage);

    const updatedPages = [...pages, newPage];
    set({
      pages: updatedPages,
      activePage: newPage,
    });

    await useCanvasStore.getState().loadPage(newPage.id, newPage.camera, newPage.background);

    if (typeof window !== 'undefined') {
      window.history.pushState({ pageId: newPage.id }, '', formatPageUrl(pageSlug));
    }

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

  renameSection: async (sectionId, newTitle) => {
    await dbUpdateSection(sectionId, { title: newTitle });
    set((state) => ({
      sections: state.sections.map((s) => (s.id === sectionId ? { ...s, title: newTitle } : s)),
      activeSection: state.activeSection?.id === sectionId ? { ...state.activeSection, title: newTitle } : state.activeSection,
    }));
  },

  setSectionColor: async (sectionId, color) => {
    await dbUpdateSection(sectionId, { color });
    set((state) => ({
      sections: state.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)),
      activeSection: state.activeSection?.id === sectionId ? { ...state.activeSection, color } : state.activeSection,
    }));
  },

  moveToTrashSection: async (sectionId) => {
    await dbMoveToTrashSection(sectionId);
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

  restoreSection: async (sectionId) => {
    await dbRestoreSection(sectionId);
    await get().refreshFromStorage();
  },

  permanentDeleteSection: async (sectionId) => {
    await dbDeleteSection(sectionId);
    await get().refreshFromStorage();
  },

  moveToTrashPage: async (pageId) => {
    await dbMoveToTrashPage(pageId);
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

  restorePage: async (pageId) => {
    await dbRestorePage(pageId);
    await get().refreshFromStorage();
  },

  permanentDeletePage: async (pageId) => {
    await dbDeletePage(pageId);
    await get().refreshFromStorage();
  },

  getTrashItems: async () => {
    return dbLoadTrash();
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
      if (typeof window !== 'undefined') {
        const canonicalPath = formatPageUrl(nextActive.slug || titleToSlug(nextActive.title));
        window.history.replaceState({ pageId: nextActive.id }, '', canonicalPath);
      }
    } else if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
    }
  },

  renamePage: async (pageId, newTitle) => {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;

    const { pages, activePage } = get();
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;

    const oldSlug = page.slug || titleToSlug(page.title);
    const allExistingPages = await loadAllPages();
    const existingSlugs = allExistingPages.map((p) => p.slug || titleToSlug(p.title));
    const existingAliases = allExistingPages.flatMap((p) => p.slugAliases || []);
    const newSlug = generateUniqueSlug(cleanTitle, existingSlugs, oldSlug, existingAliases);

    let updatedAliases = page.slugAliases || [];
    if (newSlug !== oldSlug && !updatedAliases.includes(oldSlug)) {
      updatedAliases = [...updatedAliases, oldSlug];
    }

    await updatePageMetadata(pageId, {
      title: cleanTitle,
      slug: newSlug,
      slugAliases: updatedAliases,
    });

    set((state) => ({
      pages: state.pages.map((p) =>
        p.id === pageId ? { ...p, title: cleanTitle, slug: newSlug, slugAliases: updatedAliases } : p
      ),
      activePage:
        state.activePage?.id === pageId
          ? { ...state.activePage, title: cleanTitle, slug: newSlug, slugAliases: updatedAliases }
          : state.activePage,
    }));

    if (activePage?.id === pageId && typeof window !== 'undefined') {
      window.history.replaceState({ pageId }, '', formatPageUrl(newSlug));
    }
  },

  refreshFromStorage: async () => {
    const notebooks = await loadNotebooks();
    const currentActiveNb = get().activeNotebook;
    const activeNb = notebooks.find((n) => n.id === currentActiveNb?.id) || notebooks[0] || null;
    let sections: Section[] = [];
    let activeSec = get().activeSection;
    let pages: Page[] = [];
    let activePg = get().activePage;

    if (activeNb) {
      sections = await loadSections(activeNb.id);
      if (!activeSec || !sections.some((s) => s.id === activeSec?.id)) {
        activeSec = sections[0] || null;
      }
      if (activeSec) {
        pages = await loadPages(activeSec.id);
        if (!activePg || !pages.some((p) => p.id === activePg?.id)) {
          activePg = pages[0] || null;
        }
      }
    }

    if (activePg) {
      await useCanvasStore.getState().loadPage(activePg.id, activePg.camera, activePg.background);
    }

    set({
      notebooks,
      activeNotebook: activeNb,
      sections,
      activeSection: activeSec,
      pages,
      activePage: activePg,
    });
  },
}));
