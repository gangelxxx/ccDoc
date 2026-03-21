import { useState } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { TreeView } from "../TreeView/TreeView.js";
import { TodoPanel } from "../TodoPanel/TodoPanel.js";
import { HistoryPanel } from "../HistoryPanel/HistoryPanel.js";
import { ProjectPickerModal } from "../ProjectPickerModal/ProjectPickerModal.js";
import { FolderKanban, FileText } from "lucide-react";
import { PassportModal } from "../PassportModal/PassportModal.js";

function collectFiles(nodes: any[]): any[] {
  const result: any[] = [];
  for (const n of nodes) {
    if (n.type === "file") result.push(n);
    if (n.children?.length) result.push(...collectFiles(n.children));
  }
  return result;
}

export function Sidebar() {
  const {
    projects,
    currentProject,
    selectProject,
    addProject,
    sidebarCollapsed,
    sidebarWidth,
    setPaletteOpen,
    historyExpanded,
    toggleHistoryExpanded,
    tree,
    llmApiKey,
    generateSectionSummary,
    llmLoading,
    startBgTask,
    finishBgTask,
  } = useAppStore();

  const t = useT();
  const [saveRequested, setSaveRequested] = useState(false);
  const [todoExpanded, setTodoExpanded] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showPassport, setShowPassport] = useState(false);
  const [generatingSummaries, setGeneratingSummaries] = useState(false);

  const handleGenerateSummaries = async () => {
    if (!llmApiKey) return;
    const files = collectFiles(tree);
    if (!files.length) return;
    const taskId = startBgTask(t("summaryTaskLabel", files.length));
    setGeneratingSummaries(true);
    try {
      for (const file of files) {
        await generateSectionSummary(file.id);
      }
    } finally {
      finishBgTask(taskId);
      setGeneratingSummaries(false);
    }
  };

  const style = sidebarCollapsed ? undefined : { width: sidebarWidth };

  return (
    <div className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`} style={style}>
      {/* Header */}
      <div className="sidebar-header">
        <h2>CCDoc</h2>
        <div style={{ display: "flex", gap: 4 }}>
          {currentProject && llmApiKey && (
            <button
              className="btn-icon"
              onClick={handleGenerateSummaries}
              disabled={generatingSummaries || llmLoading}
              title={t("generateSummariesTitle")}
              style={{ fontWeight: 600, fontSize: 13 }}
            >
              S
            </button>
          )}
          {currentProject && (
            <button
              className="btn-icon"
              onClick={() => setShowPassport(true)}
              title={t("passport")}
            >
              <FileText size={16} />
            </button>
          )}
          <button
            className="btn-icon"
            onClick={() => setShowProjectPicker(true)}
            title={t("selectProject")}
          >
            <FolderKanban size={16} />
          </button>
        </div>
      </div>

      {showProjectPicker && (
        <ProjectPickerModal onClose={() => setShowProjectPicker(false)} />
      )}
      {showPassport && (
        <PassportModal onClose={() => setShowPassport(false)} />
      )}

      {currentProject && (
        <>
          {/* Quick actions */}
          <div className="sidebar-quick-actions">
            <button className="sidebar-quick-action" onClick={() => setPaletteOpen(true)}>
              {"\uD83D\uDD0D"} {t("search")}
              <span className="shortcut">Ctrl+K</span>
            </button>
          </div>

          {/* Body */}
          <div className="sidebar-body">
            {/* Tree section */}
            <div className="sidebar-section sidebar-section-tree" style={{ flex: 1 }}>
              <TreeView />
            </div>

            {/* TODO (collapsible) */}
            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <span
                  className="sidebar-section-title clickable"
                  onClick={() => setTodoExpanded(!todoExpanded)}
                >
                  {todoExpanded ? "\u25BC" : "\u25B6"} {t("todo")}
                </span>
              </div>
              {todoExpanded && <TodoPanel />}
            </div>

            {/* History (collapsible) */}
            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <span
                  className="sidebar-section-title clickable"
                  onClick={toggleHistoryExpanded}
                >
                  {historyExpanded ? "\u25BC" : "\u25B6"} {t("history")}
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!historyExpanded) toggleHistoryExpanded();
                    setSaveRequested(true);
                  }}
                >
                  {t("saveBtnLabel")}
                </button>
              </div>
              {historyExpanded && (
                <HistoryPanel
                  saveRequested={saveRequested}
                  onSaveHandled={() => setSaveRequested(false)}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
