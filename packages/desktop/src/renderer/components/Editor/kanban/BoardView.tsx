import type { KanbanCard, KanbanColumn, PropertyDefinition, BoardSettings, FocusedCard } from "./types.js";
import { ColumnView } from "./ColumnView.js";
import { useT } from "../../../i18n.js";

// ── Board Layout (horizontal columns) ───────────────────────

export function BoardView({
  processedColumns,
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
  onAddColumn,
  onToggleSubGroup,
  onToggleDone,
  onResizeColumn,
}: {
  processedColumns: KanbanColumn[];
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
  onAddColumn: () => void;
  onToggleSubGroup: (key: string) => void;
  onToggleDone: (colId: string) => void;
  onResizeColumn: (colId: string, width: number) => void;
}) {
  const t = useT();
  return (
    <div className="kanban-board">
      {processedColumns.map((col, colIndex) => (
        <ColumnView
          key={col.id}
          col={col}
          colIndex={colIndex}
          isGrouped={isGrouped}
          settings={settings}
          properties={properties}
          focusedCard={focusedCard}
          dragCard={dragCard}
          dragColumn={dragColumn}
          dropTarget={dropTarget}
          dropColumnTarget={dropColumnTarget}
          selectedCards={selectedCards}
          editingCard={editingCard}
          editingColumn={editingColumn}
          addingCardCol={addingCardCol}
          newCardTitle={newCardTitle}
          cardSizeClass={cardSizeClass}
          processedColumns={processedColumns}
          subGroupByProp={subGroupByProp}
          collapsedSubGroups={collapsedSubGroups}
          getSubGroups={getSubGroups}
          onCardDragStart={onCardDragStart}
          onCardDragOver={onCardDragOver}
          onCardDragEnd={onCardDragEnd}
          onCardDrop={onCardDrop}
          onColumnDragStart={onColumnDragStart}
          onColumnDragOver={onColumnDragOver}
          onColumnDrop={onColumnDrop}
          onColumnDragEnd={onColumnDragEnd}
          onCardClick={onCardClick}
          onContextMenu={onContextMenu}
          onCheckChange={onCheckChange}
          onTitleEdit={onTitleEdit}
          onTitleSave={onTitleSave}
          onEditingCardChange={onEditingCardChange}
          onDeleteCard={onDeleteCard}
          onEditingColumnChange={onEditingColumnChange}
          onRenameColumn={onRenameColumn}
          onDeleteColumn={onDeleteColumn}
          onAddingCardColChange={onAddingCardColChange}
          onNewCardTitleChange={onNewCardTitleChange}
          onAddCard={onAddCard}
          onToggleSubGroup={onToggleSubGroup}
          onToggleDone={onToggleDone}
          onResizeColumn={onResizeColumn}
        />
      ))}

      {!isGrouped && (
        <button className="kanban-add-column" onClick={onAddColumn}>
          {t("kanbanAddColumn")}
        </button>
      )}
    </div>
  );
}
