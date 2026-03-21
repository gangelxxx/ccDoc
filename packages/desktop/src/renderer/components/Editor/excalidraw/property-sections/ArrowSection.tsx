import type { SectionProps } from "./shared.js";

interface ArrowSectionProps extends SectionProps {
  hasLines: boolean;
  hasArrows: boolean;
}

export function ArrowSection({ firstEl, updateSelectedProps, hasLines, hasArrows }: ArrowSectionProps) {
  return (
    <>
      {/* Line/Arrow type */}
      {hasLines && (
        <>
          <div className="excalidraw-sidebar-label">Тип линии</div>
          <div className="excalidraw-sidebar-row">
            {(["sharp", "round", "elbow"] as const).map((t) => (
              <button
                key={t}
                className={`excalidraw-tool-btn${firstEl?.arrowType === t ? " active" : ""}`}
                onClick={() => updateSelectedProps({ arrowType: t })}
                title={t === "sharp" ? "Прямая" : t === "round" ? "Кривая" : "Ломаная"}
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  {t === "sharp" && <path d="M3 15L15 3" stroke="currentColor" strokeWidth="1.5" fill="none" />}
                  {t === "round" && <path d="M3 15Q9 3 15 3" stroke="currentColor" strokeWidth="1.5" fill="none" />}
                  {t === "elbow" && <path d="M3 15L3 3L15 3" stroke="currentColor" strokeWidth="1.5" fill="none" />}
                </svg>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Arrowheads (arrows only) */}
      {hasArrows && (
        <>
          <div className="excalidraw-sidebar-label">Конец стрелки</div>
          <div className="excalidraw-sidebar-row">
            {([null, "arrow"] as const).map((ah) => (
              <button
                key={String(ah)}
                className={`excalidraw-tool-btn${firstEl?.arrowhead === ah ? " active" : ""}`}
                onClick={() => updateSelectedProps({ arrowhead: ah })}
                title={ah ? "Со стрелкой" : "Без стрелки"}
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
          <div className="excalidraw-sidebar-label">Начало стрелки</div>
          <div className="excalidraw-sidebar-row">
            {([null, "arrow"] as const).map((ah) => (
              <button
                key={"start-" + String(ah)}
                className={`excalidraw-tool-btn${firstEl?.startArrowhead === ah ? " active" : ""}`}
                onClick={() => updateSelectedProps({ startArrowhead: ah })}
                title={ah ? "Со стрелкой" : "Без стрелки"}
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
