import { useT } from "../../../i18n.js";

export function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="kanban-modal-overlay" onClick={onCancel}>
      <div className="kanban-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div className="kanban-confirm-actions">
          <button className="kanban-toolbar-btn kanban-btn-danger" onClick={onConfirm}>{t("kanbanDelete")}</button>
          <button className="kanban-toolbar-btn" onClick={onCancel}>{t("kanbanCancel")}</button>
        </div>
      </div>
    </div>
  );
}
