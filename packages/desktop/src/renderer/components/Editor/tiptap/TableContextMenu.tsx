import type { Editor } from "@tiptap/react";
import { useT } from "../../../i18n.js";

export function TableContextMenu({
  editor,
  position,
  onClose,
}: {
  editor: Editor;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const t = useT();
  const run = (cmd: () => void) => { cmd(); onClose(); };

  const items: Array<{ label: string; action: () => void; danger?: boolean } | "separator"> = [
    { label: t("tableAddColBefore"), action: () => run(() => editor.chain().focus().addColumnBefore().run()) },
    { label: t("tableAddColAfter"), action: () => run(() => editor.chain().focus().addColumnAfter().run()) },
    { label: t("tableDeleteCol"), action: () => run(() => editor.chain().focus().deleteColumn().run()) },
    "separator",
    { label: t("tableAddRowAbove"), action: () => run(() => editor.chain().focus().addRowBefore().run()) },
    { label: t("tableAddRowBelow"), action: () => run(() => editor.chain().focus().addRowAfter().run()) },
    { label: t("tableDeleteRow"), action: () => run(() => editor.chain().focus().deleteRow().run()) },
    "separator",
    { label: t("tableDelete"), action: () => run(() => editor.chain().focus().deleteTable().run()), danger: true },
  ];

  return (
    <div
      className="table-context-menu"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="table-context-menu-sep" />
        ) : (
          <button
            key={item.label}
            className={`table-context-menu-item${item.danger ? " danger" : ""}`}
            onClick={item.action}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
