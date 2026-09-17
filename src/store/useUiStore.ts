import { create } from 'zustand';

export type RibbonTab = 'file' | 'home' | 'insert' | 'draw' | 'view';

interface UiState {
  theme: 'light' | 'dark';
  activeRibbonTab: RibbonTab;
  isRibbonCollapsed: boolean;
  isSidebarOpen: boolean;
  isZenMode: boolean;
  isSearchOpen: boolean;
  isExportOpen: boolean;
  isSettingsOpen: boolean;
  isCloudSettingsOpen: boolean;
  isTrashOpen: boolean;
  isCreateSectionOpen: boolean;
  deleteConfirm: { isOpen: boolean; type: 'section' | 'page'; id: string; title: string } | null;
  isFloatingPaletteOpen: boolean;

  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setActiveRibbonTab: (tab: RibbonTab) => void;
  toggleRibbonCollapsed: () => void;
  toggleSidebar: () => void;
  toggleZenMode: () => void;
  setSearchOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCloudSettingsOpen: (open: boolean) => void;
  setTrashOpen: (open: boolean) => void;
  setCreateSectionOpen: (open: boolean) => void;
  openDeleteConfirm: (type: 'section' | 'page', id: string, title: string) => void;
  closeDeleteConfirm: () => void;
  toggleFloatingPalette: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'light',
  activeRibbonTab: 'draw', // По умолчанию вкладка "Рисование" как в скриншоте!
  isRibbonCollapsed: false,
  isSidebarOpen: true,
  isZenMode: false,
  isSearchOpen: false,
  isExportOpen: false,
  isSettingsOpen: false,
  isCloudSettingsOpen: false,
  isTrashOpen: false,
  isCreateSectionOpen: false,
  deleteConfirm: null,
  isFloatingPaletteOpen: false,

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },

  toggleTheme: () => {
    const nextTheme = get().theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    set({ theme: nextTheme });
  },

  setActiveRibbonTab: (activeRibbonTab) => set({ activeRibbonTab }),
  toggleRibbonCollapsed: () => set((s) => ({ isRibbonCollapsed: !s.isRibbonCollapsed })),
  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
  toggleZenMode: () => set((s) => ({ isZenMode: !s.isZenMode })),
  setSearchOpen: (isSearchOpen) => set({ isSearchOpen }),
  setExportOpen: (isExportOpen) => set({ isExportOpen }),
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  setCloudSettingsOpen: (isCloudSettingsOpen) => set({ isCloudSettingsOpen }),
  setTrashOpen: (isTrashOpen) => set({ isTrashOpen }),
  setCreateSectionOpen: (isCreateSectionOpen) => set({ isCreateSectionOpen }),
  openDeleteConfirm: (type, id, title) => set({ deleteConfirm: { isOpen: true, type, id, title } }),
  closeDeleteConfirm: () => set({ deleteConfirm: null }),
  toggleFloatingPalette: () => set((s) => ({ isFloatingPaletteOpen: !s.isFloatingPaletteOpen })),
}));
