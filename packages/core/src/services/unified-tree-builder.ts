import type { Client } from "@libsql/client";
import type { TreeNode, LinkedProject, LinkedProjectMeta } from "../types.js";
import { SectionsService } from "./sections.service.js";

export interface UnifiedTreeOptions {
  /** If true, load first level of children for linked projects. Default: true */
  loadLinkedRoots?: boolean;
  /** Display name for the root project wrapper node */
  rootProjectName?: string;
  /** Icon for the root project wrapper node */
  rootProjectIcon?: string | null;
}

export class UnifiedTreeBuilder {
  constructor(
    private getProjectDb: (token: string) => Promise<Client>,
  ) {}

  /**
   * Build a unified tree: root project tree + linked project nodes.
   * @param rootTree - the already-loaded root project tree (caller provides it)
   * @param linkedProjects - list of linked projects from workspace
   * @param opts - options for tree building
   */
  async build(
    rootTree: TreeNode[],
    linkedProjects: LinkedProject[],
    opts: UnifiedTreeOptions = {},
  ): Promise<TreeNode[]> {
    const loadRoots = opts.loadLinkedRoots !== false;

    const linkedNodes: TreeNode[] = [];

    for (const lp of linkedProjects) {
      const meta: LinkedProjectMeta = {
        linked_project_id: lp.id,
        project_token: lp.project_token,
        has_ccdoc: lp.has_ccdoc,
        doc_status: lp.doc_status,
        link_type: lp.link_type,
        source_path: lp.source_path,
      };

      let children: TreeNode[] = [];

      // If the linked project has loaded docs and a token, load its root tree
      if (loadRoots && lp.doc_status === "loaded" && lp.project_token) {
        try {
          const db = await this.getProjectDb(lp.project_token);
          const linkedSections = new SectionsService(db);
          children = await linkedSections.getRootTreeNodes();
        } catch (err) {
          console.warn(
            `[unified-tree] Failed to load tree for linked project ${lp.source_path}:`,
            err,
          );
        }
      }

      const displayName =
        lp.alias || lp.source_path.split(/[\\/]/).pop() || "unnamed";

      linkedNodes.push({
        id: `linked:${lp.id}`,
        parent_id: null,
        title: displayName,
        type: "folder",
        icon: lp.icon || "📎",
        sort_key: `z${String(lp.sort_order).padStart(10, "0")}`,
        summary: null,
        updated_at: lp.added_at,
        children,
        hasChildren: lp.doc_status === "loaded",
        childrenLoaded: children.length > 0,
        linkedProjectMeta: meta,
      });
    }

    // Wrap root project sections in a named folder node
    const rootProjectName = opts.rootProjectName || "Project";
    const rootNode: TreeNode = {
      id: "workspace-root",
      parent_id: null,
      title: rootProjectName,
      type: "folder",
      icon: opts.rootProjectIcon ?? null,
      sort_key: "a0",
      summary: null,
      updated_at: new Date().toISOString(),
      children: rootTree,
      hasChildren: rootTree.length > 0,
      childrenLoaded: true,
    };

    return [rootNode, ...linkedNodes];
  }

  /**
   * Load children for a linked project (lazy loading).
   * Called when user expands a linked project node.
   */
  async loadLinkedProjectChildren(
    projectToken: string,
    parentId?: string,
  ): Promise<TreeNode[]> {
    const db = await this.getProjectDb(projectToken);
    const sections = new SectionsService(db);
    if (parentId) {
      return sections.getChildTreeNodes(parentId);
    }
    return sections.getRootTreeNodes();
  }
}
