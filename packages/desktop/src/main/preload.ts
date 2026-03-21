import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Projects
  listProjects: () => ipcRenderer.invoke("projects:list"),
  addProject: () => ipcRenderer.invoke("projects:add"),
  removeProject: (token: string) => ipcRenderer.invoke("projects:remove", token),
  renameProject: (token: string, name: string) => ipcRenderer.invoke("projects:rename", token, name),
  touchProject: (token: string) => ipcRenderer.invoke("projects:touch", token),

  // Sections
  getTree: (token: string) => ipcRenderer.invoke("sections:tree", token),
  getSection: (token: string, id: string) => ipcRenderer.invoke("sections:get", token, id),
  getSectionContent: (token: string, id: string, format: string) =>
    ipcRenderer.invoke("sections:getContent", token, id, format),
  createSection: (token: string, parentId: string | null, title: string, type: string, icon?: string | null, content?: string) =>
    ipcRenderer.invoke("sections:create", token, parentId, title, type, icon, content),
  updateIcon: (token: string, id: string, icon: string | null) =>
    ipcRenderer.invoke("sections:updateIcon", token, id, icon),
  updateSection: (token: string, id: string, title: string, content: string) =>
    ipcRenderer.invoke("sections:update", token, id, title, content),
  updateSectionMarkdown: (token: string, id: string, title: string, markdown: string) =>
    ipcRenderer.invoke("sections:updateMarkdown", token, id, title, markdown),
  moveSection: (token: string, id: string, newParentId: string | null, afterId: string | null) =>
    ipcRenderer.invoke("sections:move", token, id, newParentId, afterId),
  duplicateSection: (token: string, id: string) => ipcRenderer.invoke("sections:duplicate", token, id),
  convertIdeaToKanban: (token: string, ideaId: string, columnNames?: { backlog: string; inProgress: string; done: string }) => ipcRenderer.invoke("sections:convertIdeaToKanban", token, ideaId, columnNames),
  deleteSection: (token: string, id: string) => ipcRenderer.invoke("sections:delete", token, id),
  restoreSection: (token: string, id: string) => ipcRenderer.invoke("sections:restore", token, id),
  getFileWithSections: (token: string, fileId: string) => ipcRenderer.invoke("sections:getFileWithSections", token, fileId),
  getSectionChildren: (token: string, parentId: string) => ipcRenderer.invoke("sections:getSectionChildren", token, parentId),
  setSectionSummary: (token: string, id: string, summary: string | null) =>
    ipcRenderer.invoke("sections:setSummary", token, id, summary),
  copySectionAsMarkdown: (token: string, id: string) =>
    ipcRenderer.invoke("sections:copy-as-markdown", token, id),

  // Embedding model
  getEmbeddingStatus: () => ipcRenderer.invoke("embedding:status") as Promise<{ statuses: Record<string, "none" | "partial" | "ready"> }>,
  downloadEmbeddingModel: (modelId: string) => ipcRenderer.invoke("embedding:download", modelId),
  cancelEmbeddingDownload: (modelId: string) => ipcRenderer.invoke("embedding:cancel", modelId),
  deleteEmbeddingModel: (modelId: string) => ipcRenderer.invoke("embedding:delete", modelId),
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
  cleanupProjectDocs: (filePaths: string[]) =>
    ipcRenderer.invoke("import-docs:cleanup", filePaths),
  onImportDocsProgress: (callback: (data: { phase: string; found?: number; current?: number; total?: number; file?: string }) => void) => {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("import-docs:progress", handler);
    return () => { ipcRenderer.removeListener("import-docs:progress", handler); };
  },

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

  // External DB change notification
  onExternalDbChange: (callback: (data: { token: string }) => void) => {
    const handler = (_event: unknown, data: { token: string }) => callback(data);
    ipcRenderer.on("db:external-change", handler);
    return () => { ipcRenderer.removeListener("db:external-change", handler); };
  },

  // Search
  search: (token: string, query: string) => ipcRenderer.invoke("search:query", token, query),
  searchFts: (token: string, query: string, limit?: number) => ipcRenderer.invoke("search:fts", token, query, limit),

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

  // LLM
  llmModels: (apiKey: string) => ipcRenderer.invoke("llm:models", apiKey),
  llmChat: (params: { apiKey: string; system: string; messages: any[]; model: string; maxTokens: number; tools?: any[]; thinking?: { type: string; budget_tokens: number }; temperature?: number; skipMessageCache?: boolean; toolChoice?: { type: string } }) =>
    ipcRenderer.invoke("llm:chat", params),
  llmSetupToken: () => ipcRenderer.invoke("llm:setup-token"),

  // Settings
  settingsGetAll: () => ipcRenderer.invoke("settings:getAll"),
  settingsPatch: (partial: Record<string, any>) => ipcRenderer.invoke("settings:patch", partial),
  sessionsGetAll: () => ipcRenderer.invoke("settings:getSessions"),
  sessionsSave: (sessions: any[]) => ipcRenderer.invoke("settings:saveSessions", sessions),

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
