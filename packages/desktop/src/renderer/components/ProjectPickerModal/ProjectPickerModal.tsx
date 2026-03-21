import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { Trash2, AlertTriangle, Loader2, Copy, Check } from "lucide-react";
import { useT } from "../../i18n.js";

interface Props {
  onClose: () => void;
}

export function ProjectPickerModal({ onClose }: Props) {
  const { projects, currentProject, selectProject, addProject, removeProject } = useAppStore();
  const t = useT();
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<typeof projects[0] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? projects.filter((p) => p.name.toLowerCase().includes(q))
      : projects.slice(0, 5);
    return list;
  }, [projects, query]);

  const handleSelect = (project: typeof projects[0]) => {
    selectProject(project);
    onClose();
  };

  const handleAdd = async () => {
    await addProject();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal project-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("selectProjectTitle")}</h3>

        <input
          ref={inputRef}
          type="text"
          placeholder={t("searchByName")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="project-picker-list">
          {filtered.length === 0 && (
            <div className="project-picker-empty">{t("noProjectsFound")}</div>
          )}
          {filtered.map((p) => (
            <div
              key={p.token}
              className={`project-picker-item${p.token === currentProject?.token ? " active" : ""}`}
              onClick={() => handleSelect(p)}
            >
              <div className="project-picker-item-info">
                <div className="project-picker-item-name">{p.name}</div>
                <div className="project-picker-item-path">{p.path}</div>
              </div>
              <button
                className="project-picker-item-copy"
                title={t("copyPath")}
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(p.path);
                  setCopiedToken(p.token);
                  setTimeout(() => setCopiedToken(null), 1500);
                }}
              >
                {copiedToken === p.token ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                className="project-picker-item-delete"
                title={t("deleteProject")}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(p);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {!query && projects.length > 5 && (
          <div className="project-picker-hint">
            {t("projectsTotal", projects.length)}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={handleAdd}>{t("createProjectBtn")}</button>
          <button className="btn" onClick={handleAdd}>{t("addExistingBtn")}</button>
          <button className="btn" onClick={onClose}>{t("cancel")}</button>
        </div>
      </div>

      {deleteTarget && (
        <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <AlertTriangle size={24} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
              <div>
                <h3 style={{ margin: 0 }}>{t("deleteProjectTitle")}</h3>
                <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5 }}
                  dangerouslySetInnerHTML={{ __html: t("deleteProjectWarning", deleteTarget.name) }}
                />
                <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                  {t("deleteProjectIrreversible")}
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-danger" disabled={deleting} onClick={async () => {
                setDeleting(true);
                try {
                  await removeProject(deleteTarget.token);
                } finally {
                  setDeleting(false);
                  setDeleteTarget(null);
                }
              }}>
                {deleting ? <><Loader2 size={14} className="llm-spinner" /> {t("deleting")}</> : t("delete")}
              </button>
              <button className="btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
