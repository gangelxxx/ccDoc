import { registerProjectsIpc } from "./projects";
import { registerSectionsIpc } from "./sections";
import { registerHistoryIpc } from "./history";
import { registerIoIpc } from "./io";
import { registerImportDocsIpc } from "./import-docs";
import { registerSearchIpc } from "./search";
import { registerPassportIpc } from "./passport";
import { registerBackupIpc } from "./backup";
import { registerLlmIpc } from "./llm";
import { registerEmbeddingIpc } from "./embedding";
import { registerVoiceIpc } from "./voice";
import { registerSourceCodeIpc } from "./source-code";
import { registerInstallIpc } from "./install";
import { registerWebSearchIpc } from "./web-search";
import { registerKnowledgeGraphIpc } from "./knowledge-graph";
import { registerSemanticIpc } from "./semantic";
import { registerSettingsIpc } from "./settings";
import type { SettingsService } from "../services/settings.service";

export function registerAllIpcHandlers(settingsService: SettingsService): void {
  registerProjectsIpc();
  registerSectionsIpc();
  registerHistoryIpc();
  registerIoIpc();
  registerImportDocsIpc();
  registerSearchIpc();
  registerPassportIpc();
  registerBackupIpc();
  registerLlmIpc();
  registerEmbeddingIpc();
  registerVoiceIpc();
  registerSourceCodeIpc();
  registerInstallIpc();
  registerWebSearchIpc();
  registerKnowledgeGraphIpc(settingsService);
  registerSemanticIpc();
  registerSettingsIpc(settingsService);
}
