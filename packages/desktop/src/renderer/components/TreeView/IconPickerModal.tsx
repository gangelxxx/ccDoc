import { createPortal } from "react-dom";
import { useT } from "../../i18n.js";

const ICON_OPTIONS = [
  null, "\uD83D\uDCC1", "\uD83D\uDCC2", "\uD83D\uDCC4", "\uD83D\uDCDA", "\uD83D\uDCA1",
  "\u00A7", "\u270F\uFE0F", "\u2611\uFE0F", "\uD83D\uDCCA", "\u2B50", "\uD83D\uDD27",
  "\uD83C\uDFAF", "\uD83D\uDE80", "\uD83D\uDCAC", "\uD83C\uDFA8", "\uD83D\uDCC8",
  "\uD83D\uDD12", "\u2764\uFE0F", "\uD83C\uDF1F", "\uD83D\uDEE0\uFE0F", "\uD83C\uDF10",
  "\uD83D\uDCCB", "\u26A1", "\uD83D\uDC1B", "\uD83C\uDFC6", "\uD83D\uDCDD", "\uD83D\uDD0D",
  "\uD83D\uDEA7", "\uD83C\uDFE0",
];

interface IconPickerModalProps {
  sectionId: string;
  onSelect: (sectionId: string, icon: string | null) => void;
  onClose: () => void;
}

export function IconPickerModal({ sectionId, onSelect, onClose }: IconPickerModalProps) {
  const t = useT();

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("chooseIcon")}</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ICON_OPTIONS.map((ic) => (
            <button
              key={ic ?? "default"}
              className="btn btn-sm"
              style={{ width: 36, height: 36, fontSize: 18, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => {
                onSelect(sectionId, ic);
                onClose();
              }}
              title={ic ?? "Default"}
            >
              {ic ?? "\u2205"}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
