import { useMemo } from "react";
import { findTreeNode } from "./editor-utils.js";

// --- Folder Summary ---
export function FolderSummary({ folderId, tree, projectName, onNavigate }: {
  folderId: string;
  tree: any[];
  projectName: string;
  onNavigate: (id: string) => void;
}) {
  const folderNode = findTreeNode(tree, folderId);
  const children = folderNode?.children || [];

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        total++;
        counts[n.type] = (counts[n.type] || 0) + 1;
        if (n.children?.length) walk(n.children);
      }
    };
    walk(children);
    return { total, counts };
  }, [children]);

  const typeIcons: Record<string, string> = {
    folder: "\uD83D\uDCC1", file: "\uD83D\uDCC4", section: "\u00A7",
    idea: "\uD83D\uDCA1", todo: "\u2611\uFE0F", kanban: "\uD83D\uDCCA", excalidraw: "\u270F\uFE0F",
  };

  const getIcon = (node: any) => node.icon || typeIcons[node.type] || "\uD83D\uDCC4";

  return (
    <div className="folder-summary">
      <div className="folder-summary-project">{projectName}</div>

      {stats.total > 0 && (
        <div className="folder-summary-stats">
          {Object.entries(stats.counts).map(([type, count]) => (
            <span key={type} className="folder-summary-stat">
              {typeIcons[type] || "\uD83D\uDCC4"} {count}
            </span>
          ))}
          <span className="folder-summary-stat total">{"\u2211"} {stats.total}</span>
        </div>
      )}

      <div className="folder-summary-children">
        {children.length === 0 ? (
          <div className="folder-summary-empty">Folder is empty</div>
        ) : (
          children.map((child: any) => (
            <div
              key={child.id}
              className="folder-summary-item"
              onClick={() => onNavigate(child.id)}
            >
              <span className="folder-summary-item-icon">{getIcon(child)}</span>
              <span className="folder-summary-item-title">{child.title}</span>
              {child.children?.length > 0 && (
                <span className="folder-summary-item-count">{child.children.length}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
