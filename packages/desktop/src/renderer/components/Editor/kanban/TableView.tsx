import { useState, useMemo } from "react";
import { useT } from "../../../i18n.js";
import type { KanbanCard, KanbanColumn, PropertyDefinition, BoardSettings } from "./types.js";
import { getAllCards } from "./utils.js";
import { PropertyEditor, PropertyDisplay } from "./PropertyEditor.js";

export function TableView({
  columns,
  properties,
  settings,
  onUpdateCard,
  onDeleteCard,
  onOpenCard,
  onToggleCardDone,
}: {
  columns: KanbanColumn[];
  properties: PropertyDefinition[];
  settings: BoardSettings;
  onUpdateCard: (colId: string, cardId: string, updates: Partial<KanbanCard>) => void;
  onDeleteCard: (colId: string, cardId: string) => void;
  onOpenCard: (colId: string, cardId: string) => void;
  onToggleCardDone: (fromColId: string, cardId: string) => void;
}) {
  const t = useT();
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingCell, setEditingCell] = useState<{ cardId: string; propId: string } | null>(null);

  const allCards = useMemo(() => getAllCards(columns), [columns]);
  const hasDoneCol = columns.some((c) => c.isDone);
  const doneColIds = useMemo(() => new Set(columns.filter((c) => c.isDone).map((c) => c.id)), [columns]);
  const visibleProps = properties.filter((p) => p.isVisible);

  const sorted = useMemo(() => {
    if (!sortCol) return allCards;
    return [...allCards].sort((a, b) => {
      let av: any, bv: any;
      if (sortCol === "__title") { av = a.title; bv = b.title; }
      else if (sortCol === "__status") { av = a._colTitle; bv = b._colTitle; }
      else { av = a.properties[sortCol]; bv = b.properties[sortCol]; }
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === "asc" ? 1 : -1;
      if (bv == null) return sortDir === "asc" ? -1 : 1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [allCards, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  return (
    <div className="kanban-table-wrap">
      <table className="kanban-table">
        <thead>
          <tr>
            <th className="kanban-table-th" onClick={() => toggleSort("__title")}>
              {t("kanbanTableTitle")} {sortCol === "__title" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </th>
            <th className="kanban-table-th" onClick={() => toggleSort("__status")}>
              {t("kanbanTableStatus")} {sortCol === "__status" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </th>
            {visibleProps.map((p) => (
              <th key={p.id} className="kanban-table-th" onClick={() => toggleSort(p.id)}>
                {p.name} {sortCol === p.id ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
            ))}
            <th className="kanban-table-th" style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((card) => (
            <tr key={card.id} className={`kanban-table-row${doneColIds.has(card._colId) ? " kanban-table-row--done" : ""}`} onClick={() => onOpenCard(card._colId, card.id)}>
              <td className="kanban-table-td">
                {hasDoneCol && (
                  <input
                    type="checkbox"
                    checked={doneColIds.has(card._colId)}
                    onChange={(e) => { e.stopPropagation(); onToggleCardDone(card._colId, card.id); }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginRight: 8 }}
                  />
                )}
                <span style={doneColIds.has(card._colId) ? { textDecoration: "line-through", opacity: 0.5 } : undefined}>{card.title}</span>
              </td>
              <td className="kanban-table-td">
                <span className="kanban-prop-badge" style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}>
                  {card._colTitle}
                </span>
              </td>
              {visibleProps.map((prop) => (
                <td
                  key={prop.id}
                  className="kanban-table-td kanban-table-cell-editable"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCell({ cardId: card.id, propId: prop.id });
                  }}
                >
                  {editingCell?.cardId === card.id && editingCell?.propId === prop.id ? (
                    <PropertyEditor
                      prop={prop}
                      value={card.properties[prop.id]}
                      onChange={(v) => {
                        onUpdateCard(card._colId, card.id, { properties: { ...card.properties, [prop.id]: v } });
                        setEditingCell(null);
                      }}
                      onClose={() => setEditingCell(null)}
                    />
                  ) : (
                    <PropertyDisplay prop={prop} value={card.properties[prop.id]} />
                  )}
                </td>
              ))}
              <td className="kanban-table-td">
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onDeleteCard(card._colId, card.id); }}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
