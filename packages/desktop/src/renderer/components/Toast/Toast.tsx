import { useAppStore } from "../../stores/app.store.js";

const ICONS: Record<string, string> = {
  success: "\u2713",
  error: "\u2715",
  info: "\u24D8",
  warning: "\u26A0",
};

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className={`toast-icon ${t.type}`}>{ICONS[t.type]}</span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-message">{t.message}</div>}
          </div>
          <button className="toast-close" onClick={() => removeToast(t.id)}>
            {"\u2715"}
          </button>
        </div>
      ))}
    </div>
  );
}
