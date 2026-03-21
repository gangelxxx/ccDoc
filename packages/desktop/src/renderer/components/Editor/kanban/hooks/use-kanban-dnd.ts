import { useState, useCallback } from "react";
import type { KanbanData, KanbanColumn, KanbanCard } from "../types.js";

// ── Drag-and-Drop State & Handlers ──────────────────────────

export interface KanbanDndState {
  dragCard: { cardId: string; fromColId: string } | null;
  dragColumn: string | null;
  dropTarget: { colId: string; index: number } | null;
  dropColumnTarget: number | null;
}

export interface KanbanDndHandlers {
  handleCardDragStart: (e: React.DragEvent, cardId: string, fromColId: string) => void;
  handleCardDragOver: (e: React.DragEvent, colId: string, index: number) => void;
  handleCardDrop: (e: React.DragEvent, toColId: string, toIndex: number) => void;
  handleCardDragEnd: () => void;
  handleColumnDragStart: (e: React.DragEvent, colId: string) => void;
  handleColumnDragOver: (e: React.DragEvent, index: number) => void;
  handleColumnDrop: (e: React.DragEvent, toIndex: number) => void;
  handleColumnDragEnd: () => void;
}

export type KanbanDnd = KanbanDndState & KanbanDndHandlers;

export function useKanbanDnd(
  data: KanbanData,
  save: (updated: KanbanData) => void,
  onCardMoved?: (card: KanbanCard, fromColId: string, toColId: string) => void,
): KanbanDnd {
  const [dragCard, setDragCard] = useState<{ cardId: string; fromColId: string } | null>(null);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ colId: string; index: number } | null>(null);
  const [dropColumnTarget, setDropColumnTarget] = useState<number | null>(null);

  // ── Card DnD ──

  const handleCardDragStart = useCallback((e: React.DragEvent, cardId: string, fromColId: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
    setDragCard({ cardId, fromColId });
  }, []);

  const handleCardDragOver = useCallback((e: React.DragEvent, colId: string, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ colId, index });
  }, []);

  const handleCardDrop = useCallback((e: React.DragEvent, toColId: string, toIndex: number) => {
    e.preventDefault();
    if (!dragCard) return;
    const { cardId, fromColId } = dragCard;

    const fromCol = data.columns.find((c) => c.id === fromColId);
    const card = fromCol?.cards.find((c) => c.id === cardId);
    if (!card) return;

    const newColumns = data.columns.map((c) => {
      if (c.id === fromColId && c.id === toColId) {
        // Same column reorder
        const cards = c.cards.filter((cd) => cd.id !== cardId);
        const fromIdx = c.cards.findIndex((cd) => cd.id === cardId);
        const adjustedIndex = fromIdx < toIndex ? toIndex - 1 : toIndex;
        cards.splice(adjustedIndex, 0, card);
        return { ...c, cards };
      }
      if (c.id === fromColId) return { ...c, cards: c.cards.filter((cd) => cd.id !== cardId) };
      if (c.id === toColId) {
        const cards = [...c.cards];
        cards.splice(toIndex, 0, card);
        return { ...c, cards };
      }
      return c;
    });

    save({ ...data, columns: newColumns });
    // Notify about cross-column move (for idea↔kanban sync)
    if (fromColId !== toColId && onCardMoved) {
      onCardMoved(card, fromColId, toColId);
    }
    setDragCard(null);
    setDropTarget(null);
  }, [dragCard, data, save, onCardMoved]);

  const handleCardDragEnd = useCallback(() => {
    setDragCard(null);
    setDropTarget(null);
  }, []);

  // ── Column DnD ──

  const handleColumnDragStart = useCallback((e: React.DragEvent, colId: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", colId);
    setDragColumn(colId);
  }, []);

  const handleColumnDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (!dragColumn) return;
    setDropColumnTarget(index);
  }, [dragColumn]);

  const handleColumnDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (!dragColumn) return;
    const fromIndex = data.columns.findIndex((c) => c.id === dragColumn);
    if (fromIndex === -1 || fromIndex === toIndex) {
      setDragColumn(null);
      setDropColumnTarget(null);
      return;
    }
    const cols = [...data.columns];
    const [moved] = cols.splice(fromIndex, 1);
    const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    cols.splice(adjustedIndex, 0, moved);
    save({ ...data, columns: cols });
    setDragColumn(null);
    setDropColumnTarget(null);
  }, [dragColumn, data, save]);

  const handleColumnDragEnd = useCallback(() => {
    setDragColumn(null);
    setDropColumnTarget(null);
  }, []);

  return {
    dragCard,
    dragColumn,
    dropTarget,
    dropColumnTarget,
    handleCardDragStart,
    handleCardDragOver,
    handleCardDrop,
    handleCardDragEnd,
    handleColumnDragStart,
    handleColumnDragOver,
    handleColumnDrop,
    handleColumnDragEnd,
  };
}
