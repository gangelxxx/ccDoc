import { useT } from "../../../i18n.js";
import type { ImportResult } from "../types.js";

export function DonePhaseView({
  successCount,
  deletedCount,
  totalWarnings,
  failedImports,
  cleanupErrors,
}: {
  successCount: number;
  deletedCount: number;
  totalWarnings: number;
  failedImports: ImportResult[];
  cleanupErrors: string[];
}) {
  const t = useT();

  return (
    <div className="import-docs-summary">
      <p>
        Imported: <strong>{successCount}</strong>
        {deletedCount > 0 && <>, deleted: <strong>{deletedCount}</strong></>}
      </p>

      {totalWarnings > 0 && (
        <p style={{ opacity: 0.7 }}>Warnings: {totalWarnings}</p>
      )}

      {failedImports.length > 0 && (
        <div className="import-docs-warning" style={{ marginTop: 12 }}>
          <strong>{t("importErrors")}</strong>
          {failedImports.map((f) => (
            <div key={f.relativePath}>{f.relativePath}: {f.error || t("unknownError")}</div>
          ))}
        </div>
      )}

      {cleanupErrors.length > 0 && (
        <div className="import-docs-warning" style={{ marginTop: 12 }}>
          <strong>{t("deleteErrors")}</strong>
          {cleanupErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

    </div>
  );
}
