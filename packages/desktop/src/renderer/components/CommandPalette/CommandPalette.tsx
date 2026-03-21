import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

const HISTORY_KEY = "ccdoc-palette-search-history";
const MAX_HISTORY = 5;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string").slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function addToHistory(query: string, prev: string[]): string[] {
  const q = query.trim();
  if (!q) return prev;
  const filtered = prev.filter((h) => h !== q);
  return [q, ...filtered].slice(0, MAX_HISTORY);
}

interface PaletteItem {
  id: string;
  icon: string;
  label: string;
  labelHtml?: string;
  snippet?: string;
  hint?: string;
  action: () => void;
}

export function CommandPalette() {
  const {
    paletteOpen, setPaletteOpen,
    selectSection,
    searchFts, ftsResults, ftsLoading,
    setHighlightQuery,
  } = useAppStore();

  const t = useT();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActiveIndex(0);
      setSearchHistory(loadHistory());
      useAppStore.setState({ ftsResults: [] });
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => clearTimeout(debounceRef.current);
  }, [paletteOpen]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (value.trim()) {
      useAppStore.setState({ ftsLoading: true });
      debounceRef.current = setTimeout(() => searchFts(value), 200);
    } else {
      useAppStore.setState({ ftsResults: [], ftsLoading: false });
    }
  }, [searchFts]);

  const commitSearch = useCallback((q: string) => {
    const updated = addToHistory(q, loadHistory());
    saveHistory(updated);
    setSearchHistory(updated);
  }, []);

  const ftsItems: PaletteItem[] = useMemo(() => {
    return ftsResults.map((r) => ({
      id: r.id,
      icon: "\u00A7",
      label: r.title,
      labelHtml: r.titleHighlighted,
      snippet: r.snippet,
      action: () => {
        commitSearch(query);
        setHighlightQuery(query);
        selectSection(r.id);
        setPaletteOpen(false);
      },
    }));
  }, [ftsResults, selectSection, setPaletteOpen, setHighlightQuery, query, commitSearch]);

  const historyItems: PaletteItem[] = useMemo(() => {
    return searchHistory.map((q, i) => ({
      id: `history-${i}`,
      icon: "\uD83D\uDD70\uFE0F",
      label: q,
      action: () => {
        handleQueryChange(q);
      },
    }));
  }, [searchHistory, handleQueryChange]);

  const clearHistoryItem: PaletteItem | null = useMemo(() => {
    if (searchHistory.length === 0) return null;
    return {
      id: "clear-history",
      icon: "\u2715",
      label: t("paletteClearHistory"),
      action: () => {
        localStorage.removeItem(HISTORY_KEY);
        setSearchHistory([]);
      },
    };
  }, [searchHistory, t]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const items = [...historyItems];
      if (clearHistoryItem) items.push(clearHistoryItem);
      return items;
    }
    return ftsItems;
  }, [query, ftsItems, historyItems, clearHistoryItem]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) {
        filtered[activeIndex].action();
      } else if (query.trim() && ftsItems.length === 0) {
        commitSearch(query);
      }
    } else if (e.key === "Escape") {
      setPaletteOpen(false);
    }
  };

  if (!paletteOpen) return null;

  const showingHistory = !query.trim() && (historyItems.length > 0);
  const showingFts = query.trim() && ftsItems.length > 0;

  return (
    <div className="palette-overlay" onClick={() => setPaletteOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <span className="palette-input-icon">{"\uD83D\uDD0D"}</span>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={t("paletteSearchPlaceholder")}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="palette-results">
          {query.trim() && !ftsLoading && filtered.length === 0 && (
            <div className="palette-empty">{t("paletteNoResults")}</div>
          )}
          {ftsLoading && query.trim() && (
            <div className="palette-empty">{t("paletteSearching")}</div>
          )}

          {showingHistory && <div className="palette-group-title">{t("paletteRecentSearches")}</div>}
          {showingFts && <div className="palette-group-title">{t("paletteSections")}</div>}

          {filtered.map((item, idx) => (
            <div
              key={item.id}
              className={`palette-item${idx === activeIndex ? " active" : ""}${item.id === "clear-history" ? " palette-item-muted" : ""}`}
              onClick={item.action}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <span className="palette-item-icon">{item.icon}</span>
              <div className="palette-item-content">
                {item.labelHtml ? (
                  <span
                    className="palette-item-label"
                    dangerouslySetInnerHTML={{ __html: item.labelHtml }}
                  />
                ) : (
                  <span className="palette-item-label">{item.label}</span>
                )}
                {item.snippet && (
                  <span
                    className="palette-item-snippet"
                    dangerouslySetInnerHTML={{ __html: item.snippet }}
                  />
                )}
              </div>
              {item.hint && <span className="palette-item-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
