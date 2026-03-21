import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useAppStore } from "../../../../stores/app.store.js";
import { useT } from "../../../../i18n.js";

import type {
  PropertyDefinition,
  BoardSettings,
  Filter,
  Sort,
  BoardView,
  KanbanCard,
  KanbanColumn,
  KanbanData,
  FocusedCard,
} from "../types.js";
import {
  uid,
  migrateData,
  createCard,
  matchesFilter,
  compareCards,
  DEFAULT_SETTINGS,
} from "../utils.js";

// ── Kanban State Hook ────────────────────────────────────────

export interface KanbanUIState {
  editingCard: string | null;
  setEditingCard: (id: string | null) => void;
  editingColumn: string | null;
  setEditingColumn: (id: string | null) => void;
  addingCardCol: string | null;
  setAddingCardCol: (id: string | null) => void;
  newCardTitle: string;
  setNewCardTitle: (title: string) => void;
  labelPopupCard: string | null;
  setLabelPopupCard: (id: string | null) => void;
  confirmDelete: { colId: string; count: number } | null;
  setConfirmDelete: (v: { colId: string; count: number } | null) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  showFilterDropdown: boolean;
  setShowFilterDropdown: (v: boolean) => void;
  showSortDropdown: boolean;
  setShowSortDropdown: (v: boolean) => void;
  detailCard: { cardId: string; colId: string } | null;
  setDetailCard: (v: { cardId: string; colId: string } | null) => void;
  contextMenu: { x: number; y: number; cardId: string; colId: string } | null;
  setContextMenu: (v: { x: number; y: number; cardId: string; colId: string } | null) => void;
  handleContextMenu: (e: React.MouseEvent, cardId: string, colId: string) => void;
  selectedCards: Set<string>;
  setSelectedCards: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  focusedCard: FocusedCard | null;
  setFocusedCard: (v: FocusedCard | null) => void;
  collapsedSubGroups: Set<string>;
  toggleSubGroup: (key: string) => void;
}

export interface KanbanDataState {
  data: KanbanData;
  properties: PropertyDefinition[];
  settings: BoardSettings;
  views: BoardView[];
  activeView: BoardView;
  activeViewId: string;
  setActiveViewId: (id: string) => void;
  filters: Filter[];
  setFilters: (v: Filter[] | ((prev: Filter[]) => Filter[])) => void;
  sorts: Sort[];
  setSorts: (v: Sort[] | ((prev: Sort[]) => Sort[])) => void;
  search: string;
  setSearch: (v: string) => void;
  save: (updated: KanbanData) => void;
}

export interface KanbanOperations {
  // Views
  addView: (type: "board" | "table" | "list") => void;
  renameView: (id: string, name: string) => void;
  deleteView: (id: string) => void;
  // Columns
  addColumn: () => void;
  renameColumn: (colId: string, newTitle: string) => void;
  deleteColumn: (colId: string) => void;
  confirmDeleteColumn: () => void;
  toggleDone: (colId: string) => void;
  // Cards
  addCard: (colId: string, cardTitle: string) => void;
  updateCard: (colId: string, cardId: string, updates: Partial<KanbanCard>) => void;
  deleteCard: (colId: string, cardId: string) => void;
  duplicateCard: (colId: string, cardId: string) => void;
  // Card done toggle (for table/list views)
  toggleCardDone: (fromColId: string, cardId: string) => void;
  moveCardToTop: (colId: string, cardId: string) => void;
  moveCardToBottom: (colId: string, cardId: string) => void;
  // Bulk
  bulkMoveCards: (toColId: string) => void;
  bulkDeleteCards: () => void;
  // Column resize
  resizeColumn: (colId: string, width: number) => void;
  resetColumnWidths: () => void;
  // Settings/properties
  updateSettings: (s: BoardSettings) => void;
  updateProperties: (p: PropertyDefinition[]) => void;
}

export interface KanbanComputedState {
  isGrouped: boolean;
  groupByProp: PropertyDefinition | undefined;
  subGroupByProp: PropertyDefinition | undefined;
  processedColumns: KanbanColumn[];
  getSubGroups: (cards: KanbanCard[]) => Array<{ label: string; color?: string; cards: KanbanCard[] }> | null;
  detailCardObj: KanbanCard | null;
  detailCardObjGrouped: KanbanCard | null;
  detailCardRealColId: string | null;
  cardSizeClass: string;
}

export type KanbanState = KanbanUIState & KanbanDataState & KanbanOperations & KanbanComputedState;

export function useKanbanState(sectionId: string, title: string, initialContent: string, onCardMoved?: (card: KanbanCard, fromColId: string, toColId: string) => void, onCardReordered?: (card: KanbanCard, position: "top" | "bottom") => void): KanbanState {
  const { updateSection } = useAppStore();
  const t = useT();

  // ── Core data ──

  const [data, setData] = useState<KanbanData>(() => {
    try {
      return migrateData(JSON.parse(initialContent));
    } catch {
      return migrateData({ columns: [] });
    }
  });

  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedContent = useRef<string>(initialContent);

  // Sync from external changes (e.g. LLM tool calls)
  useEffect(() => {
    if (initialContent !== lastSavedContent.current) {
      lastSavedContent.current = initialContent;
      try {
        setData(migrateData(JSON.parse(initialContent)));
      } catch {
        // ignore invalid JSON
      }
    }
  }, [initialContent]);

  const properties = data.properties ?? [];
  const settings = data.settings ?? DEFAULT_SETTINGS;

  // ── Views ──

  const views = useMemo((): BoardView[] => {
    const v = data.views ?? [];
    if (v.length > 0) return v;
    return [{ id: "__default", name: t("kanbanViewBoard"), type: "board", filters: [], sorts: [], settings: { ...DEFAULT_SETTINGS } }];
  }, [data.views]);

  const [activeViewId, setActiveViewId] = useState<string>(() => {
    const v = data.views ?? [];
    return v.length > 0 ? v[0].id : "__default";
  });

  const activeView = useMemo(() => views.find((v) => v.id === activeViewId) ?? views[0], [views, activeViewId]);

  // ── Filters / Sorts / Search ──

  const [filters, setFiltersLocal] = useState<Filter[]>([]);
  const [sorts, setSortsLocal] = useState<Sort[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setFiltersLocal(activeView.filters ?? []);
    setSortsLocal(activeView.sorts ?? []);
  }, [activeView.id]);

  // ── Save ──

  const save = useCallback(
    (updated: KanbanData) => {
      setData(updated);
      const json = JSON.stringify(updated);
      lastSavedContent.current = json;
      clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        updateSection(sectionId, title, json);
      }, 300);
    },
    [sectionId, title, updateSection]
  );

  // Wrappers that also persist filters/sorts to the active view
  const setFilters = useCallback((newFilters: Filter[] | ((prev: Filter[]) => Filter[])) => {
    setFiltersLocal((prev) => {
      const resolved = typeof newFilters === "function" ? newFilters(prev) : newFilters;
      const updatedViews = views.map((v) => (v.id === activeView.id ? { ...v, filters: resolved } : v));
      save({ ...data, views: updatedViews });
      return resolved;
    });
  }, [views, activeView.id, data, save]);

  const setSorts = useCallback((newSorts: Sort[] | ((prev: Sort[]) => Sort[])) => {
    setSortsLocal((prev) => {
      const resolved = typeof newSorts === "function" ? newSorts(prev) : newSorts;
      const updatedViews = views.map((v) => (v.id === activeView.id ? { ...v, sorts: resolved } : v));
      save({ ...data, views: updatedViews });
      return resolved;
    });
  }, [views, activeView.id, data, save]);

  // ── UI state ──

  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [addingCardCol, setAddingCardCol] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [labelPopupCard, setLabelPopupCard] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ colId: string; count: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [detailCard, setDetailCard] = useState<{ cardId: string; colId: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cardId: string; colId: string } | null>(null);
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [focusedCard, setFocusedCard] = useState<FocusedCard | null>(null);
  const [collapsedSubGroups, setCollapsedSubGroups] = useState<Set<string>>(new Set());

  const toggleSubGroup = (key: string) => {
    setCollapsedSubGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, cardId: string, colId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, cardId, colId });
  }, []);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // ── View operations ──

  const addView = (type: "board" | "table" | "list") => {
    const id = uid("view");
    const name = type === "board" ? t("kanbanViewBoard") : type === "table" ? t("kanbanViewTable") : t("kanbanViewList");
    const newView: BoardView = { id, name, type, filters: [], sorts: [], settings: { ...DEFAULT_SETTINGS } };
    const newViews = [...views.filter((v) => v.id !== "__default"), newView];
    if (views.length === 1 && views[0].id === "__default") {
      newViews.unshift({ ...views[0], id: uid("view") });
    }
    save({ ...data, views: newViews });
    setActiveViewId(id);
  };

  const renameView = (id: string, name: string) => {
    save({ ...data, views: views.map((v) => (v.id === id ? { ...v, name } : v)) });
  };

  const deleteView = (id: string) => {
    const newViews = views.filter((v) => v.id !== id);
    if (newViews.length === 0) return;
    save({ ...data, views: newViews });
    if (activeViewId === id) setActiveViewId(newViews[0].id);
  };

  // ── Column operations ──

  const addColumn = () => {
    const id = uid("col");
    save({ ...data, columns: [...data.columns, { id, title: t("kanbanNewColumn"), cards: [] }] });
    setEditingColumn(id);
  };

  const renameColumn = (colId: string, newTitle: string) => {
    save({ ...data, columns: data.columns.map((c) => (c.id === colId ? { ...c, title: newTitle } : c)) });
  };

  const deleteColumn = (colId: string) => {
    const col = data.columns.find((c) => c.id === colId);
    if (col && col.cards.length > 0) {
      setConfirmDelete({ colId, count: col.cards.length });
    } else {
      save({ ...data, columns: data.columns.filter((c) => c.id !== colId) });
    }
  };

  const confirmDeleteColumn = () => {
    if (!confirmDelete) return;
    save({ ...data, columns: data.columns.filter((c) => c.id !== confirmDelete.colId) });
    setConfirmDelete(null);
  };

  const toggleDone = (colId: string) => {
    save({
      ...data,
      columns: data.columns.map((c) => {
        if (c.id === colId) return { ...c, isDone: !c.isDone };
        // Only one column can be isDone at a time
        if (c.isDone) return { ...c, isDone: false };
        return c;
      }),
    });
  };

  // ── Card operations ──

  const addCard = (colId: string, cardTitle: string) => {
    const card = createCard(cardTitle);
    save({
      ...data,
      columns: data.columns.map((c) => (c.id === colId ? { ...c, cards: [...c.cards, card] } : c)),
    });
  };

  const updateCard = useCallback(
    (colId: string, cardId: string, updates: Partial<KanbanCard>) => {
      save({
        ...data,
        columns: data.columns.map((c) =>
          c.id === colId
            ? {
                ...c,
                cards: c.cards.map((card) =>
                  card.id === cardId ? { ...card, ...updates, updatedAt: new Date().toISOString() } : card
                ),
              }
            : c
        ),
      });
    },
    [data, save]
  );

  const deleteCard = (colId: string, cardId: string) => {
    // Don't delete cards linked to ideas — they can only be removed from the idea list
    const col = data.columns.find((c) => c.id === colId);
    const card = col?.cards.find((c) => c.id === cardId);
    if (card?.sourceIdeaId) return;
    save({
      ...data,
      columns: data.columns.map((c) =>
        c.id === colId ? { ...c, cards: c.cards.filter((card) => card.id !== cardId) } : c
      ),
    });
  };

  const duplicateCard = (colId: string, cardId: string) => {
    const col = data.columns.find((c) => c.id === colId);
    const card = col?.cards.find((c) => c.id === cardId);
    if (!card) return;
    const dup = { ...card, id: uid("card"), title: `${card.title} ${t("kanbanCopy")}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    save({
      ...data,
      columns: data.columns.map((c) =>
        c.id === colId ? { ...c, cards: [...c.cards, dup] } : c
      ),
    });
  };

  const moveCardToTop = (colId: string, cardId: string) => {
    const col = data.columns.find((c) => c.id === colId);
    const card = col?.cards.find((c) => c.id === cardId);
    save({
      ...data,
      columns: data.columns.map((c) => {
        if (c.id !== colId) return c;
        const idx = c.cards.findIndex((cd) => cd.id === cardId);
        if (idx <= 0) return c;
        const cards = [...c.cards];
        cards.splice(idx, 1);
        cards.unshift(card!);
        return { ...c, cards };
      }),
    });
    if (card && onCardReordered) onCardReordered(card, "top");
  };

  const moveCardToBottom = (colId: string, cardId: string) => {
    const col = data.columns.find((c) => c.id === colId);
    const card = col?.cards.find((c) => c.id === cardId);
    save({
      ...data,
      columns: data.columns.map((c) => {
        if (c.id !== colId) return c;
        const idx = c.cards.findIndex((cd) => cd.id === cardId);
        if (idx === -1 || idx === c.cards.length - 1) return c;
        const cards = [...c.cards];
        cards.splice(idx, 1);
        cards.push(card!);
        return { ...c, cards };
      }),
    });
    if (card && onCardReordered) onCardReordered(card, "bottom");
  };

  const toggleCardDone = (fromColId: string, cardId: string) => {
    const doneCol = data.columns.find((c) => c.isDone);
    const firstCol = data.columns[0];
    if (!doneCol || !firstCol) return;
    const fromCol = data.columns.find((c) => c.id === fromColId);
    const card = fromCol?.cards.find((c) => c.id === cardId);
    if (!card) return;
    const isInDone = fromCol?.isDone;
    const toColId = isInDone ? firstCol.id : doneCol.id;
    const newColumns = data.columns.map((c) => {
      if (c.id === fromColId) return { ...c, cards: c.cards.filter((cd) => cd.id !== cardId) };
      if (c.id === toColId) return { ...c, cards: [...c.cards, card] };
      return c;
    });
    save({ ...data, columns: newColumns });
    if (onCardMoved) onCardMoved(card, fromColId, toColId);
  };

  // ── Bulk operations ──

  const bulkMoveCards = (toColId: string) => {
    if (selectedCards.size === 0) return;
    const movedCardsWithSource: Array<{ card: KanbanCard; fromColId: string }> = [];
    const newColumns = data.columns.map((c) => {
      const kept: KanbanCard[] = [];
      for (const card of c.cards) {
        if (selectedCards.has(card.id)) movedCardsWithSource.push({ card, fromColId: c.id });
        else kept.push(card);
      }
      return { ...c, cards: kept };
    });
    const movedCards = movedCardsWithSource.map((m) => m.card);
    save({
      ...data,
      columns: newColumns.map((c) => (c.id === toColId ? { ...c, cards: [...c.cards, ...movedCards] } : c)),
    });
    // Sync idea completed state for moved cards
    if (onCardMoved) {
      for (const { card, fromColId } of movedCardsWithSource) {
        if (fromColId !== toColId) onCardMoved(card, fromColId, toColId);
      }
    }
    setSelectedCards(new Set());
  };

  const bulkDeleteCards = () => {
    if (selectedCards.size === 0) return;
    save({
      ...data,
      columns: data.columns.map((c) => ({
        ...c,
        cards: c.cards.filter((card) => !selectedCards.has(card.id) || card.sourceIdeaId),
      })),
    });
    setSelectedCards(new Set());
  };

  // ── Column resize ──

  const resizeColumn = (colId: string, width: number) => {
    save({
      ...data,
      columns: data.columns.map((c) => (c.id === colId ? { ...c, width: Math.max(180, width) } : c)),
    });
  };

  const resetColumnWidths = () => {
    save({
      ...data,
      columns: data.columns.map((c) => {
        const { width: _, ...rest } = c;
        return rest;
      }),
    });
  };

  // ── Settings/properties ──

  const updateSettings = (s: BoardSettings) => save({ ...data, settings: s });
  const updateProperties = (p: PropertyDefinition[]) => save({ ...data, properties: p });

  // ── Group by logic ──

  const groupByProp = useMemo(
    () => settings.groupBy ? properties.find((p) => p.id === settings.groupBy) : undefined,
    [settings.groupBy, properties]
  );

  const subGroupByProp = useMemo(
    () => settings.subGroupBy ? properties.find((p) => p.id === settings.subGroupBy) : undefined,
    [settings.subGroupBy, properties]
  );

  const groupedColumns = useMemo((): KanbanColumn[] => {
    if (!groupByProp || !groupByProp.options) return [];

    const allCards: KanbanCard[] = data.columns.flatMap((c) => c.cards);

    const cols: KanbanColumn[] = groupByProp.options.map((opt) => ({
      id: `group-${opt.id}`,
      title: opt.name,
      color: opt.color,
      cards: allCards.filter((card) => {
        const val = card.properties[groupByProp.id];
        if (groupByProp.type === "multi_select") {
          return Array.isArray(val) && val.includes(opt.id);
        }
        return val === opt.id;
      }),
    }));

    const noValueCards = allCards.filter((card) => {
      const val = card.properties[groupByProp.id];
      if (groupByProp.type === "multi_select") {
        return !Array.isArray(val) || val.length === 0;
      }
      return !val;
    });
    cols.push({
      id: "group-__none",
      title: t("kanbanNoValue"),
      cards: noValueCards,
    });

    return cols;
  }, [groupByProp, data.columns]);

  const isGrouped = !!groupByProp;

  // ── Apply filters/sorts/search ──

  const processedColumns = useMemo(() => {
    let cols = isGrouped ? groupedColumns : data.columns;

    if (settings.hideEmptyGroups) {
      cols = cols.filter((c) => c.cards.length > 0);
    }

    return cols.map((col) => {
      let cards = col.cards;

      if (search) {
        const q = search.toLowerCase();
        cards = cards.filter(
          (c) => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
        );
      }

      for (const f of filters) {
        cards = cards.filter((c) => matchesFilter(c, f, properties));
      }

      if (sorts.length > 0) {
        cards = [...cards].sort((a, b) => compareCards(a, b, sorts, properties));
      }

      return { ...col, cards };
    });
  }, [data.columns, groupedColumns, isGrouped, search, filters, sorts, properties, settings.hideEmptyGroups]);

  // ── Subgroup helper ──

  const getSubGroups = useCallback((cards: KanbanCard[]): Array<{ label: string; color?: string; cards: KanbanCard[] }> | null => {
    if (!subGroupByProp || !subGroupByProp.options) return null;

    const groups: Array<{ label: string; color?: string; cards: KanbanCard[] }> = [];

    for (const opt of subGroupByProp.options) {
      const matched = cards.filter((card) => {
        const val = card.properties[subGroupByProp.id];
        if (subGroupByProp.type === "multi_select") return Array.isArray(val) && val.includes(opt.id);
        return val === opt.id;
      });
      groups.push({ label: opt.name, color: opt.color, cards: matched });
    }

    const noValue = cards.filter((card) => {
      const val = card.properties[subGroupByProp.id];
      if (subGroupByProp.type === "multi_select") return !Array.isArray(val) || val.length === 0;
      return !val;
    });
    if (noValue.length > 0) {
      groups.push({ label: t("kanbanNoValue"), cards: noValue });
    }

    return groups;
  }, [subGroupByProp]);

  // ── Detail card lookup ──

  const detailCardObj = useMemo(() => {
    if (!detailCard) return null;
    const col = data.columns.find((c) => c.id === detailCard.colId);
    return col?.cards.find((c) => c.id === detailCard.cardId) ?? null;
  }, [detailCard, data.columns]);

  const detailCardObjGrouped = useMemo(() => {
    if (detailCardObj || !detailCard) return detailCardObj;
    for (const col of data.columns) {
      const card = col.cards.find((c) => c.id === detailCard.cardId);
      if (card) return card;
    }
    return null;
  }, [detailCard, detailCardObj, data.columns]);

  const detailCardRealColId = useMemo(() => {
    if (!detailCard) return null;
    const col = data.columns.find((c) => c.id === detailCard.colId);
    if (col?.cards.find((c) => c.id === detailCard.cardId)) return detailCard.colId;
    for (const c of data.columns) {
      if (c.cards.find((card) => card.id === detailCard.cardId)) return c.id;
    }
    return detailCard.colId;
  }, [detailCard, data.columns]);

  // ── Card size CSS class ──

  const cardSizeClass = settings.cardSize === "small" ? "kanban-card-small" : settings.cardSize === "large" ? "kanban-card-large" : "";

  return {
    // UI state
    editingCard, setEditingCard,
    editingColumn, setEditingColumn,
    addingCardCol, setAddingCardCol,
    newCardTitle, setNewCardTitle,
    labelPopupCard, setLabelPopupCard,
    confirmDelete, setConfirmDelete,
    showSettings, setShowSettings,
    showFilterDropdown, setShowFilterDropdown,
    showSortDropdown, setShowSortDropdown,
    detailCard, setDetailCard,
    contextMenu, setContextMenu, handleContextMenu,
    selectedCards, setSelectedCards,
    focusedCard, setFocusedCard,
    collapsedSubGroups, toggleSubGroup,

    // Data state
    data, properties, settings,
    views, activeView, activeViewId, setActiveViewId,
    filters, setFilters,
    sorts, setSorts,
    search, setSearch,
    save,

    // Operations
    addView, renameView, deleteView,
    addColumn, renameColumn, deleteColumn, confirmDeleteColumn, toggleDone,
    addCard, updateCard, deleteCard, duplicateCard, toggleCardDone, moveCardToTop, moveCardToBottom,
    bulkMoveCards, bulkDeleteCards,
    resizeColumn, resetColumnWidths,
    updateSettings, updateProperties,

    // Computed
    isGrouped, groupByProp, subGroupByProp,
    processedColumns, getSubGroups,
    detailCardObj, detailCardObjGrouped, detailCardRealColId,
    cardSizeClass,
  };
}
