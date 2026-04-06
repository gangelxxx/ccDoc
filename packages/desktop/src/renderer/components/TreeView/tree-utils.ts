// TreeView utility types, constants and pure functions

export interface LinkedProjectMeta {
  linked_project_id: string;
  project_token: string | null;
  has_ccdoc: boolean;
  doc_status: string;
  link_type: string;
  source_path: string;
}

export interface TreeNode {
  id: string;
  parent_id: string | null;
  title: string;
  type: string;
  icon: string | null;
  summary?: string | null;
  updated_at: string;
  children: TreeNode[];
  hasChildren?: boolean;
  childrenLoaded?: boolean;
  linkedProjectMeta?: LinkedProjectMeta;
  progress?: number;    // 0–100, only for type="idea"
}

export type DropPosition = "before" | "inside" | "after";

export interface DragState {
  id: string;
  type: string;
}

export interface DropState {
  targetId: string;
  position: DropPosition;
  valid: boolean;
}

export interface ContextState {
  x: number;
  y: number;
  nodeId: string;
  nodeTitle: string;
  nodeType: string;
  /** For idea nodes: all messages completed; for plan sections: linked message completed */
  ideaCompleted?: boolean;
  /** For plan sections (section children of idea): the parent idea id */
  ideaParentId?: string;
  /** For linked project nodes */
  isLinkedProject?: boolean;
  linkedProjectId?: string;
  linkedDocStatus?: string;
}

// Inline hierarchy rules to avoid importing @ccdoc/core (which pulls Node.js modules into renderer)
export const ALLOWED_CHILDREN: Record<string, string[]> = {
  folder: ["folder", "file", "idea", "todo", "kanban", "drawing"],
  file: ["section"],
  section: ["section"],
  idea: ["section"],
};

export const canContainChild = (parentType: string, childType: string): boolean =>
  ALLOWED_CHILDREN[parentType]?.includes(childType) ?? false;

export const canBeRoot = (type: string): boolean => type === "folder";

export function getAncestorIds(nodes: TreeNode[], targetId: string): Set<string> {
  const path: string[] = [];
  const search = (items: TreeNode[]): boolean => {
    for (const n of items) {
      if (n.id === targetId) return true;
      if (n.children.length) {
        path.push(n.id);
        if (search(n.children)) return true;
        path.pop();
      }
    }
    return false;
  };
  search(nodes);
  return new Set(path);
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children.length) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function validateDrop(
  tree: TreeNode[],
  dragType: string,
  dragId: string,
  targetNode: TreeNode,
  position: DropPosition,
): boolean {
  if (dragId === targetNode.id) return false;
  // Virtual workspace-root node cannot participate in drag/drop
  if (dragId === "workspace-root" || targetNode.id === "workspace-root") return false;
  // Linked project nodes cannot be dragged
  if (dragId.startsWith("linked:")) return false;
  // Cannot drop anything into/before/after linked project nodes
  if (targetNode.linkedProjectMeta) return false;
  if (isDescendant(tree, targetNode.id, dragId)) return false;
  if (position === "inside") {
    return canContainChild(targetNode.type, dragType);
  }
  // before/after = sibling of target
  if (targetNode.parent_id === null) {
    return canBeRoot(dragType);
  }
  const parent = findNode(tree, targetNode.parent_id);
  if (!parent) return false;
  return canContainChild(parent.type, dragType);
}

export function computeMoveParams(
  tree: TreeNode[],
  targetNode: TreeNode,
  position: DropPosition,
): { newParentId: string | null; afterId: string | null } {
  if (position === "inside") {
    const lastChild = targetNode.children[targetNode.children.length - 1];
    return { newParentId: targetNode.id, afterId: lastChild?.id ?? null };
  }
  const parentId = targetNode.parent_id;
  const siblings = parentId ? findNode(tree, parentId)!.children : tree;
  const targetIndex = siblings.findIndex(s => s.id === targetNode.id);
  if (position === "before") {
    return { newParentId: parentId, afterId: targetIndex > 0 ? siblings[targetIndex - 1].id : null };
  }
  return { newParentId: parentId, afterId: targetNode.id };
}

/** Flatten tree into visible order (respecting expanded state) */
export function flattenVisibleTree(nodes: TreeNode[], expandedNodes: Set<string>): string[] {
  const result: string[] = [];
  const walk = (items: TreeNode[]) => {
    for (const n of items) {
      result.push(n.id);
      if (n.children.length && expandedNodes.has(n.id)) {
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return result;
}

// ── Virtual tree support ──────────────────────────────────────────

export interface FlatTreeItem {
  id: string;
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  hasChildren: boolean;
  childrenLoaded: boolean;
  /** True for synthetic placeholder items shown while children are loading. */
  isPlaceholder?: boolean;
}

/** Flatten tree into visible items with depth info (for virtual rendering). */
export function flattenVisibleTreeFull(
  nodes: TreeNode[],
  expandedNodes: Set<string>,
  loadingNodes: Set<string>,
): FlatTreeItem[] {
  const result: FlatTreeItem[] = [];
  const walk = (items: TreeNode[], depth: number) => {
    for (const n of items) {
      const hasChildren = n.hasChildren ?? n.children.length > 0;
      const childrenLoaded = n.childrenLoaded !== false;
      const isExpanded = expandedNodes.has(n.id);
      result.push({
        id: n.id, node: n, depth, isExpanded,
        isLoading: loadingNodes.has(n.id),
        hasChildren, childrenLoaded,
      });
      if (isExpanded && hasChildren) {
        if (childrenLoaded && n.children.length > 0) {
          walk(n.children, depth + 1);
        } else if (!childrenLoaded) {
          // Placeholder while children are loading
          result.push({
            id: `__loading_${n.id}`,
            node: n,
            depth: depth + 1,
            isExpanded: false,
            isLoading: true,
            hasChildren: false,
            childrenLoaded: true,
            isPlaceholder: true,
          });
        }
      }
    }
  };
  walk(nodes, 0);
  return result;
}

function isDescendant(tree: TreeNode[], nodeId: string, potentialAncestorId: string): boolean {
  const node = findNode(tree, potentialAncestorId);
  if (!node) return false;
  const check = (n: TreeNode): boolean => {
    if (n.id === nodeId) return true;
    return n.children.some(check);
  };
  return check(node);
}
