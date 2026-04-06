import type { IndexingConfig, SliceCreator } from "../types.js";

const INITIAL_INDEXING_CONFIG: IndexingConfig = {
  enabled: true,
  intensity: "low",
  excludedDirs: [
    "node_modules", ".git", ".ccdoc", "dist", "build", ".next", "vendor",
    "__pycache__", ".vscode", ".idea", ".svn", "coverage", ".nyc_output",
    ".cache", ".turbo", "release", "out", ".output", "logs",
  ],
  codeExtensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".go", ".rs"],
  maxFileSizeKB: 500,
  stalenessIntervalMin: 5,
}; // overwritten by boot

export interface IndexingSlice {
  indexingConfig: IndexingConfig;
  setIndexingConfig: (cfg: Partial<IndexingConfig>) => void;
}

export const createIndexingSlice: SliceCreator<IndexingSlice> = (set, get) => ({
  indexingConfig: INITIAL_INDEXING_CONFIG,

  setIndexingConfig: (cfg) => {
    const next = { ...get().indexingConfig, ...cfg };
    set({ indexingConfig: next });
    // Sequential: wait for settings to persist, then apply to worker/scheduler
    window.api.settingsPatch({ indexing: next }, "settings:indexing").then(() => {
      window.api.applyIndexingConfig().catch(() => {});
    }).catch(() => {});
  },
});
