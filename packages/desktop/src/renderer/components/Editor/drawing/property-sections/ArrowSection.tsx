import type { SectionProps } from "./shared.js";
import { useT } from "../../../../i18n.js";

interface ArrowSectionProps extends SectionProps {
  hasLines: boolean;
  hasArrows: boolean;
}

export function ArrowSection({ firstEl, updateSelectedProps, hasLines, hasArrows }: ArrowSectionProps) {
  const t = useT();

  return (
    <>
      {/* Line/Arrow type */}
      {hasLines && (
        <>
          <div className="drawing-sidebar-label">{t("drawLineType")}</div>
          <div className="drawing-sidebar-row">
            {(["sharp", "round", "elbow"] as const).map((lt) => (
              <button
                key={lt}
                className={`drawing-tool-btn${firstEl?.arrowType === lt ? " active" : ""}`}
                onClick={() => updateSelectedProps({ arrowType: lt })}
                title={lt === "sharp" ? t("drawStraight") : lt === "round" ? t("drawCurved") : t("drawElbow")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  {lt === "sharp" && <path d="M3 15L15 3" stroke="currentColor" strokeWidth="1.5" fill="none" />}
                  {lt === "round" && <path d="M3 15Q9 3 15 3" stroke="currentColor" strokeWidth="1.5" fill="none" />}
                  {lt === "elbow" && <path d="M3 15L3 3L15 3" stroke="currentColor" strokeWidth="1.5" fill="none" />}
                </svg>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Arrowheads (arrows only) */}
      {hasArrows && (
        <>
          <div className="drawing-sidebar-label">{t("drawArrowEnd")}</div>
          <div className="drawing-sidebar-row">
            {([null, "arrow"] as const).map((ah) => (
              <button
                key={String(ah)}
                className={`drawing-tool-btn${firstEl?.arrowhead === ah ? " active" : ""}`}
                onClick={() => updateSelectedProps({ arrowhead: ah })}
                title={ah ? t("drawWithArrowhead") : t("drawNoArrowhead")}
              >
                <svg width="18" height="12" viewBox="0 0 18 12">
                  {ah ? (
                    <><line x1="0" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.5" /><path d="M12 6L18 2M12 6L18 10" stroke="currentColor" strokeWidth="1.5" fill="none" /></>
                  ) : (
                    <><line x1="0" y1="6" x2="16" y2="6" stroke="currentColor" strokeWidth="1.5" /><line x1="14" y1="6" x2="16" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>
                  )}
                </svg>
              </button>
            ))}
          </div>
          <div className="drawing-sidebar-label">{t("drawArrowStart")}</div>
          <div className="drawing-sidebar-row">
            {([null, "arrow"] as const).map((ah) => (
              <button
                key={"start-" + String(ah)}
                className={`drawing-tool-btn${firstEl?.startArrowhead === ah ? " active" : ""}`}
                onClick={() => updateSelectedProps({ startArrowhead: ah })}
                title={ah ? t("drawWithArrowhead") : t("drawNoArrowhead")}
              >
                <svg width="18" height="12" viewBox="0 0 18 12">
                  {ah ? (
                    <><line x1="6" y1="6" x2="18" y2="6" stroke="currentColor" strokeWidth="1.5" /><path d="M6 6L0 2M6 6L0 10" stroke="currentColor" strokeWidth="1.5" fill="none" /></>
                  ) : (
                    <><line x1="0" y1="6" x2="16" y2="6" stroke="currentColor" strokeWidth="1.5" /><line x1="0" y1="6" x2="2" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>
                  )}
                </svg>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
