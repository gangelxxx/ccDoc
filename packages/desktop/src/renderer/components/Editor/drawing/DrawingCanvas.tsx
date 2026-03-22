import { useState, useRef, useCallback, useEffect } from "react";
import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import {
  Undo2, Redo2, Grid3x3, ZoomIn, ZoomOut, Trash2,
  Copy, Clipboard, CopyPlus, ArrowUpToLine, ArrowDownToLine,
} from "lucide-react";
import {
  type ToolType, type DrawElement, type DrawState,
  parseDrawState, HistoryStack,
} from "../drawing-engine.js";
import { SvgScene } from "../svg-renderer.js";

import { createInitialPointerState } from "./types.js";
import type { TextEditingState } from "./types.js";
import { useAutoSave } from "./use-auto-save.js";
import { useKeyboard } from "./use-keyboard.js";
import { useCanvasEvents } from "./use-canvas-events.js";
import { autoLayoutWithElk } from "./auto-layout.js";
import { Toolbar } from "./Toolbar.js";
import { PropertyPanel } from "./PropertyPanel.js";
import { TextOverlay } from "./TextOverlay.js";
import { useElementOps } from "./hooks/use-element-ops.js";
import { useTextEditing } from "./hooks/use-text-editing.js";
import { useImageInsert } from "./hooks/use-image-insert.js";

interface Props {
  sectionId: string;
  initialContent: string;
}

export function DrawingCanvas({ sectionId, initialContent }: Props) {
  const updateSection = useAppStore((s) => s.updateSection);
  const currentSection = useAppStore((s) => s.currentSection);
  const theme = useAppStore((s) => s.theme);
  const t = useT();

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const stateRef = useRef<DrawState>(parseDrawState(initialContent));
  const historyRef = useRef(new HistoryStack());
  const clipboardRef = useRef<DrawElement[]>([]);

  const [activeTool, setActiveTool] = useState<ToolType>("selection");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [strokeColor, setStrokeColor] = useState(theme === "dark" ? "#e0e0e0" : "#1a1a1a");
  const [bgColor, setBgColor] = useState("transparent");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [gridEnabled, setGridEnabled] = useState(false);
  const [cursorStyle, setCursorStyle] = useState("default");
  const [textEditing, setTextEditing] = useState<TextEditingState | null>(null);
  const [renderCounter, forceRender] = useState(0);
  const [sidebarPos, setSidebarPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem("drawing-sidebar-pos");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { x: 12, y: 50 };
  });
  const [sidebarLocked, setSidebarLocked] = useState(() => localStorage.getItem("drawing-sidebar-locked") === "1");

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const cursorRef = useRef("default");
  const updateCursor = useCallback((c: string) => {
    if (cursorRef.current !== c) { cursorRef.current = c; setCursorStyle(c); }
  }, []);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const bindTargetRef = useRef<DrawElement | null>(null);
  const textEditingRef = useRef(textEditing);
  textEditingRef.current = textEditing;

  // Pointer state
  const pointerState = useRef(createInitialPointerState());

  // --- Save ---
  const { scheduleSave, lastSavedContent } = useAutoSave({
    stateRef,
    sectionId,
    currentSection,
    initialContent,
    updateSection,
  });

  // --- Redraw (SVG is declarative, just trigger re-render) ---
  const redrawImmediate = useCallback(() => {
    forceRender(n => n + 1);
  }, []);

  const redraw = useCallback(() => {
    forceRender(n => n + 1);
  }, []);

  // --- Resize canvas ---
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { redrawImmediate(); }, [redrawImmediate, selectedIds, theme, gridEnabled]);
  useEffect(() => {
    stateRef.current.appState.gridSize = gridEnabled ? 20 : null;
    redraw();
  }, [gridEnabled, redraw]);

  // --- Sync from external changes (e.g. LLM tool calls) ---
  useEffect(() => {
    if (initialContent !== lastSavedContent.current) {
      lastSavedContent.current = initialContent;
      stateRef.current = parseDrawState(initialContent);
      historyRef.current = new HistoryStack();
      setSelectedIds(new Set());
      redraw();
    }
  }, [initialContent, redraw, lastSavedContent]);

  // --- History ---
  const pushHistory = useCallback(() => {
    historyRef.current.push(stateRef.current.elements);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.undo(stateRef.current.elements);
    if (prev) { stateRef.current.elements = prev; setSelectedIds(new Set()); redraw(); scheduleSave(); }
  }, [redraw, scheduleSave]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(stateRef.current.elements);
    if (next) { stateRef.current.elements = next; setSelectedIds(new Set()); redraw(); scheduleSave(); }
  }, [redraw, scheduleSave]);

  // --- Element operations (delete, copy, paste, duplicate, z-order, props) ---
  const {
    deleteSelected,
    copySelected,
    paste,
    duplicate,
    bringToFront,
    sendToBack,
    updateSelectedProps,
  } = useElementOps({
    stateRef,
    selectedIds,
    selectedIdsRef,
    clipboardRef,
    pushHistory,
    redraw,
    scheduleSave,
    forceRender,
    setSelectedIds,
    setStrokeColor,
    setBgColor,
    setStrokeWidth,
  });

  // --- Text editing ---
  const { startTextEditing, commitTextEdit, startBoundTextEditing } = useTextEditing({
    stateRef,
    textInputRef,
    textEditing,
    textEditingRef,
    pushHistory,
    redraw,
    scheduleSave,
    setTextEditing,
  });

  // --- Image insertion ---
  const { insertImageElement, pickAndInsertImage } = useImageInsert({
    stateRef,
    containerRef,
    pushHistory,
    strokeColor,
    strokeWidth,
    redraw,
    scheduleSave,
    setSelectedIds,
    setActiveTool,
  });

  // --- Canvas events ---
  const { onPointerDown, onPointerUp, onDoubleClick, onContextMenu, onWheel } = useCanvasEvents({
    stateRef,
    pointerState,
    containerRef,
    bindTargetRef,
    activeToolRef,
    selectedIdsRef,
    textEditingRef,

    activeTool,
    selectedIds,
    strokeColor,
    bgColor,
    strokeWidth,
    textEditing,

    setActiveTool,
    setSelectedIds,

    pushHistory,
    redraw,
    redrawImmediate,
    scheduleSave,
    updateCursor,
    commitTextEdit,
    startTextEditing,
    startBoundTextEditing,
  });

  // --- Keyboard shortcuts ---
  useKeyboard({
    deleteSelected,
    undo,
    redo,
    copySelected,
    paste,
    duplicate,
    bringToFront,
    sendToBack,
    insertImageElement,
    pickAndInsertImage,
    setActiveTool,
    setSelectedIds,
    redraw,
  });

  // --- Auto layout ---
  const autoLayout = useCallback(async () => {
    await autoLayoutWithElk(stateRef, historyRef, scheduleSave, redraw, forceRender);
  }, [scheduleSave, redraw]);

  // --- Zoom ---
  const zoomIn = useCallback(() => {
    stateRef.current.appState.zoom = Math.min(10, stateRef.current.appState.zoom * 1.2);
    redraw(); forceRender((n) => n + 1);
  }, [redraw]);

  const zoomOut = useCallback(() => {
    stateRef.current.appState.zoom = Math.max(0.1, stateRef.current.appState.zoom / 1.2);
    redraw(); forceRender((n) => n + 1);
  }, [redraw]);

  const zoom = stateRef.current.appState.zoom;

  // --- Selected elements for sidebar ---
  const selectedElements = stateRef.current.elements.filter(
    (el) => selectedIds.has(el.id) && !el.isDeleted
  );

  return (
    <div className="drawing-wrap">
      {/* Top toolbar */}
      <Toolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        autoLayout={autoLayout}
        pickAndInsertImage={pickAndInsertImage}
      />

      {/* Canvas area */}
      <div className="drawing-canvas-area" ref={containerRef}>
        <SvgScene
          state={stateRef.current}
          width={containerSize.width}
          height={containerSize.height}
          selectedIds={selectedIds}
          theme={theme}
          editingBoundTextId={textEditing ? textEditing.el.id : null}
          selectionRect={
            pointerState.current.isSelecting && pointerState.current.isDown
              ? {
                  x1: pointerState.current.startSceneX,
                  y1: pointerState.current.startSceneY,
                  x2: (pointerState.current.lastX - stateRef.current.appState.scrollX) / stateRef.current.appState.zoom,
                  y2: (pointerState.current.lastY - stateRef.current.appState.scrollY) / stateRef.current.appState.zoom,
                }
              : null
          }
          bindTarget={bindTargetRef.current}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
          cursor={cursorStyle}
        />

        {/* Inline text editor */}
        {textEditing && (
          <TextOverlay
            textEditing={textEditing}
            textInputRef={textInputRef}
            stateRef={stateRef}
            theme={theme}
            commitTextEdit={commitTextEdit}
          />
        )}

        {/* Properties sidebar */}
        <PropertyPanel
          selectedElements={selectedElements}
          activeTool={activeTool}
          sidebarPos={sidebarPos}
          setSidebarPos={setSidebarPos}
          sidebarLocked={sidebarLocked}
          setSidebarLocked={setSidebarLocked}
          containerRef={containerRef}
          updateSelectedProps={updateSelectedProps}
          bringToFront={bringToFront}
          sendToBack={sendToBack}
        />
      </div>

      {/* Bottom bar */}
      <div className="drawing-bottombar">
        <div className="drawing-toolbar-group">
          <button className="drawing-tool-btn" onClick={undo} title={t("excUndo")}>
            <Undo2 size={16} />
          </button>
          <button className="drawing-tool-btn" onClick={redo} title={t("excRedo")}>
            <Redo2 size={16} />
          </button>
        </div>
        <div className="drawing-toolbar-sep" />
        <button className={`drawing-tool-btn${gridEnabled ? " active" : ""}`} onClick={() => setGridEnabled(!gridEnabled)} title={t("excGrid")}>
          <Grid3x3 size={16} />
        </button>
        <div className="drawing-toolbar-sep" />
        <button className="drawing-tool-btn" onClick={copySelected} title={t("excCopy")} disabled={selectedIds.size === 0}>
          <Copy size={16} />
        </button>
        <button className="drawing-tool-btn" onClick={paste} title={t("excPaste")} disabled={clipboardRef.current.length === 0}>
          <Clipboard size={16} />
        </button>
        <button className="drawing-tool-btn" onClick={duplicate} title={t("excDuplicate")} disabled={selectedIds.size === 0}>
          <CopyPlus size={16} />
        </button>
        <div className="drawing-toolbar-sep" />
        <button className="drawing-tool-btn" onClick={bringToFront} title={t("excBringToFront")} disabled={selectedIds.size === 0}>
          <ArrowUpToLine size={16} />
        </button>
        <button className="drawing-tool-btn" onClick={sendToBack} title={t("excSendToBack")} disabled={selectedIds.size === 0}>
          <ArrowDownToLine size={16} />
        </button>
        <div className="drawing-toolbar-sep" />
        <button className="drawing-tool-btn" onClick={deleteSelected} title={t("excDelete")} disabled={selectedIds.size === 0}>
          <Trash2 size={16} />
        </button>
        <div style={{ flex: 1 }} />
        <div className="drawing-toolbar-group">
          <button className="drawing-tool-btn" onClick={zoomOut} title={t("excZoomOut")}>
            <ZoomOut size={16} />
          </button>
          <span className="drawing-zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="drawing-tool-btn" onClick={zoomIn} title={t("excZoomIn")}>
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
