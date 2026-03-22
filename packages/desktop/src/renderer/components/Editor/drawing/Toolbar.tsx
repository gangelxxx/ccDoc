import {
  Square, Circle, Diamond, Minus, ArrowRight, Pencil, Type,
  MousePointer2, LayoutGrid, ImageIcon,
} from "lucide-react";
import type { ToolType } from "../drawing-engine.js";

const TOOLS: { type: ToolType; icon: typeof Square; label: string; key: string }[] = [
  { type: "selection", icon: MousePointer2, label: "Выбор", key: "V" },
  { type: "rectangle", icon: Square, label: "Прямоугольник", key: "R" },
  { type: "ellipse", icon: Circle, label: "Эллипс", key: "O" },
  { type: "diamond", icon: Diamond, label: "Ромб", key: "D" },
  { type: "line", icon: Minus, label: "Линия", key: "L" },
  { type: "arrow", icon: ArrowRight, label: "Стрелка", key: "A" },
  { type: "freedraw", icon: Pencil, label: "Карандаш", key: "P" },
  { type: "text", icon: Type, label: "Текст", key: "T" },
];

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  autoLayout: () => void;
  pickAndInsertImage: () => void;
}

export function Toolbar({ activeTool, setActiveTool, autoLayout, pickAndInsertImage }: ToolbarProps) {
  return (
    <div className="drawing-toolbar">
      <div className="drawing-toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.type}
            className={`drawing-tool-btn${activeTool === t.type ? " active" : ""}`}
            onClick={() => setActiveTool(t.type)}
            title={`${t.label} (${t.key})`}
          >
            <t.icon size={18} />
          </button>
        ))}
        <div className="drawing-toolbar-sep" />
        <button
          className="drawing-tool-btn"
          onClick={autoLayout}
          title="Авто-раскладка"
        >
          <LayoutGrid size={18} />
        </button>
        <button
          className="drawing-tool-btn"
          onClick={pickAndInsertImage}
          title="Изображение (I)"
        >
          <ImageIcon size={18} />
        </button>
      </div>
    </div>
  );
}
