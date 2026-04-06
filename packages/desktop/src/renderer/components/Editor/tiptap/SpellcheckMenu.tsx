/**
 * SpellcheckMenu — context menu shown on right-click over a misspelled word.
 * Offers replacement suggestions, "Add to dictionary", "Ignore".
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../../i18n.js";

interface SpellcheckMenuProps {
  x: number;
  y: number;
  word: string;
  suggestions: string[];
  loading: boolean;
  onReplace: (suggestion: string) => void;
  onAddToDictionary: () => void;
  onIgnore: () => void;
  onClose: () => void;
}

export function SpellcheckMenu({
  x, y, word, suggestions, loading,
  onReplace, onAddToDictionary, onIgnore, onClose,
}: SpellcheckMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    // Defer listener attachment to skip the current event
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
      window.addEventListener("scroll", handleScroll, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - (suggestions.length + 3) * 32 - 16),
  };

  return createPortal(
    <div className="spellcheck-menu" ref={ref} style={style} onMouseDown={(e) => e.preventDefault()}>
      {loading ? (
        <div className="spellcheck-menu-item disabled">{t("spellcheckLoading")}</div>
      ) : suggestions.length > 0 ? (
        suggestions.map((s) => (
          <button key={s} type="button" className="spellcheck-menu-item suggestion" onClick={() => onReplace(s)}>
            {s}
          </button>
        ))
      ) : (
        <div className="spellcheck-menu-item disabled">{t("spellcheckNoSuggestions")}</div>
      )}
      <div className="spellcheck-menu-sep" />
      <button type="button" className="spellcheck-menu-item" onClick={onAddToDictionary}>
        {t("spellcheckAddToDictionary")}
      </button>
      <button type="button" className="spellcheck-menu-item" onClick={onIgnore}>
        {t("spellcheckIgnore")}
      </button>
    </div>,
    document.body,
  );
}
