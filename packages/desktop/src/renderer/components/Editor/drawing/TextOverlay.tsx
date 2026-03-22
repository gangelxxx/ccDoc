import type { DrawState } from "../drawing-engine.js";
import type { TextEditingState } from "./types.js";

interface TextOverlayProps {
  textEditing: TextEditingState;
  textInputRef: React.RefObject<HTMLTextAreaElement | null>;
  stateRef: React.RefObject<DrawState>;
  theme: string;
  commitTextEdit: () => void;
}

export function TextOverlay({ textEditing, textInputRef, stateRef, theme, commitTextEdit }: TextOverlayProps) {
  const zoom = stateRef.current!.appState.zoom;

  return (
    <textarea
      key={textEditing.el.id + (textEditing.isBoundText ? '-bound' : '')}
      ref={textInputRef}
      className="drawing-text-input"
      style={{
        left: textEditing.x,
        top: textEditing.y,
        fontSize: (textEditing.isBoundText ? (textEditing.el.boundTextFontSize || 16) : (textEditing.el.fontSize || 20)) * zoom,
        color: (() => {
          const c = textEditing.el.strokeColor?.toLowerCase() || '';
          if (theme === 'dark' && ['#1a1a1a','#000000','#1e1e1e','#111111','#0d0d0d','#222222'].includes(c)) return '#e0e0e0';
          return textEditing.el.strokeColor;
        })(),
        ...(textEditing.isBoundText ? {
          transform: 'translate(-50%, -50%)',
          textAlign: 'center' as const,
          width: (textEditing.el.type === 'line' || textEditing.el.type === 'arrow')
            ? Math.max(80, 150 * zoom)
            : Math.max(60, Math.abs(textEditing.el.width) * zoom * 0.9),
        } : {
          width: Math.max(100, Math.abs(textEditing.el.width) * zoom),
          textAlign: (textEditing.el.textAlign || 'left') as CanvasTextAlign,
        }),
      }}
      defaultValue={textEditing.isBoundText ? (textEditing.el.boundText || "") : (textEditing.el.text || "")}
      onBlur={commitTextEdit}
      onKeyDown={(e) => {
        if (e.key === "Escape") commitTextEdit();
        e.stopPropagation();
      }}
    />
  );
}
