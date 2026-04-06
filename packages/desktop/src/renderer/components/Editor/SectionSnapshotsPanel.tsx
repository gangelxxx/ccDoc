import { useMemo } from "react";
import { createPortal } from "react-dom";
import { X, RotateCcw, Trash2, GitCompare, Loader2, History } from "lucide-react";
import { diffWords } from "diff";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

function relativeTime(isoDate: string, t: (key: any, ...args: any[]) => string): string {
  const date = new Date(isoDate + "Z");
  const now = Date.now();
  const diffMs = now - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t("sectionHistoryJustNow");
  if (mins < 60) return t("sectionHistoryMinAgo", String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("sectionHistoryHourAgo", String(hours));
  const days = Math.floor(hours / 24);
  if (days < 30) return t("sectionHistoryDayAgo", String(days));
  return date.toLocaleDateString();
}

const SOURCE_COLORS: Record<string, string> = {
  manual: "var(--text-muted)",
  assistant: "var(--accent)",
  mcp: "#c084fc",
  import: "#60a5fa",
  restore: "#fbbf24",
};

export function SectionSnapshotsPanel() {
  const {
    snapshotsPanelOpen,
    snapshotsPanelSectionTitle,
    snapshots,
    snapshotsLoading,
    snapshotsHasMore,
    selectedSnapshotIds,
    diffData,
    diffLoading,
    closeSnapshotsPanel,
    loadMoreSnapshots,
    toggleSnapshotSelection,
    clearSnapshotSelection,
    loadDiff,
    loadDiffWithCurrent,
    restoreSnapshot,
    deleteSnapshot,
  } = useAppStore();
  const t = useT();

  if (!snapshotsPanelOpen) return null;

  const sourceLabel = (source: string) => {
    const key = `sectionHistorySource${source.charAt(0).toUpperCase() + source.slice(1)}` as any;
    return t(key) || source;
  };

  return createPortal(
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeSnapshotsPanel(); }}>
      <div className="section-snapshots-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="section-snapshots-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <History size={16} />
            <span className="section-snapshots-title" title={snapshotsPanelSectionTitle}>
              {t("sectionHistoryTitle", snapshotsPanelSectionTitle)}
            </span>
          </div>
          <button className="btn-icon" onClick={closeSnapshotsPanel}>
            <X size={18} />
          </button>
        </div>

        <div className="section-snapshots-body">
          {/* Timeline */}
          <div className="section-snapshots-timeline">
            {snapshots.length === 0 && !snapshotsLoading && (
              <div className="section-snapshots-empty">
                <History size={32} strokeWidth={1} style={{ opacity: 0.3 }} />
                <p>{t("sectionHistoryEmpty")}</p>
              </div>
            )}

            {snapshots.map((snap) => {
              const isSelected = selectedSnapshotIds.includes(snap.id);
              return (
                <div
                  key={snap.id}
                  className={`section-snapshot-item${isSelected ? " selected" : ""}`}
                  onClick={() => toggleSnapshotSelection(snap.id)}
                >
                  <div className="section-snapshot-item-left">
                    <div className="section-snapshot-radio">
                      {isSelected && <div className="section-snapshot-radio-dot" />}
                    </div>
                    <div className="section-snapshot-info">
                      <span className="section-snapshot-time">
                        {relativeTime(snap.created_at, t)}
                        {snap.section_title && (
                          <span className="section-snapshot-section-name"> — {snap.section_title}</span>
                        )}
                      </span>
                      <span
                        className="section-snapshot-source"
                        style={{ color: SOURCE_COLORS[snap.source] || "var(--text-muted)" }}
                      >
                        {sourceLabel(snap.source)}
                      </span>
                    </div>
                  </div>
                  <div className="section-snapshot-item-right">
                    <span className="section-snapshot-size">
                      {snap.byte_size > 1024 ? `${(snap.byte_size / 1024).toFixed(1)}KB` : `${snap.byte_size}B`}
                    </span>
                    <button
                      className="btn-icon btn-icon-sm"
                      onClick={(e) => { e.stopPropagation(); deleteSnapshot(snap.id); }}
                      title={t("delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}

            {snapshotsHasMore && (
              <button
                className="section-snapshots-load-more"
                onClick={loadMoreSnapshots}
                disabled={snapshotsLoading}
              >
                {snapshotsLoading ? <Loader2 size={14} className="spin" /> : null}
                {t("sectionHistoryLoadMore")}
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="section-snapshots-actions">
            {selectedSnapshotIds.length === 1 && (
              <button className="btn btn-sm" onClick={async () => {
                const ok = await useAppStore.getState().showConfirm(t("sectionHistoryConfirmRestore"));
                if (ok) restoreSnapshot(selectedSnapshotIds[0]);
              }}>
                <RotateCcw size={14} /> {t("sectionHistoryRestore")}
              </button>
            )}
            {selectedSnapshotIds.length === 0 && (
              <span className="section-snapshots-hint">{t("sectionHistorySelectToCompare")}</span>
            )}
          </div>

          {/* Diff View */}
          {diffLoading && (
            <div className="section-snapshots-diff-loading">
              <Loader2 size={20} className="spin" />
            </div>
          )}
          {diffData && !diffLoading && (
            <DiffView
              left={diffData.left}
              right={diffData.right}
              leftLabel={diffData.leftLabel}
              rightLabel={diffData.rightLabel}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function DiffView({ left, right, leftLabel, rightLabel }: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const diff = useMemo(() => diffWords(left, right), [left, right]);

  return (
    <div className="section-snapshots-diff">
      <div className="diff-header">
        <span className="diff-label diff-label-old">{leftLabel}</span>
        <span className="diff-arrow">{"\u2192"}</span>
        <span className="diff-label diff-label-new">{rightLabel}</span>
      </div>
      <pre className="diff-content">
        {diff.map((part, i) => (
          <span
            key={i}
            className={part.added ? "diff-added" : part.removed ? "diff-removed" : "diff-unchanged"}
          >
            {part.value}
          </span>
        ))}
      </pre>
    </div>
  );
}
