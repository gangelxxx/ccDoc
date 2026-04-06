import type { SliceCreator } from "../types.js";

export interface HistoryConfig {
  historyRetainDays: number;
  maxSnapshotsPerSection: number;
  snapshotMaxAgeDays: number;
  snapshotCoalesceIntervalSec: number;
}

const INITIAL_HISTORY_CONFIG: HistoryConfig = {
  historyRetainDays: 0,
  maxSnapshotsPerSection: 30,
  snapshotMaxAgeDays: 30,
  snapshotCoalesceIntervalSec: 30,
}; // overwritten by boot

export interface HistorySettingsSlice {
  historyConfig: HistoryConfig;
  setHistoryConfig: (cfg: Partial<HistoryConfig>) => void;
}

export const createHistorySettingsSlice: SliceCreator<HistorySettingsSlice> = (set, get) => ({
  historyConfig: INITIAL_HISTORY_CONFIG,

  setHistoryConfig: (cfg) => {
    const next = { ...get().historyConfig, ...cfg };
    set({ historyConfig: next });
    window.api.settingsPatch({ history: next }, "settings:history").then(() => {
      // Apply snapshot config to running services
      window.api.historySettingsApplyConfig({
        maxSnapshotsPerSection: next.maxSnapshotsPerSection,
        snapshotMaxAgeDays: next.snapshotMaxAgeDays,
        snapshotCoalesceIntervalSec: next.snapshotCoalesceIntervalSec,
      }).catch(() => {});
    }).catch(() => {});
  },
});
