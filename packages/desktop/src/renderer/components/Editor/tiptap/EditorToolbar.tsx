import type { Editor } from "@tiptap/react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks, Quote, SquareCode, Table2, Minus,
  Link2, Unlink, Underline, Highlighter,
  AlignLeft, AlignCenter, AlignRight,
  Image, Undo2, Redo2, ClipboardCopy,
} from "lucide-react";
import { VoiceButton } from "../../VoiceButton/VoiceButton.js";

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const t = useT();
  const [linkPopup, setLinkPopup] = useState<{ url: string } | null>(null);

  const openLinkPopup = useCallback(() => {
    if (!editor) return;
    const existing = editor.getAttributes("link").href ?? "";
    setLinkPopup({ url: existing });
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor || !linkPopup) return;
    const url = linkPopup.url.trim();
    if (url) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setLinkPopup(null);
  }, [editor, linkPopup]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkPopup(null);
  }, [editor]);

  const insertImage = useCallback(async () => {
    if (!editor) return;
    const dataUrl = await window.api.pickImage();
    if (dataUrl) {
      editor.chain().focus().setImage({ src: dataUrl }).run();
    }
  }, [editor]);

  const copyDocument = useCallback(async () => {
    const store = useAppStore.getState();
    const section = store.currentSection;
    const project = store.currentProject;
    if (!section || !project) return;
    try {
      const md = await window.api.getSectionContent(project.token, section.id, "markdown");
      await navigator.clipboard.writeText(md);
      store.addToast("success", t("markdownCopied"));
    } catch (e: any) {
      store.addToast("error", t("copyFailed"), e.message);
    }
  }, [t]);

  if (!editor) return null;

  return (
    <>
      <div className="editor-toolbar">
        <MenuBtn onClick={() => editor.chain().focus().undo().run()} icon={Undo2} title={t("toolbarUndo")} />
        <MenuBtn onClick={() => editor.chain().focus().redo().run()} icon={Redo2} title={t("toolbarRedo")} />
        <span className="editor-menu-sep" />
        <MenuBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} icon={Bold} title={t("toolbarBold")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} icon={Italic} title={t("toolbarItalic")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} icon={Underline} title={t("toolbarUnderline")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} icon={Strikethrough} title={t("toolbarStrikethrough")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} icon={Code} title={t("toolbarInlineCode")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} icon={Highlighter} title={t("toolbarHighlight")} />
        <span className="editor-menu-sep" />
        <MenuBtn onClick={openLinkPopup} active={editor.isActive("link")} icon={Link2} title={t("toolbarLink")} />
        {editor.isActive("link") && (
          <MenuBtn onClick={removeLink} icon={Unlink} title={t("toolbarRemoveLink")} />
        )}
        <span className="editor-menu-sep" />
        <MenuBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} icon={Heading1} title="H1" />
        <MenuBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} icon={Heading2} title="H2" />
        <MenuBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} icon={Heading3} title="H3" />
        <span className="editor-menu-sep" />
        <MenuBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} icon={List} title={t("toolbarBulletList")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} icon={ListOrdered} title={t("toolbarNumberedList")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} icon={ListChecks} title={t("toolbarTaskList")} />
        <span className="editor-menu-sep" />
        <MenuBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} icon={AlignLeft} title={t("toolbarAlignLeft")} />
        <MenuBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} icon={AlignCenter} title={t("toolbarAlignCenter")} />
        <MenuBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} icon={AlignRight} title={t("toolbarAlignRight")} />
        <span className="editor-menu-sep" />
        <MenuBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} icon={Quote} title={t("toolbarBlockquote")} />
        <MenuBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} icon={SquareCode} title={t("toolbarCodeBlock")} />
        <MenuBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} icon={Minus} title={t("toolbarDivider")} />
        <MenuBtn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} icon={Table2} title={t("toolbarTable")} />
        <MenuBtn onClick={insertImage} icon={Image} title={t("toolbarImage")} />
        <span className="editor-menu-sep" />
        <MenuBtn onClick={copyDocument} icon={ClipboardCopy} title={t("toolbarCopyDoc")} />
        <span className="editor-menu-sep" />
        <VoiceButton
          onTranscript={(text) => editor.commands.insertContent(text)}
          size={15}
        />
      </div>
      {linkPopup && (
        <LinkPopup
          url={linkPopup.url}
          onChange={(url) => setLinkPopup({ url })}
          onApply={applyLink}
          onRemove={removeLink}
          onClose={() => setLinkPopup(null)}
        />
      )}
    </>
  );
}

function LinkPopup({
  url, onChange, onApply, onRemove, onClose,
}: {
  url: string;
  onChange: (url: string) => void;
  onApply: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  return (
    <div className="editor-link-popup">
      <input
        ref={inputRef}
        type="url"
        className="editor-link-input"
        placeholder="https://..."
        value={url}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onApply(); }
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
      />
      <button className="editor-link-apply" onClick={onApply} title={t("toolbarApply")}>OK</button>
      {url && (
        <button className="editor-link-remove" onClick={onRemove} title={t("toolbarRemoveLink")}>
          <Unlink size={14} />
        </button>
      )}
    </div>
  );
}

function MenuBtn({ onClick, active, icon: Icon, title }: {
  onClick: () => void;
  active?: boolean;
  icon: React.ComponentType<{ size?: number }>;
  title: string;
}) {
  return (
    <button
      className={`editor-menu-btn${active ? " active" : ""}`}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
    >
      <Icon size={15} />
    </button>
  );
}
