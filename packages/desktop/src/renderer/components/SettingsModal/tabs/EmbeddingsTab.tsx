import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import { ModelList, type ModelCardInfo } from "../ModelList.js";

interface EmbeddingModelDef {
  id: string;
  name: string;
  description: string;
  sizeLabel: string;
  dimensions: number;
}

const LOCAL_MODELS: EmbeddingModelDef[] = [
  { id: "multilingual-e5-small", name: "multilingual-e5-small", description: "Multilingual, 100+ languages", sizeLabel: "130 MB", dimensions: 384 },
  { id: "all-MiniLM-L6-v2", name: "all-MiniLM-L6-v2", description: "English only, fast and compact", sizeLabel: "90 MB", dimensions: 384 },
];

export function EmbeddingsTab() {
  const {
    embeddingConfig, setEmbeddingConfig,
    embeddingStatuses, embeddingDownloading, embeddingCancelling, embeddingErrors,
    startEmbeddingDownload, cancelEmbeddingDownload, deleteEmbeddingModel,
  } = useAppStore();
  const t = useT();
  const [showOnlineKey, setShowOnlineKey] = useState(false);

  const activeLocalModelId = embeddingConfig.mode === "local" ? embeddingConfig.localModelId : "";

  const handleSelect = (id: string) => {
    setEmbeddingConfig({ mode: "local", localModelId: id });
  };

  const handleDelete = async (id: string) => {
    await deleteEmbeddingModel(id);
    if (embeddingConfig.localModelId === id && embeddingConfig.mode === "local") {
      setEmbeddingConfig({ mode: "none" });
    }
  };

  const renderCardContent = (m: EmbeddingModelDef, _info: ModelCardInfo) => (
    <>
      <div className="embedding-model-name">{m.name}</div>
      <div className="embedding-model-desc">{m.description} &middot; {m.dimensions}D</div>
    </>
  );

  return (
    <div className="settings-section">
      <div className="embedding-section-title">{t("onlineModels")}</div>
      <label className="llm-settings-label">{t("provider")}</label>
      <select
        className="llm-settings-input"
        value={embeddingConfig.onlineProvider}
        onChange={(e) => setEmbeddingConfig({ onlineProvider: e.target.value as any })}
      >
        <option value="openai">OpenAI</option>
        <option value="voyage">Voyage AI</option>
      </select>

      <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("apiKey")}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type={showOnlineKey ? "text" : "password"}
          className="llm-settings-input"
          style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
          placeholder={embeddingConfig.onlineProvider === "openai" ? "sk-..." : "pa-..."}
          value={embeddingConfig.onlineApiKey}
          onChange={(e) => setEmbeddingConfig({ onlineApiKey: e.target.value })}
        />
        <button className="btn-icon" onClick={() => setShowOnlineKey((v) => !v)}
          title={showOnlineKey ? "Hide key" : "Show key"}>
          {showOnlineKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>

      <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("model")}</label>
      <select
        className="llm-settings-input"
        value={embeddingConfig.onlineModel}
        onChange={(e) => setEmbeddingConfig({ onlineModel: e.target.value })}
      >
        {embeddingConfig.onlineProvider === "openai" && <>
          <option value="text-embedding-3-small">text-embedding-3-small</option>
          <option value="text-embedding-3-large">text-embedding-3-large</option>
          <option value="text-embedding-ada-002">text-embedding-ada-002</option>
        </>}
        {embeddingConfig.onlineProvider === "voyage" && <>
          <option value="voyage-3">voyage-3</option>
          <option value="voyage-3-lite">voyage-3-lite</option>
          <option value="voyage-multilingual-2">voyage-multilingual-2</option>
        </>}
      </select>

      <button
        className={`btn${embeddingConfig.mode === "online" ? " btn-primary" : ""}`}
        style={{ marginTop: 8 }}
        onClick={() => setEmbeddingConfig({ mode: "online" })}
        disabled={!embeddingConfig.onlineApiKey}
      >
        {embeddingConfig.mode === "online" ? t("active") : t("setActive")}
      </button>

      <div className="embedding-section-title" style={{ marginTop: 16 }}>{t("localModels")}</div>
      <ModelList
        models={LOCAL_MODELS}
        statuses={embeddingStatuses ?? {}}
        activeModelId={activeLocalModelId}
        downloading={embeddingDownloading ?? {}}
        cancelling={embeddingCancelling ?? {}}
        errors={embeddingErrors ?? {}}
        onSelect={handleSelect}
        onDownload={startEmbeddingDownload}
        onCancel={cancelEmbeddingDownload}
        onDelete={handleDelete}
        renderCardContent={renderCardContent}
      />

      {embeddingConfig.mode !== "none" && (
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() => setEmbeddingConfig({ mode: "none" })}
        >
          {t("disableEmbeddings")}
        </button>
      )}
    </div>
  );
}
