import type { SliceCreator } from "../types.js";
import type { SessionBuffer, SessionBufferEntry } from "../llm/types.js";

const MAX_ENTRY_CHARS = 30_000;
const MAX_TOTAL_CHARS = 150_000;
const MAX_ENTRIES = 50;
const MAX_KEY_LENGTH = 100;

export interface SessionBufferSlice {
  sessionBuffer: SessionBuffer;
  writeBuffer: (key: string, content: string, summary: string, author: string, tags?: string[]) => string;
  readBuffer: (key: string) => SessionBufferEntry | null;
  listBuffer: (tag?: string) => { key: string; summary: string; author: string; tags: string[]; charCount: number; updatedAt: number }[];
  clearBuffer: () => void;
}

export const createSessionBufferSlice: SliceCreator<SessionBufferSlice> = (set, get) => ({
  sessionBuffer: { entries: {}, totalChars: 0 },

  writeBuffer: (key, content, summary, author, tags) => {
    key = key.trim().toLowerCase().slice(0, MAX_KEY_LENGTH);
    if (!key) return "Error: empty key";
    if (content.length > MAX_ENTRY_CHARS) {
      content = content.slice(0, MAX_ENTRY_CHARS);
      summary += " [truncated to 30K chars]";
    }

    const buf = get().sessionBuffer;
    const entries = { ...buf.entries };
    let totalChars = buf.totalChars;

    // If overwriting, subtract old size
    if (entries[key]) {
      totalChars -= entries[key].charCount;
    }

    // LRU eviction if needed
    while (
      (totalChars + content.length > MAX_TOTAL_CHARS || Object.keys(entries).length >= MAX_ENTRIES) &&
      Object.keys(entries).length > 0
    ) {
      // Find oldest entry by updatedAt
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, e] of Object.entries(entries)) {
        if (k !== key && e.updatedAt < oldestTime) {
          oldestTime = e.updatedAt;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      totalChars -= entries[oldestKey].charCount;
      delete entries[oldestKey];
    }

    const now = Date.now();
    entries[key] = {
      key,
      content,
      summary,
      author,
      tags: (tags || []).slice(0, 10).map(t => String(t).slice(0, 50)),
      createdAt: entries[key]?.createdAt || now,
      updatedAt: now,
      charCount: content.length,
    };
    totalChars += content.length;

    set({ sessionBuffer: { entries, totalChars } });
    return `Buffer entry "${key}" written (${content.length} chars). Summary: ${summary}`;
  },

  readBuffer: (key) => {
    key = key.trim().toLowerCase();
    return get().sessionBuffer.entries[key] || null;
  },

  listBuffer: (tag) => {
    const entries = Object.values(get().sessionBuffer.entries);
    const filtered = tag ? entries.filter(e => e.tags.includes(tag)) : entries;
    return filtered
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(e => ({ key: e.key, summary: e.summary, author: e.author, tags: e.tags, charCount: e.charCount, updatedAt: e.updatedAt }));
  },

  clearBuffer: () => {
    set({ sessionBuffer: { entries: {}, totalChars: 0 } });
  },
});
