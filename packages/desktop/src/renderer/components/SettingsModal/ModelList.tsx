import { useMemo, type ReactNode } from "react";
import { useT } from "../../i18n.js";

type ModelStatus = "none" | "partial" | "ready";

interface ModelDef {
  id: string;
  sizeLabel: string;
}

export interface ModelCardInfo {
  status: ModelStatus;
  isActive: boolean;
  isDownloading: boolean;
  progress: number;
}

interface ModelListProps<T extends ModelDef> {
  models: T[];
  statuses: Record<string, ModelStatus>;
  activeModelId: string;
  downloading: Record<string, number>;
  cancelling: Record<string, boolean>;
  errors: Record<string, string>;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  renderCardContent: (model: T, info: ModelCardInfo) => ReactNode;
}

export function ModelList<T extends ModelDef>({
  models, statuses, activeModelId,
  downloading, cancelling, errors,
  onSelect, onDownload, onCancel, onDelete,
  renderCardContent,
}: ModelListProps<T>) {
  const t = useT();

  const { downloaded, available } = useMemo(() => {
    const dl: T[] = [];
    const av: T[] = [];
    for (const m of models) {
      const status = (statuses ?? {})[m.id] || "none";
      if (status === "ready" || status === "partial" || m.id in downloading) {
        dl.push(m);
      } else {
        av.push(m);
      }
    }
    dl.sort((a, b) => {
      const aVal = a.id === activeModelId ? 0 : 1;
      const bVal = b.id === activeModelId ? 0 : 1;
      return aVal - bVal;
    });
    return { downloaded: dl, available: av };
  }, [models, statuses, activeModelId, downloading]);

  return (
    <div className="model-list">
      {downloaded.length > 0 && (
        <>
          <div className="model-section-title">{t("downloadedModels")}</div>
          {downloaded.map((m) => {
            const status = (statuses ?? {})[m.id] || "none";
            const isReady = status === "ready";
            const isPartial = status === "partial";
            const isActive = activeModelId === m.id;
            const progress = downloading[m.id];
            const isDownloading = progress !== undefined;
            const isCancelling = cancelling[m.id] === true;
            const error = errors[m.id];

            return (
              <div
                key={m.id}
                className={`model-card${isActive ? " active" : ""}`}
                onClick={() => { if (isReady && !isActive) onSelect(m.id); }}
                style={{ cursor: isReady && !isActive ? "pointer" : undefined }}
              >
                {renderCardContent(m, { status, isActive, isDownloading, progress: progress ?? 0 })}

                {isDownloading && (
                  <div className="model-progress">
                    <div className="model-progress-bar" style={{ width: `${progress}%` }} />
                  </div>
                )}
                {isCancelling && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{t("stopping")}</div>
                )}
                {error && !isDownloading && (
                  <div style={{ fontSize: 11, color: "var(--error, #c00)", marginTop: 4 }}>{error}</div>
                )}

                <div className="model-card-actions">
                  {isPartial && !isDownloading && !isCancelling && (
                    <>
                      <button className="btn" onClick={(e) => { e.stopPropagation(); onDownload(m.id); }}>{t("voiceResume")}</button>
                      <button className="btn" style={{ color: "var(--error, #c00)" }} onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}>✕</button>
                    </>
                  )}
                  {isDownloading && !isCancelling && (
                    <button className="btn" onClick={(e) => { e.stopPropagation(); onCancel(m.id); }}>{Math.round(progress)}% ✕</button>
                  )}
                  {isCancelling && (
                    <button className="btn" disabled>{t("stopping")}</button>
                  )}
                  {isReady && !isActive && !isDownloading && (
                    <>
                      <button className="btn" onClick={(e) => { e.stopPropagation(); onSelect(m.id); }}>{t("select")}</button>
                      <button className="btn" style={{ color: "var(--error, #c00)" }} onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}>✕</button>
                    </>
                  )}
                  {isReady && isActive && !isDownloading && (
                    <>
                      <button className="btn btn-primary" disabled>{t("active")}</button>
                      <button className="btn" style={{ color: "var(--error, #c00)" }} onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}>✕</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {available.length > 0 && (
        <>
          <div className="model-section-title">{t("availableForDownload")}</div>
          {available.map((m) => (
            <div
              key={m.id}
              className="model-card model-card-available"
              onClick={() => onDownload(m.id)}
              style={{ cursor: "pointer" }}
            >
              {renderCardContent(m, { status: "none", isActive: false, isDownloading: false, progress: 0 })}
              <div className="model-card-actions">
                <span className="model-card-size">↓ {m.sizeLabel}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
