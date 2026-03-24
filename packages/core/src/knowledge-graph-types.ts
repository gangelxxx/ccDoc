// ─── Knowledge Graph Types ──────────────────────────────────

// --- SQL rows ---

export interface KGNodeRow {
  id: string;
  section_id: string;
  message_id: string; // non-empty for idea message nodes, "" for doc/section
  node_type: "idea" | "doc" | "section" | "session";
  label: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface KGEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: "semantic_similar" | "parent_child";
  weight: number;
  created_by: "system" | "assistant" | "user";
  created_at: string;
}

// --- Rendering ---

export interface KGNode extends KGNodeRow {
  degree: number;
}

export interface KGEdge extends KGEdgeRow {}

export interface KnowledgeGraphData {
  nodes: KGNode[];
  edges: KGEdge[];
  analyzedAt: string | null;
}

// --- View settings (stored in section content) ---

export interface KGViewSettings {
  analyzedAt: string | null;
  version: number;
  filters: {
    visibleNodeTypes: string[];
    visibleEdgeTypes: string[];
    minWeight: number;
  };
  pinnedNodes: Record<string, { x: number; y: number }>;
}

export function emptyKGViewSettings(): KGViewSettings {
  return {
    analyzedAt: null,
    version: 1,
    filters: {
      visibleNodeTypes: ["idea", "doc", "section", "session"],
      visibleEdgeTypes: ["semantic_similar", "parent_child"],
      minWeight: 0,
    },
    pinnedNodes: {},
  };
}
