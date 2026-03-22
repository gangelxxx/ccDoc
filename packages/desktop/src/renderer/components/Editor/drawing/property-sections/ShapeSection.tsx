import { BG_COLORS, type SectionProps } from "./shared.js";

interface ShapeSectionProps extends SectionProps {
  hasShapes: boolean;
  hasFill: boolean;
}

export function ShapeSection({ firstEl, updateSelectedProps, hasShapes, hasFill }: ShapeSectionProps) {
  return (
    <>
      {/* Fill */}
      {hasFill && (
        <>
          <div className="drawing-sidebar-label">Фон</div>
          <div className="drawing-sidebar-colors">
            {BG_COLORS.map((c) => (
              <button
                key={c}
                className={`drawing-color-btn${firstEl?.backgroundColor === c ? " active" : ""}`}
                style={{
                  backgroundColor: c === "transparent" ? "transparent" : c,
                  border: c === "transparent" ? "1px dashed var(--border)" : undefined,
                  backgroundImage: c === "transparent" ? "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)" : undefined,
                  backgroundSize: c === "transparent" ? "6px 6px" : undefined,
                  backgroundPosition: c === "transparent" ? "0 0, 3px 3px" : undefined,
                }}
                onClick={() => updateSelectedProps({ backgroundColor: c })}
              />
            ))}
          </div>
        </>
      )}

      {/* Roundness (shapes) */}
      {hasShapes && (
        <>
          <div className="drawing-sidebar-label">Края</div>
          <div className="drawing-sidebar-row">
            {(["sharp", "round"] as const).map((r) => (
              <button
                key={r}
                className={`drawing-tool-btn${firstEl?.roundness === r ? " active" : ""}`}
                onClick={() => updateSelectedProps({ roundness: r })}
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  {r === "sharp" ? (
                    <rect x="2" y="2" width="14" height="14" rx="0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3,2" />
                  ) : (
                    <rect x="2" y="2" width="14" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3,2" />
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
