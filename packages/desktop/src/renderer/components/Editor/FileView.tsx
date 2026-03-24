import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { TipTapEditor, EditorToolbar } from "./TipTapEditor.js";
import { ContextMenu } from "../ContextMenu/ContextMenu.js";
import { GripVertical } from "lucide-react";
import { useT } from "../../i18n.js";
import type { Editor } from "@tiptap/react";

function isEmptyContent(content: string): boolean {
  try {
    const doc = JSON.parse(content);
    if (!doc.content || doc.content.length === 0) return true;
    if (doc.content.length === 1 && doc.content[0].type === "paragraph" && (!doc.content[0].content || doc.content[0].content.length === 0)) return true;
    return false;
  } catch {
    return true;
  }
}

interface FlatSection {
  id: string;
  title: string;
  content: string;
  depth: number;
  parentId: string;
}

function flattenSections(sections: FileSection[], parentId: string, depth = 0): FlatSection[] {
  const result: FlatSection[] = [];
  for (const s of sections) {
    result.push({ id: s.id, title: s.title, content: s.content, depth, parentId });
    if (s.children?.length) {
      result.push(...flattenSections(s.children, s.id, depth + 1));
    }
  }
  return result;
}

interface FileSection {
  id: string;
  title: string;
  content: string;
  type: string;
  sort_key: string;
  updated_at: string;
  children?: FileSection[];
}

/** Lazy-rendered TipTap editor: only mounts when the section scrolls into view. */
const LazyEditor = memo(function LazyEditor({
  sectionId, content, title, onEditorReady,
}: {
  sectionId: string; content: string; title: string;
  onEditorReady: (editor: Editor) => void;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) return <div ref={ref} style={{ minHeight: 40 }} />;

  return (
    <div ref={ref}>
      <TipTapEditor
        sectionId={sectionId}
        initialContent={content}
        title={title}
        showToolbar={false}
        onEditorReady={onEditorReady}
      />
    </div>
  );
});

interface Props {
  fileId: string;
  fileTitle: string;
  onActiveEditorChange?: (editor: Editor | null) => void;
}

export function FileView({ fileId, fileTitle, onActiveEditorChange }: Props) {
  const t = useT();
  const { tree, renameSection, deleteSection, loadTree, fileSectionsVersion } = useAppStore();
  const [sections, setSections] = useState<FileSection[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeEditor, _setActiveEditor] = useState<Editor | null>(null);
  const setActiveEditor = useCallback((editor: Editor | null) => {
    _setActiveEditor(editor);
    onActiveEditorChange?.(editor);
  }, [onActiveEditorChange]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sectionId: string } | null>(null);
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number } | null>(null);

  const handleEditorReady = useCallback((editor: Editor) => {
    setActiveEditor(editor);
  }, [setActiveEditor]);

  const loadSections = async () => {
    const t0 = performance.now();
    console.log(`[perf] FileView.loadSections START fileId=${fileId.substring(0, 8)}`);
    try {
      const result = await window.api.getFileWithSections(
        useAppStore.getState().currentProject!.token,
        fileId,
      );
      const flat = flattenSections(result.sections, fileId);
      const totalContentLen = flat.reduce((s, f) => s + (f.content?.length ?? 0), 0);
      console.log(`[perf] FileView.loadSections DONE +${(performance.now() - t0).toFixed(0)}ms sections=${flat.length} totalContentLen=${totalContentLen}`);
      setSections(result.sections);
    } catch (err) {
      console.warn("[FileView] Failed to load sections:", err);
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setActiveEditor(null);
    loadSections();
  }, [fileId]);

  // Reload sections when LLM tools mutate content
  useEffect(() => {
    if (fileSectionsVersion > 0) {
      loadSections();
    }
  }, [fileSectionsVersion]);

  // Sync section titles from tree (handles renames from tree context menu)
  useEffect(() => {
    if (sections.length === 0) return;
    const findNode = (nodes: any[], id: string): any => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children?.length) {
          const found = findNode(n.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    const fileNode = findNode(tree, fileId);
    if (!fileNode?.children) return;
    const titles = new Map<string, string>();
    const collect = (nodes: any[]) => {
      for (const n of nodes) {
        titles.set(n.id, n.title);
        if (n.children) collect(n.children);
      }
    };
    collect(fileNode.children);
    const syncTitles = (sections: FileSection[]): FileSection[] =>
      sections.map(s => ({
        ...s,
        title: titles.get(s.id) ?? s.title,
        children: s.children ? syncTitles(s.children) : undefined,
      }));
    setSections(prev => syncTitles(prev));
  }, [tree, fileId]);


  const addSectionDirect = async (parentId: string) => {
    const token = useAppStore.getState().currentProject!.token;
    await window.api.createSection(token, parentId, "Untitled", "section");
    await loadSections();
    await loadTree();
  };

  const handleAddSection = () => addSectionDirect(fileId);
  const handleAddSubsection = (parentId: string) => addSectionDirect(parentId);

  const handleRenameSection = (id: string, title: string) => {
    renameSection(id, title);
    const updateTree = (sections: FileSection[]): FileSection[] =>
      sections.map(s => ({
        ...s,
        title: s.id === id ? title : s.title,
        children: s.children ? updateTree(s.children) : undefined,
      }));
    setSections(prev => updateTree(prev));
  };

  const handleDeleteSection = async (id: string) => {
    await deleteSection(id);
    await loadSections();
    await loadTree();
  };

  // Find siblings of a section for move up/down
  const findSiblings = (id: string, sections: FileSection[]): FileSection[] | null => {
    for (const s of sections) {
      if (s.id === id) return sections;
      if (s.children?.length) {
        const found = findSiblings(id, s.children);
        if (found) return found;
      }
    }
    return null;
  };

  const handleMoveSection = async (id: string, direction: "up" | "down") => {
    const siblings = findSiblings(id, sections);
    if (!siblings) return;
    const idx = siblings.findIndex(s => s.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    // afterId = the sibling that should precede our section after the move
    const afterId = direction === "down"
      ? siblings[swapIdx].id                                    // place after the next sibling
      : (swapIdx > 0 ? siblings[swapIdx - 1].id : null);       // place before the previous sibling (null = first)
    try {
      const token = useAppStore.getState().currentProject!.token;
      await window.api.moveSection(token, id, null, afterId);
      await loadSections();
      await loadTree();
    } catch (err) {
      console.warn("[FileView] Move failed:", err);
    }
  };

  const handleDragReorder = async (draggedId: string, toIndex: number) => {
    const flat = flattenSections(sections, fileId);
    const fromIndex = flat.findIndex(s => s.id === draggedId);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    // Build the target order excluding the dragged item to find the correct afterId
    const withoutDragged = flat.filter(s => s.id !== draggedId);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    const afterId = insertAt > 0 ? withoutDragged[insertAt - 1].id : null;
    // Determine new parent: same parent as the section at the target position
    const targetParentId = toIndex < flat.length ? flat[toIndex].parentId : flat[flat.length - 1].parentId;
    try {
      const token = useAppStore.getState().currentProject!.token;
      await window.api.moveSection(token, draggedId, targetParentId === fileId ? null : targetParentId, afterId);
      await loadSections();
      await loadTree();
    } catch (err) {
      console.warn("[FileView] Drag reorder failed:", err);
    }
  };

  if (loading) {
    return <div className="file-view-loading">Loading...</div>;
  }

  return (
    <div className="file-view" ref={containerRef}>
      {sections.length === 0 ? (
        <div className="file-view-empty">
          <p>{t("noSectionsYet")}</p>
          <button className="btn btn-primary" onClick={handleAddSection}>
            {t("addSectionBtn")}
          </button>
        </div>
      ) : (
        <>
          <div className="file-view-sections">
            {flattenSections(sections, fileId).map((item, idx, arr) => (
              <div
                key={item.id}
                id={`file-section-${item.id}`}
                className={`file-section-block${dragSectionId === item.id ? " file-section-dragging" : ""}${dropIndicator?.index === idx ? " file-section-drop-before" : ""}`}
                data-depth={item.depth}
              >
                <div
                  className="file-section-header"
                  draggable
                  onDragStart={(e) => {
                    setDragSectionId(item.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => {
                    setDragSectionId(null);
                    setDropIndicator(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragSectionId || dragSectionId === item.id) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const mid = rect.top + rect.height / 2;
                    setDropIndicator({ index: e.clientY < mid ? idx : idx + 1 });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!dragSectionId || dropIndicator === null) return;
                    handleDragReorder(dragSectionId, dropIndicator.index);
                    setDragSectionId(null);
                    setDropIndicator(null);
                  }}
                  onDoubleClick={() => {
                    useAppStore.getState().selectSection(item.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, sectionId: item.id });
                  }}
                >
                  <span className="file-section-drag-handle" title={t("dragToReorder")}>
                    <GripVertical size={14} />
                  </span>
                  <span className="file-section-icon">{"\u00A7"}</span>
                  <input
                    className={`file-section-title${item.depth > 0 ? " file-section-title-nested" : ""}`}
                    value={item.title}
                    placeholder={t("untitledSection")}
                    onChange={(e) =>
                      handleRenameSection(item.id, e.target.value)
                    }
                  />
                  <button
                    className="btn-icon file-section-more"
                    title={t("moreActions")}
                    onClick={(e) => setContextMenu({ x: e.clientX, y: e.clientY, sectionId: item.id })}
                  >
                    {"\u2022\u2022\u2022"}
                  </button>
                  <button
                    className="btn-icon file-section-add"
                    title={t("addSubsection")}
                    onClick={() => handleAddSubsection(item.id)}
                  >
                    +
                  </button>
                  <button
                    className="btn-icon file-section-delete"
                    title={t("deleteSection")}
                    onClick={() => handleDeleteSection(item.id)}
                  >
                    {"\u00D7"}
                  </button>
                </div>
                {!isEmptyContent(item.content) && (
                  <LazyEditor
                    key={item.id}
                    sectionId={item.id}
                    content={item.content}
                    title={item.title}
                    onEditorReady={handleEditorReady}
                  />
                )}
                {idx < arr.length - 1 && (
                  <div className="file-section-divider" />
                )}
              </div>
            ))}
          </div>
          <button className="file-view-add-section" onClick={handleAddSection}>
            {t("addSectionBtn")}
          </button>
        </>
      )}
      {contextMenu && (() => {
        const siblings = findSiblings(contextMenu.sectionId, sections);
        const idx = siblings ? siblings.findIndex(s => s.id === contextMenu.sectionId) : -1;
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              {
                label: t("addSubsection"),
                icon: "+",
                onClick: () => handleAddSubsection(contextMenu.sectionId),
              },
              "sep" as const,
              {
                label: t("moveUp"),
                icon: "\u2191",
                onClick: () => handleMoveSection(contextMenu.sectionId, "up"),
              },
              {
                label: t("moveDown"),
                icon: "\u2193",
                onClick: () => handleMoveSection(contextMenu.sectionId, "down"),
              },
              "sep" as const,
              {
                label: t("delete"),
                icon: "\uD83D\uDDD1\uFE0F",
                danger: true,
                onClick: () => handleDeleteSection(contextMenu.sectionId),
              },
            ]}
          />
        );
      })()}
    </div>
  );
}
