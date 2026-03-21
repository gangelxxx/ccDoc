import { useState } from "react";
import type { KanbanCard, KanbanColumn, PropertyDefinition, BoardSettings } from "./types.js";
import { PropertyBadge } from "./PropertyBadge.js";

export function ListView({
  columns,
  properties,
  settings,
  onOpenCard,
  onUpdateCard,
  onToggleCardDone,
}: {
  columns: KanbanColumn[];
  properties: PropertyDefinition[];
  settings: BoardSettings;
  onOpenCard: (colId: string, cardId: string) => void;
  onUpdateCard: (colId: string, cardId: string, updates: Partial<KanbanCard>) => void;
  onToggleCardDone: (fromColId: string, cardId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (colId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  };

  const visibleProps = properties.filter((p) => p.isVisible).slice(0, 4);
  const hasDoneCol = columns.some((c) => c.isDone);

  return (
    <div className="kanban-list-view">
      {columns.map((col) => (
        <div key={col.id} className="kanban-list-group">
          <div className="kanban-list-group-header" onClick={() => toggleCollapse(col.id)}>
            <span className="kanban-list-collapse-icon">{collapsed.has(col.id) ? "▶" : "▼"}</span>
            <span className="kanban-list-group-title">{col.title}</span>
            <span className="kanban-column-count">{col.cards.length}</span>
          </div>
          {!collapsed.has(col.id) && (
            <div className="kanban-list-items">
              {col.cards.map((card) => (
                <div key={card.id} className={`kanban-list-item${col.isDone ? " kanban-list-item--done" : ""}`} onClick={() => onOpenCard(col.id, card.id)}>
                  {hasDoneCol && (
                    <input
                      type="checkbox"
                      checked={!!col.isDone}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleCardDone(col.id, card.id)}
                    />
                  )}
                  <span className={`kanban-list-item-title ${col.isDone ? "checked" : ""}`}>{card.title}</span>
                  <div className="kanban-list-item-props">
                    {visibleProps.map((prop) => (
                      <PropertyBadge key={prop.id} prop={prop} value={card.properties[prop.id]} options={prop.options} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
