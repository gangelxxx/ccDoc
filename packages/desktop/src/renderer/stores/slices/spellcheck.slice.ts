import type { SpellcheckConfig, SliceCreator } from "../types.js";

const INITIAL_SPELLCHECK_CONFIG: SpellcheckConfig = {
  enabled: true,
  languages: ["ru", "en"],
  userDictionary: [],
}; // overwritten by boot

export interface SpellcheckSlice {
  spellcheckConfig: SpellcheckConfig;
  setSpellcheckConfig: (cfg: Partial<SpellcheckConfig>) => void;
}

export const createSpellcheckSlice: SliceCreator<SpellcheckSlice> = (set, get) => ({
  spellcheckConfig: INITIAL_SPELLCHECK_CONFIG,

  setSpellcheckConfig: (cfg) => {
    const next = { ...get().spellcheckConfig, ...cfg };
    set({ spellcheckConfig: next });
    window.api.settingsPatch({ spellcheck: next }, "settings:spellcheck").catch(() => {});
  },
});
