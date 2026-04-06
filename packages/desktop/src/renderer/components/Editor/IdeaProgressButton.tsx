import { useState, useRef, useEffect, useCallback } from "react";
import { Gauge, Check } from "lucide-react";
import { IdeaProgressSlider, type ProgressStage } from "./IdeaProgressSlider.js";

interface IdeaProgressButtonProps {
  progress: number;
  stages: ProgressStage[];
  onProgressChange: (value: number) => void;
}

function getStageForValue(stages: ProgressStage[], value: number): ProgressStage | undefined {
  const sorted = [...stages].sort((a, b) => b.percent - a.percent);
  return sorted.find(s => s.percent <= value);
}

export function IdeaProgressButton({ progress, stages, onProgressChange }: IdeaProgressButtonProps) {
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState(progress);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setLocalValue(progress); }, [progress]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const currentStage = getStageForValue(stages, localValue);
  const fillColor = currentStage?.color || "#94a3b8";
  const isDone = localValue === 100;

  const handleChange = useCallback((v: number) => setLocalValue(v), []);
  const handleChangeEnd = useCallback((v: number) => {
    setLocalValue(v);
    onProgressChange(v);
  }, [onProgressChange]);

  return (
    <div className="idea-progress-btn-wrapper" ref={ref}>
      <button
        className={`idea-progress-btn ${isDone ? "idea-progress-btn--done" : ""}`}
        onClick={() => setOpen(!open)}
        title={`${localValue}%${currentStage ? " — " + currentStage.name : ""}`}
      >
        {isDone ? <Check size={12} /> : <Gauge size={12} />}
        <span className="idea-progress-btn-text">{localValue}%</span>
      </button>
      {open && (
        <div className="idea-progress-popover">
          <IdeaProgressSlider
            value={localValue}
            stages={stages}
            onChange={handleChange}
            onChangeEnd={handleChangeEnd}
          />
        </div>
      )}
    </div>
  );
}
