import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationLinkDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { drag, type D3DragEvent } from "d3-drag";
import { type SimNode, type SimEdge, type NodeColors, DEFAULT_NODE_COLORS, toEdgeColor } from "./types.js";

const DIM_OPACITY = 0.08;

/** Adaptive forces — spread nodes proportionally to count */
function adaptiveForces(nodeCount: number, edgeCount: number) {
  const scale = Math.max(1, Math.sqrt(nodeCount / 20));
  // Dense graphs (high edge/node ratio) need stronger repulsion
  const density = nodeCount > 0 ? edgeCount / nodeCount : 0;
  const densityBoost = Math.max(1, density / 2);
  return {
    charge: -600 * scale * densityBoost,
    linkDistance: 200 * scale,
    collide: 30 + scale * 10,
  };
}

// ---------- Props ----------

interface GraphCanvasProps {
  nodes: SimNode[];
  edges: SimEdge[];
  selectedNodeId: string | null;
  onSelectNode: (node: SimNode | null) => void;
  onNavigateToSection: (sectionId: string, messageId?: string, nodeType?: string) => void;
  physicsPaused: boolean;
  visibleNodeTypes: string[];
  visibleEdgeTypes: string[];
  minWeight: number;
  centerKey: number;
  nodeColors?: NodeColors;
  /** Ref updated with latest node positions on each tick — for caching */
  positionsRef?: React.MutableRefObject<Record<string, { x: number; y: number }> | null>;
}

// ---------- Helpers ----------

function nodeRadius(degree: number): number {
  return Math.max(6, Math.min(20, 6 + degree * 2));
}

const EDGE_MIN_WIDTH = 0.5;
const EDGE_MAX_WIDTH = 4;

function resolveId(ref: string | SimNode): string {
  return typeof ref === "string" ? ref : ref.id;
}

// ---------- Component ----------

export function GraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onNavigateToSection,
  physicsPaused,
  visibleNodeTypes,
  visibleEdgeTypes,
  minWeight,
  centerKey,
  nodeColors: customColors,
  positionsRef,
}: GraphCanvasProps) {
  const colors = customColors ?? DEFAULT_NODE_COLORS;
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimulationLinkDatum<SimNode>> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setHoveredDebounced = useCallback((id: string | null) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (id === null) {
      // Delay unhover so transition finishes before resetting
      hoverTimerRef.current = setTimeout(() => setHoveredNodeId(null), 400);
    } else {
      setHoveredNodeId(id);
    }
  }, []);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });

  // Copy node positions from simulation into local state for React rendering
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [simEdges, setSimEdges] = useState<SimEdge[]>([]);

  // ---------- Filtered data ----------

  const filteredNodes = useMemo(
    () => simNodes.filter((n) => visibleNodeTypes.includes(n.node_type)),
    [simNodes, visibleNodeTypes],
  );

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes],
  );

  const filteredEdges = useMemo(() => {
    // First pass: filter by type and node visibility
    const typeFiltered = simEdges.filter((e) => {
      if (!visibleEdgeTypes.includes(e.edge_type)) return false;
      const srcId = resolveId(e.source);
      const tgtId = resolveId(e.target);
      return filteredNodeIds.has(srcId) && filteredNodeIds.has(tgtId);
    });

    if (minWeight <= 0) return typeFiltered;
    if (typeFiltered.length === 0) return typeFiltered;

    // Percentile-based: slider 30% = remove weakest 30% of edges
    const sorted = typeFiltered.map((e) => e.weight).sort((a, b) => a - b);
    const idx = Math.min(Math.floor(sorted.length * minWeight), sorted.length - 1);
    const cutoff = sorted[idx];

    return typeFiltered.filter((e) => e.weight >= cutoff);
  }, [simEdges, visibleEdgeTypes, minWeight, filteredNodeIds]);

  // ---------- Edge width (normalized to actual min/max) ----------

  const edgeWidthMap = useMemo(() => {
    const map = new Map<string, number>();
    if (filteredEdges.length === 0) return map;
    let wMin = Infinity, wMax = -Infinity;
    for (const e of filteredEdges) {
      if (e.weight < wMin) wMin = e.weight;
      if (e.weight > wMax) wMax = e.weight;
    }
    const range = wMax - wMin || 1;
    for (const e of filteredEdges) {
      const t = (e.weight - wMin) / range; // 0..1
      map.set(e.id, EDGE_MIN_WIDTH + t * (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH));
    }
    return map;
  }, [filteredEdges]);

  // ---------- Degree map (for filtered view) ----------

  const degreeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of filteredEdges) {
      const s = resolveId(e.source);
      const t = resolveId(e.target);
      m.set(s, (m.get(s) ?? 0) + 1);
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [filteredEdges]);

  // ---------- Highlight set (hovered or selected node + connected) ----------

  const highlightSet = useMemo(() => {
    const focusId = selectedNodeId ?? hoveredNodeId;
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const e of filteredEdges) {
      const s = resolveId(e.source);
      const t = resolveId(e.target);
      if (s === focusId) set.add(t);
      if (t === focusId) set.add(s);
    }
    return set;
  }, [hoveredNodeId, selectedNodeId, filteredEdges]);

  // ---------- Fit to view ----------

  const fitToView = useCallback((nodeList: SimNode[], animate = false) => {
    const svg = svgRef.current;
    const zoomBehavior = zoomRef.current;
    if (!svg || !zoomBehavior || nodeList.length === 0) return;

    const rect = svg.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;
    const padding = 60;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodeList) {
      if (n.x != null && n.y != null) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
    }
    if (!isFinite(minX)) return;

    const graphW = maxX - minX || 1;
    const graphH = maxY - minY || 1;
    const scale = Math.min((w - padding * 2) / graphW, (h - padding * 2) / graphH, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = w / 2 - cx * scale;
    const ty = h / 2 - cy * scale;

    const t = zoomIdentity.translate(tx, ty).scale(scale);
    if (animate) {
      select(svg).transition().duration(800).ease((t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2).call(zoomBehavior.transform, t);
    } else {
      select(svg).call(zoomBehavior.transform, t);
    }
  }, []);

  // ---------- D3 Force Simulation ----------

  useEffect(() => {
    // Filter nodes/edges by visible types before simulation
    const visibleSet = new Set(visibleNodeTypes);
    const simNodesCopy: SimNode[] = nodes
      .filter((n) => visibleSet.has(n.node_type))
      .map((n) => ({ ...n }));
    const nodeIdSet = new Set(simNodesCopy.map((n) => n.id));
    const simEdgesCopy: SimEdge[] = edges
      .filter((e) => nodeIdSet.has(e.source_id) && nodeIdSet.has(e.target_id))
      .map((e) => ({
        ...e,
        source: e.source_id,
        target: e.target_id,
      }));

    // Check if nodes already have positions (restored from cache)
    const hasPositions = simNodesCopy.some((n) => n.x != null && n.y != null);

    const forces = adaptiveForces(simNodesCopy.length, simEdgesCopy.length);

    const sim = forceSimulation<SimNode>(simNodesCopy)
      .force(
        "link",
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(simEdgesCopy as SimulationLinkDatum<SimNode>[])
          .id((d) => d.id)
          .distance(forces.linkDistance),
      )
      .force("charge", forceManyBody().strength(forces.charge))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(forces.collide))
      .on("tick", () => {
        setSimNodes([...simNodesCopy]);
        setSimEdges([...simEdgesCopy]);
        if (positionsRef) {
          const pos: Record<string, { x: number; y: number }> = {};
          for (const n of simNodesCopy) {
            if (n.x != null && n.y != null) pos[n.id] = { x: n.x, y: n.y };
          }
          positionsRef.current = pos;
        }
      });

    let fitTimer: ReturnType<typeof setTimeout> | undefined;
    if (hasPositions) {
      sim.alpha(0.05).alphaDecay(0.1);
      requestAnimationFrame(() => fitToView(simNodesCopy));
    } else {
      let fitted = false;
      sim.on("end", () => {
        if (fitted) return;
        fitted = true;
        fitToView(simNodesCopy);
      });
      fitTimer = setTimeout(() => {
        if (!fitted) { fitted = true; fitToView(simNodesCopy); }
      }, 1200);
    }

    simRef.current = sim;

    return () => {
      sim.stop();
      if (fitTimer) clearTimeout(fitTimer);
      simRef.current = null;
    };
  }, [nodes, edges, visibleNodeTypes]);

  // ---------- Pause / Resume physics ----------

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (physicsPaused) {
      sim.stop();
    } else {
      sim.alpha(0.3).restart();
    }
  }, [physicsPaused]);

  // ---------- Zoom ----------

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 8])
      .filter((event) => {
        // Don't zoom when dragging a node
        return !(event.target as Element)?.closest?.(".kg-node");
      })
      .on("zoom", (event) => {
        setTransform({ x: event.transform.x, y: event.transform.y, k: event.transform.k });
      });

    select(svg).call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  // ---------- Re-center on centerKey change ----------

  useEffect(() => {
    if (centerKey === 0) return;
    fitToView(simNodes);
  }, [centerKey, fitToView, simNodes]);

  // (auto-fit handled by simulation restart on visibleNodeTypes change)

  // ---------- Drag ----------

  const handleDragStart = useCallback(
    (event: D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) => {
      const sim = simRef.current;
      if (sim && !physicsPaused) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    },
    [physicsPaused],
  );

  const handleDrag = useCallback(
    (event: D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) => {
      d.fx = event.x;
      d.fy = event.y;
    },
    [],
  );

  const handleDragEnd = useCallback(
    (event: D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) => {
      const sim = simRef.current;
      if (sim && !physicsPaused) sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    },
    [physicsPaused],
  );

  // Attach drag behavior to each node circle
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const nodeIdToData = new Map<string, SimNode>();
    for (const n of simNodes) nodeIdToData.set(n.id, n);

    let draggedNode: SimNode | undefined;

    const dragBehavior = drag<SVGCircleElement, unknown>()
      .on("start", (event) => {
        const el = (event.sourceEvent.target as Element).closest?.("[data-node-id]");
        const id = el?.getAttribute("data-node-id");
        draggedNode = id ? nodeIdToData.get(id) : undefined;
        if (draggedNode) handleDragStart(event as any, draggedNode);
      })
      .on("drag", (event) => {
        if (draggedNode) handleDrag(event as any, draggedNode);
      })
      .on("end", (event) => {
        if (draggedNode) handleDragEnd(event as any, draggedNode);
        draggedNode = undefined;
      });

    select(svg)
      .selectAll<SVGCircleElement, unknown>("circle.kg-node")
      .call(dragBehavior);
  }, [simNodes, handleDragStart, handleDrag, handleDragEnd]);

  // ---------- Zoom to node (progressive) ----------

  const zoomToNode = useCallback((node: SimNode) => {
    // Defer to next frame so detail panel has rendered and SVG has correct size
    requestAnimationFrame(() => {
      const svg = svgRef.current;
      const zoomBehavior = zoomRef.current;
      if (!svg || !zoomBehavior || node.x == null || node.y == null) return;

      const rect = svg.getBoundingClientRect();
      const w = rect.width || 800;
      const h = rect.height || 600;
      const padding = 60;

      // Collect bounding box of node + all connected neighbours
      let minX = node.x, maxX = node.x, minY = node.y, maxY = node.y;
      const connectedIds = new Set<string>([node.id]);
      for (const e of filteredEdges) {
        const s = resolveId(e.source);
        const tgt = resolveId(e.target);
        if (s === node.id) connectedIds.add(tgt);
        if (tgt === node.id) connectedIds.add(s);
      }
      for (const n of simNodes) {
        if (connectedIds.has(n.id) && n.x != null && n.y != null) {
          minX = Math.min(minX, n.x);
          maxX = Math.max(maxX, n.x);
          minY = Math.min(minY, n.y);
          maxY = Math.max(maxY, n.y);
        }
      }

      const graphW = maxX - minX || 1;
      const graphH = maxY - minY || 1;
      const nextK = Math.min((w - padding * 2) / graphW, (h - padding * 2) / graphH, 3);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const nextX = w / 2 - cx * nextK;
      const nextY = h / 2 - cy * nextK;

      const t = zoomIdentity.translate(nextX, nextY).scale(nextK);
      select(svg).transition().duration(1000).ease((t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2).call(zoomBehavior.transform, t);
    });
  }, [filteredEdges, simNodes]);

  // ---------- Event handlers ----------

  const handleNodeClick = useCallback(
    (node: SimNode) => {
      onSelectNode(selectedNodeId === node.id ? null : node);
      zoomToNode(node);
    },
    [selectedNodeId, onSelectNode, zoomToNode],
  );

  const handleNodeDblClick = useCallback(
    (node: SimNode) => {
      onNavigateToSection(node.section_id, node.message_id || undefined, node.node_type);
    },
    [onNavigateToSection],
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as Element).tagName === "svg" || (e.target as Element).classList.contains("kg-canvas-bg")) {
        onSelectNode(null);
      }
    },
    [onSelectNode],
  );

  // ---------- Render ----------

  return (
    <svg ref={svgRef} className="kg-canvas" onClick={handleSvgClick}>
      <defs>
        {/* Node glow filter */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Arrow markers per node type */}
        {Object.entries(colors).map(([type, color]) => (
          <marker key={type} id={`arrow-${type}`} viewBox="0 0 10 8" refX="10" refY="4"
            markerWidth="10" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M1,1 L10,4 L1,7" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />
          </marker>
        ))}
        <marker id="arrow-muted" viewBox="0 0 10 8" refX="10" refY="4"
          markerWidth="10" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M1,1 L10,4 L1,7" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinejoin="round" opacity="0.5" />
        </marker>
      </defs>
      <rect className="kg-canvas-bg" width="100%" height="100%" fill="transparent" />
      <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
        {/* Edges */}
        {filteredEdges.map((e) => {
          const srcId = resolveId(e.source);
          const tgtId = resolveId(e.target);
          const srcNode = typeof e.source === "object" ? e.source : simNodes.find((n) => n.id === srcId);
          const tgtNode = typeof e.target === "object" ? e.target : simNodes.find((n) => n.id === tgtId);
          if (srcNode?.x == null || srcNode?.y == null || tgtNode?.x == null || tgtNode?.y == null) return null;

          const isHighlighted = highlightSet
            ? highlightSet.has(srcId) && highlightSet.has(tgtId)
            : true;

          // Shorten line so arrow tip stops at target node border
          const dx = tgtNode.x - srcNode.x;
          const dy = tgtNode.y - srcNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const tgtDeg = degreeMap.get(tgtId) ?? 0;
          const tgtR = nodeRadius(tgtDeg);
          const shortenBy = tgtR + 2; // +2 for small gap
          const x2 = tgtNode.x - (dx / dist) * shortenBy;
          const y2 = tgtNode.y - (dy / dist) * shortenBy;

          const isParentChild = e.edge_type === "parent_child";
          const srcType = (srcNode as SimNode).node_type ?? "doc";
          const edgeColor = isParentChild
            ? "rgba(160, 160, 160, 0.3)"
            : (toEdgeColor(colors[srcType] ?? "#999"));
          const markerId = isParentChild ? "arrow-muted" : `arrow-${srcType}`;

          return (
            <line
              key={e.id}
              className="kg-edge"
              x1={srcNode.x}
              y1={srcNode.y}
              x2={x2}
              y2={y2}
              stroke={edgeColor}
              strokeWidth={edgeWidthMap.get(e.id) ?? EDGE_MIN_WIDTH}
              strokeLinecap="round"
              opacity={highlightSet ? (isHighlighted ? 1 : DIM_OPACITY) : 0.8}
              markerEnd={`url(#${markerId})`}
            />
          );
        })}

        {/* Nodes */}
        {filteredNodes.map((n) => {
          if (n.x == null || n.y == null) return null;
          const deg = degreeMap.get(n.id) ?? n.degree;
          const r = nodeRadius(deg);
          const isSelected = n.id === selectedNodeId;
          const isHighlighted = highlightSet ? highlightSet.has(n.id) : true;
          const color = colors[n.node_type] ?? "#999";

          return (
            <g key={n.id} opacity={highlightSet ? (isHighlighted ? 1 : DIM_OPACITY) : 1}>
              {/* Soft glow behind node */}
              <circle
                cx={n.x}
                cy={n.y}
                r={r + 4}
                fill={color}
                opacity={0.15}
                filter="url(#glow)"
              />
              <circle
                className={`kg-node kg-node-${n.node_type}${isSelected ? " kg-node-selected" : ""}`}
                data-node-id={n.id}
                cx={n.x}
                cy={n.y}
                r={r}
                fill={color}
                stroke={isSelected ? "#fff" : color}
                strokeWidth={isSelected ? 2.5 : 1}
                strokeOpacity={isSelected ? 1 : 0.3}
                onClick={() => handleNodeClick(n)}
                onDoubleClick={() => handleNodeDblClick(n)}
                onMouseEnter={() => setHoveredDebounced(n.id)}
                onMouseLeave={() => setHoveredDebounced(null)}
              />
              {/* Label — visible only when zoomed in enough */}
              {transform.k >= 0.6 && (
                <text
                  className="kg-node-label"
                  x={n.x}
                  y={n.y - r - 4}
                  textAnchor="middle"
                  opacity={(highlightSet ? (isHighlighted ? 0.9 : DIM_OPACITY) : 0.9) * Math.min(1, (transform.k - 0.6) / 0.4)}
                  fontSize={Math.min(12, 10 / transform.k)}
                >
                  {n.label.length > 30 ? n.label.slice(0, 28) + "..." : n.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
