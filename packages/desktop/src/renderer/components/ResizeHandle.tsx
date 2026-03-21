import { useCallback, useRef, useEffect } from "react";

interface ResizeHandleProps {
  /** "left" = панель слева от хендла, "right" = панель справа */
  side: "left" | "right";
  /** Вызывается при начале перетаскивания */
  onResizeStart?: () => void;
  /** Абсолютная дельта от начала drag (не инкрементальная) */
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  onDoubleClick?: () => void;
}

export function ResizeHandle({ side, onResizeStart, onResize, onResizeEnd, onDoubleClick }: ResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      onResizeStart?.();
    },
    [onResizeStart]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      // Для панели справа — инвертируем дельту (тянем влево = увеличиваем)
      onResize(side === "right" ? -delta : delta);
    };

    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [side, onResize, onResizeEnd]);

  return (
    <div
      className="resize-handle"
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
