import { useState, useCallback } from "react";
import { Trash2, Plus, RotateCcw } from "lucide-react";
import { useT } from "../../../i18n.js";
interface ProgressStage {
  id: string;
  name: string;
  percent: number;
  color?: string;
}

const DEFAULT_PROGRESS_STAGES: ProgressStage[] = [
  { id: 'new',     name: 'New',         percent: 0,   color: '#94a3b8' },
  { id: 'dev',     name: 'In Progress',  percent: 25,  color: '#3b82f6' },
  { id: 'test',    name: 'Testing',   percent: 50,  color: '#f59e0b' },
  { id: 'prod',    name: 'In Production',       percent: 75,  color: '#22c55e' },
  { id: 'done',    name: 'Done',        percent: 100, color: '#10b981' },
];

interface ProgressStagesTabProps {
  stages: ProgressStage[];
  onChange: (stages: ProgressStage[]) => void;
}

export function ProgressStagesTab({ stages, onChange }: ProgressStagesTabProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  const sorted = [...stages].sort((a, b) => a.percent - b.percent);

  const validate = useCallback((newStages: ProgressStage[]): string | null => {
    if (newStages.length < 2) return t("progressStageMinRequired");
    const percents = newStages.map(s => s.percent);
    const unique = new Set(percents);
    if (unique.size !== percents.length) return t("progressStageUniquePercent");
    if (!percents.includes(0)) return t("progressStageNeedZero");
    if (!percents.includes(100)) return t("progressStageNeedHundred");
    for (const p of percents) {
      if (p < 0 || p > 100) return t("progressStagePercentRange");
    }
    return null;
  }, [t]);

  const update = useCallback((newStages: ProgressStage[]) => {
    const err = validate(newStages);
    setError(err);
    if (!err) onChange(newStages);
  }, [validate, onChange]);

  const handleNameChange = (id: string, name: string) => {
    update(stages.map(s => s.id === id ? { ...s, name } : s));
  };

  const handlePercentChange = (id: string, percent: number) => {
    update(stages.map(s => s.id === id ? { ...s, percent: Math.max(0, Math.min(100, percent)) } : s));
  };

  const handleColorChange = (id: string, color: string) => {
    update(stages.map(s => s.id === id ? { ...s, color } : s));
  };

  const handleDelete = (id: string) => {
    const stage = stages.find(s => s.id === id);
    if (stage && (stage.percent === 0 || stage.percent === 100)) return;
    update(stages.filter(s => s.id !== id));
  };

  const handleAdd = () => {
    const used = new Set(stages.map(s => s.percent));
    let newPercent = 50;
    while (used.has(newPercent) && newPercent < 100) newPercent++;
    if (used.has(newPercent)) {
      newPercent = 1;
      while (used.has(newPercent) && newPercent < 100) newPercent++;
    }
    const newStage: ProgressStage = {
      id: crypto.randomUUID(),
      name: t("progressStageNewName"),
      percent: newPercent,
      color: "#6b7280",
    };
    update([...stages, newStage]);
  };

  const handleReset = () => {
    setError(null);
    onChange([...DEFAULT_PROGRESS_STAGES]);
  };

  return (
    <div className="progress-stages-editor">
      <p className="settings-hint" style={{ marginBottom: 12 }}>
        {t("progressStageHint")}
      </p>
      <div className="progress-stages-list">
        {sorted.map(stage => {
          const isFixed = stage.percent === 0 || stage.percent === 100;
          return (
            <div key={stage.id} className="progress-stage-row">
              <input
                type="color"
                className="progress-stage-color"
                value={stage.color || "#6b7280"}
                onChange={e => handleColorChange(stage.id, e.target.value)}
              />
              <input
                className="progress-stage-name"
                value={stage.name}
                onChange={e => handleNameChange(stage.id, e.target.value)}
                placeholder={t("progressStageName")}
              />
              <input
                type="number"
                className="progress-stage-percent"
                value={stage.percent}
                min={0}
                max={100}
                onChange={e => handlePercentChange(stage.id, parseInt(e.target.value) || 0)}
              />
              <span className="progress-stage-percent-label">%</span>
              <button
                className="btn-icon progress-stage-delete"
                onClick={() => handleDelete(stage.id)}
                disabled={isFixed}
                title={isFixed ? t("progressStageCannotDelete") : t("delete")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="progress-stages-error">{error}</p>}
      <div className="progress-stages-actions">
        <button className="btn" onClick={handleAdd}>
          <Plus size={14} /> {t("progressStageAdd")}
        </button>
        <button className="btn" onClick={handleReset}>
          <RotateCcw size={14} /> {t("progressStageReset")}
        </button>
      </div>
    </div>
  );
}
