import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

const HL_ALL = "editor-search";
const HL_CUR = "editor-search-current";

interface MatchInfo {
  node: Text;
  start: number;
  length: number;
}

function collectMatches(query: string): MatchInfo[] {
  if (!query) return [];
  const editors = document.querySelectorAll(".content-body .ProseMirror");
  if (editors.length === 0) return [];
  const q = query.toLowerCase();
  const matches: MatchInfo[] = [];
  editors.forEach((editor) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent?.toLowerCase() ?? "";
      let idx = 0;
      while ((idx = text.indexOf(q, idx)) !== -1) {
        matches.push({ node, start: idx, length: query.length });
        idx += 1;
      }
    }
  });
  return matches;
}

function makeRange(m: MatchInfo): Range {
  const r = new Range();
  r.setStart(m.node, m.start);
  r.setEnd(m.node, m.start + m.length);
  return r;
}

function applyHighlights(matches: MatchInfo[], currentIdx: number) {
  if (!CSS.highlights) return;
  if (matches.length === 0) {
    CSS.highlights.delete(HL_ALL);
    CSS.highlights.delete(HL_CUR);
    return;
  }
  const allRanges = matches.map(makeRange);
  const others = allRanges.filter((_, i) => i !== currentIdx);
  CSS.highlights.set(HL_ALL, new (window as any).Highlight(...others));
  CSS.highlights.set(HL_CUR, new (window as any).Highlight(allRanges[currentIdx]));
}

function scrollToMatch(m: MatchInfo) {
  const el = m.node.parentElement;
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearHighlights() {
  CSS.highlights?.delete(HL_ALL);
  CSS.highlights?.delete(HL_CUR);
}

export function EditorSearchBar() {
  const t = useT();
  const editorSearchTrigger = useAppStore((s) => s.editorSearchTrigger);
  const sectionId = useAppStore((s) => s.currentSection?.id);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editorSearchTrigger === 0) return;
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [editorSearchTrigger]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setQuery(""); clearHighlights(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setQuery("");
    clearHighlights();
    return clearHighlights;
  }, [sectionId]);

  // Find matches when query changes
  useEffect(() => {
    if (!query.trim()) { setMatches([]); setCursor(0); clearHighlights(); return; }
    const m = collectMatches(query);
    setMatches(m);
    setCursor(0);
    applyHighlights(m, 0);
    if (m.length > 0) scrollToMatch(m[0]);
  }, [query]);

  const goTo = useCallback((newCursor: number) => {
    // Re-collect from current DOM to avoid stale node references
    const fresh = collectMatches(query);
    setMatches(fresh);
    if (fresh.length === 0) { clearHighlights(); setCursor(0); return; }
    const idx = Math.min(newCursor, fresh.length - 1);
    applyHighlights(fresh, idx);
    scrollToMatch(fresh[idx]);
    setCursor(idx);
  }, [query]);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    goTo((cursor + 1) % matches.length);
  }, [cursor, matches.length, goTo]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    goTo((cursor - 1 + matches.length) % matches.length);
  }, [cursor, matches.length, goTo]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    clearHighlights();
  }, []);

  if (!open) return null;

  return (
    <div className="editor-search-bar">
      <Search size={14} className="editor-search-bar-icon" />
      <input
        ref={inputRef}
        className="editor-search-bar-input"
        placeholder={t("editorSearchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) && matches.length > 0) {
            e.preventDefault();
            next();
          }
          if ((e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) && matches.length > 0) {
            e.preventDefault();
            prev();
          }
          if (e.key === "Escape") close();
        }}
      />
      {query && matches.length > 0 && (
        <span className="editor-search-bar-count">{cursor + 1}/{matches.length}</span>
      )}
      {query && matches.length > 1 && (
        <>
          <button className="editor-search-bar-nav" onMouseDown={(e) => { e.preventDefault(); prev(); }}><ChevronUp size={14} /></button>
          <button className="editor-search-bar-nav" onMouseDown={(e) => { e.preventDefault(); next(); }}><ChevronDown size={14} /></button>
        </>
      )}
      {query && matches.length === 0 && (
        <span className="editor-search-bar-count">0</span>
      )}
      <button className="editor-search-bar-close" onMouseDown={(e) => { e.preventDefault(); close(); }}><X size={14} /></button>
    </div>
  );
}
