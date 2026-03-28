import { useState, useRef, useEffect } from "react";
import type { TreeNode, DragState, DropState, DropPosition } from "./tree-utils.js";
import { useT } from "../../i18n.js";

export interface TreeItemProps {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  editingId: string | null;
  selectedIds: Set<string>;
  expandedNodes: Set<string>;
  externallyChangedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onExpandNode: (id: string) => void;
  onSelect: (id: string) => void;
  onMultiSelect: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onDelete: (id: string, type: string) => void;
  onRename: (id: string, title: string) => void;
  onStartEdit: (id: string | null) => void;
  onCreateChild: (parentId: string, parentType?: string) => void;
  onContextMenu: (x: number, y: number, node: TreeNode) => void;
  onClearExternalChange: (id: string) => void;
  dragItem: DragState | null;
  dropTarget: DropState | null;
  onDragStart: (node: TreeNode) => void;
  onDragEnd: () => void;
  onDragOver: (targetId: string, position: DropPosition) => void;
  onDrop: (targetId: string, position: DropPosition) => void;
  onFileDrop?: (filePaths: string[], targetFolderId?: string) => void;
  hasImportableFiles?: (e: React.DragEvent) => boolean;
  getImportableFilePaths?: (e: React.DragEvent) => string[];
}

export function TreeItem({
  node,
  depth,
  activeId,
  editingId,
  selectedIds,
  expandedNodes,
  externallyChangedIds,
  onToggleExpanded,
  onExpandNode,
  onSelect,
  onMultiSelect,
  onDelete,
  onRename,
  onStartEdit,
  onCreateChild,
  onContextMenu,
  onClearExternalChange,
  dragItem,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onFileDrop,
  hasImportableFiles,
  getImportableFilePaths,
}: TreeItemProps) {
  const t = useT();
  const expanded = expandedNodes.has(node.id);
  const [editValue, setEditValue] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const isActive = node.id === activeId;
  const isSelected = selectedIds.has(node.id);
  const isEditing = editingId === node.id;
  const isExternallyChanged = externallyChangedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isFolder = node.type === "folder";
  const isFile = node.type === "file";
  const isContainer = isFolder || isFile;
  const isSection = node.type === "section";
  const canAddChild = isContainer || isSection;
  const canCollapse = isContainer || hasChildren;

  useEffect(() => {
    if (isEditing) {
      setEditValue(node.title);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [isEditing, node.title]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== node.title) {
      onRename(node.id, trimmed);
    }
    onStartEdit(null);
  };

  const defaultIcon = isFolder ? (expanded ? "\uD83D\uDCC2" : "\uD83D\uDCC1")
    : isFile ? "\uD83D\uDCC4"
    : node.type === "section" ? "\u00A7"
    : node.type === "idea" ? "\uD83D\uDCA1"
    : node.type === "drawing" ? "\u270F\uFE0F"
    : node.type === "kanban" ? "\uD83D\uDCCA"
    : node.type === "todo" ? "\u2611\uFE0F"
    : "\uD83D\uDCC4";
  const icon = node.icon || defaultIcon;

  const getDropPosition = (e: React.DragEvent): DropPosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const isContainerType = node.type === "folder" || node.type === "file" || node.type === "section";
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    if (isContainerType) return "inside";
    return ratio < 0.5 ? "before" : "after";
  };

  const isDragging = dragItem?.id === node.id;
  const isDropTarget = dropTarget?.targetId === node.id;
  const dropClass = isDropTarget
    ? `tree-item-drop-${dropTarget.position}${!dropTarget.valid ? " tree-item-drop-invalid" : ""}`
    : "";

  return (
    <div>
      <div
        className={`tree-item ${isActive ? "active" : ""} ${isSelected ? "selected" : ""} ${isDragging ? "tree-item-dragging" : ""} ${dropClass}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        tabIndex={0}
        draggable={!isEditing}
        onDragStart={(e) => {
          dragStartPos.current = { x: e.clientX, y: e.clientY };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          // Delay so the element renders before capture
          setTimeout(() => onDragStart(node), 0);
        }}
        onDragEnd={() => {
          dragStartPos.current = null;
          if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
          onDragEnd();
        }}
        onDragOver={(e) => {
          // External file drop on folders
          if (!dragItem && hasImportableFiles?.(e) && isFolder) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            onDragOver(node.id, "inside");
            return;
          }
          // External file drag over non-folder: let it bubble to container for drop zone highlight
          if (!dragItem) return;
          e.preventDefault();
          e.stopPropagation();
          if (dragItem.id === node.id) return;
          const pos = getDropPosition(e);
          // Auto-expand collapsed containers on hover
          if (pos === "inside" && !expanded && canCollapse) {
            if (!expandTimerRef.current) {
              expandTimerRef.current = setTimeout(() => { onExpandNode(node.id); expandTimerRef.current = null; }, 600);
            }
          } else if (expandTimerRef.current && pos !== "inside") {
            clearTimeout(expandTimerRef.current);
            expandTimerRef.current = null;
          }
          onDragOver(node.id, pos);
        }}
        onDragLeave={() => {
          if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
        }}
        onDrop={(e) => {
          // External file drop on folder
          if (!dragItem && isFolder && getImportableFilePaths && onFileDrop) {
            e.preventDefault();
            e.stopPropagation();
            const paths = getImportableFilePaths(e);
            if (paths.length) {
              onFileDrop(paths, node.id);
              return;
            }
          }
          // External file drop on non-folder: let it bubble to container
          if (!dragItem) return;
          e.preventDefault();
          e.stopPropagation();
          if (dragItem.id === node.id) return;
          const pos = getDropPosition(e);
          onDrop(node.id, pos);
        }}
        onClick={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
            onMultiSelect(node.id, false, true);
          } else if (e.ctrlKey || e.metaKey) {
            onMultiSelect(node.id, true, false);
          } else {
            onMultiSelect(node.id, false, false);
            onSelect(node.id);
          }
          if (isExternallyChanged) onClearExternalChange(node.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Delete" && !isEditing) {
            e.preventDefault();
            onDelete(node.id, node.type);
          } else if (e.key === "F2" && !isEditing) {
            e.preventDefault();
            onStartEdit(node.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e.clientX, e.clientY, node);
        }}
      >
        {canCollapse && (
          <span
            className="tree-item-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded(node.id);
              if (isExternallyChanged) onClearExternalChange(node.id);
            }}
          >
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        )}
        {!canCollapse && <span style={{ width: 16, flexShrink: 0 }} />}

        <span
          className={`tree-item-icon${canCollapse ? " clickable" : ""}`}
          onClick={canCollapse ? (e: React.MouseEvent) => {
            e.stopPropagation();
            onToggleExpanded(node.id);
          } : undefined}
        >{icon}</span>

        {isEditing ? (
          <input
            ref={inputRef}
            className="tree-item-title-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") onStartEdit(null);
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-item-title">{node.title}</span>
        )}
        {!isEditing && isFile && node.summary && (
          <span className="tree-item-summary-badge" title={node.summary}>S</span>
        )}
        {isExternallyChanged && (
          <span className="tree-item-changed-dot" />
        )}

        {!isEditing && (
          <div className="tree-item-actions">
            <button
              className="btn-icon"
              style={{ width: 20, height: 20, fontSize: 11 }}
              onClick={(e) => {
                e.stopPropagation();
                onContextMenu(e.clientX, e.clientY, node);
              }}
              title={t("moreActions")}
            >
              {"\u2022\u2022\u2022"}
            </button>
            {canAddChild && (
              <button
                className="btn-icon"
                style={{ width: 20, height: 20, fontSize: 11 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateChild(node.id, node.type);
                }}
                title={isSection ? t("addSubsection") : isFile ? t("addSection") : t("addChild")}
              >
                +
              </button>
            )}
          </div>
        )}
      </div>

      {hasChildren && (
        <div className="tree-children" style={expanded ? undefined : { display: "none" }}>
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              editingId={editingId}
              selectedIds={selectedIds}
              expandedNodes={expandedNodes}
              externallyChangedIds={externallyChangedIds}
              onToggleExpanded={onToggleExpanded}
              onExpandNode={onExpandNode}
              onSelect={onSelect}
              onMultiSelect={onMultiSelect}
              onDelete={onDelete}
              onRename={onRename}
              onStartEdit={onStartEdit}
              onCreateChild={onCreateChild}
              onContextMenu={onContextMenu}
              onClearExternalChange={onClearExternalChange}
              dragItem={dragItem}
              dropTarget={dropTarget}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onFileDrop={onFileDrop}
              hasImportableFiles={hasImportableFiles}
              getImportableFilePaths={getImportableFilePaths}
            />
          ))}
        </div>
      )}
    </div>
  );
}
