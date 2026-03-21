import { useRef, useEffect, useCallback, type RefObject } from "react";

/**
 * Hook для автоматического уменьшения шрифта заголовка,
 * чтобы текст помещался в input без горизонтального скролла.
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
