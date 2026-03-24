import { useState } from "react";
import { useT } from "../../../i18n.js";
import type { PropertyType, SelectOption, PropertyDefinition, BoardSettings } from "./types.js";
import { uid, LABEL_COLORS, PROPERTY_TYPE_KEYS } from "./utils.js";

export function SettingsPanel({
  settings,
  properties,
  onSettingsChange,
  onPropertiesChange,
  onClose,
}: {
  settings: BoardSettings;
  properties: PropertyDefinition[];
  onSettingsChange: (s: BoardSettings) => void;
  onPropertiesChange: (p: PropertyDefinition[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [addingProp, setAddingProp] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("text");
  const [addingOptionForProp, setAddingOptionForProp] = useState<string | null>(null);
  const [newOptionName, setNewOptionName] = useState("");

  const selectProps = properties.filter((p) => p.type === "select" || p.type === "multi_select");
  const numberProps = properties.filter((p) => p.type === "number");

  return (
    <div className="kanban-modal-overlay" onClick={onClose}>
      <div className="kanban-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="kanban-settings-header">
          <h3>{t("kanbanBoardSettings")}</h3>
          <button className="btn-icon" onClick={onClose}>×</button>
        </div>

        <div className="kanban-settings-section">
          <h4>{t("kanbanDisplay")}</h4>
          <label className="kanban-settings-row">
            <span>{t("kanbanCardSize")}</span>
            <select value={settings.cardSize} onChange={(e) => onSettingsChange({ ...settings, cardSize: e.target.value as any })}>
              <option value="small">{t("kanbanCardSmall")}</option>
              <option value="medium">{t("kanbanCardMedium")}</option>
              <option value="large">{t("kanbanCardLarge")}</option>
            </select>
          </label>
          <label className="kanban-settings-row">
            <span>{t("kanbanColorColumns")}</span>
            <input type="checkbox" checked={settings.colorColumns} onChange={(e) => onSettingsChange({ ...settings, colorColumns: e.target.checked })} />
          </label>
          <label className="kanban-settings-row">
            <span>{t("kanbanHideEmptyGroups")}</span>
            <input type="checkbox" checked={settings.hideEmptyGroups} onChange={(e) => onSettingsChange({ ...settings, hideEmptyGroups: e.target.checked })} />
          </label>
        </div>

        <div className="kanban-settings-section">
          <h4>{t("kanbanGrouping")}</h4>
          <label className="kanban-settings-row">
            <span>{t("kanbanGroupBy")}</span>
            <select value={settings.groupBy ?? ""} onChange={(e) => onSettingsChange({ ...settings, groupBy: e.target.value || undefined })}>
              <option value="">{t("kanbanManual")}</option>
              {selectProps.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {settings.groupBy && (
            <label className="kanban-settings-row">
              <span>{t("kanbanSubGroupBy")}</span>
              <select value={settings.subGroupBy ?? ""} onChange={(e) => onSettingsChange({ ...settings, subGroupBy: e.target.value || undefined })}>
                <option value="">{t("kanbanNone")}</option>
                {selectProps.filter((p) => p.id !== settings.groupBy).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="kanban-settings-section">
          <h4>{t("kanbanCalculation")}</h4>
          <label className="kanban-settings-row">
            <span>{t("kanbanCalcType")}</span>
            <select
              value={settings.calculation ? `${settings.calculation.propertyId}:${settings.calculation.type}` : ""}
              onChange={(e) => {
                if (!e.target.value) {
                  onSettingsChange({ ...settings, calculation: null });
                } else {
                  const [propertyId, type] = e.target.value.split(":");
                  onSettingsChange({ ...settings, calculation: { propertyId, type: type as "count" | "sum" | "avg" } });
                }
              }}
            >
              <option value="">{t("kanbanNone")}</option>
              <option value="__count:count">{t("kanbanCalcCount")}</option>
              {numberProps.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  <option value={`${p.id}:sum`}>{t("kanbanCalcSumOf", p.name)}</option>
                  <option value={`${p.id}:avg`}>{t("kanbanCalcAvgOf", p.name)}</option>
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="kanban-settings-section">
          <h4>{t("kanbanProperties")}</h4>
          {properties.sort((a, b) => a.order - b.order).map((prop) => (
            <div key={prop.id} className="kanban-settings-prop-row">
              <input
                type="checkbox"
                checked={prop.isVisible}
                onChange={(e) => {
                  onPropertiesChange(properties.map((p) => p.id === prop.id ? { ...p, isVisible: e.target.checked } : p));
                }}
              />
              <span className="kanban-settings-prop-name">{prop.name}</span>
              <span className="kanban-settings-prop-type">{t(PROPERTY_TYPE_KEYS[prop.type])}</span>
              {prop.type === "select" || prop.type === "multi_select" ? (
                addingOptionForProp === prop.id ? (
                  <span className="kanban-settings-inline-input">
                    <input
                      placeholder={t("kanbanOptionNamePrompt")}
                      value={newOptionName}
                      onChange={(e) => setNewOptionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newOptionName.trim()) {
                          const color = LABEL_COLORS[(prop.options?.length ?? 0) % LABEL_COLORS.length].color;
                          const opt: SelectOption = { id: uid("opt"), name: newOptionName.trim(), color };
                          onPropertiesChange(properties.map((p) => p.id === prop.id ? { ...p, options: [...(p.options ?? []), opt] } : p));
                          setNewOptionName("");
                          setAddingOptionForProp(null);
                        } else if (e.key === "Escape") {
                          setNewOptionName("");
                          setAddingOptionForProp(null);
                        }
                      }}
                      onBlur={() => { setNewOptionName(""); setAddingOptionForProp(null); }}
                      autoFocus
                    />
                  </span>
                ) : (
                  <button
                    className="kanban-toolbar-btn"
                    onClick={() => { setAddingOptionForProp(prop.id); setNewOptionName(""); }}
                  >
                    {t("kanbanAddOption")}
                  </button>
                )
              ) : null}
              <button
                className="btn-icon"
                onClick={() => onPropertiesChange(properties.filter((p) => p.id !== prop.id))}
              >
                ×
              </button>
            </div>
          ))}

          {addingProp ? (
            <div className="kanban-settings-add-prop">
              <input
                placeholder={t("kanbanPropertyNamePlaceholder")}
                value={newPropName}
                onChange={(e) => setNewPropName(e.target.value)}
                autoFocus
              />
              <select value={newPropType} onChange={(e) => setNewPropType(e.target.value as PropertyType)}>
                {Object.entries(PROPERTY_TYPE_KEYS).map(([k, key]) => (
                  <option key={k} value={k}>{t(key)}</option>
                ))}
              </select>
              <button
                className="kanban-toolbar-btn"
                onClick={() => {
                  if (!newPropName.trim()) return;
                  const prop: PropertyDefinition = {
                    id: uid("prop"),
                    name: newPropName.trim(),
                    type: newPropType,
                    options: newPropType === "select" || newPropType === "multi_select" ? [] : undefined,
                    isVisible: true,
                    order: properties.length,
                  };
                  onPropertiesChange([...properties, prop]);
                  setNewPropName("");
                  setAddingProp(false);
                }}
              >
                {t("kanbanAdd")}
              </button>
              <button className="btn-icon" onClick={() => setAddingProp(false)}>×</button>
            </div>
          ) : (
            <button className="kanban-toolbar-add-btn" onClick={() => setAddingProp(true)}>
              {t("kanbanAddProperty")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
