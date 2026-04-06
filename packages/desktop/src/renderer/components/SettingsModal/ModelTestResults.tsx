import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useT } from "../../i18n.js";
import type { ModelTestResult } from "../../stores/types.js";

const STAGE_KEYS: Record<string, string> = {
  connection: "tierTestConnection",
  tool_use: "tierTestToolUse",
  mcp_functions: "tierTestMcpFunctions",
  adequacy: "tierTestAdequacy",
};

const ALL_STAGES = ["connection", "tool_use", "mcp_functions", "adequacy"] as const;

export function ModelTestResults({
  results,
  loading,
}: {
  results: ModelTestResult[] | null;
  loading: boolean;
}) {
  const t = useT();

  if (!loading && !results) return null;

  const completedStages = new Set(results?.map((r) => r.stage) ?? []);

  return (
    <div className="model-test-results" style={{ marginTop: 8 }}>
      {ALL_STAGES.map((stage) => {
        const result = results?.find((r) => r.stage === stage);
        const isRunning = loading && !result && (completedStages.size === 0 || isNextStage(stage, completedStages));
        const isPending = loading && !result && !isRunning;

        return (
          <div
            key={stage}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              padding: "2px 0",
              color: result?.success === false ? "var(--error, #c00)" : undefined,
            }}
          >
            {result?.success ? (
              <CheckCircle2 size={14} style={{ color: "var(--success, #16a34a)", flexShrink: 0 }} />
            ) : result?.success === false ? (
              <XCircle size={14} style={{ color: "var(--error, #c00)", flexShrink: 0 }} />
            ) : isRunning ? (
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
            ) : (
              <Clock size={14} style={{ opacity: 0.3, flexShrink: 0 }} />
            )}
            <span>{t(STAGE_KEYS[stage] as any)}</span>
            {result && (
              <span style={{ marginLeft: "auto", opacity: 0.6 }}>
                {result.latencyMs}ms
              </span>
            )}
            {result?.error && (
              <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 11 }} title={result.details}>
                — {result.error.slice(0, 60)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function isNextStage(stage: string, completed: Set<string>): boolean {
  const idx = ALL_STAGES.indexOf(stage as any);
  if (idx === 0) return completed.size === 0;
  return completed.has(ALL_STAGES[idx - 1]);
}
