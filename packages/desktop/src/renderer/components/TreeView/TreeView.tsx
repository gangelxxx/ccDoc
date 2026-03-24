import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { ContextMenu } from "../ContextMenu/ContextMenu.js";
import { ChevronsDownUp, Sparkles } from "lucide-react";
import { useT, type TranslationKey } from "../../i18n.js";
import { getAncestorIds, findNode, validateDrop, computeMoveParams, flattenVisibleTree } from "./tree-utils.js";
import type { ContextState, DragState, DropState, DropPosition } from "./tree-utils.js";
import { TreeItem } from "./TreeItem.js";
import { CreateModal } from "./CreateModal.js";
import { IconPickerModal } from "./IconPickerModal.js";

export function TreeView() {
  const { tree, currentSection, selectSection, createSection, duplicateSection, convertIdeaToKanban, deleteSection, renameSection, updateIcon, moveSection, sectionViewFiles, toggleFileViewMode, importMarkdown, importPdf, importDroppedFiles, expandedNodes, toggleExpanded, expandNode, collapseAll, currentProject, getIdeaMessages, setScrollToPlanId, showConfirm, llmLoading, llmSessionMode, startDocUpdateSession, llmApiKey } = useAppStore();
  const t = useT();
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaultType, setCreateDefaultType] = useState<string>("folder");
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropState | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef<string | null>(null);

  const activeId = currentSection?.id || null;
  const expandForIds = useMemo(
    () => activeId ? getAncestorIds(tree, activeId) : new Set<string>(),
    [tree, activeId]
  );

  useEffect(() => {
    expandForIds.forEach((id) => expandNode(id));
  }, [expandForIds]);

  const IMPORTABLE_EXTS = new Set(["md", "markdown", "txt", "pdf"]);

  const hasImportableFiles = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return false;
    // During dragover, we can't access file names in all browsers, so accept all file drags
    if (!e.dataTransfer.files.length) return true;
    return Array.from(e.dataTransfer.files).some(f => {
      const ext = f.name.split(".").pop()?.toLowerCase() || "";
      return IMPORTABLE_EXTS.has(ext);
    });
  }, []);

  const getImportableFilePaths = useCallback((e: React.DragEvent): string[] => {
    const paths: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (IMPORTABLE_EXTS.has(ext) && (file as any).path) {
        paths.push((file as any).path);
      }
    }
    return paths;
  }, []);

  const handleFileDrop = useCallback(async (filePaths: string[], targetFolderId?: string) => {
    if (!filePaths.length) return;
    await importDroppedFiles(filePaths, targetFolderId);
  }, [importDroppedFiles]);

  const handleTreeDrop = async (targetId: string, position: DropPosition) => {
    if (!dragItem) return;
    const targetNode = findNode(tree, targetId);
    if (!targetNode) return;
    if (!validateDrop(tree, dragItem.type, dragItem.id, targetNode, position)) return;
    const { newParentId, afterId } = computeMoveParams(tree, targetNode, position);
    setDragItem(null);
    setDropTarget(null);
    await moveSection(dragItem.id, newParentId, afterId);
  };

  const handleDelete = async (id: string, type: string) => {
    const node = findNode(tree, id);
    const title = node?.title ?? "";
    const titleKey = `delete_${type}_title` as TranslationKey;
    const confirmKey = `delete_${type}_confirm` as TranslationKey;
    const ok = await showConfirm(
      t(confirmKey, title),
      { title: t(titleKey), danger: true }
    );
    if (!ok) return;
    deleteSection(id);
  };

  const handleMultiSelect = useCallback((id: string, ctrlKey: boolean, shiftKey: boolean) => {
    if (shiftKey && selectionAnchor.current) {
      const flat = flattenVisibleTree(tree, expandedNodes);
      const anchorIdx = flat.indexOf(selectionAnchor.current);
      const currentIdx = flat.indexOf(id);
      if (anchorIdx !== -1 && currentIdx !== -1) {
        const from = Math.min(anchorIdx, currentIdx);
        const to = Math.max(anchorIdx, currentIdx);
        setSelectedIds(new Set(flat.slice(from, to + 1)));
      }
    } else if (ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      selectionAnchor.current = id;
    } else {
      setSelectedIds(new Set());
      selectionAnchor.current = id;
    }
  }, [tree, expandedNodes]);

  const handleBulkDelete = async (ids: Set<string>) => {
    const count = ids.size;
    const ok = await showConfirm(
      t("deleteSelectedConfirm" as TranslationKey, count),
      { title: t("deleteSelectedTitle" as TranslationKey), danger: true }
    );
    if (!ok) return;
    for (const id of ids) {
      await deleteSection(id);
    }
    setSelectedIds(new Set());
  };

  const handleContextMenu = async (x: number, y: number, node: { id: string; title: string; type: string }) => {
    const state: ContextState = { x, y, nodeId: node.id, nodeTitle: node.title, nodeType: node.type };
    if (node.type === "section") {
      // Plan section: check if parent is an idea and the linked message is completed
      const treeNode = findNode(tree, node.id);
      if (treeNode?.parent_id) {
        const parentNode = findNode(tree, treeNode.parent_id);
        if (parentNode?.type === "idea") {
          state.ideaParentId = parentNode.id;
          try {
            const msgs = await getIdeaMessages(parentNode.id);
            const linked = msgs.find((m: any) => m.planId === node.id);
            state.ideaCompleted = !!linked?.completed;
          } catch { /* ignore */ }
        }
      }
    }
    setContextMenu(state);
  };

  const handleToggleIdeaCompleted = async () => {
    if (!currentProject?.token || !contextMenu?.ideaParentId) return;
    const newCompleted = !contextMenu.ideaCompleted;
    try {
      const sec = await window.api.getSection(currentProject.token, contextMenu.ideaParentId);
      const data = JSON.parse(sec.content);
      const msg = data.messages?.find((m: any) => m.planId === contextMenu.nodeId);
      if (msg) {
        msg.completed = newCompleted;
        await window.api.updateSection(currentProject.token, contextMenu.ideaParentId, sec.title, JSON.stringify(data));
      }
    } catch { /* ignore */ }
  };

  const handleCreate = (parentId: string | null, title: string, type: string, icon: string | null) => {
    createSection(parentId, title, type, icon);
    setShowCreate(false);
  };

  const openCreate = (parentId: string | null, parentType?: string) => {
    setCreateParentId(parentId);
    // Context-aware default type
    if (parentType === "file" || parentType === "section") {
      setCreateDefaultType("section");
    } else if (parentId) {
      setCreateDefaultType("file");
    } else {
      setCreateDefaultType("folder");
    }
    setShowCreate(true);
  };

  return (
    <>
      <div className="sidebar-section-header sidebar-section-tree-header">
        <span className="sidebar-section-title">{t("sections")}</span>
        <div style={{ display: "flex", gap: 2 }}>
          {llmApiKey && (
            <button
              className={`btn-icon${llmLoading && llmSessionMode === "doc-update" ? " active" : ""}`}
              style={{ width: 20, height: 20 }}
              onClick={async () => {
                const ok = await showConfirm(t("updateDocsConfirmMessage"), { title: t("updateDocsConfirmTitle") });
                if (ok) startDocUpdateSession();
              }}
              disabled={llmLoading}
              title={t("updateDocs")}
            >
              <Sparkles size={13} className={llmLoading && llmSessionMode === "doc-update" ? "pulsing" : ""} />
            </button>
          )}
          <button
            className="btn-icon"
            style={{ width: 20, height: 20 }}
            onClick={() => collapseAll()}
            title={t("collapseAll")}
          >
            <ChevronsDownUp size={14} />
          </button>
          <button
            className="btn-icon"
            style={{ width: 20, height: 20, fontSize: 13 }}
            onClick={() => openCreate(null)}
            title={t("newSection")}
          >
            +
          </button>
        </div>
      </div>

      <div
        className={`sidebar-section-tree-body${fileDragOver ? " tree-file-drop-zone" : ""}`}
        onDragOver={(e) => {
          if (dragItem) return; // internal drag — ignore
          if (!hasImportableFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setFileDragOver(true);
        }}
        onDragLeave={(e) => {
          // Only clear when leaving the container itself
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setFileDragOver(false);
        }}
        onDrop={(e) => {
          if (dragItem) return;
          e.preventDefault();
          setFileDragOver(false);
          const paths = getImportableFilePaths(e);
          if (paths.length) handleFileDrop(paths);
        }}
      >
      {tree.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          activeId={activeId}
          editingId={editingId}
          selectedIds={selectedIds}
          expandedNodes={expandedNodes}
          onToggleExpanded={toggleExpanded}
          onExpandNode={expandNode}
          onSelect={selectSection}
          onMultiSelect={handleMultiSelect}
          onDelete={handleDelete}
          onRename={renameSection}
          onStartEdit={setEditingId}
          onCreateChild={(parentId, parentType) => openCreate(parentId, parentType)}
          onContextMenu={(x, y, node) => handleContextMenu(x, y, node)}
          dragItem={dragItem}
          dropTarget={dropTarget}
          onDragStart={(node) => setDragItem({ id: node.id, type: node.type })}
          onDragEnd={() => { setDragItem(null); setDropTarget(null); }}
          onDragOver={(targetId, position) => {
            const targetNode = findNode(tree, targetId);
            if (!targetNode || !dragItem) return;
            const valid = validateDrop(tree, dragItem.type, dragItem.id, targetNode, position);
            setDropTarget({ targetId, position, valid });
          }}
          onDrop={handleTreeDrop}
          onFileDrop={handleFileDrop}
          hasImportableFiles={hasImportableFiles}
          getImportableFilePaths={getImportableFilePaths}
        />
      ))}

      {tree.length === 0 && (
        <div className="tree-empty">
          {t("noSectionsYet")}
          <br />
          <button
            className="btn btn-sm btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => openCreate(null)}
          >
            {t("newSectionBtn")}
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && selectedIds.size >= 2 && selectedIds.has(contextMenu.nodeId) ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: t("deleteSelected" as TranslationKey, selectedIds.size),
              icon: "\uD83D\uDDD1\uFE0F",
              danger: true,
              onClick: () => handleBulkDelete(selectedIds),
            },
          ]}
        />
      ) : contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: t("rename"),
              icon: "\u270F\uFE0F",
              shortcut: "F2",
              onClick: () => setEditingId(contextMenu.nodeId),
            },
            {
              label: t("duplicate"),
              icon: "\uD83D\uDCCB",
              onClick: () => {
                duplicateSection(contextMenu.nodeId);
              },
            },
            {
              label: t("changeIcon"),
              icon: "\uD83C\uDFA8",
              onClick: () => setIconPickerId(contextMenu.nodeId),
            },
            ...(contextMenu.nodeType === "folder"
              ? [
                  {
                    label: t("addChild"),
                    icon: "+",
                    onClick: () => openCreate(contextMenu.nodeId, "folder"),
                  },
                  "sep" as const,
                  {
                    label: t("importMarkdown"),
                    icon: "\uD83D\uDCC5",
                    onClick: () => importMarkdown(contextMenu.nodeId),
                  },
                  {
                    label: t("importPdf"),
                    icon: "\uD83D\uDCC4",
                    onClick: () => importPdf(contextMenu.nodeId),
                  },
                ]
              : contextMenu.nodeType === "idea"
              ? [
                  {
                    label: t("convertToKanban"),
                    icon: "📋",
                    onClick: () => convertIdeaToKanban(contextMenu.nodeId),
                  },
                ]
              : contextMenu.nodeType === "file"
              ? [
                  {
                    label: t("addSection"),
                    icon: "+",
                    onClick: () => openCreate(contextMenu.nodeId, "file"),
                  },
                ]
              : contextMenu.nodeType === "section"
              ? [
                  {
                    label: t("addSubsection"),
                    icon: "+",
                    onClick: () => openCreate(contextMenu.nodeId, "section"),
                  },
                ]
              : []),
            ...(contextMenu.ideaParentId
              ? [
                  "sep" as const,
                  {
                    label: t("goToIdea"),
                    icon: "💡",
                    onClick: () => {
                      setScrollToPlanId(contextMenu.nodeId);
                      selectSection(contextMenu.ideaParentId!);
                    },
                  },
                  {
                    label: contextMenu.ideaCompleted ? t("markNotDone") : t("markDone"),
                    icon: "✅",
                    onClick: () => handleToggleIdeaCompleted(),
                  },
                ]
              : []),
            "sep" as const,
            {
              label: t("delete"),
              icon: "\uD83D\uDDD1\uFE0F",
              shortcut: "Del",
              danger: true,
              onClick: () => handleDelete(contextMenu.nodeId, contextMenu.nodeType),
            },
          ]}
        />
      ) : null}

      {/* Icon picker modal */}
      {iconPickerId && (
        <IconPickerModal
          sectionId={iconPickerId}
          onSelect={updateIcon}
          onClose={() => setIconPickerId(null)}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          parentId={createParentId}
          defaultType={createDefaultType}
          tree={tree}
          onCreate={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
    </>
  );
}
