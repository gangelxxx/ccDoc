import type { SliceCreator } from "../types.js";

export interface SearchSlice {
  searchResults: { id: string; title: string; score: number }[];
  search: (query: string) => Promise<void>;

  ftsQuery: string;
  ftsResults: { id: string; title: string; titleHighlighted: string; snippet: string; score: number; breadcrumbs?: string; source?: "project" | "user" }[];
  ftsLoading: boolean;
  setFtsQuery: (query: string) => void;
  searchFts: (query: string) => Promise<void>;
}

export const createSearchSlice: SliceCreator<SearchSlice> = (set, get) => ({
  searchResults: [],
  search: async (query) => {
    const { currentProject } = get();
    if (!currentProject) return;
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    try {
      const results = await window.api.search(currentProject.token, query);
      set({ searchResults: results });
    } catch (e: any) {
      get().addToast("error", "Search failed", e.message);
    }
  },

  ftsQuery: "",
  ftsResults: [],
  ftsLoading: false,
  setFtsQuery: (query: string) => set({ ftsQuery: query }),
  searchFts: async (query) => {
    const { currentProject } = get();
    if (!query.trim()) {
      set({ ftsResults: [], ftsLoading: false });
      return;
    }
    set({ ftsLoading: true });
    try {
      if (currentProject) {
        // Project search (also searches user DB via IPC handler)
        const results = await window.api.searchFts(currentProject.token, query);
        set({ ftsResults: results, ftsLoading: false });
      } else {
        // No project — search only user DB
        const results = await window.api.user.search(query);
        const tagged = results.map((r: any) => ({ ...r, source: "user" as const }));
        set({ ftsResults: tagged, ftsLoading: false });
      }
    } catch (e: any) {
      set({ ftsLoading: false });
      get().addToast("error", "Search failed", e.message);
    }
  },
});
