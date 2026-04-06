/**
 * Pure tree-patching utilities with structural sharing.
 * Unchanged subtrees keep the same object reference so React.memo skips re-renders.
 */

import type { TreeNode } from "../types.js";

/** Update fields of a single node found by id. */
export function patchNodeInTree(
  tree: TreeNode[],
  id: string,
  patch: Partial<TreeNode>,
): TreeNode[] {
  let changed = false;
  const result = tree.map((node) => {
    if (node.id === id) {
      changed = true;
      return { ...node, ...patch };
    }
    const newChildren = patchNodeInTree(node.children, id, patch);
    if (newChildren !== node.children) {
      changed = true;
      return { ...node, children: newChildren };
    }
    return node;
  });
  return changed ? result : tree;
}

/** Remove a node by id (and all its children). */
export function removeNodeFromTree(tree: TreeNode[], id: string): TreeNode[] {
  let changed = false;
  const result: TreeNode[] = [];
  for (const node of tree) {
    if (node.id === id) {
      changed = true;
      continue;
    }
    const newChildren = removeNodeFromTree(node.children, id);
    if (newChildren !== node.children) {
      changed = true;
      result.push({ ...node, children: newChildren });
    } else {
      result.push(node);
    }
  }
  return changed ? result : tree;
}

/** Insert a node as child of parentId, after afterId (or first if null). */
export function insertNodeInTree(
  tree: TreeNode[],
  node: TreeNode,
  parentId: string | null,
): TreeNode[] {
  // Insert at root level
  if (parentId === null) {
    return [...tree, node];
  }

  let changed = false;
  const result = tree.map((n) => {
    if (n.id === parentId) {
      changed = true;
      return { ...n, children: [...n.children, node] };
    }
    const newChildren = insertNodeInTree(n.children, node, parentId);
    if (newChildren !== n.children) {
      changed = true;
      return { ...n, children: newChildren };
    }
    return n;
  });
  return changed ? result : tree;
}

/** Extract a node from the tree (returns [tree without node, extracted node]). */
function extractNode(tree: TreeNode[], id: string): [TreeNode[], TreeNode | null] {
  let found: TreeNode | null = null;
  let changed = false;
  const result: TreeNode[] = [];
  for (const node of tree) {
    if (node.id === id) {
      found = node;
      changed = true;
      continue;
    }
    const [newChildren, extracted] = extractNode(node.children, id);
    if (extracted) {
      found = extracted;
      changed = true;
      result.push({ ...node, children: newChildren });
    } else {
      result.push(node);
    }
  }
  return [changed ? result : tree, found];
}

/** Move a node to a new parent (append to end of children). */
export function moveNodeInTree(
  tree: TreeNode[],
  id: string,
  newParentId: string | null,
): TreeNode[] {
  const [treeWithout, node] = extractNode(tree, id);
  if (!node) return tree;
  return insertNodeInTree(treeWithout, node, newParentId);
}
