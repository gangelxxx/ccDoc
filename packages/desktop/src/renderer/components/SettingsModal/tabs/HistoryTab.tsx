import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "../../../i18n.js";
import { useAppStore } from "../../../stores/app.store.js";

interface HistoryStats {
  commitCount: number;
  oldestCommitDate: string | null;
  newestCommitDate: string | null;
  sizeBytes: number;
}

interface SnapshotGlobalStats {
  totalCount: number;
  totalSizeBytes: number;
  oldestDate: string | null;
}

interface CacheStats {
  count: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null, t: (key: string) => string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

type ConfirmState = "idle" | "confirming";

function useInlineConfirm(timeoutMs = 5000) {
  const [state, setState] = useState<ConfirmState>("idle");
  const startConfirm = useCallback(() => setState("confirming"), []);
  const cancel = useCallback(() => setState("idle"), []);
  useEffect(() => {
    if (state === "confirming") {
      const timer = setTimeout(() => setState("idle"), timeoutMs);
      return () => clearTimeout(timer);
    }
  }, [state, timeoutMs]);
  return { state, startConfirm, cancel, reset: cancel };
}

/** Stat row inside a stats card */
function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
      <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/** Stats card with border */
function StatsCard({ children, loading, t }: { children: React.ReactNode; loading: boolean; t: (k: string) => string }) {
  if (loading) {
    return (
      <div style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "12px 14px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "var(--text-secondary)",
        fontSize: 13,
      }}>
        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
        {t("historyLoading")}
      </div>
    );
  }
  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 6,
      padding: "8px 14px",
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

/** Inline confirm button group */
function ConfirmButton({
  label, confirmLabel, onConfirm, disabled, loading, t,
  confirm,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled: boolean;
  loading: boolean;
  t: (k: string) => string;
  confirm: ReturnType<typeof useInlineConfirm>;
}) {
  if (confirm.state === "confirming") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--danger)" }}>
          {confirmLabel || t("historyCleanupConfirm")}
        </span>
        <button className="btn btn-sm btn-danger" onClick={onConfirm} disabled={loading}>
          {loading ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : t("historyCleanupYes")}
        </button>
        <button className="btn btn-sm" onClick={confirm.cancel} disabled={loading}>
          {t("historyCleanupNo")}
        </button>
      </div>
    );
  }
  return (
    <button className="btn btn-sm" onClick={confirm.startConfirm} disabled={disabled || loading}>
      {label}
    </button>
  );
}

const RETAIN_OPTIONS = [
  { value: 0, key: "historyRetainAll" },
  { value: 1, key: "historyRetainDay1" },
  { value: 7, key: "historyRetainDays7" },
  { value: 30, key: "historyRetainDays30" },
] as const;

export interface HistoryTabProps {
  historyRetainDays: number;
  onHistoryRetainDaysChange: (days: number) => void;
  maxSnapshotsPerSection: number;
  onMaxSnapshotsChange: (n: number) => void;
  snapshotMaxAgeDays: number;
  onSnapshotMaxAgeDaysChange: (days: number) => void;
  snapshotCoalesceIntervalSec: number;
  onSnapshotCoalesceChange: (sec: number) => void;
}

export function HistoryTab({
  historyRetainDays, onHistoryRetainDaysChange,
  maxSnapshotsPerSection, onMaxSnapshotsChange,
  snapshotMaxAgeDays, onSnapshotMaxAgeDaysChange,
  snapshotCoalesceIntervalSec, onSnapshotCoalesceChange,
}: HistoryTabProps) {
  const t = useT();
  const currentProject = useAppStore(s => s.currentProject);
  const addToast = useAppStore(s => s.addToast);
  const token = currentProject?.token;

  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [snapshotStats, setSnapshotStats] = useState<SnapshotGlobalStats | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);

  const gitConfirm = useInlineConfirm();
  const snapConfirm = useInlineConfirm();
  const cacheConfirm = useInlineConfirm();
  const [gitCleaning, setGitCleaning] = useState(false);
  const [snapCleaning, setSnapCleaning] = useState(false);
  const [cacheCleaning, setCacheCleaning] = useState(false);

  const loadStats = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [hs, ss, cs] = await Promise.all([
        window.api.historySettingsGetStats(token),
        window.api.historySettingsSnapshotsStats(token),
        window.api.historySettingsCacheStats(token),
      ]);
      setHistoryStats(hs);
      setSnapshotStats(ss);
      setCacheStats(cs);
    } catch (err) {
      console.warn("[HistoryTab] Failed to load stats:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleGitCleanup = async () => {
    if (!token) return;
    setGitCleaning(true);
    try {
      const cleanupDays = historyRetainDays === 0 ? -1 : historyRetainDays;
      const result = await window.api.historySettingsCleanup(token, cleanupDays);
      if (cleanupDays === -1) {
        addToast("success", t("historyCleanupResetSuccess"));
      } else {
        addToast("success", t("historyCleanupSuccess").replace("{0}", String(result.deletedCommits)));
      }
      const hs = await window.api.historySettingsGetStats(token);
      setHistoryStats(hs);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setGitCleaning(false);
      gitConfirm.reset();
    }
  };

  const handleSnapshotsCleanup = async () => {
    if (!token) return;
    setSnapCleaning(true);
    try {
      const result = await window.api.historySettingsSnapshotsCleanup(token);
      addToast("success", t("historySnapshotsCleanupSuccess").replace("{0}", String(result.deleted)));
      const ss = await window.api.historySettingsSnapshotsStats(token);
      setSnapshotStats(ss);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setSnapCleaning(false);
      snapConfirm.reset();
    }
  };

  const handleCacheClear = async () => {
    if (!token) return;
    setCacheCleaning(true);
    try {
      await window.api.historySettingsCacheClear(token);
      addToast("success", t("historyCacheClearSuccess"));
      const cs = await window.api.historySettingsCacheStats(token);
      setCacheStats(cs);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setCacheCleaning(false);
      cacheConfirm.reset();
    }
  };

  if (!token) {
    return (
      <div className="settings-section" style={{ padding: "40px 0", textAlign: "center", color: "var(--text-secondary)" }}>
        {t("historyNoData")}
      </div>
    );
  }

  return (
    <div className="settings-section" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Git History ── */}
      <div>
        <div className="settings-section-label">{t("historyGitSection")}</div>

        <StatsCard loading={loading} t={t}>
          {historyStats && (
            <>
              <StatRow label={t("historyCommits")} value={historyStats.commitCount} />
              <StatRow label={t("historyOldest")} value={formatDate(historyStats.oldestCommitDate, t)} />
              <StatRow label={t("historyNewest")} value={formatDate(historyStats.newestCommitDate, t)} />
              <StatRow label={t("historySize")} value={formatBytes(historyStats.sizeBytes)} />
            </>
          )}
        </StatsCard>

        <div className="settings-section-label" style={{ marginTop: 4 }}>{t("historyRetainDays")}</div>
        <div className="settings-font-sizes" style={{ marginBottom: 12 }}>
          {RETAIN_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`settings-theme-btn${historyRetainDays === opt.value ? " active" : ""}`}
              onClick={() => onHistoryRetainDaysChange(opt.value)}
            >
              <span>{t(opt.key)}</span>
            </button>
          ))}
        </div>

        <ConfirmButton
          label={t("historyCleanupNow")}
          onConfirm={handleGitCleanup}
          disabled={!historyStats?.commitCount}
          loading={gitCleaning}
          t={t}
          confirm={gitConfirm}
        />
      </div>

      {/* ── Section Snapshots ── */}
      <div>
        <div className="settings-section-label">{t("historySnapshotsSection")}</div>

        <StatsCard loading={loading} t={t}>
          {snapshotStats && (
            <>
              <StatRow label={t("historySnapshotsTotal")} value={snapshotStats.totalCount} />
              <StatRow label={t("historySize")} value={formatBytes(snapshotStats.totalSizeBytes)} />
              <StatRow label={t("historySnapshotsOldest")} value={formatDate(snapshotStats.oldestDate, t)} />
            </>
          )}
        </StatsCard>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          <SettingRow label={t("historyMaxPerSection")}>
            <input
              type="number" min={1} max={100}
              value={maxSnapshotsPerSection}
              onChange={e => onMaxSnapshotsChange(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              style={{ width: 72 }}
            />
          </SettingRow>
          <SettingRow label={t("historyMaxAgeDays")}>
            <input
              type="number" min={1} max={365}
              value={snapshotMaxAgeDays}
              onChange={e => onSnapshotMaxAgeDaysChange(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              style={{ width: 72 }}
            />
          </SettingRow>
          <SettingRow label={t("historyCoalesceInterval")}>
            <input
              type="number" min={5} max={300}
              value={snapshotCoalesceIntervalSec}
              onChange={e => onSnapshotCoalesceChange(Math.max(5, Math.min(300, Number(e.target.value) || 5)))}
              style={{ width: 72 }}
            />
          </SettingRow>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -2 }}>
            {t("historyCoalesceHint")}
          </div>
        </div>

        <ConfirmButton
          label={t("historyCleanupBySettings")}
          onConfirm={handleSnapshotsCleanup}
          disabled={!snapshotStats?.totalCount}
          loading={snapCleaning}
          t={t}
          confirm={snapConfirm}
        />
      </div>

      {/* ── Semantic Cache ── */}
      <div>
        <div className="settings-section-label">{t("historySemanticCache")}</div>

        <StatsCard loading={loading} t={t}>
          {cacheStats && (
            <StatRow label={t("historyCacheCount")} value={cacheStats.count} />
          )}
        </StatsCard>

        <div style={{ marginBottom: 6 }}>
          <ConfirmButton
            label={t("historyCacheClear")}
            onConfirm={handleCacheClear}
            disabled={!cacheStats?.count}
            loading={cacheCleaning}
            t={t}
            confirm={cacheConfirm}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("historyCacheHint")}
        </div>
      </div>
    </div>
  );
}

/** Label + control row for settings inputs */
function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </div>
  );
}
