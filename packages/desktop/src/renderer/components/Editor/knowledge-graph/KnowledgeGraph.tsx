import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Share2 } from "lucide-react";
import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import { GraphCanvas } from "./GraphCanvas.js";
import { GraphToolbar } from "./GraphToolbar.js";
import { GraphDetailPanel } from "./GraphDetailPanel.js";
import type { KnowledgeGraphData } from "@ccdoc/core";
import { type SimNode, type SimEdge, type NodeColors, DEFAULT_NODE_COLORS } from "./types.js";

interface KnowledgeGraphProps {
  sectionId: string;
  initialContent: string;
}

type ViewState = "empty" | "analyzing" | "graph";

interface ProgressInfo {
  phase: string;
  current: number;
  total: number;
}

// Module-level cache — survives component unmount/remount
interface KgCacheEntry {
  viewState: ViewState;
  nodes: SimNode[];
  edges: SimEdge[];
  positions: Record<string, { x: number; y: number }> | null;
  physicsPaused: boolean;
  visibleNodeTypes: string[];
  minWeight: number;
}
const kgCache = new Map<string, KgCacheEntry>();

export function KnowledgeGraph({ sectionId, initialContent }: KnowledgeGraphProps) {
  const t = useT();
  const token = useAppStore((s) => s.currentProject?.token);
  const selectSection = useAppStore((s) => s.selectSection);
  const setScrollToMessageId = useAppStore((s) => s.setScrollToMessageId);
  const loadLlmSession = useAppStore((s) => s.loadLlmSession);
  const setLlmPanelOpen = useAppStore((s) => s.setLlmPanelOpen);

  // Restore from cache if available (keyed by sectionId, not token)
  const cached = useMemo(() => kgCache.get(sectionId), []);

  const [viewState, setViewState] = useState<ViewState>(cached?.viewState ?? "empty");
  const [progress, setProgress] = useState<ProgressInfo>({ phase: "", current: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nodes, setNodes] = useState<SimNode[]>(() => {
    if (!cached?.nodes) return [];
    // Merge cached positions into nodes
    const pos = cached.positions;
    if (!pos) return cached.nodes;
    return cached.nodes.map((n) => {
      const p = pos[n.id];
      return p ? { ...n, x: p.x, y: p.y } : n;
    });
  });
  const [edges, setEdges] = useState<SimEdge[]>(cached?.edges ?? []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [centerKey, setCenterKey] = useState(0);

  // Toolbar filter state
  const [physicsPaused, setPhysicsPaused] = useState(cached?.physicsPaused ?? false);
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<string[]>(cached?.visibleNodeTypes ?? ["idea", "doc", "section", "session"]);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<string[]>(["semantic_similar", "parent_child"]);
  const [minWeight, setMinWeight] = useState(cached?.minWeight ?? 0);

  // Ref for GraphCanvas to report latest positions
  const positionsRef = useRef<Record<string, { x: number; y: number }> | null>(cached?.positions ?? null);

  // Custom node colors (persisted in localStorage)
  const [nodeColors, setNodeColors] = useState<NodeColors>(() => {
    try {
      const saved = localStorage.getItem("kg-node-colors");
      return saved ? { ...DEFAULT_NODE_COLORS, ...JSON.parse(saved) } : { ...DEFAULT_NODE_COLORS };
    } catch { return { ...DEFAULT_NODE_COLORS }; }
  });

  const handleColorChange = useCallback((type: string, color: string) => {
    setNodeColors((prev) => {
      const next = { ...prev, [type]: color };
      localStorage.setItem("kg-node-colors", JSON.stringify(next));
      return next;
    });
  }, []);

  // Track whether we already loaded data once
  const loadedRef = useRef(false);

  // ---------- Save state to cache on unmount ----------

  const stateRef = useRef({ viewState, nodes, edges, physicsPaused, visibleNodeTypes, minWeight });
  stateRef.current = { viewState, nodes, edges, physicsPaused, visibleNodeTypes, minWeight };

  useEffect(() => {
    return () => {
      if (stateRef.current.viewState === "graph") {
        kgCache.set(sectionId, {
          ...stateRef.current,
          positions: positionsRef.current,
        });
      }
    };
  }, [token]);

  // ---------- Load existing graph on mount ----------

  const loadGraph = useCallback(async () => {
    if (!token) return;
    try {
      const data: KnowledgeGraphData = await window.api.kgGet(token);
      if (data.nodes.length > 0) {
        applyGraphData(data);
        setViewState("graph");
      }
    } catch {
      // No graph yet — stay in "empty"
    }
  }, [token]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    // Skip loading if restored from cache
    if (cached?.viewState === "graph") return;
    // Skip loading for new sections (no prior analysis)
    try {
      const parsed = JSON.parse(initialContent);
      if (!parsed.analyzedAt) return;
    } catch { /* not JSON — load anyway */ }
    loadGraph();
  }, [loadGraph]);

  // ---------- IPC listeners ----------

  useEffect(() => {
    const unsubProgress = window.api.onKgProgress((data) => {
      setProgress(data);
      setViewState("analyzing");
    });

    const unsubNodeUpdated = window.api.onKgNodeUpdated((_sid: string) => {
      // Reload full graph when any node is updated during analysis
      if (token) {
        window.api.kgGet(token).then((data: KnowledgeGraphData) => {
          applyGraphData(data);
          setViewState("graph");
        }).catch(() => {});
      }
    });

    return () => {
      unsubProgress();
      unsubNodeUpdated();
    };
  }, [token]);

  // ---------- Helpers ----------

  function applyGraphData(data: KnowledgeGraphData) {
    const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const simEdges: SimEdge[] = data.edges.map((e) => ({
      ...e,
      source: e.source_id,
      target: e.target_id,
    }));
    setNodes(simNodes);
    setEdges(simEdges);
  }

  // Sources selection dialog
  const [showSourcesDialog, setShowSourcesDialog] = useState(false);
  const [sources, setSources] = useState({ ideas: true, docs: true, sections: true, sessions: true });
  const [analyzedTypes, setAnalyzedTypes] = useState<string[] | undefined>(undefined);

  const handleStartAnalysis = useCallback(async (srcOverride?: typeof sources) => {
    if (!token) return;
    const src = srcOverride ?? sources;
    setShowSourcesDialog(false);
    setViewState("analyzing");
    setErrorMsg(null);
    setProgress({ phase: "init", current: 0, total: 0 });
    try {
      await window.api.kgAnalyze(token, src);
      const data: KnowledgeGraphData = await window.api.kgGet(token);
      applyGraphData(data);
      setViewState("graph");
      // Show only analyzed source types
      const typeMap: Record<string, string> = { ideas: "idea", docs: "doc", sections: "section", sessions: "session" };
      const types = Object.entries(src).filter(([, v]) => v).map(([k]) => typeMap[k]);
      setVisibleNodeTypes(types);
      setAnalyzedTypes(types);
      try {
        await window.api.kgSaveViewSettings(token, sectionId, JSON.stringify({
          analyzedAt: new Date().toISOString(), version: 1, sources: src,
        }));
      } catch { /* non-critical */ }
    } catch (err: any) {
      const data = await window.api.kgGet(token).catch(() => null);
      if (data && data.nodes.length > 0) {
        applyGraphData(data);
        setViewState("graph");
      } else {
        const msg = err?.message || String(err);
        const isEmbeddingIssue = msg.includes("Embedding") || msg.includes("onnxruntime") || msg.includes("embedding");
        setErrorMsg(isEmbeddingIssue ? t("kgNoEmbeddings") : msg);
        setViewState("empty");
      }
    }
  }, [token, sources]);

  const handleSelectNode = useCallback((node: SimNode | null) => {
    setSelectedNodeId(node?.id ?? null);
  }, []);

  const handleNavigateToSection = useCallback((sectionId: string, messageId?: string, nodeType?: string) => {
    if (nodeType === "session" && sectionId.startsWith("session:")) {
      // Extract session ID from "session:{sessionId}:{msgIndex}"
      const sessionId = sectionId.split(":")[1];
      if (sessionId) {
        loadLlmSession(sessionId);
        setLlmPanelOpen(true);
      }
      return;
    }
    selectSection(sectionId);
    if (messageId) setScrollToMessageId(messageId);
  }, [selectSection, setScrollToMessageId, loadLlmSession, setLlmPanelOpen]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  // ---------- Render ----------

  if (viewState === "empty") {
    return (
      <div className="kg-empty">
        <Share2 size={48} className="kg-empty-icon" />
        <h3 className="kg-empty-title">{t("kgEmpty")}</h3>
        <p className={`kg-empty-desc${errorMsg ? " kg-empty-error" : ""}`}>{errorMsg || t("kgEmptyDesc")}</p>
        <button className="btn btn-primary kg-empty-btn" onClick={() => setShowSourcesDialog(true)}>
          {t("kgStartAnalysis")}
        </button>
        {showSourcesDialog && (
          <div className="kg-sources-overlay" onClick={() => setShowSourcesDialog(false)}>
            <div className="kg-sources-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>{t("kgSelectSources")}</h3>
              {(["ideas", "docs", "sections", "sessions"] as const).map((key) => (
                <label key={key} className="kg-sources-item">
                  <input
                    type="checkbox"
                    checked={sources[key]}
                    onChange={() => setSources((p) => ({ ...p, [key]: !p[key] }))}
                  />
                  {t(({ ideas: "kgNodeIdeas", docs: "kgNodeDocs", sections: "kgNodeSections", sessions: "kgNodeSessions" })[key] as any)}
                </label>
              ))}
              <div className="kg-sources-actions">
                <button className="btn" onClick={() => setShowSourcesDialog(false)}>{t("cancel")}</button>
                <button className="btn btn-primary" onClick={() => handleStartAnalysis()}>{t("kgStartAnalysis")}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (viewState === "analyzing") {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
      <div className="kg-progress">
        <h3>{t("kgAnalyzing")}</h3>
        <div className="kg-progress-bar">
          <div className="kg-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="kg-progress-text">
          {progress.phase} — {progress.current}/{progress.total} ({pct}%)
        </p>
      </div>
    );
  }

  // viewState === "graph"
  return (
    <div className="kg-container">
      <GraphToolbar
        nodeCount={nodes.length}
        edgeCount={edges.length}
        physicsPaused={physicsPaused}
        onTogglePhysics={() => setPhysicsPaused((p) => !p)}
        visibleNodeTypes={visibleNodeTypes}
        onToggleNodeType={(type) =>
          setVisibleNodeTypes((prev) =>
            prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
          )
        }
        minWeight={minWeight}
        onMinWeightChange={setMinWeight}
        onReanalyze={() => setShowSourcesDialog(true)}
        onCenter={() => setCenterKey((k) => k + 1)}
        nodeColors={nodeColors}
        onColorChange={handleColorChange}
        analyzedTypes={analyzedTypes}
      />
      <div className="kg-body">
        <GraphCanvas
          centerKey={centerKey}
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          onNavigateToSection={handleNavigateToSection}
          physicsPaused={physicsPaused}
          visibleNodeTypes={visibleNodeTypes}
          visibleEdgeTypes={visibleEdgeTypes}
          minWeight={minWeight}
          nodeColors={nodeColors}
          positionsRef={positionsRef}
        />
        {selectedNode && (
          <GraphDetailPanel
            node={selectedNode}
            edges={edges}
            nodes={nodes}
            minWeight={minWeight}
            onClose={() => setSelectedNodeId(null)}
            onNavigateToSection={handleNavigateToSection}
          />
        )}
      </div>
      {showSourcesDialog && (
        <div className="kg-sources-overlay" onClick={() => setShowSourcesDialog(false)}>
          <div className="kg-sources-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t("kgSelectSources")}</h3>
            {(["ideas", "docs", "sections", "sessions"] as const).map((key) => (
              <label key={key} className="kg-sources-item">
                <input
                  type="checkbox"
                  checked={sources[key]}
                  onChange={() => setSources((p) => ({ ...p, [key]: !p[key] }))}
                />
                {t(({ ideas: "kgNodeIdeas", docs: "kgNodeDocs", sections: "kgNodeSections", sessions: "kgNodeSessions" })[key] as any)}
              </label>
            ))}
            <div className="kg-sources-actions">
              <button className="btn" onClick={() => setShowSourcesDialog(false)}>{t("cancel")}</button>
              <button className="btn btn-primary" onClick={() => handleStartAnalysis()}>{t("kgStartAnalysis")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
