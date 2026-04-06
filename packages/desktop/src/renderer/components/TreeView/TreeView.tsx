import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../../stores/app.store.js";
import { useShallow } from "zustand/react/shallow";
import { ContextMenu } from "../ContextMenu/ContextMenu.js";
import { ChevronsDownUp, Sparkles } from "lucide-react";
import { useT, type TranslationKey } from "../../i18n.js";
import { findNode, validateDrop, computeMoveParams, flattenVisibleTreeFull } from "./tree-utils.js";
import type { ContextState, DragState, DropState, DropPosition } from "./tree-utils.js";
import { TreeItem } from "./TreeItem.js";
import { CreateModal } from "./CreateModal.js";
import { IconPickerModal } from "./IconPickerModal.js";
import { LinkProjectDialog } from "./LinkProjectDialog.js";
import { DocUpdateModal } from "./DocUpdateModal.js";

const TREE_ITEM_HEIGHT = 28;

export function TreeView() {
  const {
    tree, currentSection, expandedNodes, loadingNodes, loadingSectionId,
    externallyChangedIds, currentProject, llmLoading, llmSessionContext,
  } = useAppStore(useShallow(s => ({
    tree: s.tree,
    currentSection: s.currentSection,
    expandedNodes: s.expandedNodes,
    loadingNodes: s.loadingNodes,
    loadingSectionId: s.loadingSectionId,
    externallyChangedIds: s.externallyChangedIds,
    currentProject: s.currentProject,
    llmLoading: s.llmLoading,
    llmSessionContext: s.llmSessionContext,
  })));

  // Actions (stable references, don't cause re-renders)
  const selectSection = useAppStore(s => s.selectSection);
  const createSection = useAppStore(s => s.createSection);
  const duplicateSection = useAppStore(s => s.duplicateSection);
  const convertIdeaToKanban = useAppStore(s => s.convertIdeaToKanban);
  const deleteSection = useAppStore(s => s.deleteSection);
  const renameSection = useAppStore(s => s.renameSection);
  const updateIcon = useAppStore(s => s.updateIcon);
  const moveSection = useAppStore(s => s.moveSection);
  const importMarkdown = useAppStore(s => s.importMarkdown);
  const importPdf = useAppStore(s => s.importPdf);
  const importDroppedFiles = useAppStore(s => s.importDroppedFiles);
  const toggleExpanded = useAppStore(s => s.toggleExpanded);
  const expandNode = useAppStore(s => s.expandNode);
  const collapseAll = useAppStore(s => s.collapseAll);
  const loadChildren = useAppStore(s => s.loadChildren);
  const expandToSection = useAppStore(s => s.expandToSection);
  const getIdeaMessages = useAppStore(s => s.getIdeaMessages);
  const setScrollToPlanId = useAppStore(s => s.setScrollToPlanId);
  const showConfirm = useAppStore(s => s.showConfirm);

  const clearExternalChange = useAppStore(s => s.clearExternalChange);
  const unlinkProject = useAppStore(s => s.unlinkProject);
  const updateLinkedProject = useAppStore(s => s.updateLinkedProject);
  const linkProject = useAppStore(s => s.linkProject);
  const ensureWorkspace = useAppStore(s => s.ensureWorkspace);
  const loadRootTree = useAppStore(s => s.loadRootTree);
  const startLinkedDocGenSession = useAppStore(s => s.startLinkedDocGenSession);
  const openSnapshotsPanel = useAppStore(s => s.openSnapshotsPanel);

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
  const [showLinkProject, setShowLinkProject] = useState(false);
  const [showDocUpdateModal, setShowDocUpdateModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activeId = currentSection?.id || null;

  // Flatten tree for virtual rendering
  const flatItems = useMemo(
    () => flattenVisibleTreeFull(tree, expandedNodes, loadingNodes),
    [tree, expandedNodes, loadingNodes]
  );

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => TREE_ITEM_HEIGHT,
    overscan: 15,
  });

  // Hydrate expanded nodes: load children for nodes that are expanded but not loaded
  useEffect(() => {
    for (const item of flatItems) {
      if (item.isExpanded && item.hasChildren && !item.childrenLoaded && !item.isLoading) {
        loadChildren(item.id);
      }
    }
  }, [flatItems]);

  // Auto-expand ancestors & scroll to active section
  const pendingScrollRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeId) return;
    pendingScrollRef.current = activeId;
    expandToSection(activeId);
  }, [activeId]);

  // Scroll to active after flatItems updated (e.g. children loaded)
  useEffect(() => {
    const target = pendingScrollRef.current;
    if (!target) return;
    const idx = flatItems.findIndex(f => f.id === target);
    if (idx !== -1) {
      virtualizer.scrollToIndex(idx, { align: "auto" });
      pendingScrollRef.current = null;
    }
  }, [flatItems]);

  const IMPORTABLE_EXTS = new Set(["md", "markdown", "txt", "pdf"]);

  const hasImportableFiles = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return false;
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
    let targetNode = findNode(tree, targetId);
    if (!targetNode) return;
    if (!validateDrop(tree, dragItem.type, dragItem.id, targetNode, position)) return;
    // Load children before computing move params (so afterId is correct)
    if (position === "inside" && targetNode.childrenLoaded === false && targetNode.hasChildren) {
      await loadChildren(targetId);
      targetNode = findNode(useAppStore.getState().tree, targetId);
      if (!targetNode) return;
    }
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
      const flatIds = flatItems.map(f => f.id);
      const anchorIdx = flatIds.indexOf(selectionAnchor.current);
      const currentIdx = flatIds.indexOf(id);
      if (anchorIdx !== -1 && currentIdx !== -1) {
        const from = Math.min(anchorIdx, currentIdx);
        const to = Math.max(anchorIdx, currentIdx);
        setSelectedIds(new Set(flatIds.slice(from, to + 1)));
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
  }, [flatItems]);

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

  const handleContextMenu = async (x: number, y: number, node: { id: string; title: string; type: string; linkedProjectMeta?: any }) => {
    const state: ContextState = { x, y, nodeId: node.id, nodeTitle: node.title, nodeType: node.type };
    if (node.linkedProjectMeta) {
      state.isLinkedProject = true;
      state.linkedProjectId = node.linkedProjectMeta.linked_project_id;
      state.linkedDocStatus = node.linkedProjectMeta.doc_status;
    }
    if (node.type === "section") {
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
    // Resolve token: check if the idea belongs to a linked project
    const ideaToken = (() => {
      for (const root of tree) {
        if (root.linkedProjectMeta && findNode(root.children, contextMenu.ideaParentId!)) {
          return root.linkedProjectMeta.project_token || currentProject.token;
        }
      }
      return currentProject.token;
    })();
    try {
      const sec = await window.api.getSection(ideaToken, contextMenu.ideaParentId);
      const data = JSON.parse(sec.content);
      const msg = data.messages?.find((m: any) => m.planId === contextMenu.nodeId);
      if (msg) {
        msg.completed = newCompleted;
        await window.api.updateSection(ideaToken, contextMenu.ideaParentId, sec.title, JSON.stringify(data));
      }
    } catch { /* ignore */ }
  };

  const handleCreate = (parentId: string | null, title: string, type: string, icon: string | null) => {
    createSection(parentId, title, type, icon);
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

  const handleToggleExpanded = useCallback((id: string) => {
    const item = flatItems.find(f => f.id === id);
    if (item && !item.isExpanded && item.hasChildren && !item.childrenLoaded) {
      loadChildren(id);
    }
    toggleExpanded(id);
  }, [flatItems, loadChildren, toggleExpanded]);

  const handleRename = useCallback((id: string, title: string) => {
    if (id.startsWith("linked:")) {
      const node = findNode(tree, id);
      const linkedId = node?.linkedProjectMeta?.linked_project_id;
      if (linkedId) {
        updateLinkedProject(linkedId, { alias: title }).then(() => {
          loadRootTree();
        });
      }
    } else {
      renameSection(id, title);
    }
  }, [tree, renameSection, updateLinkedProject, loadRootTree]);

  return (
    <>
      <div className="sidebar-section-header sidebar-section-tree-header">
        <span className="sidebar-section-title">{t("sections")}</span>
        <div style={{ display: "flex", gap: 2 }}>
          {useAppStore.getState().hasLlmAccess() && (
            <button
              className={`btn-icon${llmLoading && llmSessionContext?.mode === "doc-update" ? " active" : ""}`}
              style={{ width: 20, height: 20 }}
              onClick={() => setShowDocUpdateModal(true)}
              disabled={llmLoading}
              title={t("updateDocs")}
            >
              <Sparkles size={13} className={llmLoading && llmSessionContext?.mode === "doc-update" ? "pulsing" : ""} />
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
            style={{ width: 20, height: 20, fontSize: 11 }}
            onClick={() => setShowLinkProject(true)}
            title={t("linkProject" as TranslationKey)}
          >
            🔗
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className={`sidebar-section-tree-body${fileDragOver ? " tree-file-drop-zone" : ""}`}
        onDragOver={(e) => {
          if (dragItem) return;
          if (!hasImportableFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setFileDragOver(true);
        }}
        onDragLeave={(e) => {
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
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = flatItems[virtualRow.index];
            if (item.isPlaceholder) {
              return (
                <div
                  key={item.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="tree-item" style={{ paddingLeft: 6 + item.depth * 12, opacity: 0.5 }}>
                    <span className="tree-item-spinner" />
                    <span className="tree-item-title">...</span>
                  </div>
                </div>
              );
            }
            return (
              <TreeItem
                key={item.id}
                item={item}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                isActive={item.id === activeId}
                isEditing={editingId === item.id}
                isSelected={selectedIds.has(item.id)}
                isExternallyChanged={externallyChangedIds.has(item.id)}
                isSectionLoading={item.id === loadingSectionId}
                onToggleExpanded={handleToggleExpanded}
                onExpandNode={expandNode}
                onSelect={(id) => {
                  if (id.startsWith("linked:") || id === "workspace-root") {
                    handleToggleExpanded(id);
                  } else if (activeId !== id) {
                    selectSection(id);
                  }
                }}
                onMultiSelect={handleMultiSelect}
                onDelete={handleDelete}
                onRename={handleRename}
                onStartEdit={setEditingId}
                onCreateChild={(parentId, parentType) => openCreate(parentId === "workspace-root" ? null : parentId, parentType)}
                onContextMenu={(x, y, node) => handleContextMenu(x, y, node)}
                onClearExternalChange={clearExternalChange}
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
            );
          })}
        </div>

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
      {contextMenu && contextMenu.nodeId === "workspace-root" ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: t("addChild"),
              icon: "+",
              onClick: () => openCreate(null),
            },
            {
              label: t("changeIcon"),
              icon: "\uD83C\uDFA8",
              onClick: () => setIconPickerId("workspace-root"),
            },
            "sep" as const,
            {
              label: t("updateDocs" as TranslationKey),
              icon: "\u2728",
              onClick: () => setShowDocUpdateModal(true),
            },
          ]}
        />
      ) : contextMenu && contextMenu.isLinkedProject ? (
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
              label: t("changeIcon"),
              icon: "\uD83C\uDFA8",
              onClick: () => setIconPickerId(contextMenu.nodeId),
            },
            "sep" as const,
            ...(contextMenu.linkedDocStatus === "none" ? [{
              label: t("generateDocs" as TranslationKey),
              icon: "\uD83D\uDE80",
              onClick: () => {
                if (!contextMenu.linkedProjectId) return;
                startLinkedDocGenSession(contextMenu.linkedProjectId, "generate");
              },
            }] : []),
            ...(contextMenu.linkedDocStatus === "loaded" ? [{
              label: t("updateDocs" as TranslationKey),
              icon: "\uD83D\uDD04",
              onClick: () => {
                if (!contextMenu.linkedProjectId) return;
                startLinkedDocGenSession(contextMenu.linkedProjectId, "update");
              },
            }] : []),
            {
              label: t("unlinkProject" as TranslationKey),
              icon: "\uD83D\uDD17",
              danger: true,
              onClick: async () => {
                if (!contextMenu.linkedProjectId) return;
                const ok = await showConfirm(
                  t("unlinkProjectConfirm" as TranslationKey, contextMenu.nodeTitle),
                  { title: t("unlinkProjectTitle" as TranslationKey), danger: true }
                );
                if (ok) {
                  await unlinkProject(contextMenu.linkedProjectId);
                }
              },
            },
          ]}
        />
      ) : contextMenu && selectedIds.size >= 2 && selectedIds.has(contextMenu.nodeId) ? (
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
                    icon: "\uD83D\uDCCB",
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
                    icon: "\uD83D\uDCA1",
                    onClick: () => {
                      setScrollToPlanId(contextMenu.nodeId);
                      selectSection(contextMenu.ideaParentId!);
                    },
                  },
                  {
                    label: contextMenu.ideaCompleted ? t("markNotDone") : t("markDone"),
                    icon: "\u2705",
                    onClick: () => handleToggleIdeaCompleted(),
                  },
                ]
              : []),
            ...(contextMenu.nodeType !== "folder" ? [
              "sep" as const,
              {
                label: t("sectionHistory"),
                icon: "\uD83D\uDD53",
                onClick: () => openSnapshotsPanel(contextMenu.nodeId, contextMenu.nodeTitle),
              },
            ] : []),
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

      {/* Link project dialog */}
      {showLinkProject && (
        <LinkProjectDialog onClose={() => setShowLinkProject(false)} />
      )}
      {showDocUpdateModal && (
        <DocUpdateModal onClose={() => setShowDocUpdateModal(false)} />
      )}
    </div>
    </>
  );
}
