import { useRef, useEffect, useCallback, type RefObject } from "react";

/**
 * Hook for automatically shrinking the title font size
 * so that the text fits in the input without horizontal scrolling.
 */
export function useTitleFit(currentSectionId: string | undefined, currentSectionTitle: string | undefined) {
  const titleRef = useRef<HTMLInputElement>(null);

  const fitTitleFont = useCallback(() => {
    const input = titleRef.current;
    if (!input) return;
    const maxFont = 42;
    const minFont = 18;
    input.style.fontSize = `${maxFont}px`;
    let fs = maxFont;
    while (input.scrollWidth > input.clientWidth && fs > minFont) {
      fs -= 1;
      input.style.fontSize = `${fs}px`;
    }
  }, []);

  useEffect(() => {
    fitTitleFont();
  }, [currentSectionTitle, currentSectionId, fitTitleFont]);

  useEffect(() => {
    window.addEventListener("resize", fitTitleFont);
    return () => window.removeEventListener("resize", fitTitleFont);
  }, [fitTitleFont]);

  return titleRef;
}
