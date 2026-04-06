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
  DrawingBlock,
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
  ProgressStage,
  TrashIdeaMessage,
  IdeaProcessingMode,
  IdeaProcessingResult,
  PdfOutlineEntry,
  Workspace,
  LinkedProject,
  LinkedProjectMeta,
  DocStatus,
  LinkType,
} from "./types.js";

export { DEFAULT_PROGRESS_STAGES } from "./types.js";

// Constants
export {
  CCDOC_DIR,
  APP_DB_PATH,
  PROJECTS_DIR,
  BACKUPS_DIR,
  USER_DIR,
  USER_DB_PATH,
  USER_HISTORY_PATH,
  USER_TOKEN,
  PROJECT_MARKER_DIR,
  PROJECT_TOKEN_FILE,
  CCDOC_IGNORE_FILE,
  EXPORT_DOCS_DIR,
  SOFT_DELETE_DAYS,
  TRASH_FOLDER_TITLE,
  TRASH_FOLDER_ICON,
  TRASH_IDEAS_TITLE,
  TRASH_IDEAS_ICON,
  TRASH_FOLDER_TITLES,
  TRASH_IDEAS_TITLES,
  validateToken,
  projectDbPath,
  projectHistoryPath,
  projectBackupPath,
  PLAN_VERIFICATION_BLOCK,
  PLAN_EXECUTOR_INSTRUCTION,
  VERIFICATION_STEP_REGEX,
} from "./constants.js";

// Database
export { openAppDb, openProjectDb, openUserDb, ensureDirs } from "./db/database.js";
export { ProjectsRepo } from "./db/projects.repo.js";
export { SectionsRepo } from "./db/sections.repo.js";
export { FtsRepo } from "./db/fts.repo.js";
export type { FtsSearchResult } from "./db/fts.repo.js";
export { ProjectPassportRepo, INTERNAL_PASSPORT_KEYS, DEFAULT_PASSPORT_FIELDS } from "./db/passport.repo.js";
export { EmbeddingRepo } from "./db/embedding.repo.js";
export type { EmbeddingRow } from "./db/embedding.repo.js";
export { SemanticCacheRepo } from "./db/semantic-cache.repo.js";
export type { SemanticCacheRow } from "./db/semantic-cache.repo.js";
export { WorkspaceRepo } from "./db/workspace.repo.js";
export { SectionPrefsRepo } from "./db/section-prefs.repo.js";
export type { SectionPrefRow } from "./db/section-prefs.repo.js";
export { SectionSnapshotRepo } from "./db/section-snapshot.repo.js";
export type { SectionSnapshot, SnapshotSource } from "./db/section-snapshot.repo.js";
export { VaultRepo } from "./db/vault.repo.js";
export type { VaultBackend, RevisionInfo } from "./db/vault.repo.js";

// Services
export { ProjectsService } from "./services/projects.service.js";
export { SectionsService } from "./services/sections.service.js";
export { HistoryService } from "./services/history.service.js";
export type { HistoryStats } from "./services/history.service.js";
export { ExportService } from "./services/export.service.js";
export { ImportService } from "./services/import.service.js";
export { SearchService } from "./services/search.service.js";
export { BackupService } from "./services/backup.service.js";
export { ArchiveService } from "./services/archive.service.js";
export { FtsService } from "./services/fts.service.js";
export { IndexService, INDEX_VERSION } from "./services/index.service.js";
export { InstallService } from "./services/install.service.js";
export { EmbeddingModel, cosineSimilarity, textHash, LOCAL_MODELS } from "./services/embedding.service.js";
export type { IEmbeddingProvider, LocalModelDef, EmbeddingMode, OnlineProvider, EmbeddingConfig } from "./services/embedding.service.js";
export { OnlineEmbeddingProvider } from "./services/online-embedding.service.js";
export { SectionSnapshotService } from "./services/section-snapshot.service.js";
export type { SnapshotConfig } from "./services/section-snapshot.service.js";
export { Vault } from "./services/vault.service.js";
export type { VaultOptions } from "./services/vault.service.js";
export { FindService } from "./services/find.service.js";
export { UserService } from "./services/user.service.js";
export { TrashService } from "./services/trash.service.js";
export type { TrashMeta, TrashLabels } from "./services/trash.service.js";
export type { FindResult } from "./services/find.service.js";
export { WorkspaceService } from "./services/workspace.service.js";
export { CrossProjectSearch } from "./services/cross-project-search.js";
export type { CrossProjectSearchResult, CrossProjectScope } from "./services/cross-project-search.js";
export { CrossReferenceResolver } from "./services/cross-reference-resolver.js";
export type { CrossRefTarget, ParsedCrossRef } from "./services/cross-reference-resolver.js";
export { CcdocDetector } from "./services/ccdoc-detector.js";
export type { CcdocDetectionResult } from "./services/ccdoc-detector.js";
export { ProjectResolver } from "./services/project-resolver.js";
export type { ResolvedProject } from "./services/project-resolver.js";
export { DependencyScanner } from "./services/dependency-scanner.js";
export type { SuggestedLink } from "./services/dependency-scanner.js";
export { UnifiedTreeBuilder } from "./services/unified-tree-builder.js";
export type { UnifiedTreeOptions } from "./services/unified-tree-builder.js";
export { ProjectScanner } from "./services/project-scanner.js";
export type { ProjectScanResult, SourceFileInfo } from "./services/project-scanner.js";
export { DocGenerationQueue, DocOutlineGenerator, IncrementalUpdater } from "./services/doc-generator.js";
export type { GenerationJob, GenerationStatus, GenerationMode, OutlineSection } from "./services/doc-generator.js";

// Converters
export { prosemirrorToMarkdown } from "./converters/prosemirror-to-markdown.js";
export { prosemirrorToPlain } from "./converters/prosemirror-to-plain.js";
export { prosemirrorToStructured } from "./converters/prosemirror-to-structured.js";
export { markdownToProsemirror } from "./converters/markdown-to-prosemirror.js";
export { extractTextForSearch } from "./converters/prosemirror-text-extractor.js";
export { kanbanToMarkdown, kanbanToPlain, markdownToKanban, emptyKanbanData } from "./converters/kanban.js";
export { drawingToText, textToDrawing, drawingToPlain } from "./converters/drawing/index.js";
export { splitMarkdownByHeadings } from "./converters/markdown-splitter.js";
export { ideaToPlain, ideaToGroupedPlain } from "./converters/idea.js";
export type { SplitResult, SplitSection } from "./converters/markdown-splitter.js";

// Knowledge Graph
export type { KGNodeRow, KGEdgeRow, KGNode, KGEdge, KnowledgeGraphData, KGViewSettings } from "./knowledge-graph-types.js";
export { emptyKGViewSettings } from "./knowledge-graph-types.js";
export { KnowledgeGraphService } from "./services/knowledge-graph.service.js";
export type { ProgressCallback as KGProgressCallback, ExternalNode as KGExternalNode } from "./services/knowledge-graph.service.js";

// Hierarchy
export { validateHierarchy, canBeRoot, canContainChild, CONTAINER_TYPES } from "./hierarchy.js";

// Utils
export { sanitizeFilename } from "./utils.js";
