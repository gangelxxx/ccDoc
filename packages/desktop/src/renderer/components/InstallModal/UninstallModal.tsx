import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

type Step = { step: string; status: string; detail?: string; removed?: string[] };
type Phase = "idle" | "running" | "done" | "error";

export function UninstallModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const currentProject = useAppStore((s) => s.currentProject);
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cleanup = window.api.onInstallProgress((data: any) => {
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.step === data.step);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data;
          return next;
        }
        return [...prev, data];
      });
      if (data.removed) setRemoved(data.removed);
      if (data.status === "error") {
        setPhase("error");
        setError(data.detail || "Unknown error");
      }
    });
    return cleanup;
  }, []);

  const runUninstall = useCallback(async () => {
    if (!currentProject) return;
    setPhase("running");
    setSteps([]);
    setRemoved([]);
    setError(null);
    try {
      await window.api.uninstallClaudePlugin(currentProject.token);
      setPhase("done");
    } catch (err: any) {
      setPhase("error");
      setError(err?.message || String(err));
    }
  }, [currentProject]);

  const stepLabel = (step: string) => {
    switch (step) {
      case "project": return t("installStepProject");
      case "uninstall": return t("installStepRemoving");
      default: return step;
    }
  };

  const stepIcon = (status: string) => {
    switch (status) {
      case "done": return "\u2705";
      case "running": return "\u23F3";
      case "error": return "\u274C";
      default: return "\u2B55";
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal install-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("excludePluginTitle")}</h3>

        {phase === "idle" && (
          <div className="install-idle">
            <p
              className="install-description"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t("excludePluginDesc", currentProject?.name ?? "")) }}
            />
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={runUninstall}>{t("excludeBtn")}</button>
              <button className="btn" onClick={onClose}>{t("cancel")}</button>
            </div>
          </div>
        )}

        {(phase === "running" || phase === "done" || phase === "error") && (
          <div className="install-progress">
            <div className="install-steps">
              {steps.map((s) => (
                <div key={s.step} className={`install-step ${s.status}`}>
                  <span className="install-step-icon">{stepIcon(s.status)}</span>
                  <span className="install-step-label">{stepLabel(s.step)}</span>
                  {s.detail && <span className="install-step-detail">{s.detail}</span>}
                </div>
              ))}
            </div>

            {phase === "done" && removed.length > 0 && (
              <div className="install-report">
                <div className="install-report-header">{t("removedItems", removed.length)}</div>
                <ul className="install-files-list">
                  {removed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {phase === "error" && error && (
              <div className="install-error">{error}</div>
            )}

            <div className="modal-actions">
              {phase === "running" ? (
                <button className="btn" disabled>{t("removing")}</button>
              ) : (
                <button className="btn btn-primary" onClick={onClose}>{t("close")}</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
