import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { SectionProps } from "./shared.js";

interface TextSectionProps extends SectionProps {
  hasText: boolean;
  hasBoundText: boolean;
}

export function TextSection({ firstEl, updateSelectedProps, hasText, hasBoundText }: TextSectionProps) {
  return (
    <>
      {/* Font family (text) */}
      {hasText && (
        <>
          <div className="drawing-sidebar-label">Семейство шрифтов</div>
          <div className="drawing-sidebar-row">
            {(["hand", "normal", "code", "headline"] as const).map((f) => (
              <button
                key={f}
                className={`drawing-tool-btn${firstEl?.fontFamily === f ? " active" : ""}`}
                onClick={() => updateSelectedProps({ fontFamily: f })}
                title={f === "hand" ? "Рукописный" : f === "normal" ? "Обычный" : f === "code" ? "Моноширинный" : "Заголовочный"}
              >
                <span style={{
                  fontFamily: f === "hand" ? "cursive" : f === "normal" ? "Arial" : f === "code" ? "monospace" : "Georgia",
                  fontSize: 14, fontWeight: f === "headline" ? "bold" : "normal",
                }}>
                  {f === "hand" ? "\u270E" : f === "normal" ? "A" : f === "code" ? "</>" : "A"}
                </span>
              </button>
            ))}
          </div>

          <div className="drawing-sidebar-label">Размер шрифта</div>
          <div className="drawing-sidebar-row">
            {([{ label: "S", size: 14 }, { label: "M", size: 20 }, { label: "L", size: 28 }, { label: "XL", size: 40 }] as const).map((f) => (
              <button
                key={f.label}
                className={`drawing-tool-btn${firstEl?.fontSize === f.size ? " active" : ""}`}
                onClick={() => updateSelectedProps({ fontSize: f.size } as any)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="drawing-sidebar-label">Выравнивание текста</div>
          <div className="drawing-sidebar-row">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                className={`drawing-tool-btn${firstEl?.textAlign === a ? " active" : ""}`}
                onClick={() => updateSelectedProps({ textAlign: a })}
              >
                {a === "left" ? <AlignLeft size={16} /> : a === "center" ? <AlignCenter size={16} /> : <AlignRight size={16} />}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Bound text font size (shapes with text) */}
      {hasBoundText && (
        <>
          <div className="drawing-sidebar-label">Размер шрифта</div>
          <div className="drawing-sidebar-row">
            {([{ label: "S", size: 12 }, { label: "M", size: 16 }, { label: "L", size: 22 }, { label: "XL", size: 32 }] as const).map((f) => (
              <button
                key={f.label}
                className={`drawing-tool-btn${firstEl?.boundTextFontSize === f.size ? " active" : ""}`}
                onClick={() => updateSelectedProps({ boundTextFontSize: f.size } as any)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
