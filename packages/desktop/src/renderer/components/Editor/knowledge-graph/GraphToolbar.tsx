import { useState, useRef, useEffect } from "react";
import { RefreshCw, Maximize2, Pause, Play } from "lucide-react";
import { useT } from "../../../i18n.js";
import type { NodeColors } from "./types.js";

const NODE_TYPE_KEYS: Record<string, string> = {
  idea: "kgNodeIdeas",
  doc: "kgNodeDocs",
  section: "kgNodeSections",
  session: "kgNodeSessions",
};

const COLOR_PALETTE = [
  "#B8B0F0", "#AFA9EC", "#9B8FE8", "#7C6FD9",
  "#7EB8E8", "#85B7EB", "#5A9FDB", "#4A8BC7",
  "#6DCAAA", "#5DCAA5", "#4AB892", "#3DA57F",
  "#F0B87E", "#E8A96E", "#D9935A", "#C47D4A",
  "#F07E7E", "#E86E6E", "#D95A5A", "#C44A4A",
  "#E8E87E", "#D9D96E", "#C4C45A", "#ABAB4A",
  "#C0C0C0", "#A0A0A0", "#808080", "#606060",
];

interface GraphToolbarProps {
  nodeCount: number;
  edgeCount: number;
  physicsPaused: boolean;
  onTogglePhysics: () => void;
  visibleNodeTypes: string[];
  onToggleNodeType: (type: string) => void;
  minWeight: number;
  onMinWeightChange: (value: number) => void;
  onReanalyze: () => void;
  onCenter: () => void;
  nodeColors: NodeColors;
  onColorChange: (type: string, color: string) => void;
  /** Only show toggles for these types (all if undefined) */
  analyzedTypes?: string[];
}

export function GraphToolbar({
  nodeCount,
  edgeCount,
  physicsPaused,
  onTogglePhysics,
  visibleNodeTypes,
  onToggleNodeType,
  minWeight,
  onMinWeightChange,
  onReanalyze,
  onCenter,
  nodeColors,
  onColorChange,
  analyzedTypes,
}: GraphToolbarProps) {
  const t = useT();
  const [pickerType, setPickerType] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerType) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerType(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerType]);

  return (
    <div className="kg-toolbar">
      {/* Badges */}
      <div className="kg-toolbar-badges">
        <span className="kg-toolbar-badge">{nodeCount} nodes</span>
        <span className="kg-toolbar-badge">{edgeCount} edges</span>
      </div>

      {/* Node type toggles */}
      <div className="kg-toolbar-toggles">
        {Object.keys(NODE_TYPE_KEYS).filter((type) => !analyzedTypes || analyzedTypes.includes(type)).map((type) => {
          const active = visibleNodeTypes.includes(type);
          const color = nodeColors[type] ?? "#999";
          return (
            <div key={type} style={{ position: "relative" }}>
              <button
                className={`kg-toolbar-toggle${active ? " kg-toolbar-toggle-active" : " kg-toolbar-toggle-inactive"}`}
                onClick={() => onToggleNodeType(type)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setPickerType(pickerType === type ? null : type);
                }}
                title={t(NODE_TYPE_KEYS[type] as any)}
              >
                <span className="kg-toolbar-toggle-dot" style={{ backgroundColor: color }} />
                {t(NODE_TYPE_KEYS[type] as any)}
              </button>

              {/* Color picker popup */}
              {pickerType === type && (
                <div ref={pickerRef} className="kg-color-picker">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      className={`kg-color-swatch${c === color ? " kg-color-swatch-active" : ""}`}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        onColorChange(type, c);
                        setPickerType(null);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Min weight slider */}
      <div className="kg-toolbar-slider">
        <label className="kg-toolbar-slider-label">{t("kgMinWeight")}</label>
        <span className="kg-toolbar-slider-bound">0%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(minWeight * 100)}
          onChange={(e) => onMinWeightChange(Number(e.target.value) / 100)}
        />
        <span className="kg-toolbar-slider-bound">100%</span>
        <span className="kg-toolbar-slider-value">{Math.round(minWeight * 100)}%</span>
      </div>

      {/* Actions */}
      <div className="kg-toolbar-actions">
        <button
          className="kg-toolbar-btn"
          onClick={onTogglePhysics}
          title={physicsPaused ? t("kgResume") : t("kgPause")}
        >
          {physicsPaused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button className="kg-toolbar-btn" onClick={onCenter} title={t("kgCenter")}>
          <Maximize2 size={16} />
        </button>
        <button className="kg-toolbar-btn" onClick={onReanalyze} title={t("kgReanalyze")}>
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
  );
}
