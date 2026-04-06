import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, Plus, X, Sparkles,
  FileText, Layers, Cpu, BookOpen, ScrollText,
  Terminal, FolderTree, AlertTriangle, Tag,
} from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT, type TranslationKey } from "../../i18n.js";

/** Keys that are internal (not user-facing passport fields). Must match core/db/passport.repo.ts */
const INTERNAL_PASSPORT_KEYS = new Set([
  "auto_commit_enabled",
  "fts_index_version",
  "fts_last_indexed_at",
  "semantic_last_indexed_at",
  "code_max_mtime",
  "indexing_auto_configured",
]);

const DEFAULT_PASSPORT_FIELDS = [
  "name", "description", "stack", "architecture",
  "conventions", "commands", "structure", "notes",
] as const;

interface Props {
  onClose: () => void;
}

interface FieldMeta {
  i18n: TranslationKey;
  placeholder: string;
  icon: ReactNode;
}

const FIELD_META: Record<string, FieldMeta> = {
  name:         { i18n: "passportFieldName",         placeholder: "My Project",                                     icon: <FileText size={15} /> },
  description:  { i18n: "passportFieldDescription",  placeholder: "What this project is, what problem it solves...", icon: <BookOpen size={15} /> },
  stack:        { i18n: "passportFieldStack",         placeholder: "TypeScript, React, Node.js...",                  icon: <Cpu size={15} /> },
  architecture: { i18n: "passportFieldArchitecture",  placeholder: "Layers, modules, patterns, data flow...",        icon: <Layers size={15} /> },
  conventions:  { i18n: "passportFieldConventions",   placeholder: "Naming conventions, patterns, rules...",         icon: <ScrollText size={15} /> },
  commands:     { i18n: "passportFieldCommands",      placeholder: "pnpm dev \u2014 start dev server\npnpm test \u2014 run tests", icon: <Terminal size={15} /> },
  structure:    { i18n: "passportFieldStructure",     placeholder: "src/ \u2014 source code\ndocs/ \u2014 documentation",         icon: <FolderTree size={15} /> },
  notes:        { i18n: "passportFieldNotes",         placeholder: "Important gotchas, limitations...",              icon: <AlertTriangle size={15} /> },
};

const DEFAULT_SET = new Set<string>(DEFAULT_PASSPORT_FIELDS);

function AutoTextarea({ value, placeholder, onChange, onBlur }: {
  value: string; placeholder: string;
  onChange: (v: string) => void; onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = Math.max(60, Math.min(el.scrollHeight, 200)) + "px";
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); }}
      onBlur={onBlur}
      rows={2}
    />
  );
}

export function PassportModal({ onClose }: Props) {
  const { passport, setPassportField, deletePassportField, llmLoading, currentProject } = useAppStore();
  const hasLlmAccess = useAppStore((s) => s.hasLlmAccess)();
  const [values, setValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState("");
  const t = useT();

  useEffect(() => {
    setValues({ ...passport });
  }, [passport]);

  const fieldKeys = useMemo(() => {
    const keys: string[] = [...DEFAULT_PASSPORT_FIELDS];
    for (const key of Object.keys(passport)) {
      if (!DEFAULT_SET.has(key) && !INTERNAL_PASSPORT_KEYS.has(key)) {
        keys.push(key);
      }
    }
    return keys;
  }, [passport]);

  const handleBlur = (key: string) => {
    const newVal = (values[key] ?? "").trim();
    const oldVal = (passport[key] ?? "").trim();
    if (newVal !== oldVal) setPassportField(key, newVal);
  };

  const handleGenerate = async () => {
    if (!hasLlmAccess || !currentProject?.token) return;
    setGenerating(true);
    try { await useAppStore.getState().generatePassport(); }
    finally { setGenerating(false); }
  };

  const handleAddField = () => {
    const key = newFieldKey.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key || INTERNAL_PASSPORT_KEYS.has(key) || key in values) return;
    setValues((v) => ({ ...v, [key]: "" }));
    setPassportField(key, "");
    setNewFieldKey("");
    setAddingField(false);
  };

  const handleDeleteField = (key: string) => {
    deletePassportField(key);
    setValues((v) => { const { [key]: _, ...rest } = v; return rest; });
  };

  // Count filled fields
  const filledCount = fieldKeys.filter((k) => (values[k] ?? "").trim()).length;

  return createPortal(
    <div className="modal-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="modal passport-modal" onClick={(e) => e.stopPropagation()}>
        <div className="passport-header">
          <h3>{t("llmPassport")}</h3>
          <span className="passport-counter">{filledCount}/{fieldKeys.length}</span>
        </div>
        <p className="passport-hint">{t("passportHint")}</p>

        <div className="passport-fields-scroll">
          {fieldKeys.map((key) => {
            const isDefault = DEFAULT_SET.has(key);
            const meta = FIELD_META[key];
            const label = meta ? t(meta.i18n) : key;
            const placeholder = meta?.placeholder || "";
            const icon = meta?.icon || <Tag size={15} />;
            const isName = key === "name";
            const hasValue = !!(values[key] ?? "").trim();

            return (
              <div key={key} className={`passport-field${hasValue ? " passport-field--filled" : ""}`}>
                <div className="passport-field-header">
                  <span className="passport-field-icon">{icon}</span>
                  <label>{label}</label>
                  {!isDefault && (
                    <button
                      className="passport-field-delete"
                      onClick={() => handleDeleteField(key)}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                {isName ? (
                  <input
                    type="text"
                    value={values[key] ?? ""}
                    placeholder={placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                    onBlur={() => handleBlur(key)}
                  />
                ) : (
                  <AutoTextarea
                    value={values[key] ?? ""}
                    placeholder={placeholder}
                    onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
                    onBlur={() => handleBlur(key)}
                  />
                )}
              </div>
            );
          })}

          {addingField ? (
            <div className="passport-add-inline">
              <input
                type="text"
                value={newFieldKey}
                placeholder={t("passportNewFieldPlaceholder")}
                onChange={(e) => setNewFieldKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddField();
                  if (e.key === "Escape") setAddingField(false);
                }}
                autoFocus
              />
              <button className="btn btn-secondary btn-sm" onClick={handleAddField}>OK</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setAddingField(false)}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button className="passport-add-btn" onClick={() => setAddingField(true)}>
              <Plus size={14} /> {t("passportAddField")}
            </button>
          )}
        </div>

        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={handleGenerate}
            disabled={generating || !hasLlmAccess || llmLoading}
            title={!hasLlmAccess ? t("needApiKey") : ""}
          >
            {generating
              ? <><Loader2 size={14} className="llm-spinner" /> {t("generating")}</>
              : <><Sparkles size={14} /> {t("generate")}</>}
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
