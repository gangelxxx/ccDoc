import { useState } from "react";
import { useT } from "../../../i18n.js";
import type { BoardView } from "./types.js";

export function ViewTabs({
  views,
  activeViewId,
  onSelectView,
  onAddView,
  onRenameView,
  onDeleteView,
}: {
  views: BoardView[];
  activeViewId: string;
  onSelectView: (id: string) => void;
  onAddView: (type: "board" | "table" | "list") => void;
  onRenameView: (id: string, name: string) => void;
  onDeleteView: (id: string) => void;
}) {
  const t = useT();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingTab, setEditingTab] = useState<string | null>(null);

  return (
    <div className="kanban-view-tabs">
      {views.map((v) => (
        <div
          key={v.id}
          className={`kanban-view-tab ${v.id === activeViewId ? "active" : ""}`}
          onClick={() => onSelectView(v.id)}
          onDoubleClick={() => setEditingTab(v.id)}
        >
          {editingTab === v.id ? (
            <input
              className="kanban-view-tab-input"
              defaultValue={v.name}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                onRenameView(v.id, e.target.value.trim() || v.name);
                setEditingTab(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingTab(null);
              }}
            />
          ) : (
            <>
              <span className="kanban-view-tab-icon">
                {v.type === "board" ? "▦" : v.type === "table" ? "▤" : "☰"}
              </span>
              <span>{v.name}</span>
              {views.length > 1 && (
                <button
                  className="btn-icon kanban-view-tab-close"
                  onClick={(e) => { e.stopPropagation(); onDeleteView(v.id); }}
                >
                  ×
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <div className="kanban-view-tab-add" style={{ position: "relative" }}>
        <button className="kanban-toolbar-btn" onClick={() => setShowAddMenu(!showAddMenu)}>+</button>
        {showAddMenu && (
          <div className="kanban-view-add-menu">
            <div className="kanban-context-item" onClick={() => { onAddView("board"); setShowAddMenu(false); }}>▦ {t("kanbanViewBoard")}</div>
            <div className="kanban-context-item" onClick={() => { onAddView("table"); setShowAddMenu(false); }}>▤ {t("kanbanViewTable")}</div>
            <div className="kanban-context-item" onClick={() => { onAddView("list"); setShowAddMenu(false); }}>☰ {t("kanbanViewList")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
