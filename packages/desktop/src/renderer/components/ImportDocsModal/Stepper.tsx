import { useT } from "../../i18n.js";
import { STEP_KEYS, PHASE_INDEX, type Phase } from "./types.js";

export function Stepper({ currentPhase }: { currentPhase: Phase }) {
  const currentIdx = PHASE_INDEX[currentPhase];
  const t = useT();

  return (
    <div className="import-docs-stepper">
      {STEP_KEYS.map((step, i) => (
        <span key={step.key} style={{ display: "contents" }}>
          {i > 0 && (
            <div className={`import-docs-stepper-line${i <= currentIdx ? " completed" : ""}`} />
          )}
          <div className="import-docs-stepper-step">
            <div className={`import-docs-stepper-circle${i === currentIdx ? " active" : ""}${i < currentIdx ? " completed" : ""}`}>
              {i < currentIdx ? "\u2713" : i + 1}
            </div>
            <div className={`import-docs-stepper-label${i === currentIdx ? " active" : ""}`}>
              {t(step.labelKey)}
            </div>
          </div>
        </span>
      ))}
    </div>
  );
}
