import { useRef, useCallback, type RefObject } from "react";
import { useAppStore } from "../../../stores/app.store.js";

/**
 * Hook для resize LLM-панели с логикой snap (сворачивание/разворачивание по клику).
 */
export function useLlmResize(mainContentRef: RefObject<HTMLDivElement | null>) {
  const { setLlmPanelWidth, savePanelWidths, llmPanelOpen } = useAppStore();

  const llmDragStart = useRef(0);
  const llmPrevWidth = useRef(320);
  const llmSnapped = useRef(false);

  const handleLlmResizeStart = useCallback(() => {
    llmSnapped.current = false;
    llmDragStart.current = useAppStore.getState().llmPanelWidth;
  }, []);

  const handleLlmResize = useCallback((delta: number) => {
    setLlmPanelWidth(llmDragStart.current + delta);
  }, [setLlmPanelWidth]);

  const handleLlmResizeEnd = useCallback(() => {
    savePanelWidths();
  }, [savePanelWidths]);

  const handleLlmDoubleClick = useCallback(() => {
    setLlmPanelWidth(320);
    savePanelWidths();
  }, [setLlmPanelWidth, savePanelWidths]);

  // Клик по сжатой области контента -> свернуть LLM до минимума
  const handleContentClick = useCallback(() => {
    if (!llmPanelOpen) return;
    const el = mainContentRef.current;
    if (!el) return;
    if (el.getBoundingClientRect().width < 250) {
      llmPrevWidth.current = useAppStore.getState().llmPanelWidth;
      llmSnapped.current = true;
      setLlmPanelWidth(200);
      savePanelWidths();
    }
  }, [llmPanelOpen, setLlmPanelWidth, savePanelWidths]);

  // Клик по свёрнутой LLM панели -> развернуть обратно
  const handleLlmPanelClick = useCallback((e: React.MouseEvent) => {
    if (!llmSnapped.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    llmSnapped.current = false;
    setLlmPanelWidth(llmPrevWidth.current);
    savePanelWidths();
  }, [setLlmPanelWidth, savePanelWidths]);

  return {
    handleLlmResizeStart,
    handleLlmResize,
    handleLlmResizeEnd,
    handleLlmDoubleClick,
    handleContentClick,
    handleLlmPanelClick,
  };
}
