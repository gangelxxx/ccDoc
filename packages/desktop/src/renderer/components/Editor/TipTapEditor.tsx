import {
  useEditor, EditorContent,
} from "@tiptap/react";
import type { Editor, } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import UnderlineExt from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { useEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { CodeBlockWithLang, CustomImage, SelectionPreserve, lowlight } from "./tiptap/extensions.js";
import { EditorToolbar } from "./tiptap/EditorToolbar.js";
import { TableContextMenu } from "./tiptap/TableContextMenu.js";
import { ContextMenu } from "../ContextMenu/ContextMenu.js";
import { SpellcheckExtension, spellcheckPluginKey } from "./tiptap/spellcheck-extension.js";
import { SpellcheckMenu } from "./tiptap/SpellcheckMenu.js";
import { SpellcheckEngine } from "../../services/spellcheck-engine.js";
import { getEditorContextMenuItems, type EditorMenuItem } from "./editor-context-menu.js";

// Re-export for consumers that import from this file
export { EditorToolbar } from "./tiptap/EditorToolbar.js";

// ============================================
// Main TipTapEditor
// ============================================

interface Props {
  sectionId: string;
  initialContent: string;
  title: string;
  showToolbar?: boolean;
  toolbarPortalTarget?: HTMLElement | null;
  onEditorReady?: (editor: Editor) => void;
  /** Called when the editor gains focus (distinct from mount/ready) */
  onEditorFocus?: (editor: Editor) => void;
  /** Called when a taskItem goes from unchecked to checked */
  onTaskChecked?: (taskText: string) => void;
}

/** Extract a map of taskItem text -> checked from ProseMirror JSON */
function extractTaskStates(json: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  try {
    const doc = JSON.parse(json);
    const walk = (node: any) => {
      if (node.type === "taskItem") {
        const text = extractNodeText(node).trim();
        if (text) map.set(text, !!node.attrs?.checked);
      }
      if (node.content) node.content.forEach(walk);
    };
    walk(doc);
  } catch { /* ignore */ }
  return map;
}

function extractNodeText(node: any): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(extractNodeText).join("");
}

// Singleton SpellcheckEngine — shared across all editor instances
let sharedEngine: SpellcheckEngine | null = null;
let engineRefCount = 0;
let engineLangsKey = ""; // serialized languages for change detection

function acquireEngine(languages: string[], userDictionary: string[]): SpellcheckEngine {
  const langsKey = languages.slice().sort().join(",");
  if (sharedEngine && engineLangsKey !== langsKey) {
    // Languages changed — recreate engine, reset refcount
    sharedEngine.destroy();
    sharedEngine = null;
    engineRefCount = 0;
  }
  if (!sharedEngine) {
    sharedEngine = new SpellcheckEngine();
    engineLangsKey = langsKey;
    sharedEngine.init(languages, userDictionary).catch((err) =>
      console.error("[spellcheck] init failed:", err)
    );
  }
  engineRefCount++;
  return sharedEngine;
}

function releaseEngine(): void {
  engineRefCount--;
  if (engineRefCount <= 0) {
    sharedEngine?.destroy();
    sharedEngine = null;
    engineRefCount = 0;
    engineLangsKey = "";
  }
}

export function TipTapEditor({ sectionId, initialContent, title, showToolbar = true, toolbarPortalTarget, onEditorReady, onEditorFocus, onTaskChecked }: Props) {
  const updateSection = useAppStore((s) => s.updateSection);
  const markEditorDirty = useAppStore((s) => s.markEditorDirty);
  const markEditorClean = useAppStore((s) => s.markEditorClean);
  const t = useT();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedContent = useRef<string>(initialContent);
  const titleRef = useRef(title);
  titleRef.current = title;
  const editorCreateTime = useRef(performance.now());
  const hasEdits = useRef(false);
  const onTaskCheckedRef = useRef(onTaskChecked);
  onTaskCheckedRef.current = onTaskChecked;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const onEditorFocusRef = useRef(onEditorFocus);
  onEditorFocusRef.current = onEditorFocus;

  const setEditorSelectedText = useAppStore((s) => s.setEditorSelectedText);
  const spellcheckConfig = useAppStore((s) => s.spellcheckConfig);
  const setSpellcheckConfig = useAppStore((s) => s.setSpellcheckConfig);

  // Spellcheck engine — singleton lifecycle, reads config from store.
  // Engine ref stored in extension.storage so the ProseMirror plugin always sees the latest.
  const engineRef = useRef<SpellcheckEngine | null>(null);
  const langsKey = spellcheckConfig.languages.slice().sort().join(",");

  useEffect(() => {
    if (spellcheckConfig.enabled) {
      engineRef.current = acquireEngine(spellcheckConfig.languages, spellcheckConfig.userDictionary);
    } else if (engineRef.current) {
      releaseEngine();
      engineRef.current = null;
    }
    return () => {
      if (engineRef.current) {
        releaseEngine();
        engineRef.current = null;
      }
    };
  }, [spellcheckConfig.enabled, langsKey]); // langsKey is a stable string

  const editor = useEditor(
    {
      editorProps: {
        attributes: { spellcheck: "false" },
      },
      onCreate: () => {
        console.log(`[perf] TipTapEditor CREATED +${(performance.now() - editorCreateTime.current).toFixed(0)}ms id=${sectionId.substring(0, 8)} contentLen=${initialContent?.length ?? 0}`);
      },
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        CodeBlockWithLang.configure({
          lowlight,
          HTMLAttributes: { class: "code-block" },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        Link.configure({ openOnClick: false }),
        Placeholder.configure({ placeholder: t("editorPlaceholder") }),
        UnderlineExt,
        Highlight.configure({ multicolor: false }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TextStyle,
        Color,
        CustomImage.configure({ inline: false, allowBase64: true }),
        SelectionPreserve,
        SpellcheckExtension,
      ],
      content: parseContent(initialContent),
      onUpdate: ({ editor }) => {
        hasEdits.current = true;
        markEditorDirty(sectionId);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          const json = JSON.stringify(editor.getJSON());
          // Detect task completion before overwriting lastSaved
          if (onTaskCheckedRef.current) {
            const prevStates = extractTaskStates(lastSavedContent.current);
            const newStates = extractTaskStates(json);
            for (const [text, checked] of newStates) {
              if (checked && prevStates.has(text) && !prevStates.get(text)) {
                onTaskCheckedRef.current(text);
                break; // one trigger per save cycle
              }
            }
          }
          lastSavedContent.current = json;
          updateSection(sectionId, titleRef.current, json);
          markEditorClean(sectionId);
        }, 500);
      },
      onSelectionUpdate: ({ editor }) => {
        if (!editor.isFocused) return; // Don't clear selection when editor loses focus
        const { from, to } = editor.state.selection;
        setEditorSelectedText(from === to ? "" : editor.state.doc.textBetween(from, to, " "));
      },
      onBlur: ({ event }) => {
        const related = (event as FocusEvent).relatedTarget as HTMLElement | null;
        const isLlm = related?.closest(".llm-panel") || related?.closest("[data-llm-toggle]");
        if (!isLlm && useAppStore.getState().editorSelectedText) {
          setEditorSelectedText("");
        }
      },
      onFocus: () => {
        if (editor) {
          if (onEditorFocusRef.current) onEditorFocusRef.current(editor);
          else onEditorReadyRef.current?.(editor);
        }
      },
    },
    [sectionId]
  );

  useEffect(() => {
    if (editor) {
      // Notify parent once on mount (for non-FileView single editors)
      onEditorReadyRef.current?.(editor);
      // Store ProseMirror view ref for selection decoration clearing
      useAppStore.getState().setEditorView(editor.view);
    }
  }, [editor]);

  // Sync engine ref into extension storage so ProseMirror plugin always reads latest
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.storage.spellcheck.engine = engineRef.current;
    // Recheck with new engine
    editor.storage.spellcheck.scheduleCheck?.();
  }, [editor, spellcheckConfig.enabled, langsKey]);

  // Sync from external changes (e.g. LLM tool calls)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (initialContent !== lastSavedContent.current) {
      lastSavedContent.current = initialContent;
      const parsed = parseContent(initialContent);
      editor.commands.setContent(parsed);
    }
  }, [initialContent, editor]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Only save on unmount if user actually edited — prevents unnecessary
      // getJSON() + IPC calls that accumulate when clicking through sections.
      if (hasEdits.current && editor && !editor.isDestroyed) {
        const json = editor.getJSON();
        if (json && sectionId) {
          const content = JSON.stringify(json);
          updateSection(sectionId, titleRef.current, content);
        }
      }
      // Clean up dirty state on unmount to prevent stale entries
      markEditorClean(sectionId);
    };
  }, [editor, sectionId, updateSection, markEditorClean]);

  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number; hasSelection: boolean; clipboardHasContent: boolean } | null>(null);
  const [spellMenu, setSpellMenu] = useState<{
    x: number; y: number; word: string; from: number; to: number;
    suggestions: string[]; loading: boolean;
  } | null>(null);

  const handlePasteMarkdown = useCallback(async () => {
    if (!editor) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) return;
      const pmJson = await (window as any).api.convertMdToProsemirror(text);
      if (pmJson?.content) {
        editor.chain().focus().insertContent(pmJson.content).run();
      }
    } catch (err) {
      console.warn("[paste-md] failed:", err);
    }
  }, [editor]);

  const handleContextMenu = useCallback(
    async (e: ReactMouseEvent) => {
      if (!editor) return;
      const target = e.target as HTMLElement;

      // Spellcheck: right-click on a misspelled word
      const spellingEl = target.closest(".spelling-error") as HTMLElement | null;
      if (spellingEl && engineRef.current) {
        e.preventDefault();
        const word = spellingEl.textContent || "";
        // Use decoration range for reliable word positions (handles multi-mark paragraphs)
        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (pos) {
          const pluginState = spellcheckPluginKey.getState(editor.state);
          const decos = pluginState?.decorations?.find(pos.pos, pos.pos) ?? [];
          const deco = decos[0];
          if (deco) {
            setSpellMenu({
              x: e.clientX, y: e.clientY, word,
              from: deco.from, to: deco.to,
              suggestions: [], loading: true,
            });
            engineRef.current.suggest(word).then((suggestions) => {
              setSpellMenu((prev) => prev ? { ...prev, suggestions: suggestions.slice(0, 5), loading: false } : null);
            }).catch(() => {
              setSpellMenu((prev) => prev ? { ...prev, loading: false } : null);
            });
          }
        }
        return;
      }

      const inTable = target.closest("td, th") !== null;
      if (inTable) {
        e.preventDefault();
        setTableMenu({ x: e.clientX, y: e.clientY });
        return;
      }
      e.preventDefault();
      const hasSelection = !editor.state.selection.empty;
      // Check clipboard content asynchronously, show menu immediately
      let clipboardHasContent = true; // optimistic default
      try {
        const text = await navigator.clipboard.readText();
        clipboardHasContent = text.length > 0;
      } catch { /* Clipboard API may be blocked — assume content exists */ }
      setEditorMenu({ x: e.clientX, y: e.clientY, hasSelection, clipboardHasContent });
    },
    [editor],
  );

  // Close menu on any click outside (deferred to skip the current event)
  useEffect(() => {
    if (!tableMenu && !editorMenu && !spellMenu) return;
    const close = () => { setTableMenu(null); setEditorMenu(null); setSpellMenu(null); };
    const timer = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [tableMenu, editorMenu, spellMenu]);

  if (!editor) return null;

  return (
    <div className="tiptap-editor">
      {showToolbar && (toolbarPortalTarget
        ? createPortal(<EditorToolbar editor={editor} sectionId={sectionId} sectionTitle={title} />, toolbarPortalTarget)
        : <EditorToolbar editor={editor} sectionId={sectionId} sectionTitle={title} />
      )}
      <div onContextMenu={handleContextMenu}>
        <EditorContent editor={editor} />
      </div>
      {tableMenu && (
        <TableContextMenu
          editor={editor}
          position={tableMenu}
          onClose={() => setTableMenu(null)}
        />
      )}
      {editorMenu && (
        <ContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          items={getEditorContextMenuItems(editorMenu.hasSelection, editorMenu.clipboardHasContent, t).map(
            (entry) => {
              if (entry === "sep") return entry;
              const item = entry as EditorMenuItem;
              const actions: Record<string, () => void> = {
                cut: () => { editor.commands.focus(); document.execCommand("cut"); },
                copy: () => { editor.commands.focus(); document.execCommand("copy"); },
                paste: async () => {
                  editor.commands.focus();
                  try {
                    const clipItems = await navigator.clipboard.read();
                    for (const ci of clipItems) {
                      if (ci.types.includes("text/html")) {
                        const blob = await ci.getType("text/html");
                        const html = await blob.text();
                        editor.commands.insertContent(html);
                        return;
                      }
                      if (ci.types.includes("text/plain")) {
                        const blob = await ci.getType("text/plain");
                        const text = await blob.text();
                        editor.commands.insertContent(text);
                        return;
                      }
                    }
                  } catch { document.execCommand("paste"); }
                },
                selectAll: () => { editor.chain().focus().selectAll().run(); },
                pasteMarkdown: handlePasteMarkdown,
              };
              return { ...item, onClick: actions[item.id] ?? (() => {}) };
            },
          )}
          onClose={() => setEditorMenu(null)}
        />
      )}
      {spellMenu && (
        <SpellcheckMenu
          x={spellMenu.x}
          y={spellMenu.y}
          word={spellMenu.word}
          suggestions={spellMenu.suggestions}
          loading={spellMenu.loading}
          onReplace={(suggestion) => {
            editor.chain().focus()
              .deleteRange({ from: spellMenu.from, to: spellMenu.to })
              .insertContentAt(spellMenu.from, suggestion)
              .run();
            setSpellMenu(null);
          }}
          onAddToDictionary={() => {
            const lower = spellMenu.word.toLowerCase();
            engineRef.current?.addToUserDictionary(lower);
            engineRef.current?.clearCache();
            // Persist via settings store
            const dict = [...spellcheckConfig.userDictionary];
            if (!dict.includes(lower)) {
              dict.push(lower);
              setSpellcheckConfig({ userDictionary: dict });
            }
            // Remove decorations for this word (like Ignore) then recheck
            editor.view.dispatch(
              editor.state.tr.setMeta("spellcheckIgnore", spellMenu.word)
            );
            setSpellMenu(null);
          }}
          onIgnore={() => {
            editor.view.dispatch(
              editor.state.tr.setMeta("spellcheckIgnore", spellMenu.word)
            );
            setSpellMenu(null);
          }}
          onClose={() => setSpellMenu(null)}
        />
      )}
    </div>
  );
}

function parseContent(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
}
