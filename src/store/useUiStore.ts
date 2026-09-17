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
  isFloatingPaletteOpen: boolean;

  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setActiveRibbonTab: (tab: RibbonTab) => void;
  toggleRibbonCollapsed: () => void;
  toggleSidebar: () => void;
  toggleZenMode: () => void;
  setSearchOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
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
  toggleFloatingPalette: () => set((s) => ({ isFloatingPaletteOpen: !s.isFloatingPaletteOpen })),
}));
