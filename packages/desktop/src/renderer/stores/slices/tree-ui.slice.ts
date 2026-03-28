import type { SliceCreator } from "../types.js";

export interface TreeUiSlice {
  expandedNodes: Set<string>;
  toggleExpanded: (id: string) => void;
  expandNode: (id: string) => void;
  collapseAll: () => void;
}

export const createTreeUiSlice: SliceCreator<TreeUiSlice> = (set, get) => ({
  expandedNodes: (() => { try { return new Set<string>(JSON.parse(localStorage.getItem("ccdoc-expanded-nodes") || "[]")); } catch { return new Set<string>(); } })(),

  toggleExpanded: (id) => {
    const nodes = new Set(get().expandedNodes);
    if (nodes.has(id)) nodes.delete(id); else nodes.add(id);
    localStorage.setItem("ccdoc-expanded-nodes", JSON.stringify([...nodes]));
    set({ expandedNodes: nodes });
  },

  expandNode: (id) => {
    const nodes = get().expandedNodes;
    if (nodes.has(id)) return;
    const next = new Set(nodes);
    next.add(id);
    localStorage.setItem("ccdoc-expanded-nodes", JSON.stringify([...next]));
    set({ expandedNodes: next });
  },

  collapseAll: () => {
    localStorage.setItem("ccdoc-expanded-nodes", "[]");
    set({ expandedNodes: new Set() });
  },
});
