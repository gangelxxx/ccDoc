import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

type Step = { step: string; status: string; detail?: string; created?: string[]; updated?: string[] };
type Phase = "idle" | "running" | "done" | "error";

export function InstallModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const currentProject = useAppStore((s) => s.currentProject);
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [created, setCreated] = useState<string[]>([]);
  const [updated, setUpdated] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cleanup = window.api.onInstallProgress((data) => {
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.step === data.step);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data;
          return next;
        }
        return [...prev, data];
      });
      if (data.created) setCreated(data.created);
      if (data.updated) setUpdated(data.updated);
      if (data.status === "error") {
        setPhase("error");
        setError(data.detail || "Unknown error");
      }
    });
    return cleanup;
  }, []);

  const runInstall = useCallback(async () => {
    if (!currentProject) return;
    setPhase("running");
    setSteps([]);
    setCreated([]);
    setUpdated([]);
    setError(null);
    try {
      await window.api.installClaudePlugin(currentProject.token);
      setPhase("done");
    } catch (err: any) {
      setPhase("error");
      setError(err?.message || String(err));
    }
  }, [currentProject]);

  const stepLabel = (step: string) => {
    switch (step) {
      case "project": return t("installStepProject");
      case "mcp": return t("installStepMcp");
      case "install": return t("installStepWriting");
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
        <h3>{t("installPluginTitle")}</h3>

        {phase === "idle" && (
          <div className="install-idle">
            <p
              className="install-description"
              dangerouslySetInnerHTML={{ __html: t("installPluginDesc", currentProject?.name ?? "") }}
            />
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={runInstall}>{t("installBtn")}</button>
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

            {phase === "done" && (created.length > 0 || updated.length > 0) && (
              <div className="install-report">
                {created.length > 0 && (
                  <>
                    <div className="install-report-header">{t("createdFiles", created.length)}</div>
                    <ul className="install-files-list">
                      {created.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
                {updated.length > 0 && (
                  <>
                    <div className="install-report-header">{t("updatedFiles", updated.length)}</div>
                    <ul className="install-files-list">
                      {updated.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {phase === "error" && error && (
              <div className="install-error">{error}</div>
            )}

            <div className="modal-actions">
              {phase === "running" ? (
                <button className="btn" disabled>{t("installing")}</button>
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
