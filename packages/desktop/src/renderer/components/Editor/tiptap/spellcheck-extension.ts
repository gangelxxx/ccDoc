/**
 * SpellcheckExtension — TipTap Extension that underlines misspelled words
 * using ProseMirror Decorations. Runs checks asynchronously via SpellcheckEngine.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { SpellcheckEngine } from "../../../services/spellcheck-engine.js";

export const spellcheckPluginKey = new PluginKey("spellcheck");

/**
 * Word extraction regex — supports Cyrillic, Latin, apostrophes.
 * Hyphens are NOT included so compound words like "well-known" are split
 * into parts and checked individually (matching Hunspell behavior).
 */
const WORD_RE = /[\p{L}\p{M}'']+/gu;

/** Node types to skip (their text content won't be checked) */
const SKIP_TYPES = new Set(["code", "codeBlock", "code_block"]);

/** Nodes whose marks include inline code should be skipped too */
const SKIP_MARKS = new Set(["code"]);

export interface SpellcheckOptions {
  debounceMs: number;
}

interface SpellcheckPluginState {
  decorations: DecorationSet;
  ignoredWords: Set<string>;
}

/**
 * Extract words from ProseMirror doc, skipping code blocks and inline code.
 * Returns { word, from, to }[] with document positions.
 */
function extractWords(doc: PMNode): { word: string; from: number; to: number }[] {
  const results: { word: string; from: number; to: number }[] = [];

  doc.descendants((node, pos) => {
    // Skip code blocks entirely
    if (SKIP_TYPES.has(node.type.name)) return false;

    if (node.isText && node.text) {
      // Skip text with code mark
      if (node.marks.some((m) => SKIP_MARKS.has(m.type.name))) return;

      const text = node.text;
      let match: RegExpExecArray | null;
      WORD_RE.lastIndex = 0;
      while ((match = WORD_RE.exec(text)) !== null) {
        const word = match[0];
        // Skip single-character words
        if (word.length < 2) continue;
        if (!/\p{L}/u.test(word)) continue;
        const from = pos + match.index;
        const to = from + word.length;
        results.push({ word, from, to });
      }
    }
  });

  return results;
}

export const SpellcheckExtension = Extension.create<SpellcheckOptions>({
  name: "spellcheck",

  addOptions() {
    return {
      debounceMs: 400,
    };
  },

  addStorage() {
    return {
      /** Mutable engine ref — set from TipTapEditor, read by the plugin */
      engine: null as SpellcheckEngine | null,
      /** Call this from outside to force a re-check (e.g. after dictionary change) */
      scheduleCheck: null as (() => void) | null,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: spellcheckPluginKey,

        state: {
          init(): SpellcheckPluginState {
            return {
              decorations: DecorationSet.empty,
              ignoredWords: new Set(),
            };
          },

          apply(tr: Transaction, prev: SpellcheckPluginState): SpellcheckPluginState {
            // Handle meta updates from async check results — must be a DecorationSet
            const newDecos = tr.getMeta(spellcheckPluginKey);
            if (newDecos instanceof DecorationSet) {
              return { ...prev, decorations: newDecos };
            }

            // Handle ignore word
            const ignoreWord: string | undefined = tr.getMeta("spellcheckIgnore");
            if (ignoreWord) {
              const ignored = new Set(prev.ignoredWords);
              ignored.add(ignoreWord.toLowerCase());
              // Remove decorations for ignored word
              const decos = prev.decorations.find().filter((d) => {
                const text = tr.doc.textBetween(d.from, d.to, "");
                return text.toLowerCase() !== ignoreWord.toLowerCase();
              });
              return {
                ignoredWords: ignored,
                decorations: DecorationSet.create(tr.doc, decos.map((d) =>
                  Decoration.inline(d.from, d.to, { class: "spelling-error" })
                )),
              };
            }

            // Map decorations on doc change
            if (tr.docChanged) {
              return {
                ...prev,
                decorations: prev.decorations.map(tr.mapping, tr.doc),
              };
            }

            return prev;
          },
        },

        props: {
          decorations(state: EditorState) {
            return spellcheckPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },

        view(view: EditorView) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let destroyed = false;
          let checking = false;

          const scheduleCheck = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => runCheck(view), extension.options.debounceMs);
          };

          // Expose scheduleCheck for external callers (e.g. add-to-dictionary)
          extension.storage.scheduleCheck = scheduleCheck;

          async function runCheck(v: EditorView) {
            if (destroyed || checking) return;
            const engine = extension.storage.engine;
            if (!engine) return;

            checking = true;
            try {
              // Wait for engine to be ready (dictionaries loaded)
              await engine.ready;
              if (destroyed) return;

              const docBefore = v.state.doc;
              const pluginState = spellcheckPluginKey.getState(v.state) as SpellcheckPluginState | undefined;
              const ignoredWords = pluginState?.ignoredWords ?? new Set<string>();

              const wordEntries = extractWords(docBefore);
              if (wordEntries.length === 0) {
                if (pluginState?.decorations !== DecorationSet.empty) {
                  v.dispatch(v.state.tr.setMeta(spellcheckPluginKey, DecorationSet.empty));
                }
                return;
              }

              // Deduplicate words for the engine
              const uniqueWords = [...new Set(wordEntries.map((e) => e.word))];

              const misspelled = await engine.checkWords(uniqueWords);
              if (destroyed) return;

              // Document changed during async check — discard and re-schedule
              if (v.state.doc !== docBefore) {
                scheduleCheck();
                return;
              }

              // Build decorations
              const decos: Decoration[] = [];
              for (const entry of wordEntries) {
                if (ignoredWords.has(entry.word.toLowerCase())) continue;
                if (misspelled.has(entry.word)) {
                  decos.push(
                    Decoration.inline(entry.from, entry.to, { class: "spelling-error" })
                  );
                }
              }

              const decoSet = DecorationSet.create(v.state.doc, decos);
              v.dispatch(v.state.tr.setMeta(spellcheckPluginKey, decoSet));
            } catch (err) {
              console.error("[spellcheck] check failed:", err);
            } finally {
              checking = false;
            }
          }

          // Initial check
          scheduleCheck();

          return {
            update(view: EditorView, prevState: EditorState) {
              if (view.state.doc !== prevState.doc) {
                scheduleCheck();
              }
            },
            destroy() {
              destroyed = true;
              if (timer) clearTimeout(timer);
              extension.storage.scheduleCheck = null;
            },
          };
        },
      }),
    ];
  },
});
