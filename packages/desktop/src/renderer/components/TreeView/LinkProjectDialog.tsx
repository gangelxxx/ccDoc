import { useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT, type TranslationKey } from "../../i18n.js";

interface LinkProjectDialogProps {
  onClose: () => void;
}

const LINK_TYPES = [
  { value: "dependency", label: "dependency", hint: "dependencyHint", detail: "dependencyDetail", icon: "📦" },
  { value: "reference", label: "reference", hint: "referenceHint", detail: "referenceDetail", icon: "📎" },
] as const;

export function LinkProjectDialog({ onClose }: LinkProjectDialogProps) {
  const t = useT();
  const [sourcePath, setSourcePath] = useState("");
  const [linkType, setLinkType] = useState<string>("dependency");
  const [alias, setAlias] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const linkProject = useAppStore(s => s.linkProject);
  const currentProject = useAppStore(s => s.currentProject);
  const ensureWorkspace = useAppStore(s => s.ensureWorkspace);
  const loadRootTree = useAppStore(s => s.loadRootTree);

  const handleSubmit = async () => {
    if (!sourcePath.trim() || !currentProject) return;
    setLoading(true);
    setError(null);
    try {
      await ensureWorkspace(currentProject.token, currentProject.name);
      const result = await linkProject(sourcePath.trim(), linkType as any, alias.trim() || undefined);
      if (result) {
        await loadRootTree();
        onClose();
      }
    } catch (e: any) {
      setError(e.message || "Failed to link project");
    } finally {
      setLoading(false);
    }
  };

  const handleBrowse = async () => {
    const path = await window.api.pickProjectFolder();
    if (path) setSourcePath(path);
  };

  const selectedType = LINK_TYPES.find(lt => lt.value === linkType)!;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal link-project-modal" onClick={e => e.stopPropagation()}>
        <h3>{t("linkProjectTitle" as TranslationKey)}</h3>

        <label className="link-project-label">
          {t("projectPath" as TranslationKey)}
        </label>
        <div className="link-project-path-row">
          <input
            value={sourcePath}
            onChange={e => setSourcePath(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="C:\\projects\\my-lib"
            autoFocus
          />
          <button
            className="btn link-project-browse-btn"
            onClick={handleBrowse}
            title={t("browse" as TranslationKey)}
          >
            <FolderOpen size={16} />
          </button>
        </div>

        <label className="link-project-label">
          {t("linkType" as TranslationKey)}
        </label>
        <div className="link-project-types">
          {LINK_TYPES.map(({ value, label, detail, icon }) => (
            <span key={value} className="link-project-type-wrap" data-tooltip={t(detail as TranslationKey)}>
              <button
                className={`btn btn-sm ${linkType === value ? "btn-primary" : ""}`}
                onClick={() => setLinkType(value)}
              >
                {icon} {t(label as TranslationKey)}
              </button>
            </span>
          ))}
        </div>
        <div className="link-project-type-hint">
          {t(selectedType.hint as TranslationKey)}
        </div>

        <label className="link-project-label">
          {t("alias" as TranslationKey)}
          <span className="link-project-label-hint">— {t("optional" as TranslationKey).toLowerCase()}</span>
        </label>
        <input
          value={alias}
          onChange={e => setAlias(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="my-lib"
        />

        {error && (
          <div className="link-project-error">{error}</div>
        )}

        <div className="modal-actions">
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !sourcePath.trim()}
          >
            {loading ? "..." : t("linkProjectBtn" as TranslationKey)}
          </button>
          <button className="btn" onClick={onClose}>{t("cancel")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
