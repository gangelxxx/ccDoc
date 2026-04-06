import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronRight, Zap, RotateCcw, Loader2, Check, Copy, Send, Trash2, ArrowDown, ArrowDownUp, CircleCheck, FileText, Pencil, Paperclip, X, Search, ChevronUp, ChevronDown, Sparkles, Type, Wand2, Layers, FolderOpen, Undo2, XCircle } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { findTreeNode, renderMarkdown } from "./editor-utils.js";
import { VoiceButton } from "../VoiceButton/VoiceButton.js";
import { IdeaProcessingPreview } from "./IdeaProcessingPreview.js";
import type { IdeaProcessingMode, IdeaProcessingResult } from "@ccdoc/core";
import { IdeaProgressButton } from "./IdeaProgressButton.js";
import type { ProgressStage } from "./IdeaProgressSlider.js";

const DEFAULT_PROGRESS_STAGES: ProgressStage[] = [
  { id: 'new',     name: 'New',            percent: 0,   color: '#94a3b8' },
  { id: 'dev',     name: 'In Development', percent: 25,  color: '#3b82f6' },
  { id: 'test',    name: 'Testing',        percent: 50,  color: '#f59e0b' },
  { id: 'prod',    name: 'In Production',  percent: 75,  color: '#22c55e' },
  { id: 'done',    name: 'Done',           percent: 100, color: '#10b981' },
];

interface IdeaImage {
  id: string;
  name: string;
  mediaType: string;
  data: string;
}

type Msg = {
  id: string;
  text: string;
  createdAt: number;
  planId?: string;
  completed?: boolean;
  editedAt?: number;
  images?: IdeaImage[];
  progress?: number;
};

// --- helpers ---

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.7;
const MAX_IMAGES_PER_MESSAGE = 5;

const compressImage = (file: File): Promise<{ data: string; mediaType: string }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (!width || !height) { reject(new Error("Invalid image dimensions")); return; }
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width = MAX_DIMENSION;
        } else {
          width = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      img.src = ""; // help GC release the data URL
      resolve({ data: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = reject;
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result as string; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const processImageFile = async (file: File): Promise<IdeaImage> => {
  // Small images (< 200KB) — keep original format; larger — compress
  if (file.size < 200 * 1024) {
    const data = await readFileAsBase64(file);
    return { id: crypto.randomUUID(), name: file.name, mediaType: file.type || "image/png", data };
  }
  const { data, mediaType } = await compressImage(file);
  return { id: crypto.randomUUID(), name: file.name, mediaType, data };
};

import { sourceGetSection as ideaGetSection, sourceSaveSection as ideaSaveSection } from "./source-api.js";

// --- Idea Plan Card (collapsible plan preview under a message) ---
export function IdeaPlanCard({ planId, onNavigate }: { planId: string; onNavigate: (id: string) => void }) {
  const t = useT();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [phasesExpanded, setPhasesExpanded] = useState(false);
  const [copiedPhaseId, setCopiedPhaseId] = useState<string | null>(null);
  const currentProject = useAppStore(s => s.currentProject);
  const activeSectionToken = useAppStore(s => s.activeSectionToken);
  const sectionSource = useAppStore(s => s.sectionSource);
  const tree = useAppStore(s => s.tree);
  const userTree = useAppStore(s => s.userTree);
  const isUser = sectionSource === "user";

  useEffect(() => {
    if (isUser) {
      window.api.user.getContent(planId, "markdown")
        .then((content: string) => setMarkdown(content || null))
        .catch(() => setMarkdown(null));
    } else if (currentProject?.token) {
      const token = activeSectionToken || currentProject.token;
      window.api.getSectionContent(token, planId, "markdown")
        .then((content: string) => setMarkdown(content || null))
        .catch(() => setMarkdown(null));
    }
  }, [planId, currentProject?.token, activeSectionToken, isUser]);

  const activeTree = isUser ? userTree : tree;
  const planNode = findTreeNode(activeTree, planId);
  const phases = planNode?.children?.filter((c: any) => c.type === "section") || [];

  const handleCopyPhase = async (e: React.MouseEvent, phaseId: string) => {
    e.stopPropagation();
    try {
      let content: string;
      if (isUser) {
        content = await window.api.user.getContent(phaseId, "markdown");
      } else {
        if (!currentProject?.token) return;
        const phaseToken = activeSectionToken || currentProject.token;
        content = await window.api.getSectionContent(phaseToken, phaseId, "markdown");
      }
      if (content) {
        await navigator.clipboard.writeText(content);
        setCopiedPhaseId(phaseId);
        setTimeout(() => setCopiedPhaseId(null), 1500);
      }
    } catch { /* ignore */ }
  };

  if (!markdown) return null;

  return (
    <div className="idea-chat-plan">
      <div className="idea-chat-plan-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="idea-chat-plan-label">
          <FileText size={13} />
          <span>{planNode?.title || "Plan"}</span>
          {phases.length > 0 && (
            <span className="idea-chat-plan-phase-count">
              {phases.length} {t("planPhases")}
            </span>
          )}
        </div>
        <div className="idea-chat-plan-actions">
          <button
            className="idea-chat-plan-open"
            onClick={(e) => { e.stopPropagation(); onNavigate(planId); }}
          >
            {t("viewPlan")} <ChevronRight size={12} />
          </button>
          <ChevronRight
            size={14}
            className={`idea-chat-plan-chevron ${collapsed ? "" : "expanded"}`}
          />
        </div>
      </div>
      {!collapsed && (
        <>
          {phases.length > 0 && (
            <div className="idea-chat-plan-phases">
              <div
                className="idea-chat-plan-phases-toggle"
                onClick={() => setPhasesExpanded(!phasesExpanded)}
              >
                <Layers size={12} />
                <span>{t("planShowPhases")}</span>
                {phasesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </div>
              {phasesExpanded && (
                <div className="idea-chat-plan-phases-list">
                  {phases.map((phase: any) => (
                    <div key={phase.id} className="idea-chat-plan-phase-item">
                      <span
                        className="idea-chat-plan-phase-title"
                        onClick={() => onNavigate(phase.id)}
                      >
                        {phase.title}
                      </span>
                      <button
                        className="idea-chat-plan-phase-copy"
                        onClick={(e) => handleCopyPhase(e, phase.id)}
                        title={t("planCopyPhase")}
                      >
                        {copiedPhaseId === phase.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div
            className="idea-chat-plan-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
          />
        </>
      )}
    </div>
  );
}

// --- Idea Chat (Telegram-like chat for brainstorming ideas) ---
export function IdeaChat({ section, tree, onNavigate }: {
  section: any;
  tree: any[];
  onNavigate: (id: string) => void;
}) {
  const t = useT();
  const expandIdeaToPlan = useAppStore((s) => s.expandIdeaToPlan);
  const processIdeaWithLLM = useAppStore((s) => s.processIdeaWithLLM);
  const addIdeaMessage = useAppStore((s) => s.addIdeaMessage);
  const deleteIdeaMessage = useAppStore((s) => s.deleteIdeaMessage);
  const permanentDeleteIdeaMessage = useAppStore((s) => s.permanentDeleteIdeaMessage);
  const restoreIdeaMessage = useAppStore((s) => s.restoreIdeaMessage);
  const emptyIdeaTrash = useAppStore((s) => s.emptyIdeaTrash);
  const addToast = useAppStore((s) => s.addToast);
  const getIdeaMessages = useAppStore((s) => s.getIdeaMessages);
  const deleteSection = useAppStore((s) => s.deleteSection);
  const loadTree = useAppStore((s) => s.loadTree);
  const renameSection = useAppStore((s) => s.renameSection);
  const hasLlmAccess = useAppStore((s) => s.hasLlmAccess)();
  const llmLoading = useAppStore((s) => s.llmLoading);
  const currentProject = useAppStore((s) => s.currentProject);
  const scrollToPlanId = useAppStore((s) => s.scrollToPlanId);
  const setScrollToPlanId = useAppStore((s) => s.setScrollToPlanId);
  const highlightQuery = useAppStore((s) => s.highlightQuery);
  const setHighlightQuery = useAppStore((s) => s.setHighlightQuery);
  const ideaSearchTrigger = useAppStore((s) => s.ideaSearchTrigger);
  const progressStages = useAppStore((s) => s.progressStages);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedPlanId, setCopiedPlanId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editMinWidth, setEditMinWidth] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const shouldScrollRef = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Image attachment state
  const [pendingImages, setPendingImages] = useState<IdeaImage[]>([]);
  const [lightbox, setLightbox] = useState<{ images: IdeaImage[]; index: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [imageMenu, setImageMenu] = useState<{ msgId: string; imageId: string; x: number; y: number } | null>(null);
  const [msgContextMenu, setMsgContextMenu] = useState<{ msgId: string; x: number; y: number } | null>(null);

  // Local search state
  // AI processing state (stored in Zustand — survives navigation)
  const ideaProcessingTask = useAppStore((s) => s.ideaProcessingTask);
  const clearIdeaProcessingTask = useAppStore((s) => s.clearIdeaProcessingTask);
  const applyIdeaProcessingResult = useAppStore((s) => s.applyIdeaProcessingResult);
  const [showProcessingPreview, setShowProcessingPreview] = useState(false);
  const [processingDropdown, setProcessingDropdown] = useState(false);
  const processingDropdownRef = useRef<HTMLDivElement>(null);
  const [sortDropdown, setSortDropdown] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const showGrouped = useAppStore((s) => {
    const prefs = s._sectionPrefs[section.id];
    return prefs && "grouping" in prefs ? (prefs["grouping"] as boolean) : true;
  });
  // ideaSort format: "field:dir" e.g. "progress:desc", "completed:desc", "plan:desc"
  const ideaSort = useAppStore((s) => {
    const prefs = s._sectionPrefs[section.id];
    return (prefs?.["ideaSort"] as string | undefined) ?? undefined;
  });
  const setSectionPref = useAppStore((s) => s.setSectionPref);

  // Detect if this idea is the trash bin (by known titles in any language, or by message metadata)
  const TRASH_IDEA_TITLES = ["Deleted ideas", "\u0423\u0434\u0430\u043b\u0451\u043d\u043d\u044b\u0435 \u0438\u0434\u0435\u0438"];
  const isTrash = TRASH_IDEA_TITLES.includes(section.title) ||
    (messages.length > 0 && typeof (messages[0] as any).deletedAt === "number");

  // Auto-show preview when processing completes for this section
  useEffect(() => {
    if (
      ideaProcessingTask?.status === "done" &&
      ideaProcessingTask.sectionId === section.id &&
      ideaProcessingTask.result
    ) {
      setShowProcessingPreview(true);
    }
  }, [ideaProcessingTask?.status, ideaProcessingTask?.sectionId, section.id]);

  const isProcessing = ideaProcessingTask?.status === "processing" && ideaProcessingTask.sectionId === section.id;

  // Local search state
  const [localSearch, setLocalSearch] = useState(false);
  const [localQuery, setLocalQuery] = useState("");
  const [matchIndices, setMatchIndices] = useState<number[]>([]);
  const [matchCursor, setMatchCursor] = useState(0);
  const localSearchRef = useRef<HTMLInputElement>(null);

  // Edit-mode image state
  const [editPendingImages, setEditPendingImages] = useState<IdeaImage[]>([]);
  const [editDragOver, setEditDragOver] = useState(false);

  // Check if scroll-down button should be visible
  const checkScrollPosition = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 100);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Reset transient UI state on section change
  useEffect(() => {
    setImageMenu(null);
    setLightbox(null);
    setPendingImages([]);
    setEditPendingImages([]);
    setEditDragOver(false);
    if (progressDebounceRef.current) clearTimeout(progressDebounceRef.current);
  }, [section.id]);

  // Load messages & auto-link unlinked plan children
  useEffect(() => {
    if (sendingRef.current) return; // skip reload while sending
    (async () => {
      const msgs = await getIdeaMessages(section.id);

      // Find idea's children in tree
      const ideaNode = findTreeNode(tree, section.id);
      const children = ideaNode?.children || [];

      // Clean up planIds pointing to deleted sections
      const childIds = new Set(children.map((c: any) => c.id));
      let changed = false;
      for (const m of msgs) {
        if (m.planId && !childIds.has(m.planId)) {
          delete m.planId;
          changed = true;
        }
      }

      // Auto-link orphaned children (created by LLM in chat mode, not via expandIdeaToPlan)
      const linkedIds = new Set(msgs.filter((m: any) => m.planId).map((m: any) => m.planId));
      const orphans = children.filter((c: any) => c.type === "section" && !linkedIds.has(c.id));
      if (orphans.length > 0) {
        // Attach each orphan to the last message, or create a synthetic message
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg) {
          // If last message already has a planId, create a new message for each orphan
          for (const orphan of orphans) {
            if (!lastMsg.planId) {
              lastMsg.planId = orphan.id;
            } else {
              msgs.push({ id: `auto-${orphan.id}`, text: "", createdAt: Date.now(), planId: orphan.id });
            }
          }
        } else {
          for (const orphan of orphans) {
            msgs.push({ id: `auto-${orphan.id}`, text: "", createdAt: Date.now(), planId: orphan.id });
          }
        }
        changed = true;
      }

      if (changed) {
        try {
          const sec = await ideaGetSection(section.id);
          if (sec) {
            const data = JSON.parse(sec.content);
            data.messages = msgs;
            await ideaSaveSection(section.id, sec.title, JSON.stringify(data));
          }
        } catch { /* ignore */ }
      }

      setMessages(msgs);
    })();
  }, [section.id, tree]);

  // Scroll only when explicitly requested (after sending a message)
  // Also update scroll-down button visibility after messages change
  useEffect(() => {
    if (shouldScrollRef.current) {
      shouldScrollRef.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // Check after DOM updates
    requestAnimationFrame(checkScrollPosition);
  }, [messages, checkScrollPosition]);

  // Scroll to a specific plan message when navigated from tree context menu
  useEffect(() => {
    if (!scrollToPlanId || messages.length === 0) return;
    const el = messagesContainerRef.current?.querySelector(`[data-plan-id="${scrollToPlanId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("idea-chat-msg--highlight");
      setTimeout(() => el.classList.remove("idea-chat-msg--highlight"), 1500);
    }
    setScrollToPlanId(null);
  }, [scrollToPlanId, messages]);

  // Scroll to a specific message by ID (e.g. from kanban card)
  const scrollToMessageId = useAppStore((s) => s.scrollToMessageId);
  const setScrollToMessageId = useAppStore((s) => s.setScrollToMessageId);
  useEffect(() => {
    if (!scrollToMessageId || messages.length === 0) return;
    // Defer to next frame so DOM is rendered after messages update
    const raf = requestAnimationFrame(() => {
      const el = messagesContainerRef.current?.querySelector(`[data-msg-id="${scrollToMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Delay highlight until smooth scroll finishes
        setTimeout(() => {
          el.classList.add("idea-chat-msg--highlight");
          setTimeout(() => el.classList.remove("idea-chat-msg--highlight"), 1500);
        }, 500);
      }
      setScrollToMessageId(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToMessageId, messages]);

  // Scroll to and highlight message matching search query
  useEffect(() => {
    if (!highlightQuery || messages.length === 0) return;
    const q = highlightQuery.toLowerCase();
    const idx = messages.findIndex((m) => m.text?.toLowerCase().includes(q));
    if (idx === -1) { setHighlightQuery(null); return; }
    const row = messagesContainerRef.current?.querySelector(`[data-msg-id="${messages[idx].id}"]`);
    const bubble = row?.querySelector(".idea-chat-msg-bubble");
    if (row && bubble) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      bubble.classList.add("idea-chat-msg--search-highlight");
      setTimeout(() => bubble.classList.remove("idea-chat-msg--search-highlight"), 3000);
    }
    setHighlightQuery(null);
  }, [highlightQuery, messages]);

  // Local search: update matches when query changes
  useEffect(() => {
    if (!localQuery.trim()) { setMatchIndices([]); setMatchCursor(0); return; }
    const q = localQuery.toLowerCase();
    const indices = messages
      .map((m, i) => m.text?.toLowerCase().includes(q) ? i : -1)
      .filter((i) => i !== -1);
    setMatchIndices(indices);
    setMatchCursor(0);
    // Scroll to first match
    if (indices.length > 0) {
      const el = messagesContainerRef.current?.querySelector(`[data-msg-id="${messages[indices[0]].id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [localQuery, messages]);

  // Local search: scroll to current match when cursor changes
  const scrollToMatch = useCallback((cursor: number) => {
    if (matchIndices.length === 0) return;
    const idx = matchIndices[cursor];
    const el = messagesContainerRef.current?.querySelector(`[data-msg-id="${messages[idx].id}"]`);
    const bubble = el?.querySelector(".idea-chat-msg-bubble");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (bubble) {
      bubble.classList.remove("idea-chat-msg--search-highlight");
      void (bubble as HTMLElement).offsetWidth; // force reflow
      bubble.classList.add("idea-chat-msg--search-highlight");
      setTimeout(() => bubble.classList.remove("idea-chat-msg--search-highlight"), 3000);
    }
  }, [matchIndices, messages]);

  // Ctrl+F trigger from App.tsx global handler
  useEffect(() => {
    if (ideaSearchTrigger === 0) return;
    setLocalSearch(true);
    setTimeout(() => localSearchRef.current?.focus(), 50);
  }, [ideaSearchTrigger]);

  // Escape to close local search
  useEffect(() => {
    if (!localSearch) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setLocalSearch(false); setLocalQuery(""); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [localSearch]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  }, []);
  useEffect(() => { autoResize(); }, [input, autoResize]);

  // --- Image handlers ---

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const toProcess = imageFiles.slice(0, MAX_IMAGES_PER_MESSAGE);
    const newImages: IdeaImage[] = [];
    for (const file of toProcess) {
      try {
        newImages.push(await processImageFile(file));
      } catch { /* skip broken files */ }
    }
    if (newImages.length > 0) {
      setPendingImages(prev => {
        const remaining = MAX_IMAGES_PER_MESSAGE - prev.length;
        if (remaining <= 0) return prev;
        return [...prev, ...newImages.slice(0, remaining)];
      });
    }
  }, []);

  const handleAttachImages = useCallback(() => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.onchange = () => {
      if (fileInput.files) addImageFiles(Array.from(fileInput.files));
    };
    fileInput.click();
  }, [addImageFiles]);

  const removePendingImage = useCallback((imageId: string) => {
    setPendingImages(prev => prev.filter(img => img.id !== imageId));
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addImageFiles(Array.from(e.dataTransfer.files));
  }, [addImageFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items).filter(item => item.type.startsWith("image/"));
    if (items.length === 0) return;
    e.preventDefault();
    const files: File[] = [];
    for (const item of items) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    addImageFiles(files);
  }, [addImageFiles]);

  // --- Edit-mode image handlers ---

  const addEditImageFiles = useCallback(async (files: File[], existingCount: number) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const newImages: IdeaImage[] = [];
    for (const file of imageFiles) {
      try {
        newImages.push(await processImageFile(file));
      } catch { /* skip broken files */ }
    }
    if (newImages.length > 0) {
      setEditPendingImages(prev => {
        const remaining = MAX_IMAGES_PER_MESSAGE - existingCount - prev.length;
        if (remaining <= 0) return prev;
        return [...prev, ...newImages.slice(0, remaining)];
      });
    }
  }, []);

  const handleEditPaste = useCallback((e: React.ClipboardEvent, existingCount: number) => {
    const items = Array.from(e.clipboardData.items).filter(item => item.type.startsWith("image/"));
    if (items.length === 0) return;
    e.preventDefault();
    const files: File[] = [];
    for (const item of items) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    addEditImageFiles(files, existingCount);
  }, [addEditImageFiles]);

  const handleEditAttachImages = useCallback((existingCount: number) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.onchange = () => {
      if (fileInput.files) addEditImageFiles(Array.from(fileInput.files), existingCount);
    };
    fileInput.click();
  }, [addEditImageFiles]);

  const removeEditPendingImage = useCallback((imageId: string) => {
    setEditPendingImages(prev => prev.filter(img => img.id !== imageId));
  }, []);

  const handleEditDrop = useCallback((e: React.DragEvent, existingCount: number) => {
    e.preventDefault();
    setEditDragOver(false);
    addEditImageFiles(Array.from(e.dataTransfer.files), existingCount);
  }, [addEditImageFiles]);

  const handleEditDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setEditDragOver(true);
  }, []);

  const handleEditDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setEditDragOver(false);
    }
  }, []);

  const openLightbox = useCallback((images: IdeaImage[], index: number) => {
    setLightbox({ images, index });
  }, []);

  const closeLightbox = useCallback(() => setLightbox(null), []);

  // --- Image context menu ---

  const handleImageContextMenu = useCallback((e: React.MouseEvent, msgId: string, imageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const MENU_W = 160, MENU_H = 70;
    const x = Math.min(e.clientX, window.innerWidth - MENU_W);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H);
    setImageMenu({ msgId, imageId, x, y });
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (!imageMenu) return;
    const msg = messages.find(m => m.id === imageMenu.msgId);
    const img = msg?.images?.find(i => i.id === imageMenu.imageId);
    if (!img) return;
    try {
      // Clipboard API only supports image/png — convert via canvas
      const imgEl = new Image();
      await new Promise<void>((resolve, reject) => { imgEl.onload = () => resolve(); imgEl.onerror = reject; imgEl.src = `data:${img.mediaType};base64,${img.data}`; });
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      canvas.getContext("2d")!.drawImage(imgEl, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(), "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch { /* ignore */ }
    setImageMenu(null);
  }, [imageMenu, messages]);

  const handleDeleteImage = useCallback(async () => {
    if (!imageMenu) return;
    const { msgId, imageId } = imageMenu;
    setImageMenu(null);
    // Check if message becomes empty after removing the image
    const msg = messages.find(m => m.id === msgId);
    const remainingImages = msg?.images?.filter(i => i.id !== imageId);
    const becomesEmpty = !msg?.text && (!remainingImages || remainingImages.length === 0);
    if (becomesEmpty) {
      // Delete entire message
      setLightbox(null);
      setMessages(prev => prev.filter(m => m.id !== msgId));
      await deleteIdeaMessage(section.id, msgId);
      return;
    }
    // Update local state
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      return { ...m, images: remainingImages?.length ? remainingImages : undefined };
    }));
    // Reconcile lightbox if it's showing images from this message
    setLightbox(prev => {
      if (!prev) return prev;
      const updated = prev.images.filter(i => i.id !== imageId);
      if (updated.length === 0) return null;
      return { images: updated, index: Math.min(prev.index, updated.length - 1) };
    });
    // Persist to DB
    try {
      const sec = await ideaGetSection(section.id);
      if (sec) {
        const data = JSON.parse(sec.content);
        const target = data.messages.find((m: any) => m.id === msgId);
        if (target && target.images) {
          target.images = target.images.filter((i: any) => i.id !== imageId);
          if (target.images.length === 0) delete target.images;
          await ideaSaveSection(section.id, sec.title, JSON.stringify(data));
        }
      }
    } catch { /* ignore */ }
  }, [imageMenu, messages, section.id, deleteIdeaMessage]);

  // Close image menu on click outside or Escape
  useEffect(() => {
    if (!imageMenu) return;
    const close = () => setImageMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", handleKey); };
  }, [imageMenu]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") setLightbox(prev => prev && ({ ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length }));
      if (e.key === "ArrowRight") setLightbox(prev => prev && ({ ...prev, index: (prev.index + 1) % prev.images.length }));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightbox, closeLightbox]);

  // --- Send ---

  const handleSend = async () => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    setInput("");
    const imagesToSend = pendingImages.length > 0 ? [...pendingImages] : undefined;
    setPendingImages([]);
    const hasGroups = showGrouped && messages.some((m: any) => m.group);
    // Optimistic: show immediately
    const tempMsg: Msg = { id: crypto.randomUUID(), text, createdAt: Date.now(), images: imagesToSend };
    if (hasGroups) {
      // When grouped, scroll to the new message in its group instead of to the bottom
      setScrollToMessageId(tempMsg.id);
    } else {
      shouldScrollRef.current = true;
    }
    setMessages(prev => [...prev, tempMsg]);
    // Save to DB, then reload to get real IDs
    sendingRef.current = true;
    try {
      await addIdeaMessage(section.id, text, imagesToSend);
      const updated = await getIdeaMessages(section.id);
      setMessages(updated);
    } finally {
      sendingRef.current = false;
    }
  };

  const progressDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const handleMsgProgressChange = useCallback((msgId: string, val: number) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, progress: val } : m));
    if (progressDebounceRef.current) clearTimeout(progressDebounceRef.current);
    progressDebounceRef.current = setTimeout(async () => {
      try {
        const sec = await ideaGetSection(section.id);
        if (!sec) return;
        const data = JSON.parse(sec.content);
        const target = data.messages?.find((m: any) => m.id === msgId);
        if (target) {
          target.progress = val;
          await ideaSaveSection(section.id, sec.title, JSON.stringify(data));
        }
      } catch { /* ignore */ }
    }, 300);
  }, [section.id]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleExpandToPlan = async (msg: Msg) => {
    setGeneratingFor(msg.id);
    try {
      // If regenerating, delete old plan first
      if (msg.planId) {
        await deleteSection(msg.planId);
        await loadTree();
      }
      await expandIdeaToPlan(section.id, msg.id, msg.text, msg.images);
      const updated = await getIdeaMessages(section.id);
      setMessages(updated);
    } finally {
      setGeneratingFor(null);
    }
  };

  const handleDelete = async (msgId: string) => {
    await deleteIdeaMessage(section.id, msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  const handlePermanentDelete = async (msgId: string) => {
    await permanentDeleteIdeaMessage(msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  const handleRestore = async (msgId: string) => {
    const result = await restoreIdeaMessage(msgId);
    if (result.success) {
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } else if (result.error === "original_deleted") {
      addToast("warning", t("trashOriginalDeleted"));
    } else {
      addToast("error", t("trashRestoreFailed"));
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm(t("trashEmptyConfirm"))) return;
    await emptyIdeaTrash();
    setMessages([]);
  };

  const handleDeletePlan = async (msg: { id: string; planId?: string }) => {
    if (!msg.planId) return;
    await deleteSection(msg.planId);
    // Unlink planId from message
    try {
      const sec = await ideaGetSection(section.id);
      if (sec) {
        const data = JSON.parse(sec.content);
        const target = data.messages.find((m: any) => m.id === msg.id);
        if (target) {
          delete target.planId;
          await ideaSaveSection(section.id, sec.title, JSON.stringify(data));
        }
      }
    } catch { /* ignore */ }
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, planId: undefined } : m));
    await loadTree();
  };

  const handleStartEdit = (msg: { id: string; text: string }, e?: React.MouseEvent) => {
    // Capture bubble width before switching to textarea
    const bubble = (e?.currentTarget as HTMLElement)?.closest?.(".idea-chat-msg-bubble")
      || document.querySelector(`[data-msg-id="${msg.id}"] .idea-chat-msg-bubble`);
    if (bubble) setEditMinWidth((bubble as HTMLElement).offsetWidth);
    setEditingId(msg.id);
    setEditText(msg.text);
    setEditPendingImages([]);
    setEditDragOver(false);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const trimmed = editText.trim();
    const newImages = [...editPendingImages];
    // Check if the message has existing images
    const editMsg = messages.find(m => m.id === editingId);
    const hasExistingImages = (editMsg?.images?.length || 0) > 0;
    if (!trimmed && newImages.length === 0 && !hasExistingImages) {
      setEditingId(null);
      setEditText("");
      setEditMinWidth(null);
      setEditPendingImages([]);
      setEditDragOver(false);
      return;
    }
    const editId = editingId;
    // Merge new images with existing ones
    setMessages(prev => prev.map(m => {
      if (m.id !== editId) return m;
      const mergedImages = newImages.length > 0
        ? [...(m.images || []), ...newImages]
        : m.images;
      return { ...m, text: trimmed, editedAt: Date.now(), images: mergedImages?.length ? mergedImages : undefined };
    }));
    setEditingId(null);
    setEditText("");
    setEditMinWidth(null);
    setEditPendingImages([]);
    setEditDragOver(false);
    try {
      const sec = await ideaGetSection(section.id);
      if (sec) {
        const data = JSON.parse(sec.content);
        const target = data.messages.find((m: any) => m.id === editId);
        if (target) {
          target.text = trimmed;
          target.editedAt = Date.now();
          if (newImages.length > 0) {
            target.images = [...(target.images || []), ...newImages];
          }
          await ideaSaveSection(section.id, sec.title, JSON.stringify(data));

          // Sync edit to linked kanban card
          if (data.kanbanId) {
            try {
              const kanbanSection = await ideaGetSection(data.kanbanId);
              if (kanbanSection) {
                const kanbanData = JSON.parse(kanbanSection.content);
                for (const col of kanbanData.columns ?? []) {
                  const card = col.cards.find((c: any) => c.sourceMessageId === editId);
                  if (card) {
                    const lines = trimmed.split("\n");
                    card.title = lines[0] || trimmed;
                    card.description = lines.slice(1).join("\n").trim();
                    card.updatedAt = new Date().toISOString();
                    await ideaSaveSection(data.kanbanId, kanbanSection.title, JSON.stringify(kanbanData));
                    break;
                  }
                }
              }
            } catch { /* kanban may be deleted */ }
          }
        }
      }
    } catch (e) {
      console.error('Failed to edit idea message:', e);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText("");
    setEditMinWidth(null);
    setEditPendingImages([]);
    setEditDragOver(false);
  };

  // Auto-resize edit textarea
  useEffect(() => {
    if (editingId && editTextareaRef.current) {
      const ta = editTextareaRef.current;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    }
  }, [editingId]);

  const handleToggleCompleted = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;
    const newCompleted = !msg.completed;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, completed: newCompleted } : m));
    try {
      const sec = await ideaGetSection(section.id);
      if (sec) {
        const data = JSON.parse(sec.content);
        const target = data.messages.find((m: any) => m.id === msgId);
        if (target) {
          target.completed = newCompleted;
          await ideaSaveSection(section.id, sec.title, JSON.stringify(data));

          // Sync completed to linked kanban: move card to/from isDone column
          if (data.kanbanId) {
            try {
              const kanbanSection = await ideaGetSection(data.kanbanId);
              if (kanbanSection) {
                const kanbanData = JSON.parse(kanbanSection.content);
                const cols = kanbanData.columns ?? [];
                const doneCol = cols.find((c: any) => c.isDone);
                const firstCol = cols[0];
                if (doneCol && firstCol && cols.length >= 2) {
                  for (const col of cols) {
                    const cardIdx = col.cards.findIndex((c: any) => c.sourceMessageId === msgId);
                    if (cardIdx !== -1) {
                      const card = col.cards[cardIdx];
                      if (newCompleted && !col.isDone) {
                        col.cards.splice(cardIdx, 1);
                        doneCol.cards.push(card);
                      } else if (!newCompleted && col.isDone) {
                        col.cards.splice(cardIdx, 1);
                        firstCol.cards.push(card);
                      }
                      await ideaSaveSection(data.kanbanId, kanbanSection.title, JSON.stringify(kanbanData));
                      break;
                    }
                  }
                }
              }
            } catch { /* kanban may be deleted */ }
          }
        }
      }
    } catch { /* ignore */ }
  };

  // --- Message context menu (right-click) ---

  const handleMsgContextMenu = useCallback((e: React.MouseEvent, msgId: string) => {
    e.preventDefault();
    const MENU_W = 200, MENU_H = 120;
    const x = Math.min(e.clientX, window.innerWidth - MENU_W);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H);
    setMsgContextMenu({ msgId, x, y });
  }, []);

  // Close msg context menu on click outside or Escape
  useEffect(() => {
    if (!msgContextMenu) return;
    const close = () => setMsgContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", handleKey); };
  }, [msgContextMenu]);

  const moveIdeaMessage = async (msgId: string, position: "top" | "bottom") => {
    setMsgContextMenu(null);
    try {
      const sec = await ideaGetSection(section.id);
      if (!sec) return;
      const data = JSON.parse(sec.content);
      const msgs = data.messages;
      if (!msgs) return;
      const idx = msgs.findIndex((m: any) => m.id === msgId);
      if (idx === -1) return;
      const [msg] = msgs.splice(idx, 1);
      if (position === "top") msgs.unshift(msg);
      else msgs.push(msg);
      await ideaSaveSection(section.id, sec.title, JSON.stringify(data));

      // Sync to linked kanban
      if (data.kanbanId) {
        try {
          const kanbanSection = await ideaGetSection(data.kanbanId);
          if (!kanbanSection) throw new Error("kanban not found");
          const kanbanData = JSON.parse(kanbanSection.content);
          for (const col of kanbanData.columns ?? []) {
            const cardIdx = col.cards.findIndex((c: any) => c.sourceMessageId === msgId);
            if (cardIdx !== -1) {
              const [card] = col.cards.splice(cardIdx, 1);
              if (position === "top") col.cards.unshift(card);
              else col.cards.push(card);
              await ideaSaveSection(data.kanbanId, kanbanSection.title, JSON.stringify(kanbanData));
              break;
            }
          }
        } catch { /* kanban may be deleted */ }
      }

      // Reload messages
      const updated = await getIdeaMessages(section.id);
      setMessages(updated);
    } catch { /* ignore */ }
  };

  // AI processing handlers
  const handleProcessIdeas = (mode: IdeaProcessingMode) => {
    setProcessingDropdown(false);
    processIdeaWithLLM(section.id, mode);
  };

  const handleApplyProcessing = async (result: IdeaProcessingResult) => {
    setShowProcessingPreview(false);
    await applyIdeaProcessingResult(section.id, result);
    const updated = await getIdeaMessages(section.id);
    setMessages(updated);
  };

  const handleCancelProcessing = () => {
    setShowProcessingPreview(false);
    clearIdeaProcessingTask();
  };

  // Close processing dropdown on click outside
  useEffect(() => {
    if (!processingDropdown) return;
    const close = (e: MouseEvent) => {
      if (processingDropdownRef.current && !processingDropdownRef.current.contains(e.target as Node)) {
        setProcessingDropdown(false);
      }
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [processingDropdown]);

  // Close sort dropdown on click outside
  useEffect(() => {
    if (!sortDropdown) return;
    const close = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdown(false);
      }
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [sortDropdown]);

  const canSend = input.trim() || pendingImages.length > 0;

  return (
    <div className="idea-chat">
      <div className="idea-chat-header">
        <button
          className="idea-chat-search-btn"
          onClick={() => { setLocalSearch(!localSearch); if (!localSearch) setTimeout(() => localSearchRef.current?.focus(), 50); else setLocalQuery(""); }}
          title={t("search") + " (Ctrl+F)"}
        >
          <Search size={16} />
        </button>
        {hasLlmAccess && messages.length > 1 && (
          <div className="idea-processing-dropdown-wrapper" ref={processingDropdownRef}>
            <button
              className="idea-chat-search-btn"
              onClick={(e) => { e.stopPropagation(); setProcessingDropdown(!processingDropdown); }}
              disabled={llmLoading || generatingFor !== null || isProcessing}
              title={t("processIdeas")}
            >
              {isProcessing ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            </button>
            {processingDropdown && (
              <div className="idea-processing-dropdown">
                <button onClick={() => handleProcessIdeas("title")}><Type size={14} /> {t("ideaProcessTitle")}</button>
                <button onClick={() => handleProcessIdeas("polish")}><Wand2 size={14} /> {t("ideaProcessPolish")}</button>
                <button onClick={() => handleProcessIdeas("deduplicate")}><Layers size={14} /> {t("ideaProcessDeduplicate")}</button>
                <button onClick={() => handleProcessIdeas("group")}><FolderOpen size={14} /> {t("ideaProcessGroup")}</button>
                <div className="idea-processing-dropdown-divider" />
                <button onClick={() => handleProcessIdeas("full")}><Sparkles size={14} /> {t("ideaProcessFull")}</button>
              </div>
            )}
          </div>
        )}
        {showGrouped && messages.some((m: any) => m.group) && (
          <button
            className="idea-chat-search-btn idea-chat-ungroup-btn"
            onClick={() => setSectionPref(section.id, "grouping", false)}
            title={t("ideaProcessUngroupBtn")}
          >
            <Layers size={14} />
            <X size={10} className="idea-chat-ungroup-x" />
          </button>
        )}
        {!showGrouped && messages.some((m: any) => m.group) && (
          <button
            className="idea-chat-search-btn"
            onClick={() => setSectionPref(section.id, "grouping", true)}
            title={t("ideaProcessGroup")}
          >
            <Layers size={14} />
          </button>
        )}
        {!isTrash && messages.length > 1 && (
          <div className="idea-sort-dropdown-wrapper" ref={sortDropdownRef}>
            <button
              className={`idea-chat-search-btn${ideaSort ? " idea-chat-sort-active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setSortDropdown(!sortDropdown); }}
              title={ideaSort ? t("ideaSortActive", ideaSort) : t("ideaSortLabel")}
            >
              <ArrowDownUp size={14} />
            </button>
            {sortDropdown && (
              <div className="idea-sort-dropdown">
                <button
                  className={!ideaSort ? "active" : ""}
                  onClick={() => { setSortDropdown(false); setSectionPref(section.id, "ideaSort", null); }}
                >
                  {t("ideaSortNone")}
                </button>
                <div className="idea-sort-dropdown-divider" />
                {([
                  ["progress:desc", t("ideaSortProgressDesc")],
                  ["progress:asc",  t("ideaSortProgressAsc")],
                  ["completed:desc", t("ideaSortCompletedFirst")],
                  ["completed:asc", t("ideaSortIncompleteFirst")],
                  ["plan:desc",     t("ideaSortWithPlanFirst")],
                  ["plan:asc",      t("ideaSortWithoutPlanFirst")],
                ] as [string, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    className={ideaSort === key ? "active" : ""}
                    onClick={() => {
                      setSortDropdown(false);
                      setSectionPref(section.id, "ideaSort", key);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <input
          className="idea-chat-title"
          value={section.title}
          placeholder="Untitled"
          onChange={(e) => renameSection(section.id, e.target.value)}
        />
      </div>
      {localSearch && (
        <div className="idea-chat-local-search">
          <Search size={14} className="idea-chat-local-search-icon" />
          <input
            ref={localSearchRef}
            className="idea-chat-local-search-input"
            placeholder={t("ideaSearchPlaceholder")}
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) && matchIndices.length > 0) {
                e.preventDefault();
                const next = (matchCursor + 1) % matchIndices.length;
                setMatchCursor(next);
                scrollToMatch(next);
              }
              if ((e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) && matchIndices.length > 0) {
                e.preventDefault();
                const prev = (matchCursor - 1 + matchIndices.length) % matchIndices.length;
                setMatchCursor(prev);
                scrollToMatch(prev);
              }
              if (e.key === "Escape") { setLocalSearch(false); setLocalQuery(""); }
            }}
          />
          {localQuery && matchIndices.length > 0 && (
            <span className="idea-chat-local-search-count">
              {matchCursor + 1}/{matchIndices.length}
            </span>
          )}
          {localQuery && matchIndices.length > 1 && (
            <>
              <button className="idea-chat-local-search-nav" onClick={() => { const prev = (matchCursor - 1 + matchIndices.length) % matchIndices.length; setMatchCursor(prev); scrollToMatch(prev); }}>
                <ChevronUp size={14} />
              </button>
              <button className="idea-chat-local-search-nav" onClick={() => { const next = (matchCursor + 1) % matchIndices.length; setMatchCursor(next); scrollToMatch(next); }}>
                <ChevronDown size={14} />
              </button>
            </>
          )}
          <button className="idea-chat-local-search-close" onClick={() => { setLocalSearch(false); setLocalQuery(""); }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="idea-chat-messages-wrapper">
      <div className="idea-chat-messages" ref={messagesContainerRef} onScroll={checkScrollPosition}>
        {messages.length === 0 && (
          <div className="idea-chat-empty">
            {isTrash ? (
              <>
                <Trash2 size={24} />
                <span>{t("trashEmptyHint")}</span>
              </>
            ) : (
              <>
                <Zap size={24} />
                <span>{t("ideaEmptyHint")}</span>
              </>
            )}
          </div>
        )}
        {(() => {
          // Group messages for rendering
          const hasGroups = showGrouped && messages.some((m: any) => m.group);
          let lastGroup: string | null = null;
          let sortedMessages = hasGroups
            ? [...messages].sort((a: any, b: any) => {
                const ga = (a as any).group || "";
                const gb = (b as any).group || "";
                if (ga !== gb) return ga.localeCompare(gb);
                return a.createdAt - b.createdAt;
              })
            : messages;
          if (ideaSort) {
            const [field, dir] = ideaSort.split(":");
            sortedMessages = [...sortedMessages].sort((a, b) => {
              let va: number, vb: number;
              if (field === "progress") {
                va = a.progress ?? 0; vb = b.progress ?? 0;
              } else if (field === "completed") {
                va = a.completed ? 1 : 0; vb = b.completed ? 1 : 0;
              } else {
                va = a.planId ? 1 : 0; vb = b.planId ? 1 : 0;
              }
              return dir === "desc" ? vb - va : va - vb;
            });
          }

          return sortedMessages.map((msg) => {
            const msgGroup = (msg as any).group as string | undefined;
            const msgTitle = (msg as any).title as string | undefined;
            const showGroupHeader = hasGroups && msgGroup && msgGroup !== lastGroup;
            if (hasGroups && msgGroup) lastGroup = msgGroup;

            return (
              <div key={msg.id}>
                {showGroupHeader && (
                  <div className="idea-chat-group-header">
                    <FolderOpen size={13} />
                    <span>{msgGroup}</span>
                  </div>
                )}
                <div data-msg-id={msg.id} data-plan-id={msg.planId || undefined} className={`idea-chat-msg${msg.completed ? " idea-chat-msg--completed" : ""}${generatingFor === msg.id ? " idea-chat-msg--generating" : ""}`} onContextMenu={(e) => handleMsgContextMenu(e, msg.id)}>
            <div className="idea-chat-msg-bubble" style={editingId === msg.id && editMinWidth ? { minWidth: editMinWidth } : undefined}>
              {editingId === msg.id ? (() => {
                const existingCount = msg.images?.length || 0;
                const totalCount = existingCount + editPendingImages.length;
                return (
                  <div
                    className={`idea-chat-edit-area${editDragOver ? " idea-chat-edit-area--dragover" : ""}`}
                    onDrop={(e) => handleEditDrop(e, existingCount)}
                    onDragOver={handleEditDragOver}
                    onDragLeave={handleEditDragLeave}
                  >
                    <textarea
                      ref={editTextareaRef}
                      className="idea-chat-edit-textarea"
                      value={editText}
                      onChange={(e) => {
                        setEditText(e.target.value);
                        const ta = e.target;
                        ta.style.height = "auto";
                        ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                        if (e.key === "Escape") handleCancelEdit();
                      }}
                      onBlur={(e) => {
                        // Don't save on blur if clicking edit-area buttons (attach, remove image)
                        if (e.relatedTarget && (e.currentTarget.parentElement?.contains(e.relatedTarget as Node))) return;
                        handleSaveEdit();
                      }}
                      onPaste={(e) => handleEditPaste(e, existingCount)}
                    />
                    {editPendingImages.length > 0 && (
                      <div className="idea-chat-pending-images">
                        {editPendingImages.map(img => (
                          <div key={img.id} className="idea-chat-pending-image">
                            <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} />
                            <button
                              className="idea-chat-pending-image-remove"
                              onClick={() => removeEditPendingImage(img.id)}
                              title={t("removeAttachment")}
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="idea-chat-edit-actions">
                      <button
                        className="idea-chat-attach-btn"
                        onClick={() => handleEditAttachImages(existingCount)}
                        title={t("attachImages")}
                        disabled={totalCount >= MAX_IMAGES_PER_MESSAGE}
                      >
                        <Paperclip size={14} />
                      </button>
                    </div>
                  </div>
                );
              })() : (
                <>
                  {msgTitle && <div className="idea-chat-msg-title">{msgTitle}</div>}
                  {msg.text && <div className="idea-chat-msg-text" onDoubleClick={(e) => handleStartEdit(msg, e)}>{msg.text}</div>}
                </>
              )}
              {msg.images && msg.images.length > 0 && (
                <div className="idea-chat-msg-images">
                  {msg.images.map((img, idx) => (
                    <img
                      key={img.id || idx}
                      src={`data:${img.mediaType};base64,${img.data}`}
                      alt={img.name}
                      className="idea-chat-msg-image"
                      loading="lazy"
                      onClick={() => openLightbox(msg.images!, idx)}
                      onContextMenu={(e) => handleImageContextMenu(e, msg.id, img.id)}
                    />
                  ))}
                </div>
              )}
              <div className="idea-chat-msg-footer">
                <span className="idea-chat-msg-time">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                {msg.editedAt && (
                  <span className="idea-chat-msg-edited">{t("edited")}</span>
                )}
                {isTrash && (msg as any).deletedAt && (
                  <span className="idea-chat-msg-trash-meta">
                    {t("trashDeletedFrom", (msg as any).fromSectionTitle || "?", (msg as any).fromProjectName || "?")}
                    {" \u2022 "}
                    {new Date((msg as any).deletedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <div className="idea-chat-msg-footer-row">
            {!isTrash && (
              <IdeaProgressButton
                progress={msg.progress ?? 0}
                stages={progressStages.length > 0 ? progressStages : DEFAULT_PROGRESS_STAGES}
                onProgressChange={(val) => handleMsgProgressChange(msg.id, val)}
              />
            )}
            {isTrash ? (
              <div className="idea-chat-msg-actions idea-chat-msg-actions--visible">
                <button
                  className="idea-chat-msg-action-btn"
                  onClick={() => handleRestore(msg.id)}
                  title={t("trashRestore")}
                >
                  <Undo2 size={12} />
                </button>
                <button
                  className="idea-chat-msg-action-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(msg.text);
                    setCopiedId(msg.id);
                    setTimeout(() => setCopiedId(null), 1500);
                  }}
                  title={t("copy")}
                >
                  {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <button
                  className="idea-chat-msg-action-btn idea-chat-msg-action-btn--danger"
                  onClick={() => handlePermanentDelete(msg.id)}
                  title={t("trashPermanentDelete")}
                >
                  <XCircle size={12} />
                </button>
              </div>
            ) : (
            <div className={`idea-chat-msg-actions${generatingFor === msg.id ? " idea-chat-msg-actions--visible" : ""}`}>
              {generatingFor === msg.id ? (
                <div className="idea-chat-msg-action-btn" style={{ cursor: "default" }}>
                  <Loader2 size={12} className="spin" style={{ color: "var(--text-secondary)" }} />
                </div>
              ) : hasLlmAccess && (
                <button
                  className="idea-chat-msg-action-btn"
                  onClick={() => handleExpandToPlan(msg)}
                  disabled={llmLoading || generatingFor !== null}
                  title={msg.planId ? t("regeneratePlan") : t("createPlan")}
                >
                  {msg.planId ? <RotateCcw size={12} /> : <Zap size={12} />}
                </button>
              )}
              <button
                className={`idea-chat-msg-action-btn${msg.completed ? " idea-chat-msg-action-btn--done" : ""}`}
                onClick={() => handleToggleCompleted(msg.id)}
                title={msg.completed ? t("markNotDone") : t("markDone")}
              >
                <CircleCheck size={12} />
              </button>
              <button
                className={`idea-chat-msg-action-btn${editingId === msg.id ? " idea-chat-msg-action-btn--active" : ""}`}
                onClick={() => handleStartEdit(msg)}
                title={t("edit")}
              >
                <Pencil size={12} />
              </button>
              <button
                className="idea-chat-msg-action-btn"
                onClick={() => {
                  navigator.clipboard.writeText(msg.text);
                  setCopiedId(msg.id);
                  setTimeout(() => setCopiedId(null), 1500);
                }}
                title={t("copy")}
              >
                {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button
                className="idea-chat-msg-action-btn idea-chat-msg-action-btn--danger"
                onClick={() => handleDelete(msg.id)}
                title={t("delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
            )}
            </div>
            {msg.planId && (
              <div className="idea-chat-plan-row">
                <IdeaPlanCard planId={msg.planId} onNavigate={onNavigate} />
                <div className="idea-chat-msg-actions">
                  <button
                    className={`idea-chat-msg-action-btn${msg.completed ? " idea-chat-msg-action-btn--done" : ""}`}
                    onClick={() => handleToggleCompleted(msg.id)}
                    title={msg.completed ? t("markNotDone") : t("markDone")}
                  >
                    <CircleCheck size={12} />
                  </button>
                  <button
                    className="idea-chat-msg-action-btn idea-chat-msg-action-btn--danger"
                    onClick={() => handleDeletePlan(msg)}
                    title={t("deletePlan")}
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    className="idea-chat-msg-action-btn"
                    onClick={async () => {
                      try {
                        const st = useAppStore.getState();
                        if (st.sectionSource === "user") {
                          await window.api.user.copySectionAsMarkdown(msg.planId!);
                        } else if (currentProject?.token) {
                          const copyToken = st.activeSectionToken || currentProject.token;
                          await window.api.copySectionAsMarkdown(copyToken, msg.planId!);
                        } else { return; }
                        setCopiedPlanId(msg.planId!);
                        setTimeout(() => setCopiedPlanId(null), 1500);
                      } catch { /* ignore */ }
                    }}
                    title={t("copyAsMarkdown")}
                  >
                    {copiedPlanId === msg.planId ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            )}
          </div>
              </div>
            );
          });
        })()}
        <div ref={messagesEndRef} />
      </div>

      {showScrollDown && (
        <button className="idea-chat-scroll-down" onClick={scrollToBottom}>
          <ArrowDown size={18} />
        </button>
      )}
      </div>

      {isTrash ? (
        messages.length > 0 && (
          <div className="idea-chat-input-area">
            <div className="idea-chat-input-row" style={{ justifyContent: "center" }}>
              <button
                className="idea-chat-msg-action-btn idea-chat-msg-action-btn--danger"
                onClick={handleEmptyTrash}
                style={{ padding: "6px 16px", fontSize: 13, gap: 6, display: "flex", alignItems: "center" }}
              >
                <Trash2 size={14} />
                {t("trashEmptyTrash")}
              </button>
            </div>
          </div>
        )
      ) : (
      <div
        className={`idea-chat-input-area${dragOver ? " idea-chat-input-area--dragover" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {pendingImages.length > 0 && (
          <div className="idea-chat-pending-images">
            {pendingImages.map(img => (
              <div key={img.id} className="idea-chat-pending-image">
                <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} />
                <button
                  className="idea-chat-pending-image-remove"
                  onClick={() => removePendingImage(img.id)}
                  title={t("removeAttachment")}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="idea-chat-input-row">
          <button
            className="idea-chat-attach-btn"
            onClick={handleAttachImages}
            title={t("attachImages")}
            disabled={pendingImages.length >= MAX_IMAGES_PER_MESSAGE}
          >
            <Paperclip size={16} />
          </button>
          <VoiceButton
            onTranscript={(text) => setInput((prev) => prev ? prev + " " + text : text)}
            disabled={generatingFor !== null}
            size={16}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("ideaPlaceholder")}
            rows={1}
          />
          <button
            className="idea-chat-send-btn"
            onClick={handleSend}
            disabled={!canSend}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
      )}

      {imageMenu && (
        <div
          className="idea-chat-image-menu"
          style={{ top: imageMenu.y, left: imageMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={handleCopyImage}>{t("copyImage")}</button>
          <button className="danger" onClick={handleDeleteImage}>{t("deleteImage")}</button>
        </div>
      )}

      {msgContextMenu && (
        <div
          className="idea-chat-image-menu"
          style={{ top: msgContextMenu.y, left: msgContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => moveIdeaMessage(msgContextMenu.msgId, "top")}>{t("kanbanMoveToTop")}</button>
          <button onClick={() => moveIdeaMessage(msgContextMenu.msgId, "bottom")}>{t("kanbanMoveToBottom")}</button>
        </div>
      )}

      {showProcessingPreview && ideaProcessingTask?.result && ideaProcessingTask.originalMessages && (
        <IdeaProcessingPreview
          result={ideaProcessingTask.result}
          originalMessages={ideaProcessingTask.originalMessages}
          onApply={handleApplyProcessing}
          onCancel={handleCancelProcessing}
        />
      )}

      {lightbox && lightbox.index < lightbox.images.length && (
        <div className="idea-chat-lightbox" onClick={closeLightbox}>
          <img
            src={`data:${lightbox.images[lightbox.index].mediaType};base64,${lightbox.images[lightbox.index].data}`}
            alt=""
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.images.length > 1 && (
            <div className="idea-chat-lightbox-nav" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setLightbox(prev => prev && ({ ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length }))}>&#8592;</button>
              <span>{lightbox.index + 1} / {lightbox.images.length}</span>
              <button onClick={() => setLightbox(prev => prev && ({ ...prev, index: (prev.index + 1) % prev.images.length }))}>&#8594;</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
