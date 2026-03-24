import { join } from "path";
import { homedir } from "os";
import { EmbeddingModel, OnlineEmbeddingProvider } from "@ccdoc/core";
import type { IEmbeddingProvider } from "@ccdoc/core";
import type { SettingsService } from "./services/settings.service";

/**
 * Manages the current embedding provider singleton.
 * Supports hot-swapping between local ONNX and online providers.
 */
export class EmbeddingManager {
  private provider: IEmbeddingProvider | null = null;

  constructor(private settingsService: SettingsService) {
    this.refresh();
  }

  /** Recreate the provider from current settings. */
  refresh(): void {
    const cfg = this.settingsService.getAll().embedding;

    if (cfg.mode === "local") {
      const modelDir = join(homedir(), ".ccdoc", "models", cfg.localModelId);
      this.provider = new EmbeddingModel(modelDir);
    } else if (cfg.mode === "online") {
      this.provider = new OnlineEmbeddingProvider(
        cfg.onlineProvider as "openai" | "voyage",
        cfg.onlineModel,
        cfg.onlineApiKey
      );
    } else {
      this.provider = null;
    }
  }

  /** Get the current provider, or null if not configured / not available. */
  getProvider(): IEmbeddingProvider | null {
    if (!this.provider) return null;
    return this.provider.isAvailable() ? this.provider : null;
  }
}
