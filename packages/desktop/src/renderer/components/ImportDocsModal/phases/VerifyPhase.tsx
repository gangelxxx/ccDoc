import { useState } from "react";
import { useT } from "../../../i18n.js";
import type { VerifyResult, ImportResult } from "../types.js";
import { statusIcon, linkStatusIcon } from "../helpers.js";

// ---------------------------------------------------------------------------
// StatsRow
// ---------------------------------------------------------------------------

function StatsRow({ label, original, imported }: { label: string; original: number; imported: number }) {
  const mismatch = original !== imported;
  return (
    <>
      <span>{label}</span>
      <span>{original}</span>
      <span style={mismatch ? { color: "var(--color-danger, #e53935)", fontWeight: 600 } : undefined}>
        {imported}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// VerifyCard
// ---------------------------------------------------------------------------

function VerifyCard({ result, defaultExpanded }: { result: VerifyResult; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasIssues = !result.match || result.warnings.length > 0 || result.brokenLinks > 0;
  const icon = statusIcon(result.match, result.warnings.length > 0 || result.brokenLinks > 0);
  const t = useT();

  return (
    <div className={`import-docs-verify-card${hasIssues ? " has-issues" : ""}`}>
      <div className="import-docs-verify-header" onClick={() => setExpanded(!expanded)}>
        <span>{icon}</span>
        <span className="import-docs-file-path">{result.relativePath}</span>
        <span style={{ marginLeft: "auto", cursor: "pointer" }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </div>

      {expanded && (
        <div className="import-docs-verify-details">
          <div className="import-docs-verify-stats">
            <span style={{ fontWeight: 600 }}>{t("verifyMetric")}</span>
            <span style={{ fontWeight: 600 }}>{t("verifyOriginal")}</span>
            <span style={{ fontWeight: 600 }}>{t("verifyImported")}</span>
            <StatsRow label={t("verifyHeadings")} original={result.stats.original.headings} imported={result.stats.imported.headings} />
            <StatsRow label={t("verifyCodeBlocks")} original={result.stats.original.codeBlocks} imported={result.stats.imported.codeBlocks} />
            <StatsRow label={t("verifyLinks")} original={result.stats.original.links} imported={result.stats.imported.links} />
            <StatsRow label={t("verifyImages")} original={result.stats.original.images} imported={result.stats.imported.images} />
            <StatsRow label={t("verifyChars")} original={result.stats.original.charCount} imported={result.stats.imported.charCount} />
          </div>

          {result.warnings.length > 0 && (
            <div className="import-docs-warning" style={{ marginTop: 8 }}>
              {result.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {result.links.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {result.links.map((link, i) => (
                <div key={i} className="import-docs-link-row">
                  <span>{linkStatusIcon(link.status)}</span>
                  <span className="import-docs-file-path" style={{ flex: 1 }}>{link.href}</span>
                  {link.detail && <span style={{ opacity: 0.7 }}>{link.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VerifyPhase
// ---------------------------------------------------------------------------

export function VerifyPhase({
  results,
  failedImports,
  showOnlyErrors,
}: {
  results: VerifyResult[];
  failedImports: ImportResult[];
  showOnlyErrors: boolean;
}) {
  const errorResults = results.filter((r) => !r.match || r.warnings.length > 0 || r.brokenLinks > 0);
  const displayResults = showOnlyErrors ? errorResults : results;
  const t = useT();

  return (
    <>
      {failedImports.length > 0 && (
        <div className="import-docs-warning">
          {t("failedToImport", failedImports.length)}
          {failedImports.map((f) => (
            <div key={f.relativePath} style={{ marginLeft: 12 }}>
              {"\u274C"} {f.relativePath}: {f.error || t("unknownError")}
            </div>
          ))}
        </div>
      )}

      {displayResults.map((result) => (
        <VerifyCard
          key={result.fileId}
          result={result}
          defaultExpanded={!result.match || result.warnings.length > 0 || result.brokenLinks > 0}
        />
      ))}

      {results.length === 0 && failedImports.length === 0 && (
        <p style={{ textAlign: "center", opacity: 0.7 }}>{t("noVerifyData")}</p>
      )}

    </>
  );
}
