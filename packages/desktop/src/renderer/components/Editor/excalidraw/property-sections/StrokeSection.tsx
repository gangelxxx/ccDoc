import { STROKE_COLORS, type SectionProps } from "./shared.js";

interface StrokeSectionProps extends SectionProps {
  hasStroke: boolean;
  hasStrokeStyle: boolean;
}

export function StrokeSection({ firstEl, updateSelectedProps, hasStroke, hasStrokeStyle }: StrokeSectionProps) {
  return (
    <>
      {/* Stroke color */}
      {hasStroke && (
        <>
          <div className="excalidraw-sidebar-label">Обводка</div>
          <div className="excalidraw-sidebar-colors">
            {STROKE_COLORS.map((c) => (
              <button
                key={c}
                className={`excalidraw-color-btn${firstEl?.strokeColor === c ? " active" : ""}`}
                style={{ backgroundColor: c, border: c === "#ffffff" ? "1px solid var(--border)" : undefined }}
                onClick={() => updateSelectedProps({ strokeColor: c })}
              />
            ))}
            <input
              type="color"
              className="excalidraw-color-input"
              value={firstEl?.strokeColor || "#1a1a1a"}
              onChange={(e) => updateSelectedProps({ strokeColor: e.target.value })}
            />
          </div>
        </>
      )}

      {/* Stroke width */}
      {hasStrokeStyle && (
        <>
          <div className="excalidraw-sidebar-label">Толщина штриха</div>
          <div className="excalidraw-sidebar-row">
            {[1, 2, 4].map((w) => (
              <button
                key={w}
                className={`excalidraw-tool-btn${firstEl?.strokeWidth === w ? " active" : ""}`}
                onClick={() => updateSelectedProps({ strokeWidth: w })}
              >
                <div style={{ width: 20, height: w + 1, backgroundColor: "currentColor", borderRadius: 1 }} />
              </button>
            ))}
          </div>
        </>
      )}

      {/* Stroke style */}
      {hasStrokeStyle && (
        <>
          <div className="excalidraw-sidebar-label">Стиль обводки</div>
          <div className="excalidraw-sidebar-row">
            {(["solid", "dashed", "dotted"] as const).map((s) => (
              <button
                key={s}
                className={`excalidraw-tool-btn${firstEl?.strokeStyle === s ? " active" : ""}`}
                onClick={() => updateSelectedProps({ strokeStyle: s })}
              >
                <svg width="20" height="4" viewBox="0 0 20 4">
                  <line
                    x1="0" y1="2" x2="20" y2="2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={s === "dashed" ? "6,4" : s === "dotted" ? "2,3" : "none"}
                  />
                </svg>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
