import { useEffect, useRef, useCallback } from "react";
import DOMPurify from "dompurify";
import { useAppStore } from "../../stores/app.store.js";
import { Search, X } from "lucide-react";
import { useT } from "../../i18n.js";

export function SearchPanel() {
  const {
    ftsQuery, ftsResults, ftsLoading,
    setFtsQuery, searchFts,
    selectSection,
    selectUserSection,
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
            key={`${r.source ?? "project"}-${r.id}`}
            className="search-panel-item"
            onClick={() => {
              setHighlightQuery(ftsQuery);
              if (r.source === "user") selectUserSection(r.id);
              else selectSection(r.id);
            }}
          >
            <span
              className="search-panel-item-title"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(r.titleHighlighted || r.title) }}
            />
            {r.source === "user" && (
              <span className="search-panel-item-badge" style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>
                {"\uD83D\uDC64"}
              </span>
            )}
            {r.snippet && (
              <span
                className="search-panel-item-snippet"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(r.snippet) }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
