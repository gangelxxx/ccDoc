import { useState, useRef, useCallback, useEffect } from "react";
import { Eye, EyeOff, Key, FlaskConical, Code2, Loader2, CheckCircle2, XCircle, Clock, ChevronDown } from "lucide-react";
import { useT } from "../../i18n.js";
import type { ModelTier, ModelTierConfig, ProviderScriptMeta, ModelTestResult } from "../../stores/types.js";
import type { LlmEffort } from "../../stores/types.js";
import { EFFORT_PRESETS } from "../../stores/llm-config.js";


interface ModelTierFormProps {
  tier: ModelTier;
  config: ModelTierConfig;
  onChange: (patch: Partial<ModelTierConfig>) => void;
  builtinScripts: ProviderScriptMeta[];
  onViewCode: (config: ModelTierConfig) => void;
}

const TIER_COLORS: Record<ModelTier, string> = {
  strong: "#ef4444",
  medium: "#f59e0b",
  weak: "#22c55e",
};

const TIER_LABELS: Record<ModelTier, string> = {
  strong: "tierStrong",
  medium: "tierMedium",
  weak: "tierWeak",
};

const TIER_DESCS: Record<ModelTier, string> = {
  strong: "tierStrongDesc",
  medium: "tierMediumDesc",
  weak: "tierWeakDesc",
};

const DEFAULT_URLS: Record<string, string> = {
  "anthropic-oauth": "https://api.anthropic.com",
  "anthropic-apikey": "https://api.anthropic.com",
  "openai": "https://api.openai.com/v1",
  "openrouter": "https://openrouter.ai/api/v1",
  "ollama": "http://127.0.0.1:11434",
};

const STAGE_LABELS: Record<string, string> = {
  // Base
  connection: "tierTestConnection",
  tool_selection: "tierTestToolSelection",
  tool_params: "tierTestToolParams",
  param_types: "tierTestParamTypes",
  error_recovery: "tierTestErrorRecovery",
  multi_turn: "tierTestMultiTurn",
  structured_output: "tierTestStructuredOutput",
  instruction_following: "tierTestInstructionFollowing",
  // Light
  light_basic_tool: "tierTestLightBasicTool",
  light_short_answer: "tierTestLightShortAnswer",
  light_thinking: "tierTestLightThinking",
  // Medium
  medium_multi_tool: "tierTestMediumMultiTool",
  medium_long_output: "tierTestMediumLongOutput",
  medium_param_sensitivity: "tierTestMediumParamSensitivity",
  // Heavy
  heavy_doc_generation: "tierTestHeavyDocGeneration",
  heavy_doc_restructure: "tierTestHeavyDocRestructure",
  heavy_completeness: "tierTestHeavyCompleteness",
  heavy_architecture: "tierTestHeavyArchitecture",
};

type TestDifficulty = "base" | "light" | "medium" | "heavy";

const BASE_STAGES = ["connection", "tool_selection", "tool_params", "param_types", "error_recovery", "multi_turn", "structured_output", "instruction_following"] as const;
const LIGHT_STAGES = ["light_basic_tool", "light_short_answer", "light_thinking"] as const;
const MEDIUM_STAGES = ["medium_multi_tool", "medium_long_output", "medium_param_sensitivity"] as const;
const HEAVY_STAGES = ["heavy_doc_generation", "heavy_doc_restructure", "heavy_completeness", "heavy_architecture"] as const;

const DIFFICULTY_STAGES: Record<TestDifficulty, readonly string[]> = {
  base: BASE_STAGES,
  light: LIGHT_STAGES,
  medium: MEDIUM_STAGES,
  heavy: HEAVY_STAGES,
};

const DIFFICULTY_COLORS: Record<TestDifficulty, string> = {
  base: "#60a5fa",
  light: "#22c55e",
  medium: "#f59e0b",
  heavy: "#ef4444",
};

const ALL_DIFFICULTIES: TestDifficulty[] = ["base", "light", "medium", "heavy"];

// ─── Model Combobox ────────────────────────────────────────

interface ModelInfoItem {
  id: string;
  name: string;
  contextLength?: number;
  maxOutput?: number;
  supportsThinking?: boolean;
  supportsToolUse?: boolean;
  supportedParams?: string[];
}

function ModelCombobox({
  config,
  onChange,
  onModelInfo,
}: {
  config: ModelTierConfig;
  onChange: (patch: Partial<ModelTierConfig>) => void;
  onModelInfo?: (info: ModelInfoItem | null) => void;
}) {
  const t = useT();
  const [models, setModels] = useState<ModelInfoItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.llmTierListModels(config);
      if (Array.isArray(result) && result.length > 0) {
        setModels(result);
        setOpen(true);
        setFilter("");
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        setError(t("tierModelsEmpty" as any) || "No models found");
      }
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }, [config, t]);

  const handleSelect = (id: string) => {
    const model = models?.find(m => m.id === id);
    const patch: Partial<ModelTierConfig> = { modelId: id };

    if (model) {
      // Auto-disable thinking if model doesn't support it
      if (model.supportsThinking === false && config.thinking) {
        patch.thinking = false;
      }
      // Auto-set maxTokens from model capabilities
      if (model.maxOutput && config.maxTokens > model.maxOutput) {
        patch.maxTokens = model.maxOutput;
      }
    }

    onChange(patch);
    if (onModelInfo) onModelInfo(model || null);
    setOpen(false);
    setFilter("");
  };

  const filtered = models?.filter((m) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  }) ?? [];

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="text"
          className="llm-settings-input"
          style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
          value={config.modelId}
          onChange={(e) => onChange({ modelId: e.target.value })}
          placeholder="model-id"
        />
        <button
          className="btn-icon"
          onClick={loadModels}
          disabled={loading}
          title={t("tierLoadModels" as any) || "Load models"}
          style={{ flexShrink: 0 }}
        >
          {loading ? (
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: "var(--error, #c00)", marginTop: 4 }}>{error}</div>
      )}
      {open && models && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--bg-sidebar)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            marginTop: 4,
            maxHeight: 260,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <input
              ref={inputRef}
              type="text"
              className="llm-settings-input"
              style={{ marginBottom: 0, fontSize: 12 }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`${t("search")}... (${models.length})`}
            />
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: "8px 12px", fontSize: 12, opacity: 0.5 }}>
                {t("noResults" as any) || "No results"}
              </div>
            )}
            {filtered.map((m) => (
              <div
                key={m.id}
                onClick={() => handleSelect(m.id)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                  background: m.id === config.modelId ? "rgba(100,200,150,0.15)" : undefined,
                  borderBottom: "1px solid var(--border)",
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(100,200,150,0.1)"; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = m.id === config.modelId ? "rgba(100,200,150,0.15)" : ""; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: m.id === config.modelId ? 600 : 400, flex: 1 }}>{m.name}</span>
                  {m.supportsThinking && <span title="Thinking" style={{ fontSize: 9, opacity: 0.6 }}>think</span>}
                  {m.supportsToolUse && <span title="Tool Use" style={{ fontSize: 9, opacity: 0.6 }}>tools</span>}
                  {m.contextLength && <span style={{ fontSize: 9, opacity: 0.4 }}>{Math.round(m.contextLength / 1000)}K</span>}
                </div>
                {m.id !== m.name && (
                  <div style={{ fontSize: 10, opacity: 0.5 }}>{m.id}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stage indicator row ────────────────────────────────────

function StageRow({ stage, result, isRunning, t }: { stage: string; result?: ModelTestResult; isRunning: boolean; t: (k: any) => string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        padding: "4px 8px",
        borderRadius: 4,
        background: result ? (result.success ? "rgba(22,163,106,0.1)" : "rgba(204,0,0,0.1)") : undefined,
      }}
    >
      {result?.success ? (
        <CheckCircle2 size={16} style={{ color: "var(--success, #16a34a)", flexShrink: 0 }} />
      ) : result?.success === false ? (
        <XCircle size={16} style={{ color: "var(--error, #c00)", flexShrink: 0 }} />
      ) : isRunning ? (
        <Loader2 size={16} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
      ) : (
        <Clock size={16} style={{ opacity: 0.25, flexShrink: 0 }} />
      )}
      <span style={{ flex: 1 }}>{t(STAGE_LABELS[stage] as any)}</span>
      {result && (
        <span style={{ opacity: 0.5, fontSize: 11 }}>{result.latencyMs}ms</span>
      )}
      {result?.error && (
        <span style={{ color: "var(--error, #c00)", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {result.error}
        </span>
      )}
    </div>
  );
}

// ─── Test Modal ─────────────────────────────────────────────

function TestModal({
  tier,
  config,
  onClose,
}: {
  tier: ModelTier;
  config: ModelTierConfig;
  onClose: () => void;
}) {
  const t = useT();
  const [results, setResults] = useState<ModelTestResult[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [enabledLevels, setEnabledLevels] = useState<Set<TestDifficulty>>(new Set(["base"]));

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const toggleLevel = (level: TestDifficulty) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  // Build active stages list from enabled checkboxes
  const activeStages: string[] = [];
  for (const d of ALL_DIFFICULTIES) {
    if (enabledLevels.has(d)) activeStages.push(...DIFFICULTY_STAGES[d]);
  }

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setCurrentStage(null);
    setLog([]);
    addLog(`${t("tierTest")}: ${config.providerScript.builtinId || "custom"} / ${config.modelId}`);
    addLog(`Endpoint: ${config.baseUrl}`);
    const hasExtended = enabledLevels.has("light") || enabledLevels.has("medium") || enabledLevels.has("heavy");
    if (hasExtended) {
      addLog(`Config: maxTokens=${config.maxTokens}, temp=${config.temperature}, thinking=${config.thinking ? "on(" + config.thinkingBudget + ")" : "off"}`);
    }
    addLog("---");

    const collected: ModelTestResult[] = [];
    const stages: string[] = [];
    for (const d of ALL_DIFFICULTIES) {
      if (enabledLevels.has(d)) stages.push(...DIFFICULTY_STAGES[d]);
    }

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const stageName = t(STAGE_LABELS[stage] as any);
      const stageIdx = i + 1;

      setCurrentStage(stage);
      addLog(`[${stageIdx}/${stages.length}] ${stageName}...`);

      try {
        const result: ModelTestResult = await window.api.llmTestStage(config, stage);
        collected.push(result);
        setResults([...collected]);

        if (result.success) {
          addLog(`[${stageIdx}/${stages.length}] ${stageName} — ${t("tierTestSuccess")} (${result.latencyMs}ms)${result.details ? " — " + result.details : ""}`);
        } else {
          addLog(`[${stageIdx}/${stages.length}] ${stageName} — ${t("tierTestFailed")}: ${result.error || "unknown"}${result.details ? "\n    " + result.details.slice(0, 200) : ""}`);
        }

        if (stage === "connection" && !result.success) break;
      } catch (e: any) {
        const errResult: ModelTestResult = { stage: stage as any, success: false, latencyMs: 0, error: e.message };
        collected.push(errResult);
        setResults([...collected]);
        addLog(`[${stageIdx}/${stages.length}] ${stageName} — ${t("tierTestFailed")}: ${e.message}`);
        if (stage === "connection") break;
      }
    }

    setCurrentStage(null);
    const passed = collected.filter((r) => r.success).length;
    const total = collected.length;
    addLog("---");
    addLog(`${passed}/${total} — ${passed === total ? t("tierTestSuccess") : t("tierTestFailed")}`);
    setRunning(false);
  }, [config, addLog, t, enabledLevels]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 640, width: "90vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 12px" }}>
          {t("tierTest")} — {t(TIER_LABELS[tier] as any)}
        </h3>

        {/* Config summary */}
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
          {config.providerScript.builtinId || "custom"} / {config.modelId} / {config.baseUrl}
        </div>

        {/* Difficulty level checkboxes */}
        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          {ALL_DIFFICULTIES.map((level) => (
            <label
              key={level}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                cursor: running ? "default" : "pointer",
                opacity: running ? 0.5 : 1,
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid " + (enabledLevels.has(level) ? DIFFICULTY_COLORS[level] : "var(--border)"),
                background: enabledLevels.has(level) ? DIFFICULTY_COLORS[level] + "18" : undefined,
              }}
            >
              <input
                type="checkbox"
                checked={enabledLevels.has(level)}
                onChange={() => toggleLevel(level)}
                disabled={running}
                style={{ margin: 0 }}
              />
              <span style={{ color: enabledLevels.has(level) ? DIFFICULTY_COLORS[level] : undefined, fontWeight: enabledLevels.has(level) ? 600 : 400 }}>
                {t(("tierTestLevel_" + level) as any)}
              </span>
            </label>
          ))}
        </div>

        {/* Config params note for extended tests */}
        {(enabledLevels.has("light") || enabledLevels.has("medium") || enabledLevels.has("heavy")) && (
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8, fontStyle: "italic" }}>
            {t("tierTestConfigNote" as any)}: maxTokens={config.maxTokens}, temp={config.temperature}, thinking={config.thinking ? "on(" + config.thinkingBudget + ")" : "off"}
          </div>
        )}

        {/* Stage indicators grouped */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 12, maxHeight: 300, overflow: "auto" }}>
          {ALL_DIFFICULTIES.map((level, idx) =>
            enabledLevels.has(level) ? (
              <div key={level}>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: DIFFICULTY_COLORS[level], textTransform: "uppercase",
                  padding: idx === 0 ? "4px 8px" : "6px 8px 2px",
                  borderTop: idx > 0 ? "1px solid var(--border)" : undefined,
                  marginTop: idx > 0 ? 4 : 0,
                }}>
                  {t(("tierTestLevel_" + level) as any)}
                </div>
                {DIFFICULTY_STAGES[level].map((stage) => (
                  <StageRow key={stage} stage={stage as string} result={results.find((r) => r.stage === stage)} isRunning={currentStage === stage} t={t} />
                ))}
              </div>
            ) : null
          )}
        </div>

        {/* Log output */}
        <div
          ref={logRef}
          style={{
            background: "var(--bg-sidebar)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 10,
            fontSize: 11,
            fontFamily: "monospace",
            lineHeight: 1.6,
            maxHeight: 180,
            minHeight: 60,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {log.length === 0 && !running && (
            <span style={{ opacity: 0.4 }}>{t("tierTestPending")}</span>
          )}
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>

        {/* Actions */}
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={handleRun}
            disabled={running}
            style={{ marginRight: "auto" }}
          >
            {running && <Loader2 size={14} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} />}
            {t("tierTest")} ({activeStages.length})
          </button>
          <button className="btn" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main form ──────────────────────────────────────────────

export function ModelTierForm({
  tier,
  config,
  onChange,
  builtinScripts,
  onViewCode,
}: ModelTierFormProps) {
  const t = useT();
  const [showKey, setShowKey] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [modelCaps, setModelCaps] = useState<ModelInfoItem | null>(null);

  // Remember API keys per provider so switching doesn't lose them
  const savedKeysRef = useRef<Record<string, string>>({});
  // Initialize with current provider's key
  const currentProviderId = config.providerScript.builtinId || "";
  if (config.apiKey && currentProviderId) {
    savedKeysRef.current[currentProviderId] = config.apiKey;
  }

  const isOAuth = currentProviderId.includes("oauth");

  const handleSetupOAuth = async () => {
    setSetupLoading(true);
    try {
      const result = await window.api.llmSetupToken();
      if (result.ok && result.key) {
        onChange({ apiKey: result.key });
      }
    } catch (err) {
      console.error("setup-token error:", err);
    } finally {
      setSetupLoading(false);
    }
  };

  const handleScriptChange = (builtinId: string) => {
    // Save current key before switching
    const oldId = config.providerScript.builtinId || "";
    if (oldId && config.apiKey) {
      savedKeysRef.current[oldId] = config.apiKey;
    }
    // Restore saved key for new provider (or empty)
    const savedKey = savedKeysRef.current[builtinId] || "";
    const defaultUrl = DEFAULT_URLS[builtinId] || "";
    onChange({
      providerScript: { type: "builtin", builtinId },
      baseUrl: defaultUrl,
      apiKey: savedKey,
      modelId: "",
    });
    setModelCaps(null);
  };

  return (
    <div className="settings-accordion" style={{ borderLeft: `3px solid ${TIER_COLORS[tier]}` }}>
      <div style={{ padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <strong>{t(TIER_LABELS[tier] as any)}</strong>
            <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{t(TIER_DESCS[tier] as any)}</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className="btn-icon"
              onClick={() => onViewCode(config)}
              title={t("providerViewCode")}
            >
              <Code2 size={14} />
            </button>
            <button
              className="btn-icon"
              onClick={() => setTestModalOpen(true)}
              title={t("tierTest")}
            >
              <FlaskConical size={14} />
            </button>
          </div>
        </div>

        {/* Provider script */}
        <label className="llm-settings-label">{t("providerScript")}</label>
        <select
          className="llm-settings-input llm-model-select"
          value={config.providerScript.builtinId || ""}
          onChange={(e) => handleScriptChange(e.target.value)}
        >
          {builtinScripts.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Model ID */}
        <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("tierModelId")}</label>
        <ModelCombobox config={config} onChange={onChange} onModelInfo={setModelCaps} />

        {/* Base URL */}
        <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("tierBaseUrl")}</label>
        <input
          type="text"
          className="llm-settings-input"
          value={config.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder="https://api.anthropic.com"
        />

        {/* API Key */}
        <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("tierApiKey")}</label>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type={showKey ? "text" : "password"}
            className="llm-settings-input"
            style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
            value={config.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder="sk-ant-..."
          />
          <button
            className="btn-icon"
            onClick={() => setShowKey((v) => !v)}
            title={showKey ? t("hideApiKey") : t("showApiKey")}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {isOAuth && (
            <button
              className="btn-icon"
              onClick={handleSetupOAuth}
              disabled={setupLoading}
              title={t("tierSetupOAuth")}
            >
              <Key size={14} />
            </button>
          )}
        </div>

        {/* Effort */}
        <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("tierEffort")}</label>
        <div className="llm-effort-row">
          {(["low", "medium", "high"] as LlmEffort[]).map((level) => (
            <button
              key={level}
              className={`llm-effort-btn${config.effort === level ? " active" : ""}`}
              onClick={() => onChange({ effort: level, ...EFFORT_PRESETS[level] })}
            >
              {level === "low" ? "Low" : level === "medium" ? "Medium" : "High"}
            </button>
          ))}
        </div>

        {/* Thinking */}
        <div className="llm-thinking-row" style={{ marginTop: 8 }}>
          <label className="llm-thinking-toggle" style={{ opacity: modelCaps?.supportsThinking === false ? 0.4 : 1 }}>
            <input
              type="checkbox"
              checked={config.thinking}
              onChange={(e) => onChange({ thinking: e.target.checked })}
              disabled={modelCaps?.supportsThinking === false}
            />
            {t("tierThinking")}
            {modelCaps?.supportsThinking === false && (
              <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 6 }}>({t("tierNotSupported" as any) || "not supported"})</span>
            )}
          </label>
        </div>
        {config.thinking && (
          <div style={{ marginTop: 4 }}>
            <label className="llm-settings-label">{t("tierThinkingBudget")}</label>
            <input
              type="number"
              className="llm-settings-input"
              value={config.thinkingBudget}
              onChange={(e) => onChange({ thinkingBudget: Number(e.target.value) || 5000 })}
              min={1000}
              max={100000}
              step={1000}
            />
          </div>
        )}

        {/* Max tokens */}
        <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("tierMaxTokens")}</label>
        <input
          type="number"
          className="llm-settings-input"
          value={config.maxTokens}
          onChange={(e) => onChange({ maxTokens: Number(e.target.value) || 4096 })}
          min={256}
          max={65536}
          step={256}
        />

        {/* Temperature */}
        <label className="llm-settings-label" style={{ marginTop: 8 }}>{t("tierTemperature")}</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={config.temperature}
            onChange={(e) => onChange({ temperature: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, minWidth: 28, textAlign: "right" }}>{config.temperature}</span>
        </div>
      </div>

      {/* Test modal */}
      {testModalOpen && (
        <TestModal
          tier={tier}
          config={config}
          onClose={() => setTestModalOpen(false)}
        />
      )}
    </div>
  );
}
