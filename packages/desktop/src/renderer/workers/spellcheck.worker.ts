/**
 * Spellcheck Web Worker — runs nspell instances in a background thread.
 *
 * Messages IN:
 *   { type: 'init', lang, aff: ArrayBuffer, dic: ArrayBuffer }
 *   { type: 'check', id, words: string[], lang?: string }
 *   { type: 'checkBatch', id, groups: { lang, words }[] }
 *   { type: 'suggest', id, word: string, lang?: string }
 *   { type: 'addWord', word: string }
 *   { type: 'removeDict', lang: string }
 *
 * Messages OUT:
 *   { type: 'initDone', lang }
 *   { type: 'checkResult', id, misspelled: string[] }
 *   { type: 'suggestResult', id, suggestions: string[] }
 *   { type: 'error', id?, message: string }
 */
import nspell from "nspell";

const checkers = new Map<string, ReturnType<typeof nspell>>();
const userWords = new Set<string>();

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        const aff = new TextDecoder().decode(msg.aff as ArrayBuffer);
        const dic = new TextDecoder().decode(msg.dic as ArrayBuffer);
        const checker = nspell(aff, dic);
        // Re-add user words to new checker
        for (const w of userWords) checker.add(w);
        checkers.set(msg.lang, checker);
        self.postMessage({ type: "initDone", lang: msg.lang });
        break;
      }

      case "check": {
        const words: string[] = msg.words;
        const misspelled: string[] = [];
        for (const word of words) {
          if (userWords.has(word.toLowerCase())) continue;
          const lang = msg.lang || detectLang(word);
          const checker = checkers.get(lang);
          if (!checker) continue;
          if (!checker.correct(word)) {
            misspelled.push(word);
          }
        }
        self.postMessage({ type: "checkResult", id: msg.id, misspelled });
        break;
      }

      case "checkBatch": {
        const misspelled: string[] = [];
        for (const group of msg.groups) {
          const checker = checkers.get(group.lang);
          if (!checker) continue;
          for (const word of group.words) {
            if (userWords.has(word.toLowerCase())) continue;
            if (!checker.correct(word)) misspelled.push(word);
          }
        }
        self.postMessage({ type: "checkResult", id: msg.id, misspelled });
        break;
      }

      case "suggest": {
        const lang = msg.lang || detectLang(msg.word);
        const checker = checkers.get(lang);
        const suggestions = checker ? checker.suggest(msg.word).slice(0, 8) : [];
        self.postMessage({ type: "suggestResult", id: msg.id, suggestions });
        break;
      }

      case "addWord": {
        const word = msg.word;
        userWords.add(word.toLowerCase());
        for (const checker of checkers.values()) {
          checker.add(word);
        }
        break;
      }

      case "removeDict": {
        checkers.delete(msg.lang);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: "error", id: msg.id, message: err.message || String(err) });
  }
};

/** Simple heuristic: if word contains Cyrillic chars → 'ru', else → 'en' */
function detectLang(word: string): string {
  return /[\u0400-\u04FF]/.test(word) ? "ru" : "en";
}
