/**
 * SpellcheckEngine — Promise-based API over the spellcheck Web Worker.
 * Singleton: one Worker per application lifetime.
 */
import SpellcheckWorker from "../workers/spellcheck.worker.ts?worker";

type Pending = { resolve: (val: any) => void; reject: (err: any) => void };

const DICT_PATHS: Record<string, { aff: string; dic: string }> = {
  en: { aff: "dictionaries/en.aff", dic: "dictionaries/en.dic" },
  ru: { aff: "dictionaries/ru.aff", dic: "dictionaries/ru.dic" },
};

const MAX_CACHE_SIZE = 10_000;

let nextId = 0;

export class SpellcheckEngine {
  private worker: Worker;
  private pending = new Map<string, Pending>();
  private loadedLangs = new Set<string>();
  private loadingLangs = new Set<string>();
  private cache = new Map<string, boolean>(); // word → isMisspelled

  /** Resolves when all dictionaries from init() are loaded */
  public ready: Promise<void> = Promise.resolve();

  constructor() {
    this.worker = new SpellcheckWorker();
    this.worker.onmessage = (e) => this.handleMessage(e.data);
    this.worker.onerror = (e) => console.error("[spellcheck-worker]", e);
  }

  // ─── Public API ───────────────────────────────────────────

  async init(languages: string[], userDictionary: string[] = []): Promise<void> {
    const toLoad = languages.filter(
      (l) => DICT_PATHS[l] && !this.loadedLangs.has(l) && !this.loadingLangs.has(l)
    );

    this.ready = (async () => {
      await Promise.all(toLoad.map((lang) => this.loadDictionary(lang)));

      // Remove languages no longer needed
      for (const lang of this.loadedLangs) {
        if (!languages.includes(lang)) {
          this.worker.postMessage({ type: "removeDict", lang });
          this.loadedLangs.delete(lang);
        }
      }

      // Load user dictionary
      for (const word of userDictionary) {
        this.worker.postMessage({ type: "addWord", word });
      }
    })();

    return this.ready;
  }

  /**
   * Check words and return a Set of misspelled words.
   * Uses cache for already-checked words.
   */
  async checkWords(words: string[]): Promise<Set<string>> {
    if (words.length === 0) return new Set();

    // Split into cached and uncached
    const uncached: string[] = [];
    const result = new Set<string>();

    for (const w of words) {
      const cached = this.cache.get(w);
      if (cached !== undefined) {
        if (cached) result.add(w);
      } else {
        uncached.push(w);
      }
    }

    if (uncached.length === 0) return result;

    // Group by detected language for batch checking
    const groups: { lang: string; words: string[] }[] = [];
    const langMap = new Map<string, string[]>();
    for (const w of uncached) {
      const lang = detectLang(w);
      if (!this.loadedLangs.has(lang)) {
        // No dictionary → treat as correct
        this.cacheSet(w, false);
        continue;
      }
      let arr = langMap.get(lang);
      if (!arr) { arr = []; langMap.set(lang, arr); }
      arr.push(w);
    }
    for (const [lang, ws] of langMap) groups.push({ lang, words: ws });

    if (groups.length === 0) return result;

    const id = String(nextId++);
    const misspelled: string[] = await this.send({
      type: "checkBatch",
      id,
      groups,
    }, id);

    const misspelledSet = new Set(misspelled);
    // Update cache
    for (const [, ws] of langMap) {
      for (const w of ws) {
        const bad = misspelledSet.has(w);
        this.cacheSet(w, bad);
        if (bad) result.add(w);
      }
    }

    return result;
  }

  async suggest(word: string): Promise<string[]> {
    const id = String(nextId++);
    return this.send(
      { type: "suggest", id, word, lang: detectLang(word) },
      id,
    );
  }

  addToUserDictionary(word: string): void {
    this.worker.postMessage({ type: "addWord", word });
    // Invalidate cache entries for this word
    this.cache.delete(word);
    this.cache.delete(word.toLowerCase());
  }

  clearCache(): void {
    this.cache.clear();
  }

  destroy(): void {
    this.worker.terminate();
    this.pending.clear();
    this.cache.clear();
    this.loadedLangs.clear();
    this.loadingLangs.clear();
  }

  get languages(): ReadonlySet<string> {
    return this.loadedLangs;
  }

  // ─── Private ──────────────────────────────────────────────

  /** Add to cache with eviction when over size limit */
  private cacheSet(word: string, misspelled: boolean): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entries (Map preserves insertion order)
      const toDelete = this.cache.size - MAX_CACHE_SIZE + 1000;
      let i = 0;
      for (const key of this.cache.keys()) {
        if (i++ >= toDelete) break;
        this.cache.delete(key);
      }
    }
    this.cache.set(word, misspelled);
  }

  private async loadDictionary(lang: string): Promise<void> {
    if (this.loadingLangs.has(lang)) return; // already loading
    this.loadingLangs.add(lang);

    const paths = DICT_PATHS[lang];
    if (!paths) {
      this.loadingLangs.delete(lang);
      throw new Error(`Unknown language: ${lang}`);
    }

    try {
      const base = import.meta.env.BASE_URL || "/";
      const [affResp, dicResp] = await Promise.all([
        fetch(`${base}${paths.aff}`),
        fetch(`${base}${paths.dic}`),
      ]);

      if (!affResp.ok || !dicResp.ok) {
        throw new Error(`Failed to load dictionary for ${lang}`);
      }

      const [aff, dic] = await Promise.all([
        affResp.arrayBuffer(),
        dicResp.arrayBuffer(),
      ]);

      const id = `init-${lang}`;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Dictionary load timed out for ${lang}`));
        }, 30000);

        this.pending.set(id, {
          resolve: () => { clearTimeout(timer); this.loadedLangs.add(lang); resolve(); },
          reject: (err) => { clearTimeout(timer); reject(err); },
        });
        this.worker.postMessage({ type: "init", lang, aff, dic }, [aff, dic]);
      });
    } finally {
      this.loadingLangs.delete(lang);
    }
  }

  private send(msg: any, id: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Spellcheck request timed out (id=${id})`));
      }, 10000);

      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this.worker.postMessage(msg);
    });
  }

  private handleMessage(data: any): void {
    switch (data.type) {
      case "initDone": {
        const p = this.pending.get(`init-${data.lang}`);
        if (p) { this.pending.delete(`init-${data.lang}`); p.resolve(undefined); }
        break;
      }
      case "checkResult": {
        const p = this.pending.get(data.id);
        if (p) { this.pending.delete(data.id); p.resolve(data.misspelled); }
        break;
      }
      case "suggestResult": {
        const p = this.pending.get(data.id);
        if (p) { this.pending.delete(data.id); p.resolve(data.suggestions); }
        break;
      }
      case "error": {
        console.error("[spellcheck-worker]", data.message);
        // Reject the pending request if we have an id
        if (data.id) {
          const p = this.pending.get(data.id);
          if (p) { this.pending.delete(data.id); p.reject(new Error(data.message)); }
        }
        break;
      }
    }
  }
}

/** Simple heuristic: Cyrillic → 'ru', else → 'en' */
function detectLang(word: string): string {
  return /[\u0400-\u04FF]/.test(word) ? "ru" : "en";
}
