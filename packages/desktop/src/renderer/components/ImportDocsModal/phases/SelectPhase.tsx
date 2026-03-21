import { useState, useCallback } from "react";
import { useT } from "../../../i18n.js";
import type { ScannedFile, TreeNode } from "../types.js";
import { formatSize, fileBaseName, buildFileTree, collectAllIndices } from "../helpers.js";

// ---------------------------------------------------------------------------
// DirTreeNode (recursive directory node)
// ---------------------------------------------------------------------------

function DirTreeNode({
  node, depth, selected, collapsed, onToggle, onToggleDir, onToggleCollapse,
}: {
  node: TreeNode;
  depth: number;
  selected: Set<number>;
  collapsed: Set<string>;
  onToggle: (i: number) => void;
  onToggleDir: (indices: number[]) => void;
  onToggleCollapse: (path: string) => void;
}) {
  const allIndices = collectAllIndices(node);
  const allChecked = allIndices.length > 0 && allIndices.every((i) => selected.has(i));
  const someChecked = allIndices.some((i) => selected.has(i));
  const isCollapsed = collapsed.has(node.path);
  const padLeft = 14 + depth * 20;

  return (
    <div>
      <div
        className="import-docs-dir-row"
        style={{ paddingLeft: padLeft }}
        onClick={() => onToggleDir(allIndices)}
      >
        <span
          className={`import-docs-collapse-btn${isCollapsed ? " collapsed" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.path); }}
        >
          &#9654;
        </span>
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleDir(allIndices)}
        />
        <span>{node.name}</span>
        <span className="import-docs-dir-count">{allIndices.length}</span>
      </div>
      {!isCollapsed && (
        <>
          {node.files.map((entry) => (
            <div
              key={entry.index}
              className="import-docs-tree-file"
              style={{ paddingLeft: padLeft + 20 }}
              onClick={() => onToggle(entry.index)}
            >
              <input
                type="checkbox"
                checked={selected.has(entry.index)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggle(entry.index)}
              />
              <span className="import-docs-file-path">{fileBaseName(entry.file.relativePath)}</span>
              <span className="import-docs-file-size">{formatSize(entry.file.sizeBytes)}</span>
            </div>
          ))}
          {node.children.map((child) => (
            <DirTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              collapsed={collapsed}
              onToggle={onToggle}
              onToggleDir={onToggleDir}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectPhase
// ---------------------------------------------------------------------------

export function SelectPhase({
  files,
  selected,
  onToggle,
  onToggleAll,
  onToggleDir,
}: {
  files: ScannedFile[];
  selected: Set<number>;
  onToggle: (i: number) => void;
  onToggleAll: () => void;
  onToggleDir: (indices: number[]) => void;
}) {
  const tree = buildFileTree(files);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allSelected = selected.size === files.length;
  const t = useT();

  const toggleCollapse = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  return (
    <>
      <div className="import-docs-select-bar">
        <label>
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
          {allSelected ? t("deselectAll") : t("selectAll")} ({files.length})
        </label>
      </div>

      <div className="import-docs-files">
        {/* Root files (no directory) */}
        {tree.files.map((entry) => (
          <div
            key={entry.index}
            className="import-docs-tree-file"
            style={{ paddingLeft: 14 }}
            onClick={() => onToggle(entry.index)}
          >
            <input
              type="checkbox"
              checked={selected.has(entry.index)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggle(entry.index)}
            />
            <span className="import-docs-file-path">{fileBaseName(entry.file.relativePath)}</span>
            <span className="import-docs-file-size">{formatSize(entry.file.sizeBytes)}</span>
          </div>
        ))}
        {/* Directory subtrees */}
        {tree.children.map((child) => (
          <DirTreeNode
            key={child.path}
            node={child}
            depth={0}
            selected={selected}
            collapsed={collapsed}
            onToggle={onToggle}
            onToggleDir={onToggleDir}
            onToggleCollapse={toggleCollapse}
          />
        ))}
      </div>

    </>
  );
}
