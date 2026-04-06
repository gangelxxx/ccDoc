import { useState, useCallback } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { useShallow } from "zustand/react/shallow";
import { useT, type TranslationKey } from "../../i18n.js";
import { ContextMenu } from "../ContextMenu/ContextMenu.js";
import { CreateModal } from "../TreeView/CreateModal.js";
import { findNode, validateDrop, computeMoveParams, ALLOWED_CHILDREN, canBeRoot } from "../TreeView/tree-utils.js";
import type { TreeNode } from "../TreeView/tree-utils.js";
import type { DropPosition } from "../TreeView/tree-utils.js";

interface ContextState {
  x: number;
  y: number;
  nodeId: string;
  nodeTitle: string;
  nodeType: string;
}

interface DragState {
  id: string;
  type: string;
}

interface DropState {
  targetId: string;
  position: DropPosition;
  valid: boolean;
}

const defaultIcon = (type: string, expanded: boolean): string =>
  type === "folder" ? (expanded ? "\uD83D\uDCC2" : "\uD83D\uDCC1")
  : type === "file" ? "\uD83D\uDCC4"
  : type === "section" ? "\u00A7"
  : type === "idea" ? "\uD83D\uDCA1"
  : type === "drawing" ? "\u270F\uFE0F"
  : type === "kanban" ? "\uD83D\uDCCA"
  : type === "todo" ? "\u2611\uFE0F"
  : "\uD83D\uDCC4";

export function UserFolder() {
  const {
    userTree, userTreeLoading, userFolderExpanded,
    sectionSource, currentSection,
  } = useAppStore(useShallow(s => ({
    userTree: s.userTree,
    userTreeLoading: s.userTreeLoading,
    userFolderExpanded: s.userFolderExpanded,
    sectionSource: s.sectionSource,
    currentSection: s.currentSection,
  })));

  const toggleUserFolder = useAppStore(s => s.toggleUserFolder);
  const selectUserSection = useAppStore(s => s.selectUserSection);
  const createUserSection = useAppStore(s => s.createUserSection);
  const deleteUserSection = useAppStore(s => s.deleteUserSection);
  const moveUserSection = useAppStore(s => s.moveUserSection);
  const duplicateUserSection = useAppStore(s => s.duplicateUserSection);
  const updateUserIcon = useAppStore(s => s.updateUserIcon);
  const loadUserTree = useAppStore(s => s.loadUserTree);
  const addToast = useAppStore(s => s.addToast);
  const showConfirm = useAppStore(s => s.showConfirm);

  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [createDefaultType, setCreateDefaultType] = useState<string>("folder");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dragItem, setDragItem] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropState | null>(null);

  const activeId = sectionSource === "user" ? currentSection?.id : null;

  const toggleNode = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleCreate = (parentId: string | null, title: string, type: string, icon: string | null) => {
    createUserSection(parentId, title, type, icon ?? undefined);
    setShowCreate(false);
  };

  const openCreate = (parentId: string | null, parentType?: string) => {
    setCreateParentId(parentId);
    if (parentType === "file" || parentType === "section") {
      setCreateDefaultType("section");
    } else if (parentId) {
      setCreateDefaultType("file");
    } else {
      setCreateDefaultType("folder");
    }
    setShowCreate(true);
  };

  const handleDelete = async (id: string, type: string) => {
    const node = findNode(userTree, id);
    const title = node?.title ?? "";
    const titleKey = `delete_${type}_title` as TranslationKey;
    const confirmKey = `delete_${type}_confirm` as TranslationKey;
    const ok = await showConfirm(
      t(confirmKey, title),
      { title: t(titleKey), danger: true }
    );
    if (!ok) return;
    deleteUserSection(id);
  };

  const handleRename = async (id: string, title: string) => {
    setEditingId(null);
    if (!title.trim()) return;
    try {
      const section = await window.api.user.get(id);
      if (section) {
        await window.api.user.update(id, title.trim(), section.content);
        // Update currentSection if this section is currently open
        const state = useAppStore.getState();
        if (state.currentSection?.id === id && state.sectionSource === "user") {
          useAppStore.setState({ currentSection: { ...state.currentSection, title: title.trim() } });
        }
        await loadUserTree();
      }
    } catch (e: any) {
      addToast("error", "Failed to rename", e.message);
    }
  };

  const handleContextMenu = (x: number, y: number, node: TreeNode) => {
    setContextMenu({ x, y, nodeId: node.id, nodeTitle: node.title, nodeType: node.type });
  };

  const handleDrop = async (targetId: string, position: DropPosition) => {
    if (!dragItem) return;
    const targetNode = findNode(userTree, targetId);
    if (!targetNode) return;
    if (!validateDrop(userTree, dragItem.type, dragItem.id, targetNode, position)) {
      addToast("warning", t("userFolder.dragForbidden" as TranslationKey));
      return;
    }
    const { newParentId, afterId } = computeMoveParams(userTree, targetNode, position);
    setDragItem(null);
    setDropTarget(null);
    await moveUserSection(dragItem.id, newParentId, afterId);
  };

  const getDropPosition = (e: React.DragEvent, node: TreeNode): DropPosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const isContainer = node.type === "folder" || node.type === "file" || node.type === "section";
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    if (isContainer) return "inside";
    return ratio < 0.5 ? "before" : "after";
  };

  const contextMenuItems = contextMenu ? (() => {
    const items: (({ label: string; icon?: string; danger?: boolean; onClick: () => void }) | "sep")[] = [];
    const node = findNode(userTree, contextMenu.nodeId);
    const nodeType = contextMenu.nodeType;
    const canAdd = nodeType === "folder" || nodeType === "file" || nodeType === "section";

    if (canAdd) {
      items.push({
        label: t("contextCreate"),
        icon: "\u2795",
        onClick: () => openCreate(contextMenu.nodeId, nodeType),
      });
    } else if (!node?.parent_id) {
      items.push({
        label: t("contextCreate"),
        icon: "\u2795",
        onClick: () => openCreate(null),
      });
    }

    items.push({
      label: t("contextRename"),
      icon: "\u270F\uFE0F",
      onClick: () => { setEditingId(contextMenu.nodeId); setEditValue(contextMenu.nodeTitle); },
    });
    items.push({
      label: t("contextDuplicate"),
      icon: "\uD83D\uDCCB",
      onClick: () => duplicateUserSection(contextMenu.nodeId),
    });
    items.push("sep");
    items.push({
      label: t("contextDelete"),
      icon: "\uD83D\uDDD1\uFE0F",
      danger: true,
      onClick: () => handleDelete(contextMenu.nodeId, nodeType),
    });
    return items;
  })() : [];

  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expanded.has(node.id);
    const isActive = activeId === node.id;
    const isEditing = editingId === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isFolder = node.type === "folder";
    const isFile = node.type === "file";
    const canCollapse = isFolder || isFile || hasChildren;
    const icon = node.icon || defaultIcon(node.type, isExpanded);

    const isDragging = dragItem?.id === node.id;
    const isDropTarget_ = dropTarget?.targetId === node.id;
    const dropClass = isDropTarget_
      ? `tree-item-drop-${dropTarget!.position}${!dropTarget!.valid ? " tree-item-drop-invalid" : ""}`
      : "";

    return (
      <div key={node.id}>
        <div
          className={`tree-item ${isActive ? "active" : ""} ${isDragging ? "tree-item-dragging" : ""} ${dropClass}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          draggable={!isEditing}
          onClick={() => {
            if (!isEditing) selectUserSection(node.id);
          }}
          onDoubleClick={() => {
            if (canCollapse) toggleNode(node.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            handleContextMenu(e.clientX, e.clientY, node);
          }}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/x-user-section", node.id);
            setTimeout(() => setDragItem({ id: node.id, type: node.type }), 0);
          }}
          onDragEnd={() => { setDragItem(null); setDropTarget(null); }}
          onDragOver={(e) => {
            // Block cross-tree drops (project -> user)
            if (!e.dataTransfer.types.includes("text/x-user-section")) {
              e.dataTransfer.dropEffect = "none";
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const pos = getDropPosition(e, node);
            const valid = dragItem ? validateDrop(userTree, dragItem.type, dragItem.id, node, pos) : false;
            setDropTarget({ targetId: node.id, position: pos, valid });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!e.dataTransfer.types.includes("text/x-user-section")) {
              addToast("warning", t("userFolder.dragForbidden" as TranslationKey));
              return;
            }
            const pos = getDropPosition(e, node);
            handleDrop(node.id, pos);
          }}
        >
          {canCollapse ? (
            <span
              className="tree-item-toggle"
              onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }}
            >
              {isExpanded ? "\u25BC" : "\u25B6"}
            </span>
          ) : (
            <span className="tree-item-toggle" />
          )}
          <span className="tree-item-icon">{icon}</span>
          {isEditing ? (
            <input
              className="tree-item-input"
              value={editValue}
              autoFocus
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleRename(node.id, editValue)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(node.id, editValue);
                if (e.key === "Escape") setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tree-item-title">{node.title}</span>
          )}
        </div>
        {isExpanded && hasChildren && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span
            className="sidebar-section-title clickable"
            onClick={toggleUserFolder}
          >
            {userFolderExpanded ? "\u25BC" : "\u25B6"} {"\uD83D\uDC64"} {t("userFolder.title" as TranslationKey)}
          </span>
          {userFolderExpanded && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={(e) => { e.stopPropagation(); openCreate(null); }}
              title={t("contextCreate")}
            >
              +
            </button>
          )}
        </div>
        {userFolderExpanded && (
          <div
            className="user-folder-tree"
            onDragOver={(e) => {
              // Block drops from project tree into user folder area
              if (!e.dataTransfer.types.includes("text/x-user-section") && e.dataTransfer.types.includes("text/plain")) {
                e.dataTransfer.dropEffect = "none";
              }
            }}
          >
            {userTreeLoading ? (
              <div className="todo-panel-empty">{"\u23F3"}</div>
            ) : userTree.length === 0 ? (
              <div className="todo-panel-empty">{t("userFolder.empty" as TranslationKey)}</div>
            ) : (
              userTree.map(node => renderNode(node, 0))
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showCreate && (
        <CreateModal
          parentId={createParentId}
          defaultType={createDefaultType}
          tree={userTree}
          onCreate={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </>
  );
}
