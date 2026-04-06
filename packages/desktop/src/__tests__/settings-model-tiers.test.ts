import { describe, it, expect } from "vitest";
import { validateSettings, SETTINGS_DEFAULTS } from "../main/services/settings.types";
import type { ModelTiersConfig, ModelTierConfig } from "../main/services/settings.types";

// ─── validateSettings for modelTiers ──────────────────────────────────────

describe("validateSettings — modelTiers", () => {
  it("uses defaults when modelTiers is missing", () => {
    const raw = { ...SETTINGS_DEFAULTS };
    delete (raw as any).modelTiers;
    const result = validateSettings(raw);
    expect(result.modelTiers).toEqual(SETTINGS_DEFAULTS.modelTiers);
  });

  it("uses defaults when modelTiers is null", () => {
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: null });
    expect(result.modelTiers).toEqual(SETTINGS_DEFAULTS.modelTiers);
  });

  it("preserves valid modelTiers", () => {
    const custom: ModelTiersConfig = {
      strong: {
        providerScript: { type: "builtin", builtinId: "openai" },
        modelId: "gpt-4o",
        baseUrl: "https://api.openai.com",
        apiKey: "sk-test",
        effort: "high",
        thinking: false,
        thinkingBudget: 5000,
        maxTokens: 8192,
        temperature: 0.8,
      },
      medium: { ...SETTINGS_DEFAULTS.modelTiers.medium },
      weak: { ...SETTINGS_DEFAULTS.modelTiers.weak },
      chatTier: "strong",
      passportTier: "weak",
      summaryTier: "weak",
    };
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: custom });
    expect(result.modelTiers.strong.providerScript.builtinId).toBe("openai");
    expect(result.modelTiers.strong.modelId).toBe("gpt-4o");
    expect(result.modelTiers.chatTier).toBe("strong");
  });

  it("replaces missing tier with defaults", () => {
    const partial = {
      strong: { ...SETTINGS_DEFAULTS.modelTiers.strong },
      // medium is missing
      weak: { ...SETTINGS_DEFAULTS.modelTiers.weak },
      chatTier: "medium",
      passportTier: "weak",
      summaryTier: "weak",
    };
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: partial });
    expect(result.modelTiers.medium).toEqual(SETTINGS_DEFAULTS.modelTiers.medium);
  });

  it("clamps thinkingBudget to [1000, 100000]", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.strong.thinkingBudget = 500; // below min
    tiers.medium.thinkingBudget = 200000; // above max
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.strong.thinkingBudget).toBe(1000);
    expect(result.modelTiers.medium.thinkingBudget).toBe(100000);
  });

  it("clamps maxTokens to [256, 65536]", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.strong.maxTokens = 10; // below min
    tiers.weak.maxTokens = 999999; // above max
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.strong.maxTokens).toBe(256);
    expect(result.modelTiers.weak.maxTokens).toBe(65536);
  });

  it("clamps temperature to [0, 2]", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.strong.temperature = -1;
    tiers.medium.temperature = 5;
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.strong.temperature).toBe(0);
    expect(result.modelTiers.medium.temperature).toBe(2);
  });

  it("fixes invalid effort to default", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.strong.effort = "ultra" as any;
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.strong.effort).toBe(SETTINGS_DEFAULTS.modelTiers.strong.effort);
  });

  it("fixes invalid thinking to default boolean", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.weak.thinking = "yes" as any;
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.weak.thinking).toBe(SETTINGS_DEFAULTS.modelTiers.weak.thinking);
  });

  it("fixes invalid tier assignments", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.chatTier = "ultra" as any;
    tiers.passportTier = "invalid" as any;
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.chatTier).toBe("medium");
    expect(result.modelTiers.passportTier).toBe("weak");
  });

  it("uses default providerScript when it's invalid", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.strong.providerScript = "not an object" as any;
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.strong.providerScript).toEqual(SETTINGS_DEFAULTS.modelTiers.strong.providerScript);
  });

  it("handles NaN values by using defaults", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    tiers.strong.thinkingBudget = NaN;
    tiers.strong.maxTokens = NaN;
    tiers.strong.temperature = NaN;
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    // NaN clamped to min
    expect(result.modelTiers.strong.thinkingBudget).toBe(1000);
    expect(result.modelTiers.strong.maxTokens).toBe(256);
    expect(result.modelTiers.strong.temperature).toBe(0);
  });

  it("preserves apiKey as empty string when missing", () => {
    const tiers = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS.modelTiers));
    delete tiers.strong.apiKey;
    const result = validateSettings({ ...SETTINGS_DEFAULTS, modelTiers: tiers });
    expect(result.modelTiers.strong.apiKey).toBe("");
  });
});

// ─���─ SETTINGS_DEFAULTS.modelTiers structure ──────────────────────────────

describe("SETTINGS_DEFAULTS.modelTiers", () => {
  it("has all three tiers", () => {
    expect(SETTINGS_DEFAULTS.modelTiers.strong).toBeDefined();
    expect(SETTINGS_DEFAULTS.modelTiers.medium).toBeDefined();
    expect(SETTINGS_DEFAULTS.modelTiers.weak).toBeDefined();
  });

  it("all tiers use anthropic-oauth by default", () => {
    for (const tier of ["strong", "medium", "weak"] as const) {
      expect(SETTINGS_DEFAULTS.modelTiers[tier].providerScript).toEqual({
        type: "builtin",
        builtinId: "anthropic-oauth",
      });
    }
  });

  it("strong tier has thinking enabled", () => {
    expect(SETTINGS_DEFAULTS.modelTiers.strong.thinking).toBe(true);
  });

  it("medium and weak tiers have thinking disabled", () => {
    expect(SETTINGS_DEFAULTS.modelTiers.medium.thinking).toBe(false);
    expect(SETTINGS_DEFAULTS.modelTiers.weak.thinking).toBe(false);
  });

  it("tier assignments are correct defaults", () => {
    expect(SETTINGS_DEFAULTS.modelTiers.chatTier).toBe("medium");
    expect(SETTINGS_DEFAULTS.modelTiers.passportTier).toBe("weak");
    expect(SETTINGS_DEFAULTS.modelTiers.summaryTier).toBe("weak");
  });

  it("all tiers have valid baseUrl", () => {
    for (const tier of ["strong", "medium", "weak"] as const) {
      expect(SETTINGS_DEFAULTS.modelTiers[tier].baseUrl).toBe("https://api.anthropic.com");
    }
  });

  it("effort levels differ: strong=high, medium=medium, weak=low", () => {
    expect(SETTINGS_DEFAULTS.modelTiers.strong.effort).toBe("high");
    expect(SETTINGS_DEFAULTS.modelTiers.medium.effort).toBe("medium");
    expect(SETTINGS_DEFAULTS.modelTiers.weak.effort).toBe("low");
  });
});
