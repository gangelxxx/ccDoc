import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, RotateCcw, Clock, FileText, Search, Filter, Loader2 } from "lucide-react";
import { diffWords } from "diff";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

// --- History View ---
export function HistoryView() {
  const {
    historyViewCommit,
    historyViewSections,
    historyViewSectionId,
    historyViewContent,
    historyViewCurrentContent,
    historyDiffIds,
    viewCommitSection,
    closeHistoryView,
    restoreVersion,
  } = useAppStore();
  const th = useT();
  const [changesOnly, setChangesOnly] = useState(false);

  if (!historyViewCommit) return null;

  const typeIcons: Record<string, string> = {
    folder: "\uD83D\uDCC1", file: "\uD83D\uDCC4", section: "\u00A7",
    idea: "\uD83D\uDCA1", todo: "\u2611\uFE0F", kanban: "\uD83D\uDCCA", drawing: "\u270F\uFE0F",
  };

  // Build tree from flat sections of the commit
  type HSection = { id: string; parent_id: string | null; title: string; type: string; sort_key: string; icon?: string | null; children: HSection[] };
  const treeNodes = useMemo(() => {
    const map = new Map<string, HSection>();
    const roots: HSection[] = [];
    for (const s of historyViewSections) {
      map.set(s.id, { ...s, children: [] });
    }
    for (const s of historyViewSections) {
      const node = map.get(s.id)!;
      if (s.parent_id && map.has(s.parent_id)) {
        map.get(s.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const sortNodes = (nodes: HSection[]) => {
      nodes.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
      nodes.forEach(n => sortNodes(n.children));
    };
    sortNodes(roots);
    return roots;
  }, [historyViewSections]);

  const [searchQuery, setSearchQuery] = useState("");
  const [contentMatchIds, setContentMatchIds] = useState<Set<string> | null>(null);
  const { currentProject } = useAppStore();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced git grep search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim() || !currentProject || !historyViewCommit) {
      setContentMatchIds(null);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const ids = await window.api.searchAtVersion(
          currentProject.token, historyViewCommit.oid, searchQuery.trim()
        );
        setContentMatchIds(new Set(ids));
      } catch {
        setContentMatchIds(null);
      }
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery, currentProject, historyViewCommit]);

  // Filter tree by title + content matches (from git grep)
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return treeNodes;
    const q = searchQuery.toLowerCase();
    const filterNodes = (nodes: typeof treeNodes): typeof treeNodes => {
      const result: typeof treeNodes = [];
      for (const node of nodes) {
        const filteredChildren = filterNodes(node.children);
        const titleMatch = node.title.toLowerCase().includes(q);
        const contentMatch = contentMatchIds?.has(node.id) ?? false;
        if (titleMatch || contentMatch || filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
      return result;
    };
    return filterNodes(treeNodes);
  }, [treeNodes, searchQuery, contentMatchIds]);

  // Filter to show only changed sections
  const changedIds = useMemo(() => {
    if (!historyDiffIds) return null;
    return new Set([...historyDiffIds.added, ...historyDiffIds.removed, ...historyDiffIds.changed]);
  }, [historyDiffIds]);

  const displayTree = useMemo(() => {
    if (!changesOnly || !changedIds) return filteredTree;
    const filterChanged = (nodes: typeof filteredTree): typeof filteredTree => {
      const result: typeof filteredTree = [];
      for (const node of nodes) {
        const filteredChildren = filterChanged(node.children);
        if (changedIds.has(node.id) || filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
      return result;
    };
    return filterChanged(filteredTree);
  }, [filteredTree, changesOnly, changedIds]);

  const handleRestore = async () => {
    const ok = await useAppStore.getState().showConfirm(th("confirmRestore"));
    if (ok) {
      restoreVersion(historyViewCommit.oid);
      closeHistoryView();
    }
  };

  const diff = useMemo(() => {
    if (!historyViewContent) return null;
    const oldText = historyViewContent.content || "";
    const newText = historyViewCurrentContent || "";
    return diffWords(oldText, newText);
  }, [historyViewContent, historyViewCurrentContent]);

  return (
    <div className="history-view">
      <div className="history-view-header">
        <div className="history-view-header-info">
          <Clock size={14} />
          <span className="history-view-header-message" title={historyViewCommit.message}>
            {historyViewCommit.message.length > 60
              ? historyViewCommit.message.slice(0, 60) + "\u2026"
              : historyViewCommit.message}
          </span>
          <span className="history-view-header-date">
            {new Date(historyViewCommit.timestamp * 1000).toLocaleString(th("dateLocale"), {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        </div>
        <div className="history-view-header-actions">
          <button
            className={`btn btn-sm${changesOnly ? " active" : ""}`}
            onClick={() => setChangesOnly(!changesOnly)}
            title={th("changesOnly")}
          >
            <Filter size={14} /> {th("changesOnly")}
          </button>
          <button className="btn btn-sm" onClick={handleRestore}>
            <RotateCcw size={14} /> {th("restore")}
          </button>
          <button className="btn-icon" onClick={closeHistoryView}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="history-view-body">
        <div className="history-view-sections">
          <div className="history-view-search">
            <Search size={14} />
            <input
              type="text"
              placeholder={th("historySearch")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="history-view-sections-tree">
            <HistoryTreeNodes nodes={displayTree} depth={0} typeIcons={typeIcons} activeId={historyViewSectionId} onSelect={viewCommitSection} forceExpand={!!searchQuery.trim() || changesOnly} />
          </div>
        </div>

        <div className="history-view-content">
          {!historyViewSectionId && (
            <div className="history-view-placeholder">
              <FileText size={48} strokeWidth={1} />
              <p>{th("historySelectSection")}</p>
            </div>
          )}

          {historyViewSectionId && !historyViewContent && (
            <div className="history-view-placeholder">
              <div className="spinner" />
            </div>
          )}

          {historyViewContent && diff && (
            <div className="history-view-diff">
              <div className="diff-header">
                {historyViewCurrentContent !== null ? (
                  <>
                    <span className="diff-label diff-label-old">{th("historyCurrent")}</span>
                    <span className="diff-arrow">{"\u2192"}</span>
                    <span className="diff-label diff-label-new">{th("historyVersionLabel", historyViewCommit.message)}</span>
                  </>
                ) : (
                  <span className="diff-label diff-label-new">{th("historyVersionLabel", historyViewCommit.message)} {th("historyNotInVersion")}</span>
                )}
              </div>
              <pre className="diff-content">
                {diff.map((part, i) => (
                  <span
                    key={i}
                    className={part.added ? "diff-added" : part.removed ? "diff-removed" : "diff-unchanged"}
                  >
                    {part.value}
                  </span>
                ))}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- History Tree Nodes ---
function HistoryTreeNodes({ nodes, depth, typeIcons, activeId, onSelect, forceExpand }: {
  nodes: any[];
  depth: number;
  typeIcons: Record<string, string>;
  activeId: string | null;
  onSelect: (id: string) => void;
  forceExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (depth === 0) {
      const init: Record<string, boolean> = {};
      nodes.forEach(n => { if (n.children.length > 0) init[n.id] = true; });
      return init;
    }
    return {};
  });
  const toggle = (id: string) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = forceExpand || !!expanded[node.id];
        return (
          <div key={node.id}>
            <div
              className={`history-view-section-item${activeId === node.id ? " active" : ""}`}
              style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() => {
                if (hasChildren && !forceExpand) toggle(node.id);
                if (node.type !== "folder") onSelect(node.id);
              }}
            >
              {hasChildren ? (
                <span className={`history-tree-arrow${isExpanded ? " open" : ""}`}>&#9654;</span>
              ) : (
                <span style={{ width: 12, display: "inline-block" }} />
              )}
              <span className="history-view-section-icon">{node.icon || typeIcons[node.type] || "\uD83D\uDCC4"}</span>
              <span className="history-view-section-title">{node.title}</span>
            </div>
            {hasChildren && isExpanded && (
              <HistoryTreeNodes nodes={node.children} depth={depth + 1} typeIcons={typeIcons} activeId={activeId} onSelect={onSelect} forceExpand={forceExpand} />
            )}
          </div>
        );
      })}
    </>
  );
}

// --- Restore Progress Modal ---
export function RestoreProgressModal() {
  const restoreProgress = useAppStore((s) => s.restoreProgress);
  const th = useT();

  if (!restoreProgress) return null;

  const { current, total, title } = restoreProgress;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal" style={{ maxWidth: 420, textAlign: "center" }}>
        <Loader2 size={32} className="spin" style={{ color: "var(--accent)", marginBottom: 12 }} />
        <h3 style={{ margin: "0 0 4px" }}>{th("restoringVersion")}</h3>
        <p style={{ margin: "0 0 16px", color: "var(--text-secondary)", fontSize: 13 }}>
          {th("restoreProcessing")}
        </p>
        <div style={{
          width: "100%", height: 6, borderRadius: 3,
          background: "var(--bg-secondary)", overflow: "hidden", marginBottom: 8,
        }}>
          <div style={{
            width: `${percent}%`, height: "100%", borderRadius: 3,
            background: "var(--accent)", transition: "width 0.15s ease",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
            {title}
          </span>
          <span>{current} / {total}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
