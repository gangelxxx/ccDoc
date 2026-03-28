import { useMemo } from "react";
import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import { ModelList, type ModelCardInfo } from "../ModelList.js";

type VoiceLang = "en" | "multi" | "ru";

interface VoiceModelDef {
  id: string;
  accuracy: number;
  speed: number;
  sizeLabel: string;
  lang: VoiceLang;
  canTranslate?: boolean;
}

const VOICE_MODELS: VoiceModelDef[] = [
  { id: "gigaam-v3",           accuracy: 85, speed: 90, sizeLabel: "152 MB",  lang: "ru" },
  { id: "moonshine-v2-tiny",   accuracy: 45, speed: 95, sizeLabel: "31,0 MB", lang: "en" },
  { id: "moonshine-base",      accuracy: 55, speed: 90, sizeLabel: "58,0 MB", lang: "en" },
  { id: "whisper-small",       accuracy: 70, speed: 85, sizeLabel: "487 MB",  lang: "multi", canTranslate: true },
  { id: "whisper-medium",      accuracy: 80, speed: 45, sizeLabel: "760 MB",  lang: "multi", canTranslate: true },
  { id: "whisper-large",       accuracy: 80, speed: 15, sizeLabel: "1,1 GB",  lang: "multi", canTranslate: true },
  { id: "whisper-turbo",       accuracy: 80, speed: 20, sizeLabel: "1,6 GB",  lang: "multi", canTranslate: true },
];

const LANG_KEYS: Record<VoiceLang, string> = {
  en: "voiceLangEn",
  multi: "voiceLangMulti",
  ru: "voiceLangRu",
};

function RatingBar({ value }: { value: number }) {
  return (
    <div className="voice-bar-track">
      <div className="voice-bar-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

interface VoiceTabProps {
  voiceModelDraft: string;
  onVoiceModelChange: (id: string) => void;
}

export function VoiceTab({ voiceModelDraft, onVoiceModelChange }: VoiceTabProps) {
  const {
    voiceStatuses, voiceDownloading, voiceProgress, voiceCancelling, voiceErrors,
    startVoiceDownload, cancelVoiceDownload, deleteVoiceModel,
  } = useAppStore();
  const t = useT();

  // Normalize voice store (single download) → Record format for ModelList
  const downloading = useMemo(() => {
    if (!voiceDownloading) return {};
    return { [voiceDownloading]: voiceProgress };
  }, [voiceDownloading, voiceProgress]);

  const cancelling = useMemo(() => {
    if (!voiceDownloading || !voiceCancelling) return {};
    return { [voiceDownloading]: true };
  }, [voiceDownloading, voiceCancelling]);

  const handleDelete = async (modelId: string) => {
    await deleteVoiceModel(modelId);
    if (voiceModelDraft === modelId) onVoiceModelChange("");
  };

  const renderCardContent = (m: VoiceModelDef, info: ModelCardInfo) => {
    const localeKey = m.id.replace(/-/g, "_");
    return (
      <>
        <div className="voice-card-header">
          <div className="voice-card-left">
            <div className="voice-card-name">
              {t(`voice_${localeKey}` as any)}
              {info.isActive && <span className="voice-active-badge">✓ {t("active")}</span>}
            </div>
            <div className="voice-card-desc">
              {t(`voice_${localeKey}_desc` as any)}
            </div>
          </div>
          <div className="voice-card-bars">
            <div className="voice-bar-row">
              <span className="voice-bar-label">{t("voiceAccuracy")}</span>
              <RatingBar value={m.accuracy} />
            </div>
            <div className="voice-bar-row">
              <span className="voice-bar-label">{t("voiceSpeed")}</span>
              <RatingBar value={m.speed} />
            </div>
          </div>
        </div>
        <div className="voice-card-tags">
          <span className="voice-lang-tag">⊕ {t(LANG_KEYS[m.lang] as any)}</span>
          {m.canTranslate && (
            <span className="voice-translate-tag">⇄ {t("voiceTranslateEn")}</span>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="settings-section">
      <div className="embedding-section-title">{t("voiceTitle")}</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        {t("voiceDescription")}
      </div>

      <ModelList
        models={VOICE_MODELS}
        statuses={voiceStatuses ?? {}}
        activeModelId={voiceModelDraft}
        downloading={downloading}
        cancelling={cancelling}
        errors={voiceErrors ?? {}}
        onSelect={onVoiceModelChange}
        onDownload={startVoiceDownload}
        onCancel={cancelVoiceDownload}
        onDelete={handleDelete}
        renderCardContent={renderCardContent}
      />
    </div>
  );
}
