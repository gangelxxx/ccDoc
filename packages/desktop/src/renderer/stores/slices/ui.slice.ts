import type { Lang } from "../../i18n.js";
import type { SliceCreator, ToastType } from "../types.js";

let toastCounter = 0;

export interface UiSlice {
  theme: "light" | "dark";
  toggleTheme: () => void;
  language: Lang;
  setLanguage: (lang: Lang) => void;
  contentWidth: "narrow" | "medium" | "wide";
  cycleContentWidth: () => void;

  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  llmPanelWidth: number;
  setLlmPanelWidth: (w: number) => void;
  savePanelWidths: () => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  sidebarTab: "tree" | "search" | "history";
  setSidebarTab: (tab: "tree" | "search" | "history") => void;
  historyExpanded: boolean;
  toggleHistoryExpanded: () => void;

  toasts: { id: string; type: ToastType; title: string; message?: string }[];
  addToast: (type: ToastType, title: string, message?: string) => void;
  removeToast: (id: string) => void;

  confirmModal: { message: string; title?: string; danger?: boolean; resolve: (ok: boolean) => void } | null;
  showConfirm: (message: string, opts?: { title?: string; danger?: boolean }) => Promise<boolean>;
  closeConfirm: (result: boolean) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  scrollToSectionId: string | null;
  setScrollToSectionId: (id: string | null) => void;
  clearScrollToSection: () => void;

  sectionViewFiles: Record<string, boolean>;
  toggleFileViewMode: (fileId: string) => void;

  // FileView content refresh signal (incremented after LLM mutations)
  fileSectionsVersion: number;

  sectionLoading: boolean;
  treeLoading: boolean;

  llmPanelOpen: boolean;
  setLlmPanelOpen: (open: boolean) => void;
  toggleLlmPanel: () => void;

  quickIdeaOpen: boolean;
  setQuickIdeaOpen: (open: boolean) => void;
  toggleQuickIdea: () => void;

  settingsOpen: string | null; // null = closed, string = tab to open (e.g. "voice")
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
}

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  theme: "light" as "light" | "dark", // overwritten by boot
  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    set({ theme: next });
    window.api.settingsPatch({ theme: next });
  },
  language: "en" as Lang, // overwritten by boot
  setLanguage: (lang) => {
    set({ language: lang });
    window.api.settingsPatch({ language: lang });
  },

  sidebarWidth: 268, // overwritten by boot
  setSidebarWidth: (w) => {
    const clamped = Math.max(140, Math.min(800, w));
    if (clamped === get().sidebarWidth) return;
    set({ sidebarWidth: clamped });
  },
  llmPanelWidth: 320, // overwritten by boot
  setLlmPanelWidth: (w) => {
    const maxW = Math.floor(window.innerWidth * 0.8);
    const clamped = Math.max(200, Math.min(maxW, w));
    if (clamped === get().llmPanelWidth) return;
    set({ llmPanelWidth: clamped });
  },
  savePanelWidths: () => {
    const { sidebarWidth, llmPanelWidth } = get();
    window.api.settingsPatch({ sidebarWidth, llmPanelWidth });
  },

  sectionLoading: false,
  treeLoading: false,

  contentWidth: "narrow" as "narrow" | "medium" | "wide", // overwritten by boot
  cycleContentWidth: () => {
    const order = ["narrow", "medium", "wide"] as const;
    const idx = order.indexOf(get().contentWidth);
    const next = order[(idx + 1) % order.length];
    document.documentElement.setAttribute("data-content-width", next);
    set({ contentWidth: next });
    window.api.settingsPatch({ contentWidth: next });
  },

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  sidebarTab: "tree",
  setSidebarTab: (tab) => {
    set({ sidebarTab: tab });
    if (tab === "history") get().loadHistory();
  },
  historyExpanded: false,
  toggleHistoryExpanded: () => set((s) => ({ historyExpanded: !s.historyExpanded })),

  toasts: [],
  addToast: (type, title, message) => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({
      toasts: [...s.toasts.slice(-2), { id, type, title, message }],
    }));
    setTimeout(() => get().removeToast(id), 3000);
  },
  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  confirmModal: null,
  showConfirm: (message: string, opts?: { title?: string; danger?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      set({ confirmModal: { message, title: opts?.title, danger: opts?.danger, resolve } });
    });
  },
  closeConfirm: (result: boolean) => {
    const modal = get().confirmModal;
    if (modal) modal.resolve(result);
    set({ confirmModal: null });
  },

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  scrollToSectionId: null,
  setScrollToSectionId: (id) => set({ scrollToSectionId: id }),
  clearScrollToSection: () => set({ scrollToSectionId: null }),

  fileSectionsVersion: 0,

  sectionViewFiles: {},
  toggleFileViewMode: (fileId) => {
    set((s) => ({
      sectionViewFiles: {
        ...s.sectionViewFiles,
        [fileId]: !s.sectionViewFiles[fileId],
      },
    }));
  },

  llmPanelOpen: false,
  setLlmPanelOpen: (open) => set({ llmPanelOpen: open }),
  toggleLlmPanel: () => set((s) => ({ llmPanelOpen: !s.llmPanelOpen })),

  quickIdeaOpen: false,
  setQuickIdeaOpen: (open) => set({ quickIdeaOpen: open }),
  toggleQuickIdea: () => set((s) => ({ quickIdeaOpen: !s.quickIdeaOpen })),

  settingsOpen: null,
  openSettings: (tab) => set({ settingsOpen: tab || "model" }),
  closeSettings: () => set({ settingsOpen: null }),
});
