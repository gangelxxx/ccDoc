import {
  ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import ImageExt from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  AlignLeft, AlignCenter, AlignRight,
  Trash2, Replace,
} from "lucide-react";

export const lowlight = createLowlight(common);

export const CODE_LANGUAGES = [
  { value: "", label: "Auto" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Bash" },
  { value: "sql", label: "SQL" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "markdown", label: "Markdown" },
];

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="code-block-wrapper">
      <select
        contentEditable={false}
        className="code-block-lang-select"
        value={node.attrs.language || ""}
        onChange={(e) => updateAttributes({ language: e.target.value })}
      >
        {CODE_LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlockWithLang = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});

// ============================================
// Custom Image with resize + toolbar
// ============================================

function ImageNodeView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const startData = useRef<{ startX: number; startY: number; startW: number; ratio: number }>({
    startX: 0, startY: 0, startW: 0, ratio: 1,
  });

  const width = node.attrs.width as number | null;
  const textAlign = (node.attrs.textAlign as string) || "center";

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = wrapperRef.current?.querySelector("img");
    if (!img) return;
    const rect = img.getBoundingClientRect();
    startData.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, ratio: rect.height / rect.width };
    setResizing(true);

    const onMove = (ev: globalThis.MouseEvent) => {
      const dx = ev.clientX - startData.current.startX;
      const newW = Math.max(50, startData.current.startW + dx);
      updateAttributes({ width: Math.round(newW) });
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [updateAttributes]);

  const replaceImage = useCallback(async () => {
    const dataUrl = await window.api.pickImage();
    if (dataUrl) updateAttributes({ src: dataUrl });
    setShowMenu(false);
  }, [updateAttributes]);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const close = (e: globalThis.MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    setTimeout(() => window.addEventListener("mousedown", close), 0);
    return () => window.removeEventListener("mousedown", close);
  }, [showMenu]);

  const justify = textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start";

  return (
    <NodeViewWrapper
      className={`image-node-wrapper${selected ? " selected" : ""}${resizing ? " resizing" : ""}`}
      style={{ justifyContent: justify }}
    >
      <div ref={wrapperRef} className="image-node-inner" style={{ width: width ? `${width}px` : undefined }}>
        <img
          src={node.attrs.src as string}
          alt={node.attrs.alt as string || ""}
          title={node.attrs.title as string || undefined}
          draggable={false}
          onClick={() => setShowMenu((v) => !v)}
        />
        {/* Resize handles */}
        {selected && (
          <>
            <div className="image-resize-handle nw" onMouseDown={onResizeStart} />
            <div className="image-resize-handle ne" onMouseDown={onResizeStart} />
            <div className="image-resize-handle sw" onMouseDown={onResizeStart} />
            <div className="image-resize-handle se" onMouseDown={onResizeStart} />
          </>
        )}
        {/* Floating menu */}
        {showMenu && (
          <div className="image-toolbar" contentEditable={false}>
            <button className={textAlign === "left" ? "active" : ""} onClick={() => updateAttributes({ textAlign: "left" })} title="Align left"><AlignLeft size={15} /></button>
            <button className={textAlign === "center" ? "active" : ""} onClick={() => updateAttributes({ textAlign: "center" })} title="Align center"><AlignCenter size={15} /></button>
            <button className={textAlign === "right" ? "active" : ""} onClick={() => updateAttributes({ textAlign: "right" })} title="Align right"><AlignRight size={15} /></button>
            <span className="image-toolbar-sep" />
            <button onClick={replaceImage} title="Replace image"><Replace size={15} /></button>
            <button onClick={() => deleteNode()} title="Delete image" className="danger"><Trash2 size={15} /></button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const CustomImage = ImageExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}) },
      textAlign: { default: "center", renderHTML: (attrs) => ({ "data-text-align": attrs.textAlign }) },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});
