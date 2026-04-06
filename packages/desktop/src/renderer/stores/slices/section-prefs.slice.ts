import type { SliceCreator } from "../types.js";

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const loadingPromises = new Map<string, Promise<void>>();

export interface SectionPrefsSlice {
  _sectionPrefs: Record<string, Record<string, unknown>>;
  _sectionPrefsLoaded: Set<string>;
  getSectionPref: <T = unknown>(sectionId: string, key: string, defaultValue: T) => T;
  setSectionPref: (sectionId: string, key: string, value: unknown) => void;
  loadSectionPrefs: (sectionId: string) => Promise<void>;
  removeSectionPref: (sectionId: string, key: string) => void;
  clearSectionPrefsCache: (sectionId: string) => void;
}

export const createSectionPrefsSlice: SliceCreator<SectionPrefsSlice> = (set, get) => ({
  _sectionPrefs: {},
  _sectionPrefsLoaded: new Set<string>(),

  getSectionPref: <T = unknown>(sectionId: string, key: string, defaultValue: T): T => {
    const prefs = get()._sectionPrefs[sectionId];
    if (!prefs || !(key in prefs)) return defaultValue;
    return prefs[key] as T;
  },

  setSectionPref: (sectionId: string, key: string, value: unknown) => {
    // Capture token NOW, not when timer fires
    const token = get().currentProject?.token ?? get().activeSectionToken;

    // Instant in-memory update
    const prev = get()._sectionPrefs;
    const sectionPrefs = { ...prev[sectionId], [key]: value };
    set({ _sectionPrefs: { ...prev, [sectionId]: sectionPrefs } });

    // Debounced IPC write (300ms per sectionId:key)
    const timerKey = `${sectionId}:${key}`;
    const existing = debounceTimers.get(timerKey);
    if (existing) clearTimeout(existing);
    debounceTimers.set(timerKey, setTimeout(() => {
      debounceTimers.delete(timerKey);
      if (!token) return;
      window.api.sectionPrefsSet(token, sectionId, key, value).catch(() => {});
    }, 300));
  },

  loadSectionPrefs: async (sectionId: string) => {
    if (get()._sectionPrefsLoaded.has(sectionId)) return;
    // Deduplicate concurrent loads for the same section
    if (loadingPromises.has(sectionId)) return loadingPromises.get(sectionId)!;

    const token = get().currentProject?.token ?? get().activeSectionToken;
    if (!token) return;

    const promise = (async () => {
      try {
        const prefs = await window.api.sectionPrefsGetAll(token, sectionId);
        // Merge: keep any in-memory values that were set while loading
        const current = get()._sectionPrefs[sectionId] ?? {};
        const merged = { ...prefs, ...current };
        const loaded = new Set(get()._sectionPrefsLoaded);
        loaded.add(sectionId);
        set({
          _sectionPrefs: { ...get()._sectionPrefs, [sectionId]: merged },
          _sectionPrefsLoaded: loaded,
        });
      } catch (e) {
        console.warn("[section-prefs] failed to load prefs for", sectionId, e);
      }
    })();

    loadingPromises.set(sectionId, promise);
    try { await promise; } finally { loadingPromises.delete(sectionId); }
  },

  removeSectionPref: (sectionId: string, key: string) => {
    const prev = get()._sectionPrefs;
    const sectionPrefs = { ...prev[sectionId] };
    delete sectionPrefs[key];
    set({ _sectionPrefs: { ...prev, [sectionId]: sectionPrefs } });

    // Cancel any pending debounce for this key
    const timerKey = `${sectionId}:${key}`;
    const existing = debounceTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
      debounceTimers.delete(timerKey);
    }

    const token = get().currentProject?.token ?? get().activeSectionToken;
    if (!token) return;
    window.api.sectionPrefsDelete(token, sectionId, key).catch(() => {});
  },

  clearSectionPrefsCache: (sectionId: string) => {
    // Cancel all pending debounce timers for this section
    for (const [timerKey, timer] of debounceTimers) {
      if (timerKey.startsWith(`${sectionId}:`)) {
        clearTimeout(timer);
        debounceTimers.delete(timerKey);
      }
    }
    const prev = get()._sectionPrefs;
    const { [sectionId]: _, ...rest } = prev;
    const loaded = new Set(get()._sectionPrefsLoaded);
    loaded.delete(sectionId);
    set({ _sectionPrefs: rest, _sectionPrefsLoaded: loaded });
  },
});
