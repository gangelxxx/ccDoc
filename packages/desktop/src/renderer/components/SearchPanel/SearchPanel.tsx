import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { Search, X } from "lucide-react";
import { useT } from "../../i18n.js";

export function SearchPanel() {
  const {
    ftsQuery, ftsResults, ftsLoading,
    setFtsQuery, searchFts,
    selectSection,
    setHighlightQuery,
  } = useAppStore();

  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = useCallback((value: string) => {
    setFtsQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchFts(value);
    }, 250);
  }, [setFtsQuery, searchFts]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="search-panel">
      <div className="search-panel-input-wrap">
        <Search size={14} className="search-panel-icon" />
        <input
          ref={inputRef}
          className="search-panel-input"
          placeholder={t("searchPlaceholder")}
          value={ftsQuery}
          onChange={(e) => handleChange(e.target.value)}
        />
        {ftsQuery && (
          <button
            className="search-panel-clear"
            onClick={() => { setFtsQuery(""); searchFts(""); }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="search-panel-results">
        {ftsLoading && <div className="search-panel-status">{t("searching")}</div>}

        {!ftsLoading && ftsQuery && ftsResults.length === 0 && (
          <div className="search-panel-status">{t("noResults")}</div>
        )}

        {ftsResults.map((r) => (
          <button
            key={r.id}
            className="search-panel-item"
            onClick={() => { setHighlightQuery(ftsQuery); selectSection(r.id); }}
          >
            <span
              className="search-panel-item-title"
              dangerouslySetInnerHTML={{ __html: r.titleHighlighted || r.title }}
            />
            {r.snippet && (
              <span
                className="search-panel-item-snippet"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
