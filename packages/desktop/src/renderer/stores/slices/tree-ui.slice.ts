import type { SliceCreator } from "../types.js";

export interface TreeUiSlice {
  expandedNodes: Set<string>;
  loadingNodes: Set<string>;
  toggleExpanded: (id: string) => void;
  expandNode: (id: string) => void;
  collapseAll: () => void;
  setNodeLoading: (id: string, loading: boolean) => void;
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistExpanded(nodes: Set<string>): void {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    localStorage.setItem("ccdoc-expanded-nodes", JSON.stringify([...nodes]));
  }, 500);
}

export const createTreeUiSlice: SliceCreator<TreeUiSlice> = (set, get) => ({
  expandedNodes: (() => { try { return new Set<string>(JSON.parse(localStorage.getItem("ccdoc-expanded-nodes") || "[]")); } catch { return new Set<string>(); } })(),
  loadingNodes: new Set<string>(),

  toggleExpanded: (id) => {
    const nodes = new Set(get().expandedNodes);
    if (nodes.has(id)) nodes.delete(id); else nodes.add(id);
    set({ expandedNodes: nodes });
    persistExpanded(nodes);
  },

  expandNode: (id) => {
    const nodes = get().expandedNodes;
    if (nodes.has(id)) return;
    const next = new Set(nodes);
    next.add(id);
    set({ expandedNodes: next });
    persistExpanded(next);
  },

  collapseAll: () => {
    set({ expandedNodes: new Set() });
    persistExpanded(new Set());
  },

  setNodeLoading: (id, loading) => {
    const next = new Set(get().loadingNodes);
    if (loading) next.add(id); else next.delete(id);
    set({ loadingNodes: next });
  },
});
