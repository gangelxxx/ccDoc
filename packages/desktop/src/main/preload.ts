import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Projects
  listProjects: () => ipcRenderer.invoke("projects:list"),
  addProject: () => ipcRenderer.invoke("projects:add"),
  removeProject: (token: string) => ipcRenderer.invoke("projects:remove", token),
  touchProject: (token: string) => ipcRenderer.invoke("projects:touch", token),

  // Sections
  getTree: (token: string) => ipcRenderer.invoke("sections:tree", token),
  getRootTree: (token: string) => ipcRenderer.invoke("sections:rootTree", token),
  getChildrenTree: (token: string, parentId: string) => ipcRenderer.invoke("sections:childrenTree", token, parentId),
  getParentChain: (token: string, id: string) => ipcRenderer.invoke("sections:parentChain", token, id),
  getSection: (token: string, id: string) => ipcRenderer.invoke("sections:get", token, id),
  getSectionContent: (token: string, id: string, format: string) =>
    ipcRenderer.invoke("sections:getContent", token, id, format),
  createSection: (token: string, parentId: string | null, title: string, type: string, icon?: string | null, content?: string) =>
    ipcRenderer.invoke("sections:create", token, parentId, title, type, icon, content),
  updateIcon: (token: string, id: string, icon: string | null) =>
    ipcRenderer.invoke("sections:updateIcon", token, id, icon),
  updateSection: (token: string, id: string, title: string, content: string, source?: string) =>
    ipcRenderer.invoke("sections:update", token, id, title, content, source),
  updateSectionMarkdown: (token: string, id: string, title: string, markdown: string, source?: string) =>
    ipcRenderer.invoke("sections:updateMarkdown", token, id, title, markdown, source),
  moveSection: (token: string, id: string, newParentId: string | null, afterId: string | null) =>
    ipcRenderer.invoke("sections:move", token, id, newParentId, afterId),
  duplicateSection: (token: string, id: string) => ipcRenderer.invoke("sections:duplicate", token, id),
  convertIdeaToKanban: (token: string, ideaId: string, columnNames?: { backlog: string; inProgress: string; done: string }) => ipcRenderer.invoke("sections:convertIdeaToKanban", token, ideaId, columnNames),
  deleteSection: (token: string, id: string) => ipcRenderer.invoke("sections:delete", token, id),
  restoreSection: (token: string, id: string) => ipcRenderer.invoke("sections:restore", token, id),
  getFileWithSections: (token: string, fileId: string) => ipcRenderer.invoke("sections:getFileWithSections", token, fileId),
  getSectionChildren: (token: string, parentId: string) => ipcRenderer.invoke("sections:getSectionChildren", token, parentId),
  getNodesRich: (token: string, parentId: string | null, opts?: any) =>
    ipcRenderer.invoke("sections:nodesRich", token, parentId, opts),
  getNodeInfo: (token: string, id: string) =>
    ipcRenderer.invoke("sections:nodeInfo", token, id),
  getTreeStats: (token: string) =>
    ipcRenderer.invoke("sections:treeStats", token),
  setSectionSummary: (token: string, id: string, summary: string | null) =>
    ipcRenderer.invoke("sections:setSummary", token, id, summary),
  copySectionAsMarkdown: (token: string, id: string) =>
    ipcRenderer.invoke("sections:copy-as-markdown", token, id),

  // Embedding model
  getEmbeddingStatus: () => ipcRenderer.invoke("embedding:status") as Promise<{ statuses: Record<string, "none" | "partial" | "ready"> }>,
  downloadEmbeddingModel: (modelId: string) => ipcRenderer.invoke("embedding:download", modelId),
  cancelEmbeddingDownload: (modelId: string) => ipcRenderer.invoke("embedding:cancel", modelId),
  deleteEmbeddingModel: (modelId: string) => ipcRenderer.invoke("embedding:delete", modelId),
  applyEmbeddingConfig: () => ipcRenderer.invoke("embedding:apply-config"),
  onEmbeddingProgress: (callback: (data: { modelId?: string; file?: string; percent?: number; done?: boolean; error?: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("embedding:progress", handler);
    return () => { ipcRenderer.removeListener("embedding:progress", handler); };
  },

  // History
  commitVersion: (token: string, message: string) => ipcRenderer.invoke("history:commit", token, message),
  getHistoryDiff: (token: string) => ipcRenderer.invoke("history:getDiff", token),
  getHistoryDiffIds: (token: string, commitOid: string) => ipcRenderer.invoke("history:getDiffIds", token, commitOid),
  getHistory: (token: string) => ipcRenderer.invoke("history:log", token),
  restoreVersion: (token: string, commitId: string) =>
    ipcRenderer.invoke("history:restore", token, commitId),
  onRestoreProgress: (callback: (data: { current: number; total: number; title: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("history:restore-progress", handler);
    return () => { ipcRenderer.removeListener("history:restore-progress", handler); };
  },
  deleteHistoryCommit: (token: string, commitId: string) =>
    ipcRenderer.invoke("history:delete", token, commitId),
  getHistoryStructure: (token: string, commitId: string) =>
    ipcRenderer.invoke("history:getStructure", token, commitId),
  getSectionAtVersion: (token: string, sectionId: string, commitId: string) =>
    ipcRenderer.invoke("history:getSectionAtVersion", token, sectionId, commitId),
  getAllContentsAtVersion: (token: string, commitId: string) =>
    ipcRenderer.invoke("history:getAllContents", token, commitId) as Promise<Record<string, string>>,
  searchAtVersion: (token: string, commitId: string, query: string) =>
    ipcRenderer.invoke("history:search", token, commitId, query) as Promise<string[]>,

  // Export
  exportMarkdown: (token: string) => ipcRenderer.invoke("export:markdown", token),
  exportMarkdownTo: (token: string) => ipcRenderer.invoke("export:markdown-to", token),
  exportPdf: (token: string, sectionId: string, defaultName: string) => ipcRenderer.invoke("export:pdf", token, sectionId, defaultName) as Promise<boolean>,

  // Import
  importMarkdown: (token: string, folderId: string) => ipcRenderer.invoke("import:markdown", token, folderId),
  importPdf: (token: string, folderId: string) => ipcRenderer.invoke("import:pdf", token, folderId),
  importMarkdownFiles: (token: string, folderId: string, filePaths: string[]) =>
    ipcRenderer.invoke("import:markdown-files", token, folderId, filePaths),
  importPdfFile: (token: string, folderId: string, filePath: string) =>
    ipcRenderer.invoke("import:pdf-file", token, folderId, filePath),

  // Import Project Docs
  scanProjectDocs: (token: string) => ipcRenderer.invoke("import-docs:scan", token),
  importProjectDocs: (token: string, files: { absolutePath: string; relativePath: string }[], folderId: string) =>
    ipcRenderer.invoke("import-docs:import", token, files, folderId),
  verifyProjectDocs: (token: string, importResults: { relativePath: string; absolutePath: string; fileId: string }[]) =>
    ipcRenderer.invoke("import-docs:verify", token, importResults),
  cleanupProjectDocs: (token: string, filePaths: string[]) =>
    ipcRenderer.invoke("import-docs:cleanup", token, filePaths),
  onImportDocsProgress: (callback: (data: { phase: string; found?: number; current?: number; total?: number; file?: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("import-docs:progress", handler);
    return () => { ipcRenderer.removeListener("import-docs:progress", handler); };
  },

  // Semantic indexing progress
  onSemanticProgress: (callback: (data: { token: string; item: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("semantic:progress", handler);
    return () => { ipcRenderer.removeListener("semantic:progress", handler); };
  },

  // Icon progress (taskbar/dock)
  setIconProgress: (data: { progress: number; activeCount: number }) =>
    ipcRenderer.send("app:set-icon-progress", data),

  // Background tasks from main process
  onBgTaskStart: (callback: (data: { id: string; label: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("bg-task:start", handler);
    return () => { ipcRenderer.removeListener("bg-task:start", handler); };
  },
  onBgTaskFinish: (callback: (data: { id: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("bg-task:finish", handler);
    return () => { ipcRenderer.removeListener("bg-task:finish", handler); };
  },
  onBgTaskProgress: (callback: (data: { id: string; progress: number }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("bg-task:progress", handler);
    return () => { ipcRenderer.removeListener("bg-task:progress", handler); };
  },

  // External DB change notification
  onExternalDbChange: (callback: (data: { token: string }) => void) => {
    const handler = (_event: unknown, data: { token: string }) => callback(data);
    ipcRenderer.on("db:external-change", handler);
    return () => { ipcRenderer.removeListener("db:external-change", handler); };
  },

  // Search
  search: (token: string, query: string) => ipcRenderer.invoke("search:query", token, query),
  searchFts: (token: string, query: string, limit?: number) => ipcRenderer.invoke("search:fts", token, query, limit),

  // Section View Prefs
  sectionPrefsGetAll: (token: string, sectionId: string) =>
    ipcRenderer.invoke("section-prefs:get-all", token, sectionId) as Promise<Record<string, unknown>>,
  sectionPrefsSet: (token: string, sectionId: string, key: string, value: unknown) =>
    ipcRenderer.invoke("section-prefs:set", token, sectionId, key, value) as Promise<void>,
  sectionPrefsDelete: (token: string, sectionId: string, key: string) =>
    ipcRenderer.invoke("section-prefs:delete", token, sectionId, key) as Promise<void>,

  // Passport
  getPassport: (token: string) => ipcRenderer.invoke("passport:getAll", token) as Promise<Record<string, string>>,
  setPassportField: (token: string, key: string, value: string) => ipcRenderer.invoke("passport:set", token, key, value),
  deletePassportField: (token: string, key: string) => ipcRenderer.invoke("passport:delete", token, key),

  // Backup
  createBackup: (token: string) => ipcRenderer.invoke("backup:create", token),
  listBackups: (token: string) => ipcRenderer.invoke("backup:list", token),

  // Source code access
  sourceTree: (token: string, glob?: string, maxDepth?: number) => ipcRenderer.invoke("source:tree", token, glob, maxDepth),
  sourceOutlines: (token: string, paths: string[]) => ipcRenderer.invoke("source:outlines", token, paths),
  sourceRead: (token: string, relativePath: string, startLine?: number, endLine?: number) => ipcRenderer.invoke("source:read", token, relativePath, startLine, endLine),
  sourceSearch: (token: string, opts: {
    pattern: string; is_regex?: boolean; case_sensitive?: boolean; whole_word?: boolean;
    include?: string; exclude?: string; context_lines?: number;
    output_mode?: "content" | "files" | "count"; max_results?: number;
  }) => ipcRenderer.invoke("source:search", token, opts),
  sourceFindSymbols: (token: string, opts: {
    name_pattern?: string; kind?: string; file_glob?: string; max_results?: number;
  }) => ipcRenderer.invoke("source:find-symbols", token, opts),

  // Semantic Index
  semanticSearch: (token: string, query: string, topK?: number, filter?: string) =>
    ipcRenderer.invoke("semantic:search", token, query, topK, filter) as Promise<{
      results: Array<{ score: number; chunk: any }>;
      formatted: string;
      indexing: boolean;
    }>,
  semanticPrefetch: (token: string, userMessage: string, maxTokens?: number, minScore?: number) =>
    ipcRenderer.invoke("semantic:prefetch", token, userMessage, maxTokens, minScore) as Promise<{
      chunks: Array<{ score: number; chunk: any }>;
      totalTokens: number;
    } | null>,
  semanticSnapshot: (token: string) =>
    ipcRenderer.invoke("semantic:snapshot", token) as Promise<{ codeTree: string; docTree: string } | null>,
  semanticStats: (token: string) => ipcRenderer.invoke("semantic:stats", token),
  semanticStatus: (token: string) =>
    ipcRenderer.invoke("semantic:status", token) as Promise<{
      ready: boolean;
      indexing: boolean;
      stats: { totalChunks: number; codeChunks: number; docChunks: number; indexSizeBytes: number; indexingTimeMs: number } | null;
    }>,
  semanticReindex: (token: string) => ipcRenderer.invoke("semantic:reindex", token),
  semanticClearIndex: (token: string) => ipcRenderer.invoke("semantic:clear-index", token),
  semanticInvalidateSnapshot: (token: string) => ipcRenderer.invoke("semantic:invalidate-snapshot", token),

  // Indexing config
  applyIndexingConfig: () => ipcRenderer.invoke("indexing:apply-config"),
  scanExclusionSuggestions: (token: string) => ipcRenderer.invoke("indexing:scan-suggestions", token) as Promise<string[]>,
  scanExtensionSuggestions: (token: string) => ipcRenderer.invoke("indexing:scan-extensions", token) as Promise<string[]>,
  scanFileSizeSuggestion: (token: string) => ipcRenderer.invoke("indexing:scan-file-sizes", token) as Promise<{
    fileCount: number; maxSizeKB: number; maxFile: string;
    p99SizeKB: number; recommendedKB: number; coverAllKB: number;
  } | null>,

  // LLM
  llmModels: (apiKey: string) => ipcRenderer.invoke("llm:models", apiKey),
  llmChat: (params: { apiKey: string; system: string; messages: any[]; model: string; maxTokens: number; tools?: any[]; thinking?: { type: string; budget_tokens: number }; temperature?: number; skipMessageCache?: boolean; toolChoice?: { type: string } }) =>
    ipcRenderer.invoke("llm:chat", params),
  llmAbort: () => ipcRenderer.invoke("llm:abort"),
  llmSetupToken: () => ipcRenderer.invoke("llm:setup-token"),
  saveFeedbackLog: (data: string) => ipcRenderer.invoke("logs:saveFeedback", data),

  // LLM tier-based (multi-provider)
  llmTierChat: (params: { tierConfig: any; system: string; messages: any[]; tools?: any[]; thinking?: { type: string; budget_tokens: number }; temperature?: number; skipMessageCache?: boolean; toolChoice?: { type: string } }) =>
    ipcRenderer.invoke("llm:tier-chat", params),
  llmTierListModels: (tierConfig: any) => ipcRenderer.invoke("llm:tier-list-models", tierConfig),
  llmScriptMeta: (ref: any) => ipcRenderer.invoke("llm:script-meta", ref),
  llmScriptCode: (ref: any) => ipcRenderer.invoke("llm:script-code", ref),
  llmBuiltinScripts: () => ipcRenderer.invoke("llm:builtin-scripts"),
  llmInvalidateScript: (ref: any) => ipcRenderer.invoke("llm:invalidate-script", ref),
  llmTestModel: (tierConfig: any) => ipcRenderer.invoke("llm:test-model", tierConfig),
  llmTestStage: (tierConfig: any, stage: string) => ipcRenderer.invoke("llm:test-stage", tierConfig, stage),

  // Knowledge Graph
  kgAnalyze: (token: string, sources?: { ideas?: boolean; docs?: boolean; sections?: boolean; sessions?: boolean }) => ipcRenderer.invoke("kg:analyze", token, sources),
  kgGet: (token: string) => ipcRenderer.invoke("kg:get", token),
  kgGetNeighbourhood: (token: string, sectionId: string) => ipcRenderer.invoke("kg:getNeighbourhood", token, sectionId),
  kgSyncNode: (token: string, sectionId: string) => ipcRenderer.invoke("kg:syncNode", token, sectionId),
  kgGetRelated: (token: string, sectionId: string, limit?: number) => ipcRenderer.invoke("kg:getRelated", token, sectionId, limit),
  kgFindOrphans: (token: string, nodeType?: string) => ipcRenderer.invoke("kg:findOrphans", token, nodeType),
  kgStats: (token: string) => ipcRenderer.invoke("kg:stats", token),
  kgSaveViewSettings: (token: string, sectionId: string, settings: string) => ipcRenderer.invoke("kg:saveViewSettings", token, sectionId, settings),
  onKgProgress: (cb: (data: { phase: string; current: number; total: number }) => void) => {
    const handler = (_event: unknown, data: any) => cb(data);
    ipcRenderer.on("kg:progress", handler);
    return () => { ipcRenderer.removeListener("kg:progress", handler); };
  },
  onKgNodeUpdated: (cb: (sectionId: string) => void) => {
    const handler = (_event: unknown, id: string) => cb(id);
    ipcRenderer.on("kg:nodeUpdated", handler);
    return () => { ipcRenderer.removeListener("kg:nodeUpdated", handler); };
  },

  // Workspace
  getWorkspace: (projectToken: string) => ipcRenderer.invoke("workspace:get", projectToken),
  getOrCreateWorkspace: (projectToken: string, projectName: string) => ipcRenderer.invoke("workspace:getOrCreate", projectToken, projectName),
  linkProject: (workspaceId: string, sourcePath: string, linkType: string, alias?: string) => ipcRenderer.invoke("workspace:link", workspaceId, sourcePath, linkType, alias),
  unlinkProject: (workspaceId: string, linkedId: string) => ipcRenderer.invoke("workspace:unlink", workspaceId, linkedId),
  updateLinkedProject: (workspaceId: string, linkedId: string, fields: { alias?: string; icon?: string | null; sort_order?: number }) => ipcRenderer.invoke("workspace:updateLink", workspaceId, linkedId, fields),
  updateWorkspaceIcon: (workspaceId: string, icon: string | null) => ipcRenderer.invoke("workspace:updateIcon", workspaceId, icon),
  listLinkedProjects: (workspaceId: string) => ipcRenderer.invoke("workspace:listLinks", workspaceId),
  detectCcdoc: (projectPath: string) => ipcRenderer.invoke("workspace:detect", projectPath),
  resolveProject: (source: string, basePath: string) => ipcRenderer.invoke("workspace:resolve", source, basePath),
  scanDependencies: (projectPath: string) => ipcRenderer.invoke("workspace:scanDeps", projectPath),
  pickProjectFolder: () => ipcRenderer.invoke("workspace:pickFolder") as Promise<string | null>,
  getUnifiedTree: (projectToken: string, full?: boolean) => ipcRenderer.invoke("workspace:unifiedTree", projectToken, full),
  getLinkedChildren: (projectToken: string, parentId?: string) => ipcRenderer.invoke("workspace:linkedChildren", projectToken, parentId),
  scanProjectForDocs: (projectPath: string) => ipcRenderer.invoke("workspace:scanProject", projectPath),
  checkGenerationLimits: (projectPath: string) => ipcRenderer.invoke("workspace:checkLimits", projectPath),
  generateDocs: (linkedProjectId: string, workspaceId: string, mode?: string) => ipcRenderer.invoke("workspace:generateDocs", linkedProjectId, workspaceId, mode || "full"),
  getGenerationStatus: (jobId: string) => ipcRenderer.invoke("workspace:generationStatus", jobId),
  cancelGeneration: (jobId: string) => ipcRenderer.invoke("workspace:cancelGeneration", jobId),
  onGenerationComplete: (callback: (data: { linkedProjectId: string; jobId: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("workspace:generation-complete", handler);
    return () => { ipcRenderer.removeListener("workspace:generation-complete", handler); };
  },
  crossProjectSearch: (projectToken: string, query: string, scope?: string) =>
    ipcRenderer.invoke("workspace:crossSearch", projectToken, query, scope || "all"),

  // Settings
  settingsGetAll: () => ipcRenderer.invoke("settings:getAll"),
  settingsPatch: (partial: Record<string, any>, source?: string) => ipcRenderer.invoke("settings:patch", partial, source),
  sessionsGetAll: () => ipcRenderer.invoke("settings:getSessions"),
  sessionsSave: (sessions: any[]) => ipcRenderer.invoke("settings:saveSessions", sessions),
  // Vault history
  vaultHistory: (limit?: number) => ipcRenderer.invoke("vault:history", limit),
  vaultSnapshot: (revision: number) => ipcRenderer.invoke("vault:snapshot", revision),
  vaultRollback: (revision: number) => ipcRenderer.invoke("vault:rollback", revision),

  // Web Search
  webSearch: (args: {
    provider: "tavily" | "brave";
    apiKey: string;
    query: string;
    options?: { maxResults?: number; searchType?: "general" | "news"; includeContent?: boolean };
  }) => ipcRenderer.invoke("web:search", args),

  // Voice STT
  getVoiceStatus: () => ipcRenderer.invoke("voice:status") as Promise<{ statuses: Record<string, "none" | "partial" | "ready"> }>,
  downloadVoiceModel: (modelId: string) => ipcRenderer.invoke("voice:download", modelId),
  cancelVoiceDownload: (modelId: string) => ipcRenderer.invoke("voice:cancel", modelId),
  deleteVoiceModel: (modelId: string) => ipcRenderer.invoke("voice:delete", modelId),
  transcribeVoice: (params: { audio: Float32Array; modelId: string; language?: string }) =>
    ipcRenderer.invoke("voice:transcribe", params) as Promise<string>,
  onVoiceProgress: (callback: (data: { modelId?: string; percent?: number; done?: boolean; cancelled?: boolean; error?: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("voice:progress", handler);
    return () => { ipcRenderer.removeListener("voice:progress", handler); };
  },

  // User folder
  user: {
    getTree: () => ipcRenderer.invoke("user:tree"),
    getRootTree: () => ipcRenderer.invoke("user:rootTree"),
    getChildrenTree: (parentId: string) => ipcRenderer.invoke("user:childrenTree", parentId),
    get: (id: string) => ipcRenderer.invoke("user:get", id),
    getContent: (id: string, format?: string) => ipcRenderer.invoke("user:content", id, format),
    getParentChain: (id: string) => ipcRenderer.invoke("user:parentChain", id),
    create: (parentId: string | null, title: string, type: string, icon?: string | null, content?: string) =>
      ipcRenderer.invoke("user:create", parentId, title, type, icon, content),
    update: (id: string, title: string, content: string) =>
      ipcRenderer.invoke("user:update", id, title, content),
    updateMarkdown: (id: string, title: string, markdown: string) =>
      ipcRenderer.invoke("user:updateMarkdown", id, title, markdown),
    updateIcon: (id: string, icon: string | null) =>
      ipcRenderer.invoke("user:icon", id, icon),
    move: (id: string, newParentId: string | null, afterId: string | null) =>
      ipcRenderer.invoke("user:move", id, newParentId, afterId),
    duplicate: (id: string) => ipcRenderer.invoke("user:duplicate", id),
    delete: (id: string) => ipcRenderer.invoke("user:delete", id),
    restore: (id: string) => ipcRenderer.invoke("user:restore", id),
    todos: () => ipcRenderer.invoke("user:todos"),
    search: (query: string, limit?: number) => ipcRenderer.invoke("user:search", query, limit),
    getFileWithSections: (fileId: string) => ipcRenderer.invoke("user:getFileWithSections", fileId),
    getSectionChildren: (parentId: string) => ipcRenderer.invoke("user:getSectionChildren", parentId),
    copySectionAsMarkdown: (id: string) => ipcRenderer.invoke("user:copy-as-markdown", id),
    // History
    commitVersion: (message: string) => ipcRenderer.invoke("user:history:commit", message),
    getHistory: () => ipcRenderer.invoke("user:history:log"),
    restoreVersion: (commitId: string) => ipcRenderer.invoke("user:history:restore", commitId),
  },

  // Idea Trash
  idea: {
    deleteMessage: (token: string, sectionId: string, messageId: string) =>
      ipcRenderer.invoke("idea:delete-message", token, sectionId, messageId) as Promise<{ success: boolean }>,
    permanentDelete: (messageId: string) =>
      ipcRenderer.invoke("idea:permanent-delete", messageId) as Promise<{ success: boolean }>,
    emptyTrash: () =>
      ipcRenderer.invoke("idea:empty-trash") as Promise<{ success: boolean }>,
    restoreMessage: (messageId: string) =>
      ipcRenderer.invoke("idea:restore-message", messageId) as Promise<{ success: boolean; error?: string }>,
    getTrashId: () =>
      ipcRenderer.invoke("idea:get-trash-id") as Promise<string | null>,
    setProgress: (token: string, sectionId: string, messageId: string, progress: number) =>
      ipcRenderer.invoke("idea:set-progress", token, sectionId, messageId, progress) as Promise<number | null>,
  },

  // Git (auto-commit)
  gitHasRepo: (token: string) => ipcRenderer.invoke("git:has-repo", token) as Promise<boolean>,
  gitDiff: (token: string) => ipcRenderer.invoke("git:diff", token) as Promise<string>,
  gitStatus: (token: string) => ipcRenderer.invoke("git:status", token) as Promise<string>,
  gitStatusParsed: (token: string) =>
    ipcRenderer.invoke("git:status-parsed", token) as Promise<{ changes: any[]; unversioned: any[] }>,
  gitGenerateMessage: (token: string, taskText: string) =>
    ipcRenderer.invoke("git:generate-message", token, taskText) as Promise<{ message: string; diff: string; hasChanges: boolean }>,
  gitCommit: (token: string, message: string) =>
    ipcRenderer.invoke("git:commit", token, message) as Promise<string>,
  gitCommitSelective: (token: string, message: string, files: string[]) =>
    ipcRenderer.invoke("git:commit-selective", token, message, files) as Promise<string>,
  gitStageFiles: (token: string, files: string[]) =>
    ipcRenderer.invoke("git:stage-files", token, files) as Promise<void>,
  gitRollbackFile: (token: string, filePath: string) =>
    ipcRenderer.invoke("git:rollback-file", token, filePath) as Promise<void>,
  gitAddToGitignore: (token: string, pattern: string) =>
    ipcRenderer.invoke("git:add-to-gitignore", token, pattern) as Promise<void>,
  gitFileDiff: (token: string, filePath: string) =>
    ipcRenderer.invoke("git:file-diff", token, filePath) as Promise<string>,

  // History settings (stats & cleanup)
  historySettingsGetStats: (token: string) =>
    ipcRenderer.invoke("history-settings:getStats", token),
  historySettingsCleanup: (token: string, retainDays: number) =>
    ipcRenderer.invoke("history-settings:cleanup", token, retainDays),
  historySettingsSnapshotsStats: (token: string) =>
    ipcRenderer.invoke("history-settings:snapshotsStats", token),
  historySettingsSnapshotsCleanup: (token: string) =>
    ipcRenderer.invoke("history-settings:snapshotsCleanup", token),
  historySettingsCacheStats: (token: string) =>
    ipcRenderer.invoke("history-settings:cacheStats", token),
  historySettingsCacheClear: (token: string) =>
    ipcRenderer.invoke("history-settings:cacheClear", token),
  historySettingsApplyConfig: (config: { maxSnapshotsPerSection: number; snapshotMaxAgeDays: number; snapshotCoalesceIntervalSec: number }) =>
    ipcRenderer.invoke("history-settings:applyConfig", config),

  // Section Snapshots (local history)
  snapshotsList: (token: string, sectionId: string, limit?: number, offset?: number) =>
    ipcRenderer.invoke("section-snapshots:list", token, sectionId, limit, offset),
  snapshotsGet: (token: string, snapshotId: string) =>
    ipcRenderer.invoke("section-snapshots:get", token, snapshotId),
  snapshotsGetPair: (token: string, idA: string, idB: string) =>
    ipcRenderer.invoke("section-snapshots:get-pair", token, idA, idB),
  snapshotsRestore: (token: string, sectionId: string, snapshotId: string) =>
    ipcRenderer.invoke("section-snapshots:restore", token, sectionId, snapshotId),
  snapshotsDelete: (token: string, snapshotId: string) =>
    ipcRenderer.invoke("section-snapshots:delete", token, snapshotId),
  snapshotsStats: (token: string) =>
    ipcRenderer.invoke("section-snapshots:stats", token),

  // Convert
  convertMdToProsemirror: (markdown: string) => ipcRenderer.invoke("convert:mdToProsemirror", markdown),
  importMarkdownClipboard: (token: string, fileId: string, markdown: string) =>
    ipcRenderer.invoke("import:markdown-clipboard", token, fileId, markdown),

  // Dialog
  pickImage: () => ipcRenderer.invoke("dialog:pickImage") as Promise<string | null>,

  // Install Claude Code plugin
  installClaudePlugin: (token: string) => ipcRenderer.invoke("install:claude-plugin", token),
  uninstallClaudePlugin: (token: string) => ipcRenderer.invoke("install:uninstall-plugin", token),
  onInstallProgress: (callback: (data: { step: string; status: string; detail?: string; created?: string[]; updated?: string[] }) => void) => {
    const handler = (_event: unknown, data: { step: string; status: string; detail?: string; created?: string[]; updated?: string[] }) => callback(data);
    ipcRenderer.on("install:progress", handler);
    return () => { ipcRenderer.removeListener("install:progress", handler); };
  },

};

export type Api = typeof api;

contextBridge.exposeInMainWorld("api", api);
