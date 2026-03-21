import { useT } from "../../../i18n.js";
import type { PropertyDefinition, Filter, Sort } from "./types.js";
import { uid, getConditionsForType, CONDITION_KEYS } from "./utils.js";

// ── Filter & Sort Dropdowns ──────────────────────────────────

export function FilterDropdown({
  filters,
  properties,
  onFiltersChange,
}: {
  filters: Filter[];
  properties: PropertyDefinition[];
  onFiltersChange: (filters: Filter[] | ((prev: Filter[]) => Filter[])) => void;
}) {
  const t = useT();
  return (
    <div className="kanban-toolbar-dropdown">
      {filters.map((f, i) => {
        const prop = properties.find((p) => p.id === f.propertyId);
        return (
          <div key={f.id} className="kanban-filter-row">
            <select
              value={f.propertyId}
              onChange={(e) => {
                const updated = [...filters];
                updated[i] = { ...f, propertyId: e.target.value, condition: "is", value: "" };
                onFiltersChange(updated);
              }}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={f.condition}
              onChange={(e) => {
                const updated = [...filters];
                updated[i] = { ...f, condition: e.target.value };
                onFiltersChange(updated);
              }}
            >
              {getConditionsForType(prop?.type ?? "text").map((c) => (
                <option key={c} value={c}>{CONDITION_KEYS[c] ? t(CONDITION_KEYS[c]) : c}</option>
              ))}
            </select>
            {!["is empty", "is checked", "is not checked"].includes(f.condition) && (
              prop?.type === "select" || prop?.type === "multi_select" ? (
                <select value={f.value} onChange={(e) => {
                  const updated = [...filters];
                  updated[i] = { ...f, value: e.target.value };
                  onFiltersChange(updated);
                }}>
                  <option value="">—</option>
                  {prop.options?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : (
                <input
                  type={prop?.type === "date" ? "date" : prop?.type === "number" ? "number" : "text"}
                  value={f.value ?? ""}
                  onChange={(e) => {
                    const updated = [...filters];
                    updated[i] = { ...f, value: e.target.value };
                    onFiltersChange(updated);
                  }}
                  className="kanban-filter-input"
                />
              )
            )}
            <button className="btn-icon" onClick={() => onFiltersChange(filters.filter((_, j) => j !== i))}>×</button>
          </div>
        );
      })}
      <button
        className="kanban-toolbar-add-btn"
        onClick={() => {
          if (properties.length === 0) return;
          onFiltersChange([...filters, { id: uid("f"), propertyId: properties[0].id, condition: "is", value: "" }]);
        }}
      >
        {t("kanbanAddFilter")}
      </button>
    </div>
  );
}

export function SortDropdown({
  sorts,
  properties,
  onSortsChange,
}: {
  sorts: Sort[];
  properties: PropertyDefinition[];
  onSortsChange: (sorts: Sort[] | ((prev: Sort[]) => Sort[])) => void;
}) {
  const t = useT();
  return (
    <div className="kanban-toolbar-dropdown">
      {sorts.map((s, i) => (
        <div key={i} className="kanban-filter-row">
          <select
            value={s.propertyId}
            onChange={(e) => {
              const updated = [...sorts];
              updated[i] = { ...s, propertyId: e.target.value };
              onSortsChange(updated);
            }}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={s.direction}
            onChange={(e) => {
              const updated = [...sorts];
              updated[i] = { ...s, direction: e.target.value as "asc" | "desc" };
              onSortsChange(updated);
            }}
          >
            <option value="asc">{t("kanbanSortAsc")}</option>
            <option value="desc">{t("kanbanSortDesc")}</option>
          </select>
          <button className="btn-icon" onClick={() => onSortsChange(sorts.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button
        className="kanban-toolbar-add-btn"
        onClick={() => {
          if (properties.length === 0) return;
          onSortsChange([...sorts, { propertyId: properties[0].id, direction: "asc" }]);
        }}
      >
        {t("kanbanAddSort")}
      </button>
    </div>
  );
}
