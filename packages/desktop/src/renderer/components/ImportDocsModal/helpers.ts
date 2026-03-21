import type { ScannedFile, TreeNode } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function resolveTargetFolder(tree: any[], currentSection: any): string | null {
  if (!currentSection) {
    const first = tree.find((n) => n.type === "folder");
    return first?.id ?? null;
  }
  if (currentSection.type === "folder") return currentSection.id;

  const findNode = (nodes: any[], id: string): any | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findNode(n.children, id);
      if (found) return found;
    }
    return null;
  };

  if (currentSection.parent_id) {
    const parent = findNode(tree, currentSection.parent_id);
    if (parent?.type === "folder") return parent.id;
    if (parent?.parent_id) {
      const grandparent = findNode(tree, parent.parent_id);
      if (grandparent?.type === "folder") return grandparent.id;
    }
  }

  const first = tree.find((n) => n.type === "folder");
  return first?.id ?? null;
}

export function statusIcon(ok: boolean, hasWarnings: boolean): string {
  if (!ok) return "\u274C";
  return hasWarnings ? "\u26A0\uFE0F" : "\u2705";
}

export function linkStatusIcon(status: string): string {
  if (status === "ok") return "\u2705";
  if (status === "warning") return "\u26A0\uFE0F";
  return "\u274C";
}

export function fileBaseName(relativePath: string): string {
  const path = relativePath.replace(/\\/g, "/");
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.substring(slash + 1);
}

export function buildFileTree(files: ScannedFile[]): TreeNode {
  const root: TreeNode = { name: "/", path: "", files: [], children: [] };
  for (let i = 0; i < files.length; i++) {
    const relPath = files[i].relativePath.replace(/\\/g, "/");
    const parts = relPath.split("/");
    parts.pop(); // remove file name
    let current = root;
    let pathSoFar = "";
    for (const part of parts) {
      pathSoFar = pathSoFar ? pathSoFar + "/" + part : part;
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: pathSoFar, files: [], children: [] };
        current.children.push(child);
      }
      current = child;
    }
    current.files.push({ index: i, file: files[i] });
  }
  function sortTree(node: TreeNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => fileBaseName(a.file.relativePath).localeCompare(fileBaseName(b.file.relativePath)));
    node.children.forEach(sortTree);
  }
  sortTree(root);
  return root;
}

export function collectAllIndices(node: TreeNode): number[] {
  const indices: number[] = node.files.map((f) => f.index);
  for (const child of node.children) indices.push(...collectAllIndices(child));
  return indices;
}
