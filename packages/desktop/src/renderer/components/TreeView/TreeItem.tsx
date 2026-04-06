import { useState, useRef, useEffect, memo } from "react";
import type { FlatTreeItem, DragState, DropState, DropPosition } from "./tree-utils.js";
import { useT } from "../../i18n.js";
import { useAppStore } from "../../stores/app.store.js";

export interface TreeItemProps {
  item: FlatTreeItem;
  style: React.CSSProperties;
  isActive: boolean;
  isEditing: boolean;
  isSelected: boolean;
  isExternallyChanged: boolean;
  isSectionLoading: boolean;
  onToggleExpanded: (id: string) => void;
  onExpandNode: (id: string) => void;
  onSelect: (id: string) => void;
  onMultiSelect: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onDelete: (id: string, type: string) => void;
  onRename: (id: string, title: string) => void;
  onStartEdit: (id: string | null) => void;
  onCreateChild: (parentId: string, parentType?: string) => void;
  onContextMenu: (x: number, y: number, node: FlatTreeItem["node"]) => void;
  onClearExternalChange: (id: string) => void;
  dragItem: DragState | null;
  dropTarget: DropState | null;
  onDragStart: (node: FlatTreeItem["node"]) => void;
  onDragEnd: () => void;
  onDragOver: (targetId: string, position: DropPosition) => void;
  onDrop: (targetId: string, position: DropPosition) => void;
  onFileDrop?: (filePaths: string[], targetFolderId?: string) => void;
  hasImportableFiles?: (e: React.DragEvent) => boolean;
  getImportableFilePaths?: (e: React.DragEvent) => string[];
}

function SummaryBadge({ nodeId, summary }: { nodeId: string; summary?: string | null }) {
  const isSummarizing = useAppStore((s) => s.summarizingIds.has(nodeId));
  const t = useT();
  if (isSummarizing) {
    return (
      <span className="tree-item-summary-badge tree-item-summary-loading" title={t("bgGeneratingSummary" as any)}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: "spin 1s linear infinite", display: "block" }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
      </span>
    );
  }
  if (!summary) return null;
  return <span className="tree-item-summary-badge" title={summary}>S</span>;
}

export const TreeItem = memo(function TreeItem({
  item,
  style,
  isActive,
  isEditing,
  isSelected,
  isExternallyChanged,
  isSectionLoading,
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
  const { node, depth, isExpanded, isLoading, hasChildren } = item;
  const [editValue, setEditValue] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLinkedProject = !!node.linkedProjectMeta;
  const isWorkspaceRoot = node.id === "workspace-root";
  const linkedMeta = node.linkedProjectMeta;

  const isFolder = node.type === "folder";
  const isFile = node.type === "file";
  const isContainer = isFolder || isFile;
  const isSection = node.type === "section";
  const canAddChild = (isContainer || isSection) && !isLinkedProject;
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

  const defaultIcon = isFolder ? (isExpanded ? "\uD83D\uDCC2" : "\uD83D\uDCC1")
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
    <div style={style}>
      <div
        className={`tree-item ${isActive ? "active" : ""} ${isSelected ? "selected" : ""} ${isDragging ? "tree-item-dragging" : ""} ${isLinkedProject ? "tree-item-linked" : ""} ${dropClass}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        tabIndex={0}
        draggable={!isEditing && !isLinkedProject && !isWorkspaceRoot}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          setTimeout(() => onDragStart(node), 0);
        }}
        onDragEnd={() => {
          if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
          onDragEnd();
        }}
        onDragOver={(e) => {
          // Block drops from user folder tree
          if (e.dataTransfer.types.includes("text/x-user-section")) {
            e.dataTransfer.dropEffect = "none";
            return;
          }
          if (!dragItem && hasImportableFiles?.(e) && isFolder) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            onDragOver(node.id, "inside");
            return;
          }
          if (!dragItem) return;
          e.preventDefault();
          e.stopPropagation();
          if (dragItem.id === node.id) return;
          const pos = getDropPosition(e);
          if (pos === "inside" && !isExpanded && canCollapse) {
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
          // Block drops from user folder tree
          if (e.dataTransfer.types.includes("text/x-user-section")) return;
          if (!dragItem && isFolder && getImportableFilePaths && onFileDrop) {
            e.preventDefault();
            e.stopPropagation();
            const paths = getImportableFilePaths(e);
            if (paths.length) { onFileDrop(paths, node.id); return; }
          }
          if (!dragItem) return;
          e.preventDefault();
          e.stopPropagation();
          if (dragItem.id === node.id) return;
          onDrop(node.id, getDropPosition(e));
        }}
        onClick={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
            onMultiSelect(node.id, false, true);
          } else if (e.ctrlKey || e.metaKey) {
            onMultiSelect(node.id, true, false);
          } else {
            onMultiSelect(node.id, false, false);
            if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
            clickTimerRef.current = setTimeout(() => {
              clickTimerRef.current = null;
              onSelect(node.id);
            }, 200);
          }
          if (isExternallyChanged) onClearExternalChange(node.id);
        }}
        onDoubleClick={() => {
          if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
          }
          if (canCollapse) onToggleExpanded(node.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Delete" && !isEditing && !isLinkedProject && !isWorkspaceRoot) { e.preventDefault(); onDelete(node.id, node.type); }
          else if (e.key === "F2" && !isEditing && !isWorkspaceRoot) { e.preventDefault(); onStartEdit(node.id); }
        }}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY, node); }}
      >
        {canCollapse && (
          isLoading ? (
            <span className="tree-item-spinner" />
          ) : (
            <span
              className="tree-item-toggle"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded(node.id);
                if (isExternallyChanged) onClearExternalChange(node.id);
              }}
            >
              {isExpanded ? "\u25BC" : "\u25B6"}
            </span>
          )
        )}
        {!canCollapse && <span style={{ width: 16, flexShrink: 0 }} />}

        <span
          className={`tree-item-icon${canCollapse ? " clickable" : ""}`}
          onClick={canCollapse ? (e: React.MouseEvent) => {
            e.stopPropagation();
            onToggleExpanded(node.id);
          } : undefined}
        >{isLinkedProject && icon !== "📎" && <span className="tree-item-link-indicator">📎</span>}{icon}</span>

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
          <span className={`tree-item-title${isSectionLoading ? " tree-item-loading" : ""}`}>{node.title}</span>
        )}
        {!isEditing && isFile && <SummaryBadge nodeId={node.id} summary={node.summary} />}
        {!isEditing && node.type === "idea" && typeof node.progress === "number" && node.progress > 0 && (
          <span className="tree-item-progress" title={`${node.progress}%`}>
            {node.progress}%
          </span>
        )}
        {isLinkedProject && linkedMeta && (
          <span className={`tree-item-link-badge tree-item-link-${linkedMeta.doc_status}`}>
            {linkedMeta.doc_status === "loaded" ? "" :
             linkedMeta.doc_status === "generating" ? "\u23F3" :
             linkedMeta.doc_status === "error" ? "\u26A0" : "\u2014"}
          </span>
        )}
        {isExternallyChanged && (
          <span className="tree-item-changed-dot" />
        )}

        {!isEditing && (
          <div className="tree-item-actions">
            <button
              className="btn-icon"
              style={{ width: 20, height: 20, fontSize: 11 }}
              onClick={(e) => { e.stopPropagation(); onContextMenu(e.clientX, e.clientY, node); }}
              title={t("moreActions")}
            >
              {"\u2022\u2022\u2022"}
            </button>
            {canAddChild && (
              <button
                className="btn-icon"
                style={{ width: 20, height: 20, fontSize: 11 }}
                onClick={(e) => { e.stopPropagation(); onCreateChild(node.id, node.type); }}
                title={isSection ? t("addSubsection") : isFile ? t("addSection") : t("addChild")}
              >
                +
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
