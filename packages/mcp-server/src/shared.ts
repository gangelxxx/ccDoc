import {
  openAppDb,
  openProjectDb,
  ProjectsService,
  SectionsService,
  HistoryService,
  FtsService,
  IndexService,
  ProjectPassportRepo,
  SectionsRepo,
  FtsRepo,
  EmbeddingRepo,
  EmbeddingModel,
  FindService,
} from "@ccdoc/core";
import type { Client } from "@libsql/client";
import { join } from "path";
import { homedir } from "os";

export const allowWrite = process.argv.includes("--allow-write");

export interface ProjectCache {
  db: Client;
  sections: SectionsService;
  history: HistoryService;
  fts: FtsService;
  index: IndexService;
  passport: ProjectPassportRepo;
  find: FindService;
  embeddingRepo: EmbeddingRepo;
}

export let projectsService: ProjectsService;
let appDb: Client | null = null;

const projectDbCache = new Map<string, ProjectCache>();

// Singleton embedding model — shared across all projects
let embeddingModel: EmbeddingModel | null = null;

export function getEmbeddingModel(): EmbeddingModel | null {
  if (embeddingModel) {
    return embeddingModel.isAvailable() ? embeddingModel : null;
  }
  // Look for model in ~/.ccdoc/models/ or CCDOC_MODELS_DIR env var
  const modelsDir = process.env.CCDOC_MODELS_DIR ?? join(homedir(), ".ccdoc", "models", "multilingual-e5-small");
  embeddingModel = new EmbeddingModel(modelsDir);
  return embeddingModel.isAvailable() ? embeddingModel : null;
}

export async function getProjectServices(token: string): Promise<ProjectCache> {
  if (!projectDbCache.has(token)) {
    const db = await openProjectDb(token);
    const ftsRepo = new FtsRepo(db);
    const embeddingRepo = new EmbeddingRepo(db);
    const model = getEmbeddingModel();
    projectDbCache.set(token, {
      db,
      sections: new SectionsService(db),
      history: new HistoryService(token),
      fts: new FtsService(db),
      index: new IndexService(db, undefined, ftsRepo, model, embeddingRepo),
      passport: new ProjectPassportRepo(db),
      find: new FindService(ftsRepo, embeddingRepo, model),
      embeddingRepo,
    });
  }
  return projectDbCache.get(token)!;
}

export async function init(): Promise<void> {
  appDb = await openAppDb();
  projectsService = new ProjectsService(appDb);
}

export async function cleanup(): Promise<void> {
  for (const [, { db }] of projectDbCache) {
    try { db.close(); } catch (e: unknown) { console.warn("cleanup error:", formatError(e)); }
  }
  projectDbCache.clear();
  try { appDb?.close(); } catch (e: unknown) { console.warn("cleanup error:", formatError(e)); }
}

export function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function errorResult(e: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${formatError(e)}` }],
    isError: true,
  };
}

