import type { ProgressStage } from "@ccdoc/core";
import type { StateCreator } from "zustand";
import type { Lang } from "../i18n.js";
import type { CustomAgent, LlmPlan, SessionBuffer, SessionBufferEntry } from "./llm/types.js";

// ─── Domain types ────────────────────────────────────────────

export interface Project {
  token: string;
  name: string;
  path: string;
  added_at: string;
  updated_at: string;
}

export interface TreeNode {
  id: string;
  parent_id: string | null;
  title: string;
  type: string;
  icon: string | null;
  sort_key: string;
  summary?: string | null;
  updated_at: string;
  children: TreeNode[];
  hasChildren?: boolean;
  childrenLoaded?: boolean;
  linkedProjectMeta?: {
    linked_project_id: string;
    project_token: string | null;
    has_ccdoc: boolean;
    doc_status: string;
    link_type: string;
    source_path: string;
  };
}

export interface Section {
  id: string;
  parent_id: string | null;
  title: string;
  content: string;
  type: string;
  sort_key: string;
  icon: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HistoryCommit {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
}

// ─── Multi-provider model tiers ─────────────────────────────

export type ModelTier = "strong" | "medium" | "weak";

export interface ProviderScriptRef {
  type: "builtin" | "custom";
  builtinId?: string;
  customPath?: string;
  customCode?: string;
}

export interface ModelTierConfig {
  providerScript: ProviderScriptRef;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  effort: "low" | "medium" | "high";
  thinking: boolean;
  thinkingBudget: number;
  maxTokens: number;
  temperature: number;
}

export interface ModelTiersConfig {
  strong: ModelTierConfig;
  medium: ModelTierConfig;
  weak: ModelTierConfig;
  chatTier: ModelTier;
  passportTier: ModelTier;
  summaryTier: ModelTier;
}

export type TestDifficulty = "light" | "medium" | "heavy";

export type TestStageName =
  // Base (always run)
  | "connection" | "tool_selection" | "tool_params" | "param_types" | "error_recovery" | "multi_turn" | "structured_output" | "instruction_following"
  // Light
  | "light_basic_tool" | "light_short_answer" | "light_thinking"
  // Medium
  | "medium_multi_tool" | "medium_long_output" | "medium_param_sensitivity"
  // Heavy
  | "heavy_doc_generation" | "heavy_doc_restructure" | "heavy_completeness" | "heavy_architecture";

export interface ModelTestResult {
  stage: TestStageName;
  success: boolean;
  latencyMs: number;
  error?: string;
  details?: string;
}

export interface ProviderScriptMeta {
  id: string;
  name: string;
  description: string;
}

// ─── LLM types ──────────────────────────────────────────────

export type LlmEffort = "low" | "medium" | "high";

export interface LlmConfig {
  model: string;
  effort: LlmEffort;
  maxTokens: number;
  temperature: number;
  thinking: boolean;
  thinkingBudget: number;
  inheritFromParent?: boolean;
}

export interface LlmAttachment {
  type: "image";
  name: string;
  mediaType: string;
  data: string; // base64
}

export interface AgentCardAction {
  tool: string;
  description: string;
  timestamp: number;
  status: "running" | "done" | "error";
}

export interface AgentCard {
  agentId: string;
  agentName: string;
  task: string;
  actions: AgentCardAction[];
  startedAt: number;
  status: "running" | "done" | "stopped" | "error";
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: any; // string or content blocks array (for tool use)
  displayContent?: string; // shown in UI instead of content (e.g. for agent prompts)
  attachments?: LlmAttachment[]; // for display in user messages
  isQuestion?: boolean; // true for ask_user questions
  plan?: LlmPlan; // work plan with checkable steps
  agentCard?: AgentCard; // live agent activity card
  /** Sections created by the assistant in this message (clickable links) */
  createdSections?: Array<{ id: string; title: string; type: string }>;
}

export interface LlmSessionContext {
  mode: "chat" | "plan" | "doc-update";
  ideaId?: string;
  messageId?: string;
  projectToken?: string;
}

export interface LlmSession {
  id: string;
  title: string; // first user message preview
  messages: LlmMessage[];
  tokensUsed: { input: number; output: number; cacheRead: number; cacheCreation: number };
  buffer?: SessionBuffer; // shared buffer between assistant and agents
  context?: LlmSessionContext;
  createdAt: number;
  updatedAt: number;
}

// ─── UI types ───────────────────────────────────────────────

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

export interface BackgroundTask {
  id: string;
  label: string;
  startedAt: number;
  tokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number };
  finishedAt?: number;
  progress?: number; // 0..1, undefined = indeterminate
  lastUpdatedAt?: number;
}

export interface IdeaProcessingTask {
  bgTaskId: string;
  sectionId: string;
  sectionTitle: string;
  mode: import("@ccdoc/core").IdeaProcessingMode;
  status: "processing" | "done" | "error";
  result: import("@ccdoc/core").IdeaProcessingResult | null;
  originalMessages: import("@ccdoc/core").IdeaMessage[] | null;
  error?: string;
}

// ─── Embedding types ────────────────────────────────────────

export type EmbeddingMode = "none" | "local" | "online";
export type OnlineProvider = "openai" | "voyage";

export interface EmbeddingConfig {
  mode: EmbeddingMode;
  localModelId: string;
  onlineProvider: OnlineProvider;
  onlineModel: string;
  onlineApiKey: string;
}

// ─── Indexing types ─────────────────────────────────────────

export interface IndexingConfig {
  enabled: boolean;
  intensity: "low" | "medium" | "high";
  excludedDirs: string[];
  codeExtensions: string[];
  maxFileSizeKB: number;
  stalenessIntervalMin: number;
}

// ─── Spellcheck types ──────────────────────────────────────

export interface SpellcheckConfig {
  enabled: boolean;
  languages: string[];
  userDictionary: string[];
}

// ─── Workspace types ────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  root_project_token: string;
  created_at: string;
  updated_at: string;
}

export type DocStatus = "none" | "loaded" | "generating" | "error";
export type LinkType = "dependency" | "reference" | "monorepo_part";

export interface LinkedProject {
  id: string;
  workspace_id: string;
  project_token: string | null;
  source_path: string;
  alias: string | null;
  icon: string | null;
  has_ccdoc: boolean;
  doc_status: DocStatus;
  link_type: LinkType;
  added_at: string;
  sort_order: number;
}

export interface SuggestedLink {
  source_path: string;
  name: string;
  link_type: LinkType;
  config_source: string;
}

// ─── AppState (composite of all slices) ─────────────────────

export interface AppState {
  // Theme & layout
  theme: "light" | "dark";
  toggleTheme: () => void;
  language: Lang;
  setLanguage: (lang: Lang) => void;
  fontFamily: "default" | "serif" | "sans" | "mono" | "system";
  setFontFamily: (v: "default" | "serif" | "sans" | "mono" | "system") => void;
  fontSize: "small" | "medium" | "large";
  setFontSize: (v: "small" | "medium" | "large") => void;
  colorScheme: "teal" | "blue" | "purple";
  setColorScheme: (v: "teal" | "blue" | "purple") => void;
  contentWidth: "narrow" | "medium" | "wide";
  cycleContentWidth: () => void;

  // Panel widths (resizable)
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  llmPanelWidth: number;
  setLlmPanelWidth: (w: number) => void;
  savePanelWidths: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  sidebarTab: "tree" | "search" | "history";
  setSidebarTab: (tab: "tree" | "search" | "history") => void;
  historyExpanded: boolean;
  toggleHistoryExpanded: () => void;

  // Navigation history
  navHistory: { id: string; source: "project" | "user" }[];
  navIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;

  // Projects
  projects: Project[];
  currentProject: Project | null;
  loadProjects: () => Promise<void>;
  addProject: () => Promise<void>;
  selectProject: (project: Project) => Promise<void>;
  removeProject: (token: string) => Promise<void>;

  // Tree & Sections
  tree: TreeNode[];
  currentSection: Section | null;
  activeSectionToken: string | null;
  editorSelectedText: string;
  _editorView: any;
  setEditorView: (view: any) => void;
  setEditorSelectedText: (text: string) => void;
  loadTree: () => Promise<void>;
  loadRootTree: () => Promise<void>;
  loadChildren: (parentId: string) => Promise<void>;
  expandToSection: (id: string) => Promise<void>;
  selectSection: (id: string) => Promise<void>;
  createSection: (parentId: string | null, title: string, type: string, icon?: string | null) => Promise<void>;
  updateSection: (id: string, title: string, content: string) => Promise<void>;
  renameSection: (id: string, title: string) => Promise<void>;
  updateIcon: (id: string, icon: string | null) => Promise<void>;
  duplicateSection: (id: string) => Promise<void>;
  convertIdeaToKanban: (ideaId: string) => Promise<void>;
  moveSection: (id: string, newParentId: string | null, afterId: string | null) => Promise<void>;
  deleteSection: (id: string) => Promise<void>;
  /** When set, IdeaChat scrolls to the message linked to this plan and clears it */
  scrollToPlanId: string | null;
  setScrollToPlanId: (id: string | null) => void;
  scrollToMessageId: string | null;
  setScrollToMessageId: (id: string | null) => void;
  /** When set, IdeaChat scrolls to the first message matching this query and highlights it */
  highlightQuery: string | null;
  setHighlightQuery: (q: string | null) => void;
  /** Counter that increments to toggle IdeaChat local search open */
  ideaSearchTrigger: number;
  /** Counter that increments to toggle editor search bar */
  editorSearchTrigger: number;
  /** Set of section IDs with unsaved editor changes — guards against DB overwrites. */
  dirtyEditors: Set<string>;
  markEditorDirty: (sectionId: string) => void;
  markEditorClean: (sectionId: string) => void;

  // History
  history: HistoryCommit[];
  restoreProgress: { current: number; total: number; title: string } | null;
  commitVersion: (message: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  restoreVersion: (commitId: string) => Promise<void>;
  deleteHistoryCommit: (commitId: string) => Promise<void>;

  // History viewer
  historyViewCommit: HistoryCommit | null;
  historyViewSections: { id: string; parent_id: string | null; title: string; type: string; sort_key: string; icon: string | null }[];
  historyViewSectionId: string | null;
  historyViewContent: { title: string; content: string } | null;
  historyViewCurrentContent: string | null;
  historyDiffIds: { added: string[]; removed: string[]; changed: string[] } | null;
  viewCommit: (commit: HistoryCommit) => Promise<void>;
  viewCommitSection: (sectionId: string) => Promise<void>;
  closeHistoryView: () => void;

  // Export
  exportMarkdown: () => Promise<void>;
  exportMarkdownTo: () => Promise<void>;

  // Import
  importMarkdown: (targetFolderId?: string) => Promise<void>;
  importPdf: (targetFolderId?: string) => Promise<void>;
  importDroppedFiles: (filePaths: string[], targetFolderId?: string) => Promise<void>;

  // Search
  searchResults: { id: string; title: string; score: number }[];
  search: (query: string) => Promise<void>;

  // FTS Search
  ftsQuery: string;
  ftsResults: { id: string; title: string; titleHighlighted: string; snippet: string; score: number }[];
  ftsLoading: boolean;
  setFtsQuery: (query: string) => void;
  searchFts: (query: string) => Promise<void>;

  // Toasts
  toasts: Toast[];
  addToast: (type: ToastType, title: string, message?: string) => void;
  removeToast: (id: string) => void;

  // Confirm modal
  confirmModal: { message: string; title?: string; danger?: boolean; resolve: (ok: boolean) => void } | null;
  showConfirm: (message: string, opts?: { title?: string; danger?: boolean }) => Promise<boolean>;
  closeConfirm: (result: boolean) => void;

  // Command palette
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  // Scroll to section (for FileView)
  scrollToSectionId: string | null;
  setScrollToSectionId: (id: string | null) => void;
  clearScrollToSection: () => void;

  // FileView content refresh signal (incremented after LLM mutations)
  fileSectionsVersion: number;

  // Section view mode (per-file: true = view each section separately)
  sectionViewFiles: Record<string, boolean>;
  toggleFileViewMode: (fileId: string) => void;

  // Loading states
  sectionLoading: boolean;
  loadingSectionId: string | null;
  treeLoading: boolean;

  /** In-memory cache of fetched sections (id → Section). */
  _sectionCache: Map<string, Section>;

  // LLM panel
  llmPanelOpen: boolean;
  setLlmPanelOpen: (open: boolean) => void;
  toggleLlmPanel: () => void;

  // Quick idea
  quickIdeaOpen: boolean;
  setQuickIdeaOpen: (open: boolean) => void;
  toggleQuickIdea: () => void;
  quickCreateIdea: (text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => Promise<void>;

  settingsOpen: string | null;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;

  llmApiKey: string;
  setLlmApiKey: (key: string) => void;
  /** True if any tier has an API key configured (or uses a keyless provider like ollama) */
  hasLlmAccess: () => boolean;
  llmModels: { id: string; display_name: string }[];
  llmModelsLoading: boolean;
  llmModelsError: string | null;
  fetchLlmModels: (apiKey?: string) => Promise<void>;

  // Model tiers
  modelTiers: ModelTiersConfig;
  setModelTier: (tier: ModelTier, config: Partial<ModelTierConfig>) => void;
  setTierAssignment: (key: "chatTier" | "passportTier" | "summaryTier", tier: ModelTier) => void;
  testModelTier: (tier: ModelTier) => Promise<ModelTestResult[]>;
  modelTestResults: Record<ModelTier, ModelTestResult[] | null>;
  modelTestLoading: Record<ModelTier, boolean>;
  fetchTierModels: (tier: ModelTier) => Promise<{ id: string; name: string }[]>;
  builtinScripts: ProviderScriptMeta[];
  loadBuiltinScripts: () => Promise<void>;
  llmChatConfig: LlmConfig;
  setLlmChatConfig: (cfg: Partial<LlmConfig>) => void;
  llmPassportConfig: LlmConfig;
  setLlmPassportConfig: (cfg: Partial<LlmConfig>) => void;
  llmSummaryConfig: LlmConfig;
  setLlmSummaryConfig: (cfg: Partial<LlmConfig>) => void;
  webSearchProvider: "tavily" | "brave" | "none";
  webSearchApiKey: string;
  setWebSearchProvider: (provider: "tavily" | "brave" | "none") => void;
  setWebSearchApiKey: (key: string) => void;

  // Custom agents
  customAgents: CustomAgent[];
  setCustomAgents: (agents: CustomAgent[]) => void;
  addCustomAgent: (agent: CustomAgent) => void;
  updateCustomAgent: (id: string, updates: Partial<CustomAgent>) => void;
  deleteCustomAgent: (id: string) => void;

  // Session buffer (shared between assistant and agents)
  sessionBuffer: SessionBuffer;
  writeBuffer: (key: string, content: string, summary: string, author: string, tags?: string[]) => string;
  readBuffer: (key: string) => SessionBufferEntry | null;
  listBuffer: (tag?: string) => { key: string; summary: string; author: string; tags: string[]; charCount: number; updatedAt: number }[];
  clearBuffer: () => void;

  // Developer mode
  devMode: boolean;
  devTrackToolIssues: boolean;
  devToolFeedback: boolean;
  setDevMode: (v: boolean) => void;
  setDevTrackToolIssues: (v: boolean) => void;
  setDevToolFeedback: (v: boolean) => void;

  llmCurrentPlan: LlmPlan | null;
  llmMessages: LlmMessage[];
  llmLoading: boolean;
  llmAborted: boolean;
  llmTokensUsed: { input: number; output: number; cacheRead: number; cacheCreation: number };
  llmIncludeContext: boolean;
  llmIncludeSourceCode: boolean;
  llmWaitingForUser: boolean;
  llmPendingQuestion: string | null;
  llmPendingOptions: string[] | null;
  llmResolveUserInput: ((answer: string) => void) | null;
  setLlmIncludeContext: (v: boolean) => void;
  setLlmIncludeSourceCode: (v: boolean) => void;
  setWaitingForUser: (question: string, options: string[] | null, resolve: (answer: string) => void) => void;
  submitUserAnswer: (answer: string) => void;
  sendLlmMessage: (text: string, includeContext: boolean, attachments?: LlmAttachment[], includeSourceCode?: boolean, displayText?: string, planMode?: boolean) => Promise<string | null>;
  stopLlmChat: () => void;
  retryLlmMessage: (userMsgIndex?: number) => void;
  clearLlmMessages: () => void;
  llmSessionContext: LlmSessionContext | null;
  llmTargetProjectToken: string | null;
  startDocUpdateSession: () => void;
  startLinkedDocGenSession: (linkedProjectId: string, mode?: "generate" | "update") => void;
  startDocUpdateQueue: (projects: Array<{ type: "main" } | { type: "linked"; linkedProjectId: string; mode: "generate" | "update" }>) => Promise<void>;
  llmSessions: LlmSession[];
  llmCurrentSessionId: string | null;
  saveLlmSession: () => void;
  loadLlmSession: (id: string) => void;
  deleteLlmSession: (id: string) => void;
  bumpSession: (sessionId: string) => void;

  // Passport
  passport: Record<string, string>;
  loadPassport: () => Promise<void>;
  setPassportField: (key: string, value: string) => Promise<void>;
  deletePassportField: (key: string) => Promise<void>;
  generatePassport: () => Promise<void>;
  generateSectionSummary: (sectionId: string) => Promise<void>;
  expandIdeaToPlan: (ideaId: string, messageId?: string, messageText?: string, messageImages?: { id: string; name: string; mediaType: string; data: string }[]) => Promise<string | null>;
  addIdeaMessage: (sectionId: string, text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => Promise<{ id: string; text: string; createdAt: number }>;
  deleteIdeaMessage: (sectionId: string, messageId: string) => Promise<void>;
  getIdeaMessages: (sectionId: string) => Promise<{ id: string; text: string; createdAt: number; planId?: string; completed?: boolean; images?: { id: string; name: string; mediaType: string; data: string }[] }[]>;
  processIdeaWithLLM: (ideaId: string, mode?: import("@ccdoc/core").IdeaProcessingMode) => void;
  applyIdeaProcessingResult: (ideaId: string, result: import("@ccdoc/core").IdeaProcessingResult) => Promise<void>;
  ideaProcessingTask: IdeaProcessingTask | null;
  clearIdeaProcessingTask: () => void;
  openIdeaProcessingResult: () => Promise<void>;

  // Background tasks
  bgTasks: BackgroundTask[];
  startBgTask: (label: string) => string;
  finishBgTask: (id: string) => void;
  updateBgTask: (id: string, updates: Partial<Omit<BackgroundTask, "id">>) => void;
  updateBgTaskProgress: (id: string, progress: number) => void;

  // Summary generation tracking (section IDs currently being summarized)
  summarizingIds: Set<string>;
  addSummarizingId: (id: string) => void;
  removeSummarizingId: (id: string) => void;
  semanticProgressItem: string | null;
  semanticProgressLog: string[];
  onSemanticProgress: (item: string) => void;
  clearSemanticProgress: () => void;

  // Auto-verify plans
  autoVerifyPlan: boolean;
  setAutoVerifyPlan: (v: boolean) => void;

  // Icon progress
  showIconProgress: boolean;
  setShowIconProgress: (v: boolean) => void;

  // Progress stages
  progressStages: ProgressStage[];
  setProgressStages: (stages: ProgressStage[]) => void;

  // Voice STT
  voiceModelId: string;
  setVoiceModelId: (id: string) => void;
  voiceStatuses: Record<string, "none" | "partial" | "ready">;
  voiceDownloading: string | null;
  voiceProgress: number;
  voiceCancelling: boolean;
  voiceErrors: Record<string, string>;
  voiceTranscribing: boolean;
  fetchVoiceStatuses: () => Promise<void>;
  initVoiceProgressListener: () => void;
  startVoiceDownload: (modelId: string) => void;
  cancelVoiceDownload: () => void;
  deleteVoiceModel: (modelId: string) => Promise<void>;
  transcribeAudio: (audio: Float32Array) => Promise<string>;

  // Embedding
  embeddingConfig: EmbeddingConfig;
  setEmbeddingConfig: (cfg: Partial<EmbeddingConfig>) => void;
  embeddingStatuses: Record<string, "none" | "partial" | "ready">;
  embeddingDownloading: Record<string, number>;
  embeddingCancelling: Record<string, boolean>;
  embeddingErrors: Record<string, string>;
  embeddingBgTaskIds: Record<string, string>;
  fetchEmbeddingStatus: () => Promise<void>;
  initEmbeddingProgressListener: () => void;
  startEmbeddingDownload: (modelId: string) => void;
  cancelEmbeddingDownload: (modelId: string) => void;
  deleteEmbeddingModel: (modelId: string) => Promise<void>;

  // Indexing
  indexingConfig: IndexingConfig;
  setIndexingConfig: (cfg: Partial<IndexingConfig>) => void;

  // Spellcheck
  spellcheckConfig: SpellcheckConfig;
  setSpellcheckConfig: (cfg: Partial<SpellcheckConfig>) => void;

  // History settings
  historyConfig: { historyRetainDays: number; maxSnapshotsPerSection: number; snapshotMaxAgeDays: number; snapshotCoalesceIntervalSec: number };
  setHistoryConfig: (cfg: Partial<{ historyRetainDays: number; maxSnapshotsPerSection: number; snapshotMaxAgeDays: number; snapshotCoalesceIntervalSec: number }>) => void;

  // Tree expand/collapse state
  expandedNodes: Set<string>;
  loadingNodes: Set<string>;
  toggleExpanded: (id: string) => void;
  expandNode: (id: string) => void;
  collapseAll: () => void;
  setNodeLoading: (id: string, loading: boolean) => void;

  // Workspace
  workspace: Workspace | null;
  linkedProjects: LinkedProject[];
  workspaceLoading: boolean;
  loadWorkspace: (projectToken: string) => Promise<void>;
  ensureWorkspace: (projectToken: string, projectName: string) => Promise<Workspace>;
  linkProject: (sourcePath: string, linkType: LinkType, alias?: string) => Promise<LinkedProject | null>;
  unlinkProject: (linkedId: string) => Promise<void>;
  updateLinkedProject: (linkedId: string, fields: { alias?: string; sort_order?: number }) => Promise<void>;
  clearWorkspace: () => void;
  suggestedLinks: SuggestedLink[];
  scanning: boolean;
  scanDependencies: (projectPath: string) => Promise<void>;
  loadLinkedChildren: (linkedProjectToken: string, parentId?: string) => Promise<TreeNode[]>;

  // Cross-project search
  crossSearchResults: Array<{
    id: string;
    title: string;
    titleHighlighted: string;
    snippet: string;
    score: number;
    breadcrumbs?: string;
    project_token: string;
    project_name: string;
    is_linked: boolean;
  }>;
  crossSearchLoading: boolean;
  crossProjectSearch: (query: string, scope?: string) => Promise<void>;

  // User folder
  userTree: TreeNode[];
  userTreeLoading: boolean;
  userFolderExpanded: boolean;
  sectionSource: "project" | "user";
  loadUserTree: () => Promise<void>;
  createUserSection: (parentId: string | null, title: string, type: string, icon?: string | null) => Promise<void>;
  updateUserSection: (id: string, title: string, content: string) => Promise<void>;
  updateUserSectionMarkdown: (id: string, title: string, markdown: string) => Promise<void>;
  updateUserIcon: (id: string, icon: string | null) => Promise<void>;
  moveUserSection: (id: string, newParentId: string | null, afterId: string | null) => Promise<void>;
  duplicateUserSection: (id: string) => Promise<void>;
  deleteUserSection: (id: string) => Promise<void>;
  restoreUserSection: (id: string) => Promise<void>;
  selectUserSection: (id: string) => Promise<void>;
  toggleUserFolder: () => void;
  setSectionSource: (source: "project" | "user") => void;

  // External changes (quiet mode)
  externalChangePending: boolean;
  externalChangeTimestamp: number | null;
  externallyChangedIds: Set<string>;
  quietLoadTree: () => Promise<void>;
  refreshCurrentSection: () => Promise<void>;
  dismissExternalChange: () => void;
  clearExternalChange: (id: string) => void;

  // Section view preferences (persisted per section)
  _sectionPrefs: Record<string, Record<string, unknown>>;
  _sectionPrefsLoaded: Set<string>;
  getSectionPref: <T = unknown>(sectionId: string, key: string, defaultValue: T) => T;
  setSectionPref: (sectionId: string, key: string, value: unknown) => void;
  loadSectionPrefs: (sectionId: string) => Promise<void>;
  removeSectionPref: (sectionId: string, key: string) => void;
  clearSectionPrefsCache: (sectionId: string) => void;

  // Section snapshots (local per-section history)
  snapshotsPanelOpen: boolean;
  snapshotsPanelSectionId: string | null;
  snapshotsPanelSectionTitle: string;
  snapshots: Array<{ id: string; section_id: string; title: string; type: string; source: string; created_at: string; byte_size: number; content?: string }>;
  snapshotsLoading: boolean;
  snapshotsHasMore: boolean;
  selectedSnapshotIds: string[];
  diffData: { left: string; right: string; leftLabel: string; rightLabel: string } | null;
  diffLoading: boolean;
  openSnapshotsPanel: (sectionId: string, sectionTitle: string) => void;
  closeSnapshotsPanel: () => void;
  loadSnapshots: (sectionId: string) => Promise<void>;
  loadMoreSnapshots: () => Promise<void>;
  toggleSnapshotSelection: (snapshotId: string) => void;
  clearSnapshotSelection: () => void;
  loadDiff: () => Promise<void>;
  loadDiffWithCurrent: (snapshotId: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  deleteSnapshot: (snapshotId: string) => Promise<void>;
}

// ─── Slice helper type ──────────────────────────────────────

export type SliceCreator<T> = StateCreator<AppState, [], [], T>;
