import type { SliceCreator } from "../types.js";

export interface NavigationSlice {
  navHistory: string[];
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
    const id = navHistory[newIndex];
    set({
      navIndex: newIndex,
      canGoBack: newIndex > 0,
      canGoForward: true,
    });
    // Load section without pushing to history
    const { currentProject } = get();
    if (currentProject) {
      window.api.getSection(currentProject.token, id).then((section) => {
        // Guard against stale navigation: only update if index hasn't changed
        if (get().navIndex === newIndex) {
          set({ currentSection: section });
        }
      }).catch(() => {});
    }
  },

  goForward: () => {
    const { navHistory, navIndex } = get();
    if (navIndex >= navHistory.length - 1) return;
    const newIndex = navIndex + 1;
    const id = navHistory[newIndex];
    set({
      navIndex: newIndex,
      canGoBack: true,
      canGoForward: newIndex < navHistory.length - 1,
    });
    const { currentProject } = get();
    if (currentProject) {
      window.api.getSection(currentProject.token, id).then((section) => {
        if (get().navIndex === newIndex) {
          set({ currentSection: section });
        }
      }).catch(() => {});
    }
  },
});
