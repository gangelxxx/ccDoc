import { useState, useRef, useCallback, useEffect } from "react";

export interface ProgressStage {
  id: string;
  name: string;
  percent: number;
  color?: string;
}

interface IdeaProgressSliderProps {
  value: number;
  stages: ProgressStage[];
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
}

function getStageForValue(stages: ProgressStage[], value: number): ProgressStage | undefined {
  const sorted = [...stages].sort((a, b) => b.percent - a.percent);
  return sorted.find(s => s.percent <= value);
}

export function IdeaProgressSlider({ value, stages, onChange, onChangeEnd }: IdeaProgressSliderProps) {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const currentStage = getStageForValue(stages, value);
  const fillColor = currentStage?.color || "#94a3b8";

  const calcValue = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * 100);
  }, [value]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const v = calcValue(e.clientX);
    onChange(v);
  }, [calcValue, onChange]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      onChange(calcValue(e.clientX));
    };
    const handleUp = (e: MouseEvent) => {
      setDragging(false);
      const v = calcValue(e.clientX);
      onChange(v);
      onChangeEnd?.(v);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, calcValue, onChange, onChangeEnd]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const step = e.shiftKey ? 5 : 1;
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(0, Math.min(100, value + dir * step));
    onChange(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChangeEnd?.(next), 300);
  }, [value, onChange, onChangeEnd]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const sortedStages = [...stages].sort((a, b) => a.percent - b.percent);

  return (
    <div className="idea-progress-slider" onWheel={handleWheel}>
      <div className="idea-progress-slider-marks">
        {sortedStages.map(s => (
          <div
            key={s.id}
            className="idea-progress-slider-mark"
            style={{ left: `${s.percent}%` }}
          >
            <span className="idea-progress-slider-mark-label">{s.name}</span>
          </div>
        ))}
      </div>
      <div
        className="idea-progress-slider-track"
        ref={trackRef}
        onMouseDown={handleMouseDown}
      >
        <div
          className="idea-progress-slider-fill"
          style={{ width: `${value}%`, backgroundColor: fillColor }}
        />
        <div
          className="idea-progress-slider-thumb"
          style={{ left: `${value}%`, borderColor: fillColor }}
        />
        {sortedStages.map(s => (
          <div
            key={s.id}
            className="idea-progress-slider-dot"
            style={{ left: `${s.percent}%`, backgroundColor: s.percent <= value ? fillColor : undefined }}
          />
        ))}
      </div>
      <div className="idea-progress-slider-info">
        <span style={{ color: fillColor, fontWeight: 600 }}>{value}%</span>
        {currentStage && <span className="idea-progress-slider-stage-name"> — {currentStage.name}</span>}
      </div>
    </div>
  );
}
