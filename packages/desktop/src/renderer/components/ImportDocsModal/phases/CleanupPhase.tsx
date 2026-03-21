import { useT } from "../../../i18n.js";
import type { ImportResult } from "../types.js";

export function CleanupPhase({
  successfulImports,
  selected,
  onToggle,
  onToggleAll,
}: {
  successfulImports: ImportResult[];
  selected: Set<number>;
  onToggle: (i: number) => void;
  onToggleAll: () => void;
}) {
  const allSelected = successfulImports.length > 0 && selected.size === successfulImports.length;
  const t = useT();

  return (
    <>
      <div className="import-docs-warning">
        {t("cleanupWarning")}
      </div>

      <div className="import-docs-select-bar">
        <label>
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
          {allSelected ? t("deselectAll") : t("selectAll")} ({successfulImports.length})
        </label>
      </div>

      <div className="import-docs-files">
        {successfulImports.map((result, i) => (
          <div key={result.relativePath} className="import-docs-file-row" onClick={() => onToggle(i)}>
            <input type="checkbox" checked={selected.has(i)} onChange={() => onToggle(i)} />
            <span className="import-docs-file-path">{result.relativePath}</span>
          </div>
        ))}
      </div>

    </>
  );
}
