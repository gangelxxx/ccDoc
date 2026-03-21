import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT, type TranslationKey } from "../../i18n.js";

interface Props {
  onClose: () => void;
}

function makeFields(t: (key: TranslationKey) => string) {
  return [
    { key: "name", label: t("passportFieldName"), placeholder: "My Project", multiline: false },
    { key: "stack", label: t("passportFieldStack"), placeholder: "TypeScript, React, Node.js...", multiline: true },
    { key: "conventions", label: t("passportFieldConventions"), placeholder: "Naming conventions, patterns, rules...", multiline: true },
  ];
}

export function PassportModal({ onClose }: Props) {
  const { passport, setPassportField, llmApiKey, llmLoading, currentProject } = useAppStore();
  const [values, setValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const t = useT();
  const fields = makeFields(t);

  useEffect(() => {
    setValues({ ...passport });
  }, [passport]);

  const handleBlur = (key: string) => {
    const newVal = (values[key] ?? "").trim();
    const oldVal = (passport[key] ?? "").trim();
    if (newVal !== oldVal) {
      setPassportField(key, newVal);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  const handleGenerate = async () => {
    if (!llmApiKey || !currentProject?.token) return;
    setGenerating(true);
    try {
      await useAppStore.getState().generatePassport();
    } finally {
      setGenerating(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal passport-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("llmPassport")}</h3>
        <p className="passport-hint">
          {t("passportHint")}
        </p>

        {fields.map(({ key, label, placeholder, multiline }) => (
          <div key={key} className="passport-field">
            <label>{label}</label>
            {multiline ? (
              <textarea
                value={values[key] ?? ""}
                placeholder={placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                onBlur={() => handleBlur(key)}
                rows={3}
              />
            ) : (
              <input
                type="text"
                value={values[key] ?? ""}
                placeholder={placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                onBlur={() => handleBlur(key)}
              />
            )}
          </div>
        ))}

        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={handleGenerate}
            disabled={generating || !llmApiKey || llmLoading}
            title={!llmApiKey ? t("needApiKey") : ""}
          >
            {generating ? <><Loader2 size={14} className="llm-spinner" /> {t("generating")}</> : t("generate")}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
