import { useState, useCallback, useRef } from "react";
import { useT } from "../../../i18n.js";
import { useAppStore } from "../../../stores/app.store.js";
import type { KanbanCard, KanbanColumn, PropertyDefinition, BoardSettings, FocusedCard } from "./types.js";
import { computeCalculation } from "./utils.js";
import { PropertyBadge } from "./PropertyBadge.js";

// ── Single Card ──────────────────────────────────────────────

export function CardView({
  card,
  col,
  colIndex,
  cardIndex,
  focusedCard,
  dragCard,
  dropTarget,
  selectedCards,
  editingCard,
  cardSizeClass,
  isGrouped,
  settings,
  properties,
  processedColumns,
  onDragStart,
  onDragOver,
  onDragEnd,
  onCardClick,
  onContextMenu,
  onCheckChange,
  onTitleEdit,
  onTitleSave,
  onEditingCardChange,
  onDeleteCard,
}: {
  card: KanbanCard;
  col: KanbanColumn;
  colIndex: number;
  cardIndex: number;
  focusedCard: FocusedCard | null;
  dragCard: { cardId: string; fromColId: string } | null;
  dropTarget: { colId: string; index: number } | null;
  selectedCards: Set<string>;
  editingCard: string | null;
  cardSizeClass: string;
  isGrouped: boolean;
  settings: BoardSettings;
  properties: PropertyDefinition[];
  processedColumns: KanbanColumn[];
  onDragStart: (e: React.DragEvent, cardId: string, colId: string) => void;
  onDragOver: (e: React.DragEvent, colId: string, index: number) => void;
  onDragEnd: () => void;
  onCardClick: (e: React.MouseEvent, card: KanbanCard, col: KanbanColumn, colIndex: number, cardIndex: number) => void;
  onContextMenu: (e: React.MouseEvent, cardId: string, colId: string) => void;
  onCheckChange: (colId: string, cardId: string, checked: boolean) => void;
  onTitleEdit: (cardId: string) => void;
  onTitleSave: (colId: string, cardId: string, title: string, fallback: string) => void;
  onEditingCardChange: (id: string | null) => void;
  onDeleteCard: (colId: string, cardId: string) => void;
}) {
  const t = useT();
  const selectSection = useAppStore((s) => s.selectSection);
  const setScrollToMessageId = useAppStore((s) => s.setScrollToMessageId);
  const isFocused = focusedCard?.colIndex === colIndex && focusedCard?.cardIndex === cardIndex;

  return (
    <div key={card.id}>
      {dropTarget?.colId === col.id && dropTarget?.index === cardIndex && dragCard && (
        <div className="kanban-drop-indicator" />
      )}
      <div
        className={`kanban-card ${card.checked ? "checked" : ""} ${dragCard?.cardId === card.id ? "dragging" : ""} ${selectedCards.has(card.id) ? "selected" : ""} ${isFocused ? "kanban-card-focused" : ""} ${cardSizeClass}`}
        draggable={!isGrouped}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(e, card.id, col.id);
        }}
        onDragOver={(e) => onDragOver(e, col.id, cardIndex)}
        onDragEnd={onDragEnd}
        onClick={(e) => onCardClick(e, card, col, colIndex, cardIndex)}
        onContextMenu={(e) => onContextMenu(e, card.id, col.id)}
      >
        <div className="kanban-card-header">
          {editingCard === card.id ? (
            <input
              className="kanban-card-title-input"
              defaultValue={card.title}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                onTitleSave(col.id, card.id, e.target.value.trim(), card.title);
                onEditingCardChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") onEditingCardChange(null);
              }}
            />
          ) : (
            <span
              className="kanban-card-title"
              onDoubleClick={(e) => {
                e.stopPropagation();
                onTitleEdit(card.id);
              }}
            >
              {card.title}
            </span>
          )}
          {card.sourceIdeaId && (
            <button
              className="btn-icon kanban-card-idea-link"
              onClick={(e) => {
                e.stopPropagation();
                if (card.sourceMessageId) setScrollToMessageId(card.sourceMessageId);
                selectSection(card.sourceIdeaId!);
              }}
              title={t("goToIdea")}
            >
              💡
            </button>
          )}
          {!card.sourceIdeaId && (
            <button
              className="btn-icon kanban-card-delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteCard(col.id, card.id);
              }}
              title={t("kanbanDeleteCard")}
            >
              ×
            </button>
          )}
        </div>

        {/* Labels */}
        {card.labels.length > 0 && settings.cardSize !== "small" && (
          <div className="kanban-card-labels" onClick={(e) => e.stopPropagation()}>
            {card.labels.map((color) => (
              <span key={color} className="kanban-label-dot" style={{ background: color }} />
            ))}
          </div>
        )}

        {/* Properties on card */}
        {settings.cardSize !== "small" && properties.filter((p) => p.isVisible).length > 0 && (
          <div className="kanban-card-props" onClick={(e) => e.stopPropagation()}>
            {properties
              .filter((p) => p.isVisible)
              .slice(0, settings.cardSize === "large" ? undefined : 3)
              .map((prop) => (
                <PropertyBadge key={prop.id} prop={prop} value={card.properties[prop.id]} options={prop.options} />
              ))}
          </div>
        )}

        {/* Description preview */}
        {card.description && settings.cardSize === "large" && (
          <div className="kanban-card-desc-preview">
            {card.description.slice(0, 100)}{card.description.length > 100 ? "..." : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single Column ────────────────────────────────────────────

export function ColumnView({
  col,
  colIndex,
  isGrouped,
  settings,
  properties,
  focusedCard,
  dragCard,
  dragColumn,
  dropTarget,
  dropColumnTarget,
  selectedCards,
  editingCard,
  editingColumn,
  addingCardCol,
  newCardTitle,
  cardSizeClass,
  processedColumns,
  subGroupByProp,
  collapsedSubGroups,
  getSubGroups,
  onCardDragStart,
  onCardDragOver,
  onCardDragEnd,
  onCardDrop,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDrop,
  onColumnDragEnd,
  onCardClick,
  onContextMenu,
  onCheckChange,
  onTitleEdit,
  onTitleSave,
  onEditingCardChange,
  onDeleteCard,
  onEditingColumnChange,
  onRenameColumn,
  onDeleteColumn,
  onAddingCardColChange,
  onNewCardTitleChange,
  onAddCard,
  onToggleSubGroup,
  onToggleDone,
  onResizeColumn,
}: {
  col: KanbanColumn;
  colIndex: number;
  isGrouped: boolean;
  settings: BoardSettings;
  properties: PropertyDefinition[];
  focusedCard: FocusedCard | null;
  dragCard: { cardId: string; fromColId: string } | null;
  dragColumn: string | null;
  dropTarget: { colId: string; index: number } | null;
  dropColumnTarget: number | null;
  selectedCards: Set<string>;
  editingCard: string | null;
  editingColumn: string | null;
  addingCardCol: string | null;
  newCardTitle: string;
  cardSizeClass: string;
  processedColumns: KanbanColumn[];
  subGroupByProp: PropertyDefinition | undefined;
  collapsedSubGroups: Set<string>;
  getSubGroups: (cards: KanbanCard[]) => Array<{ label: string; color?: string; cards: KanbanCard[] }> | null;
  onCardDragStart: (e: React.DragEvent, cardId: string, colId: string) => void;
  onCardDragOver: (e: React.DragEvent, colId: string, index: number) => void;
  onCardDragEnd: () => void;
  onCardDrop: (e: React.DragEvent, colId: string, index: number) => void;
  onColumnDragStart: (e: React.DragEvent, colId: string) => void;
  onColumnDragOver: (e: React.DragEvent, index: number) => void;
  onColumnDrop: (e: React.DragEvent, index: number) => void;
  onColumnDragEnd: () => void;
  onCardClick: (e: React.MouseEvent, card: KanbanCard, col: KanbanColumn, colIndex: number, cardIndex: number) => void;
  onContextMenu: (e: React.MouseEvent, cardId: string, colId: string) => void;
  onCheckChange: (colId: string, cardId: string, checked: boolean) => void;
  onTitleEdit: (cardId: string) => void;
  onTitleSave: (colId: string, cardId: string, title: string, fallback: string) => void;
  onEditingCardChange: (id: string | null) => void;
  onDeleteCard: (colId: string, cardId: string) => void;
  onEditingColumnChange: (id: string | null) => void;
  onRenameColumn: (colId: string, title: string) => void;
  onDeleteColumn: (colId: string) => void;
  onAddingCardColChange: (id: string | null) => void;
  onNewCardTitleChange: (title: string) => void;
  onAddCard: (colId: string, title: string) => void;
  onToggleSubGroup: (key: string) => void;
  onToggleDone: (colId: string) => void;
  onResizeColumn: (colId: string, width: number) => void;
}) {
  const t = useT();
  const subGroups = subGroupByProp && isGrouped ? getSubGroups(col.cards) : null;
  const calcText = computeCalculation(col.cards, settings.calculation, properties, t);

  // Column resize via drag
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const colEl = (e.target as HTMLElement).closest(".kanban-column") as HTMLElement;
    if (!colEl) return;
    const startW = colEl.offsetWidth;
    const startX = e.clientX;
    resizeRef.current = { startX, startW };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const diff = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(180, resizeRef.current.startW + diff);
      colEl.style.width = newW + "px";
      colEl.style.minWidth = newW + "px";
      colEl.style.flex = "none";
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!resizeRef.current) return;
      const diff = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(180, resizeRef.current.startW + diff);
      resizeRef.current = null;
      onResizeColumn(col.id, newW);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [col.id, onResizeColumn]);

  const colStyle: React.CSSProperties | undefined = col.width
    ? { width: col.width, minWidth: col.width, flex: "none" }
    : undefined;

  return (
    <div
      className={`kanban-column ${dragColumn === col.id ? "dragging" : ""} ${dropColumnTarget === colIndex ? "kanban-column-drop-target" : ""}`}
      style={colStyle}
      onDragOver={(e) => {
        if (dragColumn) {
          onColumnDragOver(e, colIndex);
        } else if (dragCard) {
          onCardDragOver(e, col.id, col.cards.length);
        }
      }}
      onDrop={(e) => {
        if (dragColumn) {
          onColumnDrop(e, colIndex);
        } else if (dragCard) {
          onCardDrop(e, col.id, col.cards.length);
        }
      }}
    >
      <div
        className="kanban-column-header"
        draggable={!isGrouped && editingColumn !== col.id}
        onDragStart={(e) => {
          e.stopPropagation();
          onColumnDragStart(e, col.id);
        }}
        onDragEnd={onColumnDragEnd}
      >
        {editingColumn === col.id ? (
          <input
            className="kanban-column-title-input"
            defaultValue={col.title}
            autoFocus
            onBlur={(e) => {
              onRenameColumn(col.id, e.target.value.trim() || col.title);
              onEditingColumnChange(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onEditingColumnChange(null);
            }}
          />
        ) : (
          <span
            className="kanban-column-title"
            onDoubleClick={() => !isGrouped && onEditingColumnChange(col.id)}
            style={settings.colorColumns && col.color ? { color: col.color } : undefined}
          >
            {col.title}
          </span>
        )}
        <span className="kanban-column-count">{col.cards.length}</span>
        {calcText && <span className="kanban-column-calc">{calcText}</span>}
        {!isGrouped && (col.isDone || !processedColumns.some((c) => c.isDone)) && (
          <button
            className={`btn-icon kanban-column-done-toggle${col.isDone ? " kanban-column-done-toggle--active" : ""}`}
            onClick={() => onToggleDone(col.id)}
            title={col.isDone ? t("kanbanColumnDone") : t("kanbanColumnSetDone")}
          >
            ✓
          </button>
        )}
        {!isGrouped && (
          <button className="btn-icon kanban-column-delete" onClick={() => onDeleteColumn(col.id)} title={t("kanbanDeleteColumn")}>
            ×
          </button>
        )}
      </div>

      <div className="kanban-cards">
        {subGroups ? (
          subGroups.map((sg) => {
            if (sg.cards.length === 0 && settings.hideEmptyGroups) return null;
            const sgKey = `${col.id}:${sg.label}`;
            const isCollapsed = collapsedSubGroups.has(sgKey);
            return (
              <div key={sg.label} className="kanban-subgroup">
                <div className="kanban-subgroup-header" onClick={() => onToggleSubGroup(sgKey)}>
                  <span className="kanban-list-collapse-icon">{isCollapsed ? "\u25B6" : "\u25BC"}</span>
                  <span style={sg.color ? { color: sg.color } : undefined}>{sg.label}</span>
                  <span className="kanban-column-count">{sg.cards.length}</span>
                </div>
                {!isCollapsed && sg.cards.map((card, ci) => (
                  <CardView
                    key={card.id}
                    card={card}
                    col={col}
                    colIndex={colIndex}
                    cardIndex={ci}
                    focusedCard={focusedCard}
                    dragCard={dragCard}
                    dropTarget={dropTarget}
                    selectedCards={selectedCards}
                    editingCard={editingCard}
                    cardSizeClass={cardSizeClass}
                    isGrouped={isGrouped}
                    settings={settings}
                    properties={properties}
                    processedColumns={processedColumns}
                    onDragStart={onCardDragStart}
                    onDragOver={onCardDragOver}
                    onDragEnd={onCardDragEnd}
                    onCardClick={onCardClick}
                    onContextMenu={onContextMenu}
                    onCheckChange={onCheckChange}
                    onTitleEdit={onTitleEdit}
                    onTitleSave={onTitleSave}
                    onEditingCardChange={onEditingCardChange}
                    onDeleteCard={onDeleteCard}
                  />
                ))}
              </div>
            );
          })
        ) : (
          col.cards.map((card, cardIndex) => (
            <CardView
              key={card.id}
              card={card}
              col={col}
              colIndex={colIndex}
              cardIndex={cardIndex}
              focusedCard={focusedCard}
              dragCard={dragCard}
              dropTarget={dropTarget}
              selectedCards={selectedCards}
              editingCard={editingCard}
              cardSizeClass={cardSizeClass}
              isGrouped={isGrouped}
              settings={settings}
              properties={properties}
              processedColumns={processedColumns}
              onDragStart={onCardDragStart}
              onDragOver={onCardDragOver}
              onDragEnd={onCardDragEnd}
              onCardClick={onCardClick}
              onContextMenu={onContextMenu}
              onCheckChange={onCheckChange}
              onTitleEdit={onTitleEdit}
              onTitleSave={onTitleSave}
              onEditingCardChange={onEditingCardChange}
              onDeleteCard={onDeleteCard}
            />
          ))
        )}
        {/* Drop indicator at end */}
        {dropTarget?.colId === col.id && dropTarget?.index === col.cards.length && dragCard && (
          <div className="kanban-drop-indicator" />
        )}
      </div>

      {/* Inline add card */}
      {!isGrouped && (
        addingCardCol === col.id ? (
          <div className="kanban-inline-add">
            <input
              className="kanban-inline-add-input"
              placeholder={t("kanbanCardTitlePlaceholder")}
              value={newCardTitle}
              autoFocus
              onChange={(e) => onNewCardTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newCardTitle.trim()) {
                  onAddCard(col.id, newCardTitle.trim());
                  onNewCardTitleChange("");
                }
                if (e.key === "Escape") {
                  onAddingCardColChange(null);
                  onNewCardTitleChange("");
                }
              }}
              onBlur={() => {
                if (newCardTitle.trim()) onAddCard(col.id, newCardTitle.trim());
                onAddingCardColChange(null);
                onNewCardTitleChange("");
              }}
            />
          </div>
        ) : (
          <button className="kanban-add-card" onClick={() => onAddingCardColChange(col.id)}>
            {t("kanbanNewCard")}
          </button>
        )
      )}
      <div className="kanban-column-resize" onMouseDown={handleResizeStart} />
    </div>
  );
}
