import { useT } from "../../../i18n.js";

export function ImportPhaseView({ current, total, file }: { current: number; total: number; file: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const t = useT();

  return (
    <div style={{ padding: "32px 0" }}>
      <div className="import-docs-progress-bar">
        <div className="import-docs-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="import-docs-progress-text">{t("importProgress", current, total)}</p>
      {file && (
        <p className="import-docs-file-path" style={{ opacity: 0.7, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{file}</p>
      )}
    </div>
  );
}
