import { useState, useEffect } from "react";
import { ChevronRight, ClipboardCopy, Check } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { TipTapEditor } from "./TipTapEditor.js";
import { findTreeNode, flattenChildren } from "./editor-utils.js";
import type { ChildSection } from "./editor-utils.js";

// --- Child Sections (inline display of nested sections) ---
export function ChildSections({ parentId, tree, onNavigate }: {
  parentId: string;
  tree: any[];
  onNavigate: (id: string) => void;
}) {
  const t = useT();
  const [children, setChildren] = useState<ChildSection[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Check if this section has children in tree
  const treeNode = findTreeNode(tree, parentId);
  const hasChildren = treeNode?.children?.length > 0;

  useEffect(() => {
    if (!hasChildren) {
      setChildren([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const state = useAppStore.getState();
        const sections = state.sectionSource === "user"
          ? await window.api.user.getSectionChildren(parentId)
          : await window.api.getSectionChildren(state.activeSectionToken || state.currentProject!.token, parentId);
        if (!cancelled) {
          setChildren(flattenChildren(sections));
        }
      } catch (err) {
        console.warn("[ChildSections] Failed to load:", err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [parentId, hasChildren]);

  if (children.length === 0) return null;

  return (
    <div className="child-sections">
      {children.map((child) => (
        <div key={child.id} className="child-section-block" data-depth={child.depth}>
          <div className="child-section-header">
            <div
              className="child-section-header-left"
              onClick={() => onNavigate(child.id)}
            >
              <ChevronRight size={14} className="child-section-arrow" />
              <span className="child-section-title">{child.title || "Untitled"}</span>
            </div>
            <button
              className="child-section-copy-btn"
              title={t("copyAsMarkdown")}
              onClick={async (e) => {
                e.stopPropagation();
                const state = useAppStore.getState();
                try {
                  if (state.sectionSource === "user") {
                    await window.api.user.copySectionAsMarkdown(child.id);
                  } else {
                    const token = state.activeSectionToken || state.currentProject?.token;
                    if (!token) return;
                    await window.api.copySectionAsMarkdown(token, child.id);
                  }
                  setCopiedId(child.id);
                  useAppStore.getState().addToast("success", t("markdownCopied"));
                  setTimeout(() => setCopiedId(null), 1500);
                } catch {
                  useAppStore.getState().addToast("error", t("copyFailed"));
                }
              }}
            >
              {copiedId === child.id ? <Check size={13} /> : <ClipboardCopy size={13} />}
            </button>
          </div>
          <TipTapEditor
            key={child.id}
            sectionId={child.id}
            initialContent={child.content}
            title={child.title}
            showToolbar={false}
          />
        </div>
      ))}
    </div>
  );
}
