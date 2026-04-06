import {
  Square, Circle, Diamond, Minus, ArrowRight, Pencil, Type,
  MousePointer2, LayoutGrid, ImageIcon,
} from "lucide-react";
import type { ToolType } from "../drawing-engine.js";
import { useT } from "../../../i18n.js";

const TOOLS: { type: ToolType; icon: typeof Square; labelKey: string; key: string }[] = [
  { type: "selection", icon: MousePointer2, labelKey: "drawSelect", key: "V" },
  { type: "rectangle", icon: Square, labelKey: "drawRectangle", key: "R" },
  { type: "ellipse", icon: Circle, labelKey: "drawEllipse", key: "O" },
  { type: "diamond", icon: Diamond, labelKey: "drawDiamond", key: "D" },
  { type: "line", icon: Minus, labelKey: "drawLine", key: "L" },
  { type: "arrow", icon: ArrowRight, labelKey: "drawArrow", key: "A" },
  { type: "freedraw", icon: Pencil, labelKey: "drawPencil", key: "P" },
  { type: "text", icon: Type, labelKey: "drawText", key: "T" },
];

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  autoLayout: () => void;
  pickAndInsertImage: () => void;
}

export function Toolbar({ activeTool, setActiveTool, autoLayout, pickAndInsertImage }: ToolbarProps) {
  const t = useT();

  return (
    <div className="drawing-toolbar">
      <div className="drawing-toolbar-group">
        {TOOLS.map((tool) => (
          <button
            key={tool.type}
            className={`drawing-tool-btn${activeTool === tool.type ? " active" : ""}`}
            onClick={() => setActiveTool(tool.type)}
            title={`${t(tool.labelKey)} (${tool.key})`}
          >
            <tool.icon size={18} />
          </button>
        ))}
        <div className="drawing-toolbar-sep" />
        <button
          className="drawing-tool-btn"
          onClick={autoLayout}
          title={t("drawAutoLayout")}
        >
          <LayoutGrid size={18} />
        </button>
        <button
          className="drawing-tool-btn"
          onClick={pickAndInsertImage}
          title={t("drawImage") + " (I)"}
        >
          <ImageIcon size={18} />
        </button>
      </div>
    </div>
  );
}
