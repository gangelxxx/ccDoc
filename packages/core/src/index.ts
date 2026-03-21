// Types
export type {
  Project,
  Section,
  SectionType,
  Tag,
  SectionTag,
  ExportHash,
  TreeNode,
  FileSectionNode,
  HistoryCommit,
  OutputFormat,
  StructuredBlock,
  StructuredOutput,
  StructureJson,
  StructureSection,
  ExcalidrawBlock,
  ProseMirrorNode,
  ProseMirrorMark,
  SearchResult,
  SearchDocument,
  KanbanColumn,
  KanbanCard,
  KanbanData,
  IdeaImage,
  IdeaMessage,
  IdeaData,
} from "./types.js";

// Constants
export {
  CCDOC_DIR,
  APP_DB_PATH,
  PROJECTS_DIR,
  BACKUPS_DIR,
  PROJECT_MARKER_DIR,
  PROJECT_TOKEN_FILE,
  CCDOC_IGNORE_FILE,
  EXPORT_DOCS_DIR,
  SOFT_DELETE_DAYS,
  validateToken,
  projectDbPath,
  projectHistoryPath,
  projectBackupPath,
} from "./constants.js";

// Database
export { openAppDb, openProjectDb, ensureDirs } from "./db/database.js";
export { ProjectsRepo } from "./db/projects.repo.js";
export { SectionsRepo } from "./db/sections.repo.js";
export { FtsRepo } from "./db/fts.repo.js";
export type { FtsSearchResult } from "./db/fts.repo.js";
export { ProjectPassportRepo } from "./db/passport.repo.js";
export { EmbeddingRepo } from "./db/embedding.repo.js";
export type { EmbeddingRow } from "./db/embedding.repo.js";

// Services
export { ProjectsService } from "./services/projects.service.js";
export { SectionsService } from "./services/sections.service.js";
export { HistoryService } from "./services/history.service.js";
export { ExportService } from "./services/export.service.js";
export { ImportService } from "./services/import.service.js";
export { SearchService } from "./services/search.service.js";
export { BackupService } from "./services/backup.service.js";
export { ArchiveService } from "./services/archive.service.js";
export { FtsService } from "./services/fts.service.js";
export { IndexService, INDEX_VERSION } from "./services/index.service.js";
export { InstallService } from "./services/install.service.js";
export { EmbeddingModel, cosineSimilarity, textHash, LOCAL_MODELS } from "./services/embedding.service.js";
export type { LocalModelDef, EmbeddingMode, OnlineProvider, EmbeddingConfig } from "./services/embedding.service.js";
export { FindService } from "./services/find.service.js";
export type { FindResult } from "./services/find.service.js";

// Converters
export { prosemirrorToMarkdown } from "./converters/prosemirror-to-markdown.js";
export { prosemirrorToPlain } from "./converters/prosemirror-to-plain.js";
export { prosemirrorToStructured } from "./converters/prosemirror-to-structured.js";
export { markdownToProsemirror } from "./converters/markdown-to-prosemirror.js";
export { extractTextForSearch } from "./converters/prosemirror-text-extractor.js";
export { kanbanToMarkdown, kanbanToPlain, markdownToKanban, emptyKanbanData } from "./converters/kanban.js";
export { excalidrawToText, textToExcalidraw, excalidrawToPlain } from "./converters/excalidraw/index.js";
export { splitMarkdownByHeadings } from "./converters/markdown-splitter.js";
export { ideaToPlain } from "./converters/idea.js";
export type { SplitResult, SplitSection } from "./converters/markdown-splitter.js";

// Hierarchy
export { validateHierarchy, canBeRoot, canContainChild, CONTAINER_TYPES } from "./hierarchy.js";

// Utils
export { sanitizeFilename } from "./utils.js";
