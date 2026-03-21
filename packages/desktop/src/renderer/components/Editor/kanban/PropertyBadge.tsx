import type { PropertyDefinition, SelectOption } from "./types.js";

export function PropertyBadge({ prop, value, options }: { prop: PropertyDefinition; value: any; options?: SelectOption[] }) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;

  switch (prop.type) {
    case "select": {
      const opt = options?.find((o) => o.id === value);
      if (!opt) return null;
      return (
        <span className="kanban-prop-badge" style={{ background: opt.color + "22", color: opt.color }}>
          {opt.name}
        </span>
      );
    }
    case "multi_select": {
      if (!Array.isArray(value)) return null;
      return (
        <>
          {value.map((v: string) => {
            const opt = options?.find((o) => o.id === v);
            if (!opt) return null;
            return (
              <span key={v} className="kanban-prop-badge" style={{ background: opt.color + "22", color: opt.color }}>
                {opt.name}
              </span>
            );
          })}
        </>
      );
    }
    case "date":
      return <span className="kanban-prop-text">📅 {new Date(value).toLocaleDateString()}</span>;
    case "checkbox":
      return <span className="kanban-prop-text">{value ? "☑" : "☐"}</span>;
    case "number":
      return <span className="kanban-prop-text">{value}</span>;
    case "person":
      return (
        <span className="kanban-prop-person" title={value}>
          {String(value).charAt(0).toUpperCase()}
        </span>
      );
    case "url":
      return (
        <a className="kanban-prop-text kanban-prop-url" href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          🔗 {new URL(value).hostname}
        </a>
      );
    default:
      return <span className="kanban-prop-text">{String(value).slice(0, 50)}</span>;
  }
}
