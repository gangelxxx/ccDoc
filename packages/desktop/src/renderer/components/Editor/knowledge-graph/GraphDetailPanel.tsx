import { X, ExternalLink } from "lucide-react";
import { useT } from "../../../i18n.js";
import type { SimNode, SimEdge } from "./types.js";

const NODE_TYPE_COLORS: Record<string, string> = {
  idea: "#AFA9EC",
  doc: "#85B7EB",
  section: "#5DCAA5",
  session: "#E8A96E",
};

interface Connection {
  nodeId: string;
  sectionId: string;
  messageId: string;
  label: string;
  nodeType: string;
  edgeType: string;
  weight: number;
}

function resolveId(ref: string | SimNode): string {
  return typeof ref === "string" ? ref : ref.id;
}

interface GraphDetailPanelProps {
  node: SimNode;
  edges: SimEdge[];
  nodes: SimNode[];
  minWeight?: number;
  onClose: () => void;
  onNavigateToSection: (sectionId: string, messageId?: string, nodeType?: string) => void;
}

export function GraphDetailPanel({
  node,
  edges,
  nodes,
  minWeight = 0,
  onClose,
  onNavigateToSection,
}: GraphDetailPanelProps) {
  const t = useT();

  // Build connections list
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  // First collect this node's edges, then apply percentile to them
  const nodeEdges = edges.filter((e) => {
    const s = resolveId(e.source);
    const tgt = resolveId(e.target);
    return s === node.id || tgt === node.id;
  });

  const weightCutoff = (() => {
    if (minWeight <= 0 || nodeEdges.length === 0) return 0;
    const sorted = nodeEdges.map((e) => e.weight).sort((a, b) => a - b);
    const idx = Math.min(Math.floor(sorted.length * minWeight), sorted.length - 1);
    return sorted[idx] ?? 0;
  })();

  const connections: Connection[] = nodeEdges
    .filter((e) => e.weight >= weightCutoff)
    .map((e) => {
      const s = resolveId(e.source);
      const tgt = resolveId(e.target);
      const otherId = s === node.id ? tgt : s;
      const other = nodesById.get(otherId);
      return {
        nodeId: otherId,
        sectionId: other?.section_id ?? "",
        messageId: other?.message_id ?? "",
        label: other?.label ?? otherId,
        nodeType: other?.node_type ?? "section",
        edgeType: e.edge_type,
        weight: e.weight,
      };
    })
    .sort((a, b) => b.weight - a.weight);

  return (
    <div className="kg-detail">
      <div className="kg-detail-header">
        <div className="kg-detail-title-row">
          <span
            className="kg-detail-type-badge"
            style={{ backgroundColor: NODE_TYPE_COLORS[node.node_type] ?? "#999" }}
          >
            {node.node_type}
          </span>
          <h3 className="kg-detail-name">{node.label}</h3>
        </div>
        <button className="kg-detail-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {node.summary && <p className="kg-detail-summary">{node.summary}</p>}

      <button
        className="btn btn-primary kg-detail-navigate"
        onClick={() => onNavigateToSection(node.section_id, node.message_id || undefined, node.node_type)}
      >
        <ExternalLink size={14} />
        {t("kgGoToSection")}
      </button>

      {connections.length > 0 && (
        <div className="kg-detail-connections">
          <h4>{t("kgConnections")} ({connections.length})</h4>
          <ul className="kg-detail-connection-list">
            {connections.map((c) => (
              <li
                key={c.nodeId}
                className="kg-detail-connection"
                onClick={() => onNavigateToSection(c.sectionId, c.messageId || undefined, c.nodeType)}
              >
                <span
                  className="kg-detail-connection-dot"
                  style={{ backgroundColor: NODE_TYPE_COLORS[c.nodeType] ?? "#999" }}
                />
                <span className="kg-detail-connection-label">{c.label}</span>
                <span className="kg-detail-connection-weight">
                  {Math.round(c.weight * 100)}%
                </span>
                <span className="kg-detail-connection-type">{c.edgeType.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
