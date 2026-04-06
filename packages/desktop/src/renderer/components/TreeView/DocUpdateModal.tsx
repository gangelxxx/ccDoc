import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT, type TranslationKey } from "../../i18n.js";

interface DocUpdateModalProps {
  onClose: () => void;
}

export function DocUpdateModal({ onClose }: DocUpdateModalProps) {
  const t = useT();
  const currentProject = useAppStore(s => s.currentProject);
  const linkedProjects = useAppStore(s => s.linkedProjects);
  const llmLoading = useAppStore(s => s.llmLoading);
  const startDocUpdateQueue = useAppStore(s => s.startDocUpdateQueue);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>(["main"]);
    for (const lp of linkedProjects) {
      if (lp.doc_status === "loaded") initial.add(lp.id);
    }
    return initial;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStart = () => {
    const projects: Array<{ type: "main" } | { type: "linked"; linkedProjectId: string; mode: "generate" | "update" }> = [];
    if (checkedIds.has("main")) projects.push({ type: "main" });
    for (const lp of linkedProjects) {
      if (checkedIds.has(lp.id)) {
        const mode = lp.doc_status === "loaded" ? "update" as const : "generate" as const;
        projects.push({ type: "linked", linkedProjectId: lp.id, mode });
      }
    }
    if (projects.length > 0) {
      startDocUpdateQueue(projects);
    }
    onClose();
  };

  const statusLabel = (status: string): string => {
    if (status === "none") return t("docStatusNone" as TranslationKey);
    return "";
  };

  const hasSelection = checkedIds.size > 0;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal doc-update-modal" onClick={e => e.stopPropagation()}>
        <h3>{t("docUpdateSelectTitle" as TranslationKey)}</h3>
        <p className="doc-update-description">{t("docUpdateSelectDescription" as TranslationKey)}</p>

        <div className="doc-update-project-list">
          {/* Main project */}
          {currentProject && (
            <label className="doc-update-project-row">
              <input
                type="checkbox"
                checked={checkedIds.has("main")}
                onChange={() => toggle("main")}
              />
              <span className="doc-update-project-icon">📁</span>
              <div className="doc-update-project-info">
                <div className="doc-update-project-name">
                  {currentProject.name}
                  <span style={{ opacity: 0.5, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                    ({t("docUpdateMainProject" as TranslationKey)})
                  </span>
                </div>
                <div className="doc-update-project-path">{currentProject.path}</div>
              </div>
            </label>
          )}

          {/* Linked projects */}
          {linkedProjects.map(lp => (
            <label key={lp.id} className="doc-update-project-row">
              <input
                type="checkbox"
                checked={checkedIds.has(lp.id)}
                onChange={() => toggle(lp.id)}
              />
              <span className="doc-update-project-icon">{lp.icon || "📎"}</span>
              <div className="doc-update-project-info">
                <div className="doc-update-project-name">
                  {lp.alias || lp.source_path.split(/[\\/]/).pop() || "unnamed"}
                </div>
                <div className="doc-update-project-path">{lp.source_path}</div>
              </div>
              <span className="doc-update-project-status">{statusLabel(lp.doc_status)}</span>
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{t("cancel")}</button>
          <button
            className="btn btn-primary"
            onClick={handleStart}
            disabled={!hasSelection || llmLoading}
          >
            {t("docUpdateStart" as TranslationKey)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
