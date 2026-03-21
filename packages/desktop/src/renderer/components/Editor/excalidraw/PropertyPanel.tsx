import { useCallback, useRef, useEffect } from "react";
import { ArrowUpToLine, ArrowDownToLine, Lock, Unlock } from "lucide-react";
import type { DrawElement, ToolType } from "../drawing-engine.js";
import type { SidebarDragState } from "./types.js";

import { StrokeSection } from "./property-sections/StrokeSection.js";
import { ShapeSection } from "./property-sections/ShapeSection.js";
import { ArrowSection } from "./property-sections/ArrowSection.js";
import { TextSection } from "./property-sections/TextSection.js";

interface PropertyPanelProps {
  selectedElements: DrawElement[];
  activeTool: ToolType;
  sidebarPos: { x: number; y: number };
  setSidebarPos: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  sidebarLocked: boolean;
  setSidebarLocked: React.Dispatch<React.SetStateAction<boolean>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  updateSelectedProps: (updates: Partial<DrawElement>) => void;
  bringToFront: () => void;
  sendToBack: () => void;
}

export function PropertyPanel({
  selectedElements,
  activeTool,
  sidebarPos,
  setSidebarPos,
  sidebarLocked,
  setSidebarLocked,
  containerRef,
  updateSelectedProps,
  bringToFront,
  sendToBack,
}: PropertyPanelProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarDrag = useRef<SidebarDragState | null>(null);

  const firstEl = selectedElements[0] ?? null;
  const toolType = activeTool !== "selection" ? activeTool : null;
  const showSidebar = selectedElements.length > 0 || toolType !== null;

  // Clamp sidebar position to container bounds
  const clampedSidebarPos = (() => {
    const container = containerRef.current;
    if (!container) return sidebarPos;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const sw = sidebarRef.current?.offsetWidth ?? 220;
    const sh = sidebarRef.current?.offsetHeight ?? 300;
    const x = Math.max(0, Math.min(sidebarPos.x, cw - sw));
    const y = Math.max(0, Math.min(sidebarPos.y, ch - sh));
    return (x !== sidebarPos.x || y !== sidebarPos.y) ? { x, y } : sidebarPos;
  })();

  // Determine what property sections to show
  const hasShapes = selectedElements.length > 0
    ? selectedElements.some((el) => ["rectangle", "diamond"].includes(el.type))
    : ["rectangle", "diamond"].includes(toolType!);
  const hasText = selectedElements.length > 0
    ? selectedElements.some((el) => el.type === "text")
    : toolType === "text";
  const hasArrows = selectedElements.length > 0
    ? selectedElements.some((el) => el.type === "arrow")
    : toolType === "arrow";
  const hasLines = selectedElements.length > 0
    ? selectedElements.some((el) => el.type === "line" || el.type === "arrow")
    : toolType === "line" || toolType === "arrow";
  const hasStroke = selectedElements.length > 0 || toolType !== null;
  const hasStrokeStyle = selectedElements.length > 0
    ? selectedElements.some((el) => el.type !== "text")
    : toolType !== null && toolType !== "text";
  const hasBoundText = selectedElements.length > 0
    && selectedElements.some((el) => ["rectangle", "diamond", "ellipse", "line", "arrow"].includes(el.type) && el.boundText);
  const hasFill = selectedElements.length > 0
    ? selectedElements.some((el) => !["text", "freedraw", "line", "arrow"].includes(el.type))
    : toolType !== null && !["text", "freedraw", "line", "arrow"].includes(toolType);

  const toggleSidebarLock = useCallback(() => {
    setSidebarLocked((v) => {
      localStorage.setItem("excalidraw-sidebar-locked", v ? "0" : "1");
      return !v;
    });
  }, [setSidebarLocked]);

  const onSidebarPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
    if (sidebarLocked) return;
    e.preventDefault();
    e.stopPropagation();
    sidebarDrag.current = { startX: e.clientX, startY: e.clientY, origX: sidebarPos.x, origY: sidebarPos.y };
    const onMove = (ev: PointerEvent) => {
      if (!sidebarDrag.current) return;
      const dx = ev.clientX - sidebarDrag.current.startX;
      const dy = ev.clientY - sidebarDrag.current.startY;
      let nx = sidebarDrag.current.origX + dx;
      let ny = sidebarDrag.current.origY + dy;
      // Snap to edges
      const container = containerRef.current;
      const sidebar = sidebarRef.current;
      if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const sw = sidebar?.offsetWidth ?? 220;
        const sh = sidebar?.offsetHeight ?? 300;
        const snap = 12;
        // Clamp within container
        nx = Math.max(0, Math.min(nx, cw - sw));
        ny = Math.max(0, Math.min(ny, ch - sh));
        // Snap to left/right
        if (nx < snap) nx = snap;
        else if (nx > cw - sw - snap) nx = cw - sw - snap;
        // Snap to top/bottom
        if (ny < snap) ny = snap;
        else if (ny > ch - sh - snap) ny = ch - sh - snap;
      }
      setSidebarPos({ x: nx, y: ny });
    };
    const onUp = () => {
      if (sidebarDrag.current) {
        setSidebarPos((pos) => {
          localStorage.setItem("excalidraw-sidebar-pos", JSON.stringify(pos));
          return pos;
        });
        sidebarDrag.current = null;
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [sidebarPos, sidebarLocked, containerRef, setSidebarPos]);

  // Keep sidebar anchored to nearest edge on window resize
  const prevWindowSize = useRef({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => {
      const prevW = prevWindowSize.current.w;
      const prevH = prevWindowSize.current.h;
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      prevWindowSize.current = { w: newW, h: newH };

      setSidebarPos((pos) => {
        const sidebarW = 160;
        const sidebarH = 300;

        // If panel was closer to right edge, preserve distance from right
        const distRight = prevW - (pos.x + sidebarW);
        const distLeft = pos.x;
        let x = distRight < distLeft
          ? newW - sidebarW - distRight
          : pos.x;

        // If panel was closer to bottom edge, preserve distance from bottom
        const distBottom = prevH - (pos.y + sidebarH);
        const distTop = pos.y;
        let y = distBottom < distTop
          ? newH - sidebarH - distBottom
          : pos.y;

        // Clamp to bounds
        const maxX = newW - sidebarW - 8;
        const maxY = newH - sidebarH - 8;
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));

        if (x !== pos.x || y !== pos.y) {
          const newPos = { x, y };
          localStorage.setItem("excalidraw-sidebar-pos", JSON.stringify(newPos));
          return newPos;
        }
        return pos;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setSidebarPos]);

  if (!showSidebar) return null;

  return (
    <div
      ref={sidebarRef}
      className="excalidraw-sidebar"
      style={{ left: clampedSidebarPos.x, top: clampedSidebarPos.y, cursor: sidebarLocked ? "default" : undefined }}
      onPointerDown={onSidebarPointerDown}
    >
      <div className="excalidraw-sidebar-drag-handle">
        <button
          className={`excalidraw-tool-btn excalidraw-lock-btn${sidebarLocked ? " active" : ""}`}
          onClick={toggleSidebarLock}
          title={sidebarLocked ? "Разблокировать перемещение" : "Заблокировать позицию"}
        >
          {sidebarLocked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      </div>
      <div className="excalidraw-sidebar-content">
        <StrokeSection
          firstEl={firstEl}
          updateSelectedProps={updateSelectedProps}
          hasStroke={hasStroke}
          hasStrokeStyle={hasStrokeStyle}
        />

        <ShapeSection
          firstEl={firstEl}
          updateSelectedProps={updateSelectedProps}
          hasShapes={hasShapes}
          hasFill={hasFill}
        />

        <ArrowSection
          firstEl={firstEl}
          updateSelectedProps={updateSelectedProps}
          hasLines={hasLines}
          hasArrows={hasArrows}
        />

        <TextSection
          firstEl={firstEl}
          updateSelectedProps={updateSelectedProps}
          hasText={hasText}
          hasBoundText={hasBoundText}
        />

        {/* Opacity */}
        <div className="excalidraw-sidebar-label">Непрозрачность</div>
        <div className="excalidraw-sidebar-slider-row">
          <input
            type="range"
            min="0"
            max="100"
            value={firstEl?.opacity ?? 100}
            onChange={(e) => updateSelectedProps({ opacity: Number(e.target.value) })}
            className="excalidraw-slider"
          />
          <span className="excalidraw-sidebar-value">{firstEl?.opacity ?? 100}</span>
        </div>

        {/* Layers */}
        <div className="excalidraw-sidebar-label">Слои</div>
        <div className="excalidraw-sidebar-row">
          <button className="excalidraw-tool-btn" onClick={sendToBack} title="На задний план">
            <ArrowDownToLine size={16} />
          </button>
          <button className="excalidraw-tool-btn" onClick={() => { /* move back one */ }} title="Назад">
            <ArrowDownToLine size={14} />
          </button>
          <button className="excalidraw-tool-btn" onClick={() => { /* move forward one */ }} title="Вперёд">
            <ArrowUpToLine size={14} />
          </button>
          <button className="excalidraw-tool-btn" onClick={bringToFront} title="На передний план">
            <ArrowUpToLine size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
