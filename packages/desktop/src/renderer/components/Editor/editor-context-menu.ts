/**
 * Pure logic for building editor context menu items.
 * Separated from TipTapEditor for testability.
 */

export interface EditorMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: string;
  disabled?: boolean;
}

export type EditorMenuEntry = EditorMenuItem | "sep";

/**
 * Builds the list of editor context menu entries based on current state.
 *
 * @param hasSelection  — whether the editor currently has a non-empty selection
 * @param clipboardHasContent — whether the clipboard contains text
 * @param t — translation function (key → localized string)
 */
export function getEditorContextMenuItems(
  hasSelection: boolean,
  clipboardHasContent: boolean,
  t: (key: string) => string,
): EditorMenuEntry[] {
  return [
    { id: "cut", label: t("editorCut"), shortcut: "Ctrl+X", disabled: !hasSelection },
    { id: "copy", label: t("editorCopy"), shortcut: "Ctrl+C", disabled: !hasSelection },
    { id: "paste", label: t("editorPaste"), shortcut: "Ctrl+V", disabled: !clipboardHasContent },
    "sep",
    { id: "selectAll", label: t("editorSelectAll"), shortcut: "Ctrl+A" },
    "sep",
    { id: "pasteMarkdown", label: t("pasteMarkdown"), icon: "📋" },
  ];
}
