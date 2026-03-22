export interface Project {
  token: string;
  name: string;
  path: string;
  added_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  parent_id: string | null;
  title: string;
  content: string; // ProseMirror JSON string
  type: SectionType;
  sort_key: string;
  icon: string | null;
  summary: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SectionType = "folder" | "file" | "section" | "idea" | "drawing" | "kanban" | "todo";

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "person";

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

export interface KanbanColumn {
  id: string;
  title: string;
  color?: string;
  cards: KanbanCard[];
  isHidden?: boolean;
  isDone?: boolean;
  width?: number;
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

export interface KanbanData {
  columns: KanbanColumn[];
  properties?: PropertyDefinition[];
  settings?: BoardSettings;
  views?: BoardView[];
  sourceIdeaId?: string;
}

export interface FileSectionNode extends Section {
  children: FileSectionNode[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface SectionTag {
  section_id: string;
  tag_id: string;
}

export interface IdeaImage {
  id: string;
  name: string;
  mediaType: string;
  data: string; // base64 without data: prefix
}

export interface IdeaMessage {
  id: string;
  text: string;
  createdAt: number;
  planId?: string;
  completed?: boolean;
  editedAt?: number;
  images?: IdeaImage[];
}

export interface IdeaData {
  messages: IdeaMessage[];
  kanbanId?: string;
}

export interface ExportHash {
  file_path: string;
  hash: string;
  exported_at: string;
}

export interface TreeNode {
  id: string;
  parent_id: string | null;
  title: string;
  type: SectionType;
  icon: string | null;
  sort_key: string;
  summary: string | null;
  children: TreeNode[];
}

export interface HistoryCommit {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
}

export type OutputFormat = "markdown" | "plain" | "structured";

export interface StructuredBlock {
  type: string;
  text?: string;
  level?: number;
  name?: string;
  checked?: boolean;
  language?: string;
  items?: StructuredBlock[];
}

export interface StructuredOutput {
  title: string;
  blocks: StructuredBlock[];
}

export interface StructureJson {
  version: string;
  exported_at: string;
  sections: StructureSection[];
  tags: Tag[];
}

export interface StructureSection {
  id: string;
  parent_id: string | null;
  title: string;
  type: SectionType;
  sort_key: string;
  icon: string | null;
  tags: string[];
  file: string;
  drawing_blocks: DrawingBlock[];
}

export interface DrawingBlock {
  name: string;
  position: number;
  elements: unknown[];
  appState: Record<string, unknown>;
}

export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: ProseMirrorMark[];
}

export interface ProseMirrorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// Drawing element for converter (subset of desktop DrawElement)
export interface DrawingElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: string;
  opacity: number;
  seed: number;
  isDeleted: boolean;
  points?: [number, number][];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: string;
  arrowhead?: string | null;
  startArrowhead?: string | null;
  arrowType?: string;
  roundness?: string;
  startBinding?: { elementId: string; anchorX: number; anchorY: number } | null;
  endBinding?: { elementId: string; anchorX: number; anchorY: number } | null;
  boundText?: string;
  boundTextFontSize?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  type: SectionType;
  score: number;
}

export interface SearchDocument {
  id: string;
  project_token: string;
  project_name: string;
  title: string;
  content: string;
  type: SectionType;
  tags: string[];
  updated_at: number;
}

/** PDF outline entry extracted from bookmarks/TOC */
export interface PdfOutlineEntry {
  title: string;
  pageNum: number; // 1-based
  level: number;   // 0 = chapter, 1 = section, 2 = subsection, ...
}
