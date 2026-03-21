import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";

const VOICE_MODELS = [
  { id: "whisper-tiny", params: "39M", sizeLabel: "~75 MB", quality: 2 },
  { id: "whisper-base", params: "74M", sizeLabel: "~150 MB", quality: 3, recommended: true },
  { id: "whisper-small", params: "244M", sizeLabel: "~470 MB", quality: 4 },
];

function QualityStars({ count }: { count: number }) {
  return (
    <span style={{ letterSpacing: 1 }}>
      {"★".repeat(count)}{"☆".repeat(5 - count)}
    </span>
  );
}

export function VoiceTab() {
  const {
    voiceModelId, setVoiceModelId,
    voiceStatuses, voiceDownloading, voiceProgress, voiceCancelling, voiceErrors,
    startVoiceDownload, cancelVoiceDownload, deleteVoiceModel,
  } = useAppStore();
  const t = useT();

  return (
    <div className="settings-section">
      <div className="embedding-section-title">{t("voiceTitle")}</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        {t("voiceDescription")}
      </div>

      <div className="embedding-models-list">
        {VOICE_MODELS.map((m) => {
          const status = (voiceStatuses ?? {})[m.id] || "none";
          const isReady = status === "ready";
          const isPartial = status === "partial";
          const isActive = voiceModelId === m.id && isReady;
          const isDownloading = voiceDownloading === m.id;
          const downloadError = (voiceErrors ?? {})[m.id];

          return (
            <div key={m.id} className={`embedding-model-card${isActive ? " active" : ""}`}>
              <div className="embedding-model-info">
                <div className="embedding-model-name">
                  {t(`voice_${m.id.replace("-", "_")}` as any)}
                  {m.recommended && <span style={{ marginLeft: 6, fontSize: 12 }} title={t("voiceRecommended")}>⭐</span>}
                </div>
                <div className="embedding-model-desc">
                  {t(`voice_${m.id.replace("-", "_")}_desc` as any)} &middot; {m.params} &middot; <QualityStars count={m.quality} />
                </div>
                {isDownloading && (
                  <div className="embedding-progress">
                    <div className="embedding-progress-bar" style={{ width: `${voiceProgress}%` }} />
                  </div>
                )}
                {isDownloading && voiceCancelling && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{t("stopping")}</div>
                )}
                {downloadError && !isDownloading && (
                  <div style={{ fontSize: 11, color: "var(--error, #c00)", marginTop: 4 }}>{downloadError}</div>
                )}
              </div>
              <span className="embedding-model-size">{m.sizeLabel}</span>

              {/* Not downloaded, not downloading */}
              {status === "none" && !isDownloading && (
                <button className="btn" onClick={() => startVoiceDownload(m.id)}>{t("download")}</button>
              )}

              {/* Partially downloaded — resume + delete */}
              {isPartial && !isDownloading && (
                <>
                  <button className="btn" onClick={() => startVoiceDownload(m.id)}>{t("voiceResume")}</button>
                  <button className="btn" style={{ color: "var(--error, #c00)" }} onClick={() => deleteVoiceModel(m.id)} title={t("voiceDelete")}>✕</button>
                </>
              )}

              {/* Downloading */}
              {isDownloading && !voiceCancelling && (
                <button className="btn" onClick={cancelVoiceDownload}>{Math.round(voiceProgress)}% ✕</button>
              )}
              {isDownloading && voiceCancelling && (
                <button className="btn" disabled>{t("stopping")}</button>
              )}

              {/* Fully downloaded, not active, not downloading */}
              {isReady && !isActive && !isDownloading && (
                <>
                  <button className="btn" onClick={() => setVoiceModelId(m.id)}>{t("select")}</button>
                  <button className="btn" style={{ color: "var(--error, #c00)" }} onClick={() => deleteVoiceModel(m.id)} title={t("voiceDelete")}>✕</button>
                </>
              )}

              {/* Fully downloaded, active, not downloading */}
              {isReady && isActive && !isDownloading && (
                <>
                  <button className="btn btn-primary" disabled>{t("active")}</button>
                  <button className="btn" style={{ color: "var(--error, #c00)" }} onClick={() => deleteVoiceModel(m.id)} title={t("voiceDelete")}>✕</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
