import { useT } from "../../../i18n.js";
import type { PropertyDefinition } from "./types.js";

export function PropertyDisplay({ prop, value }: { prop: PropertyDefinition; value: any }) {
  const t = useT();
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="kanban-prop-empty">{t("kanbanEmpty")}</span>;
  }
  switch (prop.type) {
    case "select": {
      const opt = prop.options?.find((o) => o.id === value);
      return opt ? <span className="kanban-prop-badge" style={{ background: opt.color + "22", color: opt.color }}>{opt.name}</span> : <span>{value}</span>;
    }
    case "multi_select": {
      return (
        <div className="kanban-prop-badges">
          {(value as string[]).map((v) => {
            const opt = prop.options?.find((o) => o.id === v);
            return opt ? (
              <span key={v} className="kanban-prop-badge" style={{ background: opt.color + "22", color: opt.color }}>{opt.name}</span>
            ) : null;
          })}
        </div>
      );
    }
    case "date":
      return <span>📅 {new Date(value).toLocaleDateString()}</span>;
    case "checkbox":
      return <span>{value ? `☑ ${t("kanbanChecked")}` : `☐ ${t("kanbanUnchecked")}`}</span>;
    case "url":
      return <a href={value} target="_blank" rel="noreferrer">🔗 {value}</a>;
    default:
      return <span>{String(value)}</span>;
  }
}

export function PropertyEditor({
  prop,
  value,
  onChange,
  onClose,
}: {
  prop: PropertyDefinition;
  value: any;
  onChange: (v: any) => void;
  onClose: () => void;
}) {
  const t = useT();
  switch (prop.type) {
    case "text":
    case "url":
    case "person":
      return (
        <input
          className="kanban-prop-editor-input"
          defaultValue={value ?? ""}
          autoFocus
          onBlur={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange((e.target as HTMLInputElement).value);
            if (e.key === "Escape") onClose();
          }}
        />
      );
    case "number":
      return (
        <input
          className="kanban-prop-editor-input"
          type="number"
          defaultValue={value ?? ""}
          autoFocus
          onBlur={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange((e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null);
            if (e.key === "Escape") onClose();
          }}
        />
      );
    case "date":
      return (
        <input
          className="kanban-prop-editor-input"
          type="date"
          defaultValue={value ?? ""}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "checkbox":
      return (
        <label className="kanban-prop-editor-checkbox">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span>{value ? t("kanbanChecked") : t("kanbanUnchecked")}</span>
        </label>
      );
    case "select":
      return (
        <div className="kanban-prop-editor-select">
          {prop.options?.map((opt) => (
            <div
              key={opt.id}
              className={`kanban-prop-editor-option ${value === opt.id ? "selected" : ""}`}
              style={{ background: opt.color + "22", color: opt.color }}
              onClick={() => onChange(opt.id)}
            >
              {opt.name}
            </div>
          ))}
          <div className="kanban-prop-editor-option" style={{ opacity: 0.5 }} onClick={() => onChange(null)}>
            {t("kanbanClear")}
          </div>
        </div>
      );
    case "multi_select": {
      const selected: string[] = Array.isArray(value) ? value : [];
      return (
        <div className="kanban-prop-editor-select">
          {prop.options?.map((opt) => (
            <div
              key={opt.id}
              className={`kanban-prop-editor-option ${selected.includes(opt.id) ? "selected" : ""}`}
              style={{ background: opt.color + "22", color: opt.color }}
              onClick={() => {
                const next = selected.includes(opt.id) ? selected.filter((s) => s !== opt.id) : [...selected, opt.id];
                onChange(next);
              }}
            >
              {selected.includes(opt.id) ? "✓ " : ""}{opt.name}
            </div>
          ))}
          <div className="kanban-prop-editor-option" style={{ opacity: 0.5 }} onClick={onClose}>
            {t("kanbanDone")}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
