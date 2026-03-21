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
import { useEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { CodeBlockWithLang, CustomImage, lowlight } from "./tiptap/extensions.js";
import { EditorToolbar } from "./tiptap/EditorToolbar.js";
import { TableContextMenu } from "./tiptap/TableContextMenu.js";

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
}

export function TipTapEditor({ sectionId, initialContent, title, showToolbar = true, toolbarPortalTarget, onEditorReady }: Props) {
  const updateSection = useAppStore((s) => s.updateSection);
  const t = useT();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedContent = useRef<string>(initialContent);
  const titleRef = useRef(title);
  titleRef.current = title;

  const setEditorSelectedText = useAppStore((s) => s.setEditorSelectedText);

  const editor = useEditor(
    {
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
        CustomImage.configure({ inline: false, allowBase64: true }),
      ],
      content: parseContent(initialContent),
      onUpdate: ({ editor }) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          const json = JSON.stringify(editor.getJSON());
          lastSavedContent.current = json;
          updateSection(sectionId, titleRef.current, json);
        }, 500);
      },
      onSelectionUpdate: ({ editor }) => {
        const { from, to } = editor.state.selection;
        setEditorSelectedText(from === to ? "" : editor.state.doc.textBetween(from, to, " "));
      },
      onFocus: () => {
        if (editor && onEditorReady) onEditorReady(editor);
      },
    },
    [sectionId]
  );

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

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
      const json = editor?.getJSON();
      if (json && sectionId) {
        const content = JSON.stringify(json);
        updateSection(sectionId, titleRef.current, content);
      }
    };
  }, [editor, sectionId, updateSection]);

  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (!editor) return;
      const target = e.target as HTMLElement;
      const inTable = target.closest("td, th") !== null;
      if (!inTable) return;
      e.preventDefault();
      setTableMenu({ x: e.clientX, y: e.clientY });
    },
    [editor],
  );

  // Close menu on any click outside (deferred to skip the current event)
  useEffect(() => {
    if (!tableMenu) return;
    const close = () => setTableMenu(null);
    const timer = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [tableMenu]);

  if (!editor) return null;

  return (
    <div className="tiptap-editor">
      {showToolbar && (toolbarPortalTarget
        ? createPortal(<EditorToolbar editor={editor} />, toolbarPortalTarget)
        : <EditorToolbar editor={editor} />
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
