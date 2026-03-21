// ── Kanban Types ──────────────────────────────────────────

export type PropertyType = "text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url" | "person";

export interface SelectOption {
  id: string;
  name: string;
  color: string;
}

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  isVisible: boolean;
  order: number;
}

export interface BoardSettings {
  cardSize: "small" | "medium" | "large";
  cardPreview: "none" | "page_content";
  colorColumns: boolean;
  hideEmptyGroups: boolean;
  groupBy?: string;
  subGroupBy?: string;
  calculation?: { propertyId: string; type: "count" | "sum" | "avg" } | null;
}

export interface Filter {
  id: string;
  propertyId: string;
  condition: string;
  value: any;
}

export interface Sort {
  propertyId: string;
  direction: "asc" | "desc";
}

export interface BoardView {
  id: string;
  name: string;
  type: "board" | "table" | "list";
  filters: Filter[];
  sorts: Sort[];
  settings: BoardSettings;
}

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  icon?: string;
  labels: string[];
  checked: boolean;
  properties: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  sourceIdeaId?: string;
  sourceMessageId?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  color?: string;
  cards: KanbanCard[];
  isHidden?: boolean;
  isDone?: boolean;
  width?: number;
}

export interface KanbanData {
  columns: KanbanColumn[];
  properties?: PropertyDefinition[];
  settings?: BoardSettings;
  views?: BoardView[];
  sourceIdeaId?: string;
}

export interface FocusedCard {
  colIndex: number;
  cardIndex: number;
}
