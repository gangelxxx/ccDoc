import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n.js";
import type { TreeNode } from "./tree-utils.js";
import { findNode } from "./tree-utils.js";

const FOLDER_ICONS = [
  null, "\uD83D\uDCC1", "\uD83D\uDCC2", "\uD83D\uDCDA", "\u2B50", "\uD83D\uDD27",
  "\uD83C\uDFAF", "\uD83D\uDE80", "\uD83D\uDCAC", "\uD83C\uDFA8", "\uD83D\uDCC8",
  "\uD83D\uDD12", "\u2764\uFE0F", "\uD83C\uDF1F", "\uD83D\uDEE0\uFE0F", "\uD83C\uDF10",
  "\uD83D\uDCCB", "\uD83D\uDCC5", "\u26A1",
];

interface CreateModalProps {
  parentId: string | null;
  defaultType: string;
  tree: TreeNode[];
  onCreate: (parentId: string | null, title: string, type: string, icon: string | null) => void;
  onClose: () => void;
}

export function CreateModal({ parentId, defaultType, tree, onCreate, onClose }: CreateModalProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [sectionType, setSectionType] = useState(defaultType);
  const [icon, setIcon] = useState<string | null>(null);

  const handleCreate = () => {
    if (!title.trim()) return;
    onCreate(parentId, title.trim(), sectionType, icon);
  };

  const parentNode = parentId ? findNode(tree, parentId) : null;
  const parentType = parentNode?.type;

  const typeOptions = (() => {
    if (parentType === "file" || parentType === "section") {
      return [["section", "\u00A7", t("typeSection")]] as const;
    }
    if (parentType === "folder") {
      return [
        ["file", "\uD83D\uDCC4", t("typeFile")],
        ["folder", "\uD83D\uDCC1", t("typeFolder")],
        ["idea", "\uD83D\uDCA1", t("typeIdea")],
        ["todo", "\u2611\uFE0F", t("typeTodo")],
        ["kanban", "\uD83D\uDCCA", t("typeKanban")],
        ["drawing", "\u270F\uFE0F", t("typeWhiteboard")],
        ["knowledge_graph", "\uD83D\uDD2E", t("typeKnowledgeGraph")],
      ] as const;
    }
    // Root level -- only folders
    return [["folder", "\uD83D\uDCC1", t("typeFolder")]] as const;
  })();

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("newSectionTitle")}</h3>
        <input
          placeholder={t("titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          autoFocus
        />
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {typeOptions.map(([stype, ic, label]) => (
            <button
              key={stype}
              className={`btn btn-sm ${sectionType === stype ? "btn-primary" : ""}`}
              onClick={() => setSectionType(stype)}
            >
              {ic} {label}
            </button>
          ))}
        </div>
        {sectionType === "folder" && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, marginBottom: 4, display: "block", opacity: 0.7 }}>{t("folderIcon")}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {FOLDER_ICONS.map((ic) => (
                <button
                  key={ic ?? "default"}
                  className={`btn btn-sm ${icon === ic ? "btn-primary" : ""}`}
                  style={{ width: 32, height: 32, fontSize: 16, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => setIcon(ic)}
                  title={ic ? ic : "Default"}
                >
                  {ic ?? "\uD83D\uDCC1"}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{t("cancel")}</button>
          <button className="btn btn-primary" onClick={handleCreate}>{t("create")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
