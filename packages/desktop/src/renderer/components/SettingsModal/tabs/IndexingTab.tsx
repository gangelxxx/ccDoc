import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "../../../i18n.js";
import { useAppStore } from "../../../stores/app.store.js";
import type { IndexingConfig } from "../../../stores/types.js";

export interface IndexingTabProps {
  draft: IndexingConfig;
  onChange: (cfg: Partial<IndexingConfig>) => void;
}

function parseList(text: string): string[] {
  return text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

export function IndexingTab({ draft, onChange }: IndexingTabProps) {
  const t = useT();
  const currentProject = useAppStore((s) => s.currentProject);
  const token = currentProject?.token;
  const isIndexing = useAppStore((s) => s.bgTasks.some((t) => t.label?.startsWith("Semantic") && !t.finishedAt));

  // Local text state — parsed to array only on blur
  const [excludedDirsText, setExcludedDirsText] = useState(draft.excludedDirs.join(", "));
  const [codeExtensionsText, setCodeExtensionsText] = useState(draft.codeExtensions.join(", "));

  // Sync text when draft changes externally (e.g. auto-configure from parent)
  const excludedKey = draft.excludedDirs.join(",");
  const extKey = draft.codeExtensions.join(",");
  useEffect(() => { setExcludedDirsText(draft.excludedDirs.join(", ")); }, [excludedKey]);
  useEffect(() => { setCodeExtensionsText(draft.codeExtensions.join(", ")); }, [extKey]);

  // Smart scan state — excluded dirs
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Smart scan state — extensions
  const [scanningExt, setScanningExt] = useState(false);
  const [extSuggestions, setExtSuggestions] = useState<string[] | null>(null);
  const [selectedExt, setSelectedExt] = useState<Set<string>>(new Set());

  // Smart scan state — file size ("empty" = scanned but no files found)
  const [scanningSize, setScanningSize] = useState(false);
  const [sizeSuggestion, setSizeSuggestion] = useState<{
    fileCount: number; maxSizeKB: number; maxFile: string;
    p99SizeKB: number; recommendedKB: number; coverAllKB: number;
  } | "empty" | null>(null);

  const handleSmartScan = async () => {
    if (!token) return;
    setScanning(true);
    try {
      const result = await window.api.scanExclusionSuggestions(token);
      setSuggestions(result);
      setSelected(new Set(result));
    } finally {
      setScanning(false);
    }
  };

  const handleApplySuggestions = () => {
    if (!suggestions) return;
    const merged = [...new Set([...draft.excludedDirs, ...Array.from(selected)])];
    onChange({ excludedDirs: merged });
    setExcludedDirsText(merged.join(", "));
    setSuggestions(null);
  };

  const handleSmartScanExt = async () => {
    if (!token) return;
    setScanningExt(true);
    try {
      const result = await window.api.scanExtensionSuggestions(token);
      setExtSuggestions(result);
      setSelectedExt(new Set(result));
    } finally {
      setScanningExt(false);
    }
  };

  const handleApplyExtSuggestions = () => {
    if (!extSuggestions) return;
    const merged = [...new Set([...draft.codeExtensions, ...Array.from(selectedExt)])];
    onChange({ codeExtensions: merged });
    setCodeExtensionsText(merged.join(", "));
    setExtSuggestions(null);
  };

  const handleSmartScanSize = async () => {
    if (!token) return;
    setScanningSize(true);
    try {
      const result = await window.api.scanFileSizeSuggestion(token);
      setSizeSuggestion(result ?? "empty");
    } finally {
      setScanningSize(false);
    }
  };

  return (
    <div className="settings-section" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Enabled toggle */}
      <div>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
          title={t("indexingEnabledTooltip")}
        >
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span>{t("indexingEnabled")}</span>
        </label>
      </div>

      {/* Intensity — 3 buttons */}
      <div>
        <div className="settings-section-label" title={t("indexingIntensityTooltip")}>{t("indexingIntensity")}</div>
        <div className="settings-font-sizes">
          {(["low", "medium", "high"] as const).map((level) => (
            <button
              key={level}
              className={`settings-theme-btn${draft.intensity === level ? " active" : ""}`}
              onClick={() => onChange({ intensity: level })}
              disabled={!draft.enabled}
            >
              <span>{t(`indexingIntensity_${level}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Excluded dirs — textarea + smart scan */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="settings-section-label" title={t("indexingExcludedDirsTooltip")}>{t("indexingExcludedDirs")}</div>
          <button
            className="btn"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={handleSmartScan}
            disabled={!draft.enabled || !token || scanning}
          >
            {scanning && <Loader2 size={12} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} />}
            {t("indexingSmartScan")}
          </button>
        </div>
        {suggestions !== null && (
          <div style={{
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 8,
            marginTop: 6,
            marginBottom: 6,
            background: "var(--bg-tertiary, var(--bg-secondary))",
          }}>
            {suggestions.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0" }}>
                {t("indexingSmartScanEmpty")}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                  {t("indexingSmartScanFound")}
                </div>
                {suggestions.map(dir => (
                  <label key={dir} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(dir)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        e.target.checked ? next.add(dir) : next.delete(dir);
                        setSelected(next);
                      }}
                    />
                    <span style={{ fontSize: 13 }}>{dir}</span>
                  </label>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: "2px 10px" }} onClick={handleApplySuggestions}>
                    {t("indexingSmartScanApply")}
                  </button>
                  <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }} onClick={() => setSuggestions(null)}>
                    {t("cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <textarea
          rows={4}
          value={excludedDirsText}
          onChange={(e) => setExcludedDirsText(e.target.value)}
          onBlur={() => onChange({ excludedDirs: parseList(excludedDirsText) })}
          disabled={!draft.enabled}
          placeholder="node_modules, dist, build..."
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>

      {/* Code extensions — textarea + smart scan, parsed on blur */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="settings-section-label" title={t("indexingCodeExtensionsTooltip")}>{t("indexingCodeExtensions")}</div>
          <button
            className="btn"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={handleSmartScanExt}
            disabled={!draft.enabled || !token || scanningExt}
          >
            {scanningExt && <Loader2 size={12} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} />}
            {t("indexingSmartScan")}
          </button>
        </div>
        {extSuggestions !== null && (
          <div style={{
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 8,
            marginTop: 6,
            marginBottom: 6,
            background: "var(--bg-tertiary, var(--bg-secondary))",
          }}>
            {extSuggestions.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0" }}>
                {t("indexingExtScanEmpty")}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                  {t("indexingExtScanFound")}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                  {extSuggestions.map(ext => (
                    <label key={ext} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedExt.has(ext)}
                        onChange={(e) => {
                          const next = new Set(selectedExt);
                          e.target.checked ? next.add(ext) : next.delete(ext);
                          setSelectedExt(next);
                        }}
                      />
                      <span style={{ fontSize: 13, fontFamily: "monospace" }}>{ext}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: "2px 10px" }} onClick={handleApplyExtSuggestions}>
                    {t("indexingSmartScanApply")}
                  </button>
                  <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }} onClick={() => setExtSuggestions(null)}>
                    {t("cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <textarea
          rows={2}
          value={codeExtensionsText}
          onChange={(e) => setCodeExtensionsText(e.target.value)}
          onBlur={() => onChange({ codeExtensions: parseList(codeExtensionsText) })}
          disabled={!draft.enabled}
          placeholder=".ts, .tsx, .js, .py..."
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>

      {/* Max file size + smart scan */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="settings-section-label" title={t("indexingMaxFileSizeTooltip")}>{t("indexingMaxFileSize")}</div>
          <button
            className="btn"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={handleSmartScanSize}
            disabled={!draft.enabled || !token || scanningSize}
          >
            {scanningSize && <Loader2 size={12} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} />}
            {t("indexingSmartScan")}
          </button>
        </div>
        {sizeSuggestion !== null && (
          <div style={{
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 8,
            marginTop: 6,
            marginBottom: 6,
            background: "var(--bg-tertiary, var(--bg-secondary))",
          }}>
            {sizeSuggestion === "empty" ? (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0" }}>
                {t("indexingSizeScanEmpty")}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                  {t("indexingSizeScanInfo", String(sizeSuggestion.fileCount), String(sizeSuggestion.p99SizeKB), String(sizeSuggestion.maxSizeKB))}
                </div>
                {sizeSuggestion.maxFile && (
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, fontFamily: "monospace" }}>
                    {t("indexingSizeScanMaxFile", sizeSuggestion.maxFile)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: "2px 10px" }}
                    onClick={() => { onChange({ maxFileSizeKB: sizeSuggestion.recommendedKB }); setSizeSuggestion(null); }}
                  >
                    {t("indexingSizeScanRecommended", String(sizeSuggestion.recommendedKB))}
                  </button>
                  {sizeSuggestion.coverAllKB > sizeSuggestion.recommendedKB && (
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: "2px 10px" }}
                      onClick={() => { onChange({ maxFileSizeKB: sizeSuggestion.coverAllKB }); setSizeSuggestion(null); }}
                    >
                      {t("indexingSizeScanCoverAll", String(sizeSuggestion.coverAllKB))}
                    </button>
                  )}
                  <button className="btn" style={{ fontSize: 11, padding: "2px 10px" }} onClick={() => setSizeSuggestion(null)}>
                    {t("cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={50}
            max={2000}
            step={50}
            value={draft.maxFileSizeKB}
            onChange={(e) =>
              onChange({
                maxFileSizeKB: Math.max(50, Math.min(2000, Number(e.target.value) || 500)),
              })
            }
            disabled={!draft.enabled}
            style={{ width: 80 }}
          />
          <span>KB</span>
        </div>
      </div>

      {/* Staleness interval */}
      <div>
        <div className="settings-section-label" title={t("indexingStalenessIntervalTooltip")}>{t("indexingStalenessInterval")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            max={60}
            step={1}
            value={draft.stalenessIntervalMin}
            onChange={(e) =>
              onChange({
                stalenessIntervalMin: Math.max(1, Math.min(60, Number(e.target.value) || 5)),
              })
            }
            disabled={!draft.enabled}
            style={{ width: 80 }}
          />
          <span>{t("indexingMinutes")}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          className="btn"
          onClick={() => {
            if (token) window.api.semanticReindex(token);
          }}
          disabled={!token || !draft.enabled || isIndexing}
          title={t("indexingReindexTooltip")}
        >
          {isIndexing && <Loader2 size={14} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} />}
          {t("indexingReindex")}
        </button>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (token) window.api.semanticClearIndex(token);
          }}
          disabled={!token || !draft.enabled || isIndexing}
          title={t("indexingClearIndexTooltip")}
        >
          {t("indexingClearIndex")}
        </button>
      </div>
    </div>
  );
}
