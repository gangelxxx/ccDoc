import { useEffect, useCallback, useRef } from "react";
import { useT } from "../../../i18n.js";
import { useAppStore } from "../../../stores/app.store.js";
import { sourceGetSection, sourceSaveSection } from "../source-api.js";

import type { KanbanCard, KanbanColumn } from "./types.js";
import { useKanbanState } from "./hooks/use-kanban-state.js";
import { useKanbanDnd } from "./hooks/use-kanban-dnd.js";
import { FilterDropdown, SortDropdown } from "./FilterBar.js";
import { BoardView } from "./BoardView.js";
import { CardDetailModal } from "./CardDetailModal.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { LabelPopup } from "./LabelPopup.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ViewTabs } from "./ViewTabs.js";
import { TableView } from "./TableView.js";
import { ListView } from "./ListView.js";
import type { AutoCommitApi } from "../../../hooks/use-auto-commit.js";

// Helper: sync idea message completed state when kanban card moves between columns
async function syncIdeaCompleted(card: KanbanCard, fromColId: string, toColId: string, columns: KanbanColumn[]) {
  if (!card.sourceIdeaId || !card.sourceMessageId) return;
  const doneColIds = new Set(columns.filter((c) => c.isDone).map((c) => c.id));
  if (doneColIds.size === 0) return;
  const movedToDone = doneColIds.has(toColId) && !doneColIds.has(fromColId);
  const movedFromDone = doneColIds.has(fromColId) && !doneColIds.has(toColId);
  if (!movedToDone && !movedFromDone) return;

  try {
    const sec = await sourceGetSection(card.sourceIdeaId);
    if (!sec) return;
    const data = JSON.parse(sec.content);
    const msg = data.messages?.find((m: any) => m.id === card.sourceMessageId);
    if (msg) {
      msg.completed = movedToDone;
      await sourceSaveSection(card.sourceIdeaId, sec.title, JSON.stringify(data));
    }
  } catch { /* ignore */ }
}

// ── Main Component ─────────────────────────────────────────

export function KanbanBoard({ sectionId, title, initialContent, autoCommit }: { sectionId: string; title: string; initialContent: string; autoCommit?: AutoCommitApi }) {
  const t = useT();

  // Use ref to avoid circular dependency: handleCardMoved needs columns, but useKanbanState needs handleCardMoved
  const columnsRef = useRef<KanbanColumn[]>([]);

  const handleCardMoved = useCallback((card: KanbanCard, fromColId: string, toColId: string) => {
    syncIdeaCompleted(card, fromColId, toColId, columnsRef.current);
    // Auto-commit: trigger when card moves to Done column
    if (autoCommit?.isEnabled) {
      const doneColIds = new Set(columnsRef.current.filter((c) => c.isDone).map((c) => c.id));
      if (doneColIds.has(toColId) && !doneColIds.has(fromColId)) {
        autoCommit.triggerCommit(card.title);
      }
    }
  }, [autoCommit]);

  // Sync idea message order when card is reordered in kanban
  const handleCardReordered = useCallback(async (card: KanbanCard, position: "top" | "bottom") => {
    if (!card.sourceIdeaId || !card.sourceMessageId) return;
    try {
      const sec = await sourceGetSection(card.sourceIdeaId);
      if (!sec) return;
      const data = JSON.parse(sec.content);
      const msgs = data.messages;
      if (!msgs) return;
      const idx = msgs.findIndex((m: any) => m.id === card.sourceMessageId);
      if (idx === -1) return;
      const [msg] = msgs.splice(idx, 1);
      if (position === "top") msgs.unshift(msg);
      else msgs.push(msg);
      await sourceSaveSection(card.sourceIdeaId, sec.title, JSON.stringify(data));
    } catch { /* ignore */ }
  }, []);

  const state = useKanbanState(sectionId, title, initialContent, handleCardMoved, handleCardReordered);
  columnsRef.current = state.data.columns;

  const dnd = useKanbanDnd(state.data, state.save, handleCardMoved);

  // ── Keyboard shortcuts ──

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // N -- add card in first column
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        if (state.processedColumns.length > 0) {
          state.setAddingCardCol(state.processedColumns[0].id);
        }
        return;
      }

      // Arrow navigation
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        if (!state.focusedCard) {
          if (state.processedColumns.length > 0 && state.processedColumns[0].cards.length > 0) {
            state.setFocusedCard({ colIndex: 0, cardIndex: 0 });
          }
          return;
        }

        let { colIndex, cardIndex } = state.focusedCard;

        if (e.key === "ArrowLeft") {
          colIndex = Math.max(0, colIndex - 1);
          cardIndex = Math.min(cardIndex, Math.max(0, (state.processedColumns[colIndex]?.cards.length ?? 1) - 1));
        } else if (e.key === "ArrowRight") {
          colIndex = Math.min(state.processedColumns.length - 1, colIndex + 1);
          cardIndex = Math.min(cardIndex, Math.max(0, (state.processedColumns[colIndex]?.cards.length ?? 1) - 1));
        } else if (e.key === "ArrowUp") {
          cardIndex = Math.max(0, cardIndex - 1);
        } else if (e.key === "ArrowDown") {
          const maxIdx = (state.processedColumns[colIndex]?.cards.length ?? 1) - 1;
          cardIndex = Math.min(maxIdx, cardIndex + 1);
        }

        state.setFocusedCard({ colIndex, cardIndex });
        return;
      }

      // Enter -- open focused card
      if (e.key === "Enter" && state.focusedCard) {
        const col = state.processedColumns[state.focusedCard.colIndex];
        const card = col?.cards[state.focusedCard.cardIndex];
        if (col && card) {
          state.setDetailCard({ cardId: card.id, colId: col.id });
        }
        return;
      }

      // Delete -- delete focused card
      if (e.key === "Delete" && state.focusedCard) {
        const col = state.processedColumns[state.focusedCard.colIndex];
        const card = col?.cards[state.focusedCard.cardIndex];
        if (col && card && !card.sourceIdeaId) {
          state.deleteCard(col.id, card.id);
          const newCards = col.cards.length - 1;
          if (newCards <= 0) state.setFocusedCard(null);
          else state.setFocusedCard({ colIndex: state.focusedCard.colIndex, cardIndex: Math.min(state.focusedCard.cardIndex, newCards - 1) });
        }
        return;
      }

      // Ctrl+D -- duplicate focused card
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && state.focusedCard) {
        e.preventDefault();
        const col = state.processedColumns[state.focusedCard.colIndex];
        const card = col?.cards[state.focusedCard.cardIndex];
        if (col && card) {
          state.duplicateCard(col.id, card.id);
        }
        return;
      }

      // Escape -- clear focus
      if (e.key === "Escape") {
        state.setFocusedCard(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.processedColumns, state.focusedCard, state.deleteCard, state.duplicateCard]);

  // ── Card click handler (selection + open) ──

  const handleCardClick = useCallback((e: React.MouseEvent, card: KanbanCard, col: KanbanColumn, colIndex: number, cardIndex: number) => {
    if (e.shiftKey && state.focusedCard) {
      // Range selection
      const allCardIds: string[] = [];
      for (const c of state.processedColumns) {
        for (const cd of c.cards) {
          allCardIds.push(cd.id);
        }
      }
      const focusedCol = state.processedColumns[state.focusedCard.colIndex];
      const focusedCardObj = focusedCol?.cards[state.focusedCard.cardIndex];
      if (focusedCardObj) {
        const startIdx = allCardIds.indexOf(focusedCardObj.id);
        const endIdx = allCardIds.indexOf(card.id);
        if (startIdx !== -1 && endIdx !== -1) {
          const from = Math.min(startIdx, endIdx);
          const to = Math.max(startIdx, endIdx);
          const rangeIds = allCardIds.slice(from, to + 1);
          state.setSelectedCards((prev) => {
            const next = new Set(prev);
            for (const id of rangeIds) next.add(id);
            return next;
          });
        }
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      state.setSelectedCards((prev) => {
        const next = new Set(prev);
        if (next.has(card.id)) next.delete(card.id);
        else next.add(card.id);
        return next;
      });
      return;
    }
    state.setFocusedCard({ colIndex, cardIndex });
    if (e.detail === 2) {
      // Double click — open detail modal
      state.setDetailCard({ cardId: card.id, colId: col.id });
    }
  }, [state.focusedCard, state.processedColumns, state.setSelectedCards, state.setFocusedCard, state.setDetailCard]);

  // ── Card check/title callbacks for ColumnView ──

  const handleCheckChange = useCallback((colId: string, cardId: string, checked: boolean) => {
    state.updateCard(colId, cardId, { checked });
  }, [state.updateCard]);

  const handleTitleSave = useCallback(async (colId: string, cardId: string, title: string, fallback: string) => {
    const newTitle = title || fallback;
    state.updateCard(colId, cardId, { title: newTitle });
    // Sync inline title edit to linked idea
    const col = state.data.columns.find((c) => c.id === colId);
    const card = col?.cards.find((c) => c.id === cardId);
    if (card?.sourceIdeaId && card?.sourceMessageId) {
      try {
        const sec = await sourceGetSection(card.sourceIdeaId);
        if (sec) {
          const data = JSON.parse(sec.content);
          const msg = data.messages?.find((m: any) => m.id === card.sourceMessageId);
          if (msg) {
            const descPart = card.description?.trim();
            msg.text = descPart ? `${newTitle}\n${descPart}` : newTitle;
            msg.editedAt = Date.now();
            await sourceSaveSection(card.sourceIdeaId, sec.title, JSON.stringify(data));
          }
        }
      } catch { /* ignore */ }
    }
  }, [state.updateCard, state.data.columns]);

  // ── Context menu move card ──

  const handleContextMoveCard = useCallback((fromColId: string, cardId: string, toColId: string) => {
    const fromCol = state.data.columns.find((c) => c.id === fromColId);
    const card = fromCol?.cards.find((c) => c.id === cardId);
    if (!card) return;
    state.save({
      ...state.data,
      columns: state.data.columns.map((cc) => {
        if (cc.id === fromColId) return { ...cc, cards: cc.cards.filter((cd) => cd.id !== cardId) };
        if (cc.id === toColId) return { ...cc, cards: [...cc.cards, card] };
        return cc;
      }),
    });
    // Sync idea completed state on cross-column move
    syncIdeaCompleted(card, fromColId, toColId, state.data.columns);
    // Auto-commit on move to Done via context menu
    if (autoCommit?.isEnabled) {
      const doneColIds = new Set(state.data.columns.filter((c) => c.isDone).map((c) => c.id));
      if (doneColIds.has(toColId) && !doneColIds.has(fromColId)) {
        autoCommit.triggerCommit(card.title);
      }
    }
  }, [state.data, state.save, autoCommit]);

  // ── Render ──

  return (
    <div className="kanban-wrapper">
      {/* Combined toolbar: View Tabs + Search + Filter/Sort/Settings */}
      <div className="kanban-toolbar">
        <ViewTabs
          views={state.views}
          activeViewId={state.activeView.id}
          onSelectView={state.setActiveViewId}
          onAddView={state.addView}
          onRenameView={state.renameView}
          onDeleteView={state.deleteView}
        />
        <div className="kanban-toolbar-search">
          <input
            type="text"
            placeholder={t("kanbanSearch")}
            value={state.search}
            onChange={(e) => state.setSearch(e.target.value)}
            className="kanban-search-input"
          />
        </div>
        <div className="kanban-toolbar-actions">
          {state.properties.length > 0 && (
            <>
              <button
                className={`kanban-toolbar-btn ${state.filters.length > 0 ? "active" : ""}`}
                onClick={() => state.setShowFilterDropdown(!state.showFilterDropdown)}
              >
                {t("kanbanFilter")}{state.filters.length > 0 ? ` (${state.filters.length})` : ""}
              </button>
              <button
                className={`kanban-toolbar-btn ${state.sorts.length > 0 ? "active" : ""}`}
                onClick={() => state.setShowSortDropdown(!state.showSortDropdown)}
              >
                {t("kanbanSort")}{state.sorts.length > 0 ? ` (${state.sorts.length})` : ""}
              </button>
            </>
          )}
          {state.data.columns.some((c) => c.width) && (
            <button className="kanban-toolbar-btn" onClick={state.resetColumnWidths} title={t("kanbanResetWidths")}>
              ↔
            </button>
          )}
          {autoCommit?.isAvailable && (
            <button
              className={`auto-commit-toggle ${autoCommit.isEnabled ? "active" : ""}`}
              onClick={autoCommit.toggle}
              title={t("autoCommitTooltip")}
            >
              {t("autoCommitToggle")}
            </button>
          )}
          <button className="kanban-toolbar-btn" onClick={() => state.setShowSettings(true)}>&#x22EF;</button>
        </div>
      </div>

      {/* Filter dropdown */}
      {state.showFilterDropdown && state.properties.length > 0 && (
        <FilterDropdown
          filters={state.filters}
          properties={state.properties}
          onFiltersChange={state.setFilters}
        />
      )}

      {/* Sort dropdown */}
      {state.showSortDropdown && state.properties.length > 0 && (
        <SortDropdown
          sorts={state.sorts}
          properties={state.properties}
          onSortsChange={state.setSorts}
        />
      )}

      {state.selectedCards.size > 0 && (
        <div className="kanban-bulk-bar">
          <span>{t("kanbanSelected", state.selectedCards.size)}</span>
          <select onChange={(e) => { if (e.target.value) state.bulkMoveCards(e.target.value); e.target.value = ""; }}>
            <option value="">{t("kanbanMoveToPlaceholder")}</option>
            {state.data.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button className="kanban-btn-danger" onClick={state.bulkDeleteCards}>{t("kanbanDelete")}</button>
          <button onClick={() => state.setSelectedCards(new Set())}>{t("kanbanCancel")}</button>
        </div>
      )}

      {/* Render active view type */}
      {state.activeView.type === "board" && (
        <BoardView
          processedColumns={state.processedColumns}
          isGrouped={state.isGrouped}
          settings={state.settings}
          properties={state.properties}
          focusedCard={state.focusedCard}
          dragCard={dnd.dragCard}
          dragColumn={dnd.dragColumn}
          dropTarget={dnd.dropTarget}
          dropColumnTarget={dnd.dropColumnTarget}
          selectedCards={state.selectedCards}
          editingCard={state.editingCard}
          editingColumn={state.editingColumn}
          addingCardCol={state.addingCardCol}
          newCardTitle={state.newCardTitle}
          cardSizeClass={state.cardSizeClass}
          subGroupByProp={state.subGroupByProp}
          collapsedSubGroups={state.collapsedSubGroups}
          getSubGroups={state.getSubGroups}
          onCardDragStart={dnd.handleCardDragStart}
          onCardDragOver={dnd.handleCardDragOver}
          onCardDragEnd={dnd.handleCardDragEnd}
          onCardDrop={dnd.handleCardDrop}
          onColumnDragStart={dnd.handleColumnDragStart}
          onColumnDragOver={dnd.handleColumnDragOver}
          onColumnDrop={dnd.handleColumnDrop}
          onColumnDragEnd={dnd.handleColumnDragEnd}
          onCardClick={handleCardClick}
          onContextMenu={state.handleContextMenu}
          onCheckChange={handleCheckChange}
          onTitleEdit={state.setEditingCard}
          onTitleSave={handleTitleSave}
          onEditingCardChange={state.setEditingCard}
          onDeleteCard={state.deleteCard}
          onEditingColumnChange={state.setEditingColumn}
          onRenameColumn={state.renameColumn}
          onDeleteColumn={state.deleteColumn}
          onAddingCardColChange={state.setAddingCardCol}
          onNewCardTitleChange={state.setNewCardTitle}
          onAddCard={state.addCard}
          onAddColumn={state.addColumn}
          onToggleDone={state.toggleDone}
          onResizeColumn={state.resizeColumn}
          onToggleSubGroup={state.toggleSubGroup}
        />
      )}

      {state.activeView.type === "table" && (
        <TableView
          columns={state.processedColumns}
          properties={state.properties}
          settings={state.settings}
          onUpdateCard={state.updateCard}
          onDeleteCard={state.deleteCard}
          onOpenCard={(colId, cardId) => state.setDetailCard({ colId, cardId })}
          onToggleCardDone={state.toggleCardDone}
        />
      )}

      {state.activeView.type === "list" && (
        <ListView
          columns={state.processedColumns}
          properties={state.properties}
          settings={state.settings}
          onOpenCard={(colId, cardId) => state.setDetailCard({ colId, cardId })}
          onUpdateCard={state.updateCard}
          onToggleCardDone={state.toggleCardDone}
        />
      )}

      {/* Context Menu */}
      {state.contextMenu && (
        <div
          className="kanban-context-menu"
          style={{ left: state.contextMenu.x, top: state.contextMenu.y }}
        >
          <div className="kanban-context-item" onClick={() => { state.moveCardToTop(state.contextMenu!.colId, state.contextMenu!.cardId); state.setContextMenu(null); }}>
            {t("kanbanMoveToTop")}
          </div>
          <div className="kanban-context-item" onClick={() => { state.moveCardToBottom(state.contextMenu!.colId, state.contextMenu!.cardId); state.setContextMenu(null); }}>
            {t("kanbanMoveToBottom")}
          </div>
          <div className="kanban-context-item" onClick={() => { state.setDetailCard({ cardId: state.contextMenu!.cardId, colId: state.contextMenu!.colId }); state.setContextMenu(null); }}>
            {t("kanbanOpen")}
          </div>
          <div className="kanban-context-item" onClick={() => { state.duplicateCard(state.contextMenu!.colId, state.contextMenu!.cardId); state.setContextMenu(null); }}>
            {t("kanbanDuplicate")}
          </div>
          <div className="kanban-context-item" onClick={() => { state.setLabelPopupCard(state.contextMenu!.cardId); state.setContextMenu(null); }}>
            {t("kanbanLabels")}
          </div>
          {state.data.columns.filter((c) => c.id !== state.contextMenu!.colId).map((c) => (
            <div key={c.id} className="kanban-context-item" onClick={() => {
              handleContextMoveCard(state.contextMenu!.colId, state.contextMenu!.cardId, c.id);
              state.setContextMenu(null);
            }}>
              {t("kanbanMoveTo", c.title)}
            </div>
          ))}
          {!state.data.columns.some(c => c.cards.some(card => card.id === state.contextMenu!.cardId && card.sourceIdeaId)) && (<>
            <div className="kanban-context-divider" />
            <div className="kanban-context-item kanban-context-danger" onClick={() => { state.deleteCard(state.contextMenu!.colId, state.contextMenu!.cardId); state.setContextMenu(null); }}>
              {t("kanbanDelete")}
            </div>
          </>)}
        </div>
      )}

      {/* Label popup */}
      {state.labelPopupCard && (() => {
        const colAndCard = state.data.columns.reduce<{ col: KanbanColumn; card: KanbanCard } | null>((acc, col) => {
          if (acc) return acc;
          const card = col.cards.find((c) => c.id === state.labelPopupCard);
          return card ? { col, card } : null;
        }, null);
        if (!colAndCard) return null;
        return (
          <div className="kanban-modal-overlay" onClick={() => state.setLabelPopupCard(null)}>
            <div onClick={(e) => e.stopPropagation()}>
              <LabelPopup
                labels={colAndCard.card.labels}
                onToggle={(color) => {
                  const labels = colAndCard.card.labels.includes(color)
                    ? colAndCard.card.labels.filter((l) => l !== color)
                    : [...colAndCard.card.labels, color];
                  state.updateCard(colAndCard.col.id, colAndCard.card.id, { labels });
                }}
                onClose={() => state.setLabelPopupCard(null)}
              />
            </div>
          </div>
        );
      })()}

      {/* Confirm delete dialog */}
      {state.confirmDelete && (
        <ConfirmDialog
          message={t("kanbanDeleteColumnConfirm", state.confirmDelete.count)}
          onConfirm={state.confirmDeleteColumn}
          onCancel={() => state.setConfirmDelete(null)}
        />
      )}

      {/* Settings panel */}
      {state.showSettings && (
        <SettingsPanel
          settings={state.settings}
          properties={state.properties}
          onSettingsChange={state.updateSettings}
          onPropertiesChange={state.updateProperties}
          onClose={() => state.setShowSettings(false)}
        />
      )}

      {/* Card detail modal */}
      {state.detailCard && (state.detailCardObj || state.detailCardObjGrouped) && (
        <CardDetailModal
          card={(state.detailCardObj || state.detailCardObjGrouped)!}
          colId={state.detailCardRealColId || state.detailCard.colId}
          properties={state.properties}
          onUpdate={state.updateCard}
          onClose={() => state.setDetailCard(null)}
        />
      )}

    </div>
  );
}
