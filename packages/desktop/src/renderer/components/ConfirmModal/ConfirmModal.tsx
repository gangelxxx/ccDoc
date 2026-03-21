import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { AlertTriangle } from "lucide-react";

export function ConfirmModal() {
  const { confirmModal, closeConfirm } = useAppStore();
  const t = useT();

  useEffect(() => {
    if (!confirmModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConfirm(false);
      if (e.key === "Enter") closeConfirm(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [confirmModal, closeConfirm]);

  if (!confirmModal) return null;

  return createPortal(
    <div className="modal-overlay" onClick={() => closeConfirm(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: confirmModal.danger ? 400 : undefined }}>
        {confirmModal.danger ? (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <AlertTriangle size={24} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
            <div>
              {confirmModal.title && <h3 style={{ margin: 0 }}>{confirmModal.title}</h3>}
              <p style={{ margin: confirmModal.title ? "8px 0 0" : "0 0 16px", color: confirmModal.title ? "var(--text-secondary)" : undefined, fontSize: confirmModal.title ? 13 : undefined, lineHeight: 1.5 }}>
                {confirmModal.message}
              </p>
            </div>
          </div>
        ) : (
          <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>{confirmModal.message}</p>
        )}
        <div className="modal-actions">
          <button className={confirmModal.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => closeConfirm(true)} autoFocus>
            {confirmModal.danger ? t("delete") : t("ok")}
          </button>
          <button className="btn" onClick={() => closeConfirm(false)}>
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
