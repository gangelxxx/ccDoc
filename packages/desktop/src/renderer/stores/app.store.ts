import { create } from "zustand";
import type { AppState } from "./types.js";

// Re-export types that other components import from this module
export type { LlmConfig, LlmEffort, LlmAttachment, AppState, ModelTier, ModelTierConfig, ModelTiersConfig, ModelTestResult, ProviderScriptMeta } from "./types.js";
export { applyEffort } from "./llm-config.js";

// Slice creators
import { createUiSlice } from "./slices/ui.slice.js";
import { createNavigationSlice } from "./slices/navigation.slice.js";
import { createProjectsSlice } from "./slices/projects.slice.js";
import { createSectionsSlice } from "./slices/sections.slice.js";
import { createHistorySlice } from "./slices/history.slice.js";
import { createIoSlice } from "./slices/io.slice.js";
import { createSearchSlice } from "./slices/search.slice.js";
import { createLlmConfigSlice } from "./slices/llm-config.slice.js";
import { createLlmChatSlice } from "./slices/llm-chat.slice.js";
import { createLlmSessionsSlice } from "./slices/llm-sessions.slice.js";
import { createPassportSlice } from "./slices/passport.slice.js";
import { createEmbeddingSlice } from "./slices/embedding.slice.js";
import { createVoiceSlice } from "./slices/voice.slice.js";
import { createBgTasksSlice } from "./slices/bg-tasks.slice.js";
import { createTreeUiSlice } from "./slices/tree-ui.slice.js";
import { createExternalChangesSlice } from "./slices/external-changes.slice.js";
import { createSessionBufferSlice } from "./slices/session-buffer.slice.js";
import { createIndexingSlice } from "./slices/indexing.slice.js";
import { createSpellcheckSlice } from "./slices/spellcheck.slice.js";
import { createWorkspaceSlice } from "./slices/workspace.slice.js";
import { createUserSlice } from "./slices/user.slice.js";
import { createSectionPrefsSlice } from "./slices/section-prefs.slice.js";
import { createSectionSnapshotsSlice } from "./slices/section-snapshots.slice.js";
import { createHistorySettingsSlice } from "./slices/history-settings.slice.js";
import { _setStoreGetter } from "./llm-engine.js";

export const useAppStore = create<AppState>()((...a) => ({
  ...createUiSlice(...a),
  ...createNavigationSlice(...a),
  ...createProjectsSlice(...a),
  ...createSectionsSlice(...a),
  ...createHistorySlice(...a),
  ...createIoSlice(...a),
  ...createSearchSlice(...a),
  ...createLlmConfigSlice(...a),
  ...createLlmChatSlice(...a),
  ...createLlmSessionsSlice(...a),
  ...createPassportSlice(...a),
  ...createEmbeddingSlice(...a),
  ...createVoiceSlice(...a),
  ...createBgTasksSlice(...a),
  ...createTreeUiSlice(...a),
  ...createExternalChangesSlice(...a),
  ...createSessionBufferSlice(...a),
  ...createIndexingSlice(...a),
  ...createSpellcheckSlice(...a),
  ...createWorkspaceSlice(...a),
  ...createUserSlice(...a),
  ...createSectionPrefsSlice(...a),
  ...createSectionSnapshotsSlice(...a),
  ...createHistorySettingsSlice(...a),
}));

// Wire up store getter for llm-engine tier helpers
_setStoreGetter(() => useAppStore.getState());
