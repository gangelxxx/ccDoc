import type {
  PropertyType,
  SelectOption,
  PropertyDefinition,
  BoardSettings,
  Filter,
  Sort,
  KanbanCard,
  KanbanColumn,
  KanbanData,
} from "./types.js";
import type { TranslationKey } from "../../../i18n.js";

// ── Constants ──────────────────────────────────────────────

export const LABEL_COLORS: { key: TranslationKey; color: string }[] = [
  { key: "kanbanColorRed", color: "#e03e3e" },
  { key: "kanbanColorOrange", color: "#d9730d" },
  { key: "kanbanColorYellow", color: "#dfab01" },
  { key: "kanbanColorGreen", color: "#0f7b6c" },
  { key: "kanbanColorBlue", color: "#0b6e99" },
  { key: "kanbanColorPurple", color: "#6940a5" },
  { key: "kanbanColorPink", color: "#ad1a72" },
  { key: "kanbanColorGray", color: "#787774" },
];

export const PROPERTY_TYPE_KEYS: Record<PropertyType, TranslationKey> = {
  text: "kanbanPropText",
  number: "kanbanPropNumber",
  select: "kanbanPropSelect",
  multi_select: "kanbanPropMultiSelect",
  date: "kanbanPropDate",
  checkbox: "kanbanPropCheckbox",
  url: "kanbanPropURL",
  person: "kanbanPropPerson",
};

export const CONDITION_KEYS: Record<string, TranslationKey> = {
  "is": "kanbanCondIs",
  "contains": "kanbanCondContains",
  "is empty": "kanbanCondIsEmpty",
  "is not": "kanbanCondIsNot",
  "does not contain": "kanbanCondDoesNotContain",
  "before": "kanbanCondBefore",
  "after": "kanbanCondAfter",
  "is checked": "kanbanCondIsChecked",
  "is not checked": "kanbanCondIsNotChecked",
};

export const DEFAULT_SETTINGS: BoardSettings = {
  cardSize: "medium",
  cardPreview: "none",
  colorColumns: false,
  hideEmptyGroups: false,
};

// ── Helpers ────────────────────────────────────────────────

export function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function migrateData(raw: any): KanbanData {
  const data: KanbanData = {
    columns: raw.columns ?? [],
    properties: raw.properties ?? [],
    settings: { ...DEFAULT_SETTINGS, ...raw.settings },
    views: raw.views ?? [],
  };
  // Migrate old card format
  for (const col of data.columns) {
    for (let i = 0; i < col.cards.length; i++) {
      const card = col.cards[i];
      if (!card.properties) card.properties = {};
      if (!card.createdAt) card.createdAt = new Date().toISOString();
      if (!card.updatedAt) card.updatedAt = new Date().toISOString();
      if (!card.labels) card.labels = [];
    }
  }
  return data;
}

export function createCard(title: string): KanbanCard {
  const now = new Date().toISOString();
  return {
    id: uid("card"),
    title,
    description: "",
    labels: [],
    checked: false,
    properties: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function matchesFilter(card: KanbanCard, filter: Filter, properties: PropertyDefinition[]): boolean {
  const prop = properties.find((p) => p.id === filter.propertyId);
  if (!prop) return true;
  const val = card.properties[filter.propertyId];
  const { condition, value } = filter;

  switch (prop.type) {
    case "text":
    case "url":
      if (condition === "is") return val === value;
      if (condition === "contains") return typeof val === "string" && val.toLowerCase().includes((value ?? "").toLowerCase());
      if (condition === "is empty") return !val;
      break;
    case "number":
      if (condition === "=") return Number(val) === Number(value);
      if (condition === "≠") return Number(val) !== Number(value);
      if (condition === ">") return Number(val) > Number(value);
      if (condition === "<") return Number(val) < Number(value);
      if (condition === "is empty") return val == null || val === "";
      break;
    case "select":
      if (condition === "is") return val === value;
      if (condition === "is not") return val !== value;
      if (condition === "is empty") return !val;
      break;
    case "multi_select":
      if (condition === "contains") return Array.isArray(val) && val.includes(value);
      if (condition === "does not contain") return !Array.isArray(val) || !val.includes(value);
      if (condition === "is empty") return !Array.isArray(val) || val.length === 0;
      break;
    case "date":
      if (condition === "is") return val === value;
      if (condition === "before") return val && val < value;
      if (condition === "after") return val && val > value;
      if (condition === "is empty") return !val;
      break;
    case "checkbox":
      if (condition === "is checked") return val === true;
      if (condition === "is not checked") return val !== true;
      break;
  }
  return true;
}

export function compareCards(a: KanbanCard, b: KanbanCard, sorts: Sort[], properties: PropertyDefinition[]): number {
  for (const sort of sorts) {
    const prop = properties.find((p) => p.id === sort.propertyId);
    if (!prop) continue;
    const av = a.properties[sort.propertyId];
    const bv = b.properties[sort.propertyId];
    let cmp = 0;
    if (av == null && bv == null) continue;
    if (av == null) cmp = -1;
    else if (bv == null) cmp = 1;
    else if (prop.type === "number") cmp = Number(av) - Number(bv);
    else cmp = String(av).localeCompare(String(bv));
    if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
  }
  return 0;
}

/** Collect all cards from all columns into a flat array with column info */
export function getAllCards(columns: KanbanColumn[]): Array<KanbanCard & { _colId: string; _colTitle: string }> {
  const result: Array<KanbanCard & { _colId: string; _colTitle: string }> = [];
  for (const col of columns) {
    for (const card of col.cards) {
      result.push({ ...card, _colId: col.id, _colTitle: col.title });
    }
  }
  return result;
}

/** Compute column calculation */
export function computeCalculation(
  cards: KanbanCard[],
  calc: BoardSettings["calculation"],
  properties: PropertyDefinition[],
  t: (key: TranslationKey, ...args: (string | number)[]) => string,
): string | null {
  if (!calc) return null;
  if (calc.type === "count") return t("kanbanCalcCountValue", cards.length);
  const prop = properties.find((p) => p.id === calc.propertyId);
  if (!prop || prop.type !== "number") return null;
  const nums = cards.map((c) => Number(c.properties[calc.propertyId])).filter((n) => !isNaN(n));
  if (nums.length === 0) {
    return calc.type === "sum" ? t("kanbanCalcSumValue", 0) : t("kanbanCalcAvgValue", 0);
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  if (calc.type === "sum") return t("kanbanCalcSumValue", sum);
  return t("kanbanCalcAvgValue", (sum / nums.length).toFixed(1));
}

export function getConditionsForType(type: PropertyType): string[] {
  switch (type) {
    case "text": case "url": case "person":
      return ["is", "contains", "is empty"];
    case "number":
      return ["=", "≠", ">", "<", "is empty"];
    case "select":
      return ["is", "is not", "is empty"];
    case "multi_select":
      return ["contains", "does not contain", "is empty"];
    case "date":
      return ["is", "before", "after", "is empty"];
    case "checkbox":
      return ["is checked", "is not checked"];
    default:
      return ["is"];
  }
}
