import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

// --- Passport Generating Modal ---
export function PassportGeneratingModal({ onClose }: { onClose: () => void }) {
  const bgTasks = useAppStore((s) => s.bgTasks);
  const tl = useT();
  const isGenerating = bgTasks.some((t) => t.label === "Генерация паспорта проекта");

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 340, maxWidth: 400, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        {isGenerating ? (
          <>
            <Loader2 size={32} className="llm-spinner" style={{ margin: "16px auto 12px" }} />
            <p style={{ margin: "0 0 20px", opacity: 0.8 }}>{tl("passportGenerating")}</p>
          </>
        ) : (
          <p style={{ margin: "16px 0 20px" }}>{tl("passportGenerated")}</p>
        )}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>{tl("closeBtn")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
