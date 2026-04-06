import type { SliceCreator } from "../types.js";

interface NavEntry {
  id: string;
  source: "project" | "user";
}

export interface NavigationSlice {
  navHistory: NavEntry[];
  navIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

export const createNavigationSlice: SliceCreator<NavigationSlice> = (set, get) => ({
  navHistory: [],
  navIndex: -1,
  canGoBack: false,
  canGoForward: false,

  goBack: () => {
    const { navHistory, navIndex } = get();
    if (navIndex <= 0) return;
    const newIndex = navIndex - 1;
    const entry = navHistory[newIndex];
    set({
      navIndex: newIndex,
      canGoBack: newIndex > 0,
      canGoForward: true,
    });
    if (entry.source === "user") {
      window.api.user.get(entry.id).then((section) => {
        if (get().navIndex === newIndex && section) {
          set({ currentSection: section, sectionSource: "user", activeSectionToken: null });
        }
      }).catch(() => {});
    } else {
      const { currentProject } = get();
      if (currentProject) {
        window.api.getSection(currentProject.token, entry.id).then((section) => {
          if (get().navIndex === newIndex) {
            set({ currentSection: section, sectionSource: "project" });
          }
        }).catch(() => {});
      }
    }
  },

  goForward: () => {
    const { navHistory, navIndex } = get();
    if (navIndex >= navHistory.length - 1) return;
    const newIndex = navIndex + 1;
    const entry = navHistory[newIndex];
    set({
      navIndex: newIndex,
      canGoBack: true,
      canGoForward: newIndex < navHistory.length - 1,
    });
    if (entry.source === "user") {
      window.api.user.get(entry.id).then((section) => {
        if (get().navIndex === newIndex && section) {
          set({ currentSection: section, sectionSource: "user", activeSectionToken: null });
        }
      }).catch(() => {});
    } else {
      const { currentProject } = get();
      if (currentProject) {
        window.api.getSection(currentProject.token, entry.id).then((section) => {
          if (get().navIndex === newIndex) {
            set({ currentSection: section, sectionSource: "project" });
          }
        }).catch(() => {});
      }
    }
  },
});
