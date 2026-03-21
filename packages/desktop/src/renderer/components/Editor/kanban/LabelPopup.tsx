import { useT } from "../../../i18n.js";
import { LABEL_COLORS } from "./utils.js";

export function LabelPopup({
  labels,
  onToggle,
  onClose,
}: {
  labels: string[];
  onToggle: (color: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="kanban-label-popup" onClick={(e) => e.stopPropagation()}>
      {LABEL_COLORS.map((lc) => (
        <div
          key={lc.color}
          className={`kanban-label-option ${labels.includes(lc.color) ? "selected" : ""}`}
          onClick={() => onToggle(lc.color)}
        >
          <span className="kanban-label-swatch" style={{ background: lc.color }} />
          <span>{t(lc.key)}</span>
          {labels.includes(lc.color) && <span className="kanban-label-check">✓</span>}
        </div>
      ))}
      <button className="kanban-label-done" onClick={onClose}>{t("kanbanDone")}</button>
    </div>
  );
}
