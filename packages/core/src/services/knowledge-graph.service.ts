/**
 * Knowledge Graph Service — builds and maintains a semantic graph
 * connecting ideas, documents, and sections by similarity.
 */

import { v4 as uuid } from "uuid";
import type { Client } from "@libsql/client";
import type { Section, IdeaData, IdeaMessage } from "../types.js";
import type { SectionsRepo } from "../db/sections.repo.js";
import type { EmbeddingRepo, EmbeddingRow } from "../db/embedding.repo.js";
import type { IEmbeddingProvider } from "./embedding.service.js";
import { cosineSimilarity, textHash } from "./embedding.service.js";
import { extractTextForSearch } from "../converters/prosemirror-text-extractor.js";
import type { KGNode, KGEdge, KnowledgeGraphData } from "../knowledge-graph-types.js";

export type ProgressCallback = (phase: string, current: number, total: number) => void;

export interface ExternalNode {
  id: string;
  nodeType: "session";
  label: string;
  summary: string;
  textForEmbedding: string;
}

/** A pending node to be inserted — abstraction over sections and idea messages */
interface PendingNode {
  sectionId: string;
  messageId: string | null;
  nodeType: "idea" | "doc" | "section" | "session";
  label: string;
  summary: string;
  textForEmbedding: string;
  parentSectionId: string | null;
}

function extractDocText(section: Section): { summary: string; text: string } {
  if (!section.content) return { summary: section.title, text: section.title };
  try {
    const doc = JSON.parse(section.content);
    const plain = extractTextForSearch(doc);
    return { summary: plain.slice(0, 200), text: section.title + " " + plain };
  } catch {
    return { summary: section.title, text: section.title };
  }
}

function parseIdeaMessages(section: Section): IdeaMessage[] {
  if (!section.content) return [];
  try {
    const parsed = JSON.parse(section.content);
    if (parsed.type === "doc") return []; // legacy format
    return (parsed as IdeaData).messages || [];
  } catch {
    return [];
  }
}

export class KnowledgeGraphService {
  private db: Client;
  private sectionsRepo: SectionsRepo;
  private embeddingRepo: EmbeddingRepo;
  private embeddingModel: IEmbeddingProvider | null;

  constructor(
    db: Client,
    sectionsRepo: SectionsRepo,
    embeddingRepo: EmbeddingRepo,
    embeddingModel: IEmbeddingProvider | null,
  ) {
    this.db = db;
    this.sectionsRepo = sectionsRepo;
    this.embeddingRepo = embeddingRepo;
    this.embeddingModel = embeddingModel;
  }

  isAvailable(): boolean {
    return !!this.embeddingModel?.isAvailable();
  }

  // ─── Full analysis ───────────────────────────────────────────

  async analyze(
    options?: { minSimilarity?: number; topK?: number; sources?: { ideas?: boolean; docs?: boolean; sections?: boolean; sessions?: boolean } },
    onProgress?: ProgressCallback,
    externalNodes?: ExternalNode[],
  ): Promise<KnowledgeGraphData> {
    const minSim = options?.minSimilarity ?? 0.55;
    const topK = options?.topK ?? 10;
    // If sources provided, missing key = disabled; if not provided, all enabled
    const hasSrc = !!options?.sources;
    const src = options?.sources ?? {};

    // 1. Load all relevant sections and build pending nodes
    onProgress?.("loading", 0, 1);
    const allSections = await this.sectionsRepo.list(false);
    const pending: PendingNode[] = [];

    for (const s of allSections) {
      if (s.type === "idea" && (!hasSrc || src.ideas)) {
        // Each message in an idea = separate node
        const messages = parseIdeaMessages(s);
        for (const msg of messages) {
          const label = msg.text.split("\n")[0].slice(0, 80) || "Idea";
          pending.push({
            sectionId: s.id,
            messageId: msg.id,
            nodeType: "idea",
            label,
            summary: msg.text.slice(0, 200),
            textForEmbedding: msg.text,
            parentSectionId: s.parent_id,
          });
        }
      } else if (s.type === "file" && (!hasSrc || src.docs)) {
        const { summary, text } = extractDocText(s);
        pending.push({
          sectionId: s.id, messageId: null, nodeType: "doc",
          label: s.title, summary, textForEmbedding: text, parentSectionId: s.parent_id,
        });
      } else if (s.type === "section" && (!hasSrc || src.sections)) {
        const { summary, text } = extractDocText(s);
        pending.push({
          sectionId: s.id, messageId: null, nodeType: "section",
          label: s.title, summary, textForEmbedding: text, parentSectionId: s.parent_id,
        });
      }
    }

    // Append external nodes (e.g. LLM session messages)
    if (externalNodes) {
      for (const ext of externalNodes) {
        pending.push({
          sectionId: ext.id,
          messageId: "",
          nodeType: ext.nodeType,
          label: ext.label,
          summary: ext.summary,
          textForEmbedding: ext.textForEmbedding,
          parentSectionId: null,
        });
      }
    }

    if (pending.length === 0) {
      return { nodes: [], edges: [], analyzedAt: new Date().toISOString() };
    }

    // 2. Compute embeddings for all pending nodes
    // For idea messages we compute on-the-fly (not stored in section_embeddings)
    // For doc/section nodes we reuse existing section embeddings
    const allEmbeddings = await this.embeddingRepo.getAll();
    const sectionEmbMap = new Map<string, Float32Array>();
    for (const row of allEmbeddings) sectionEmbMap.set(row.section_id, row.embedding);

    let modelLoaded = false;
    if (this.embeddingModel?.isAvailable()) {
      modelLoaded = await this.embeddingModel.load().catch(() => false);
    }

    // nodeKey → embedding (nodeKey = sectionId or sectionId:messageId)
    const nodeEmbMap = new Map<string, Float32Array>();

    for (let i = 0; i < pending.length; i++) {
      onProgress?.("embedding", i + 1, pending.length);
      const p = pending[i];
      const key = p.messageId ? `${p.sectionId}:${p.messageId}` : p.sectionId;

      const isDbSection = !p.messageId && p.nodeType !== "session";

      if (isDbSection && sectionEmbMap.has(p.sectionId)) {
        // Reuse existing section embedding
        nodeEmbMap.set(key, sectionEmbMap.get(p.sectionId)!);
      } else if (modelLoaded && this.embeddingModel) {
        // Compute embedding
        const emb = await this.embeddingModel.encode(p.textForEmbedding);
        nodeEmbMap.set(key, emb);
        // Save to section_embeddings only for real DB sections
        if (isDbSection) {
          await this.embeddingRepo.upsert(p.sectionId, emb, textHash(p.textForEmbedding));
        }
      }
    }

    // 3. Upsert kg_nodes
    onProgress?.("nodes", 0, pending.length);
    // Clear old nodes first (full rebuild)
    await this.db.execute("DELETE FROM kg_edges");
    await this.db.execute("DELETE FROM kg_nodes");

    const nodeKeyToId = new Map<string, string>(); // nodeKey → kg_node.id

    for (const p of pending) {
      const nodeId = uuid();
      const key = p.messageId ? `${p.sectionId}:${p.messageId}` : p.sectionId;
      nodeKeyToId.set(key, nodeId);
      await this.db.execute({
        sql: `INSERT INTO kg_nodes (id, section_id, message_id, node_type, label, summary)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [nodeId, p.sectionId, p.messageId ?? "", p.nodeType, p.label, p.summary],
      });
    }

    // 4. Compute similarity edges
    const nodeKeys = [...nodeKeyToId.keys()].filter(k => nodeEmbMap.has(k));
    const totalPairs = (nodeKeys.length * (nodeKeys.length - 1)) / 2;
    let pairIdx = 0;

    const candidateEdges: { sourceNodeId: string; targetNodeId: string; weight: number }[] = [];

    for (let i = 0; i < nodeKeys.length; i++) {
      for (let j = i + 1; j < nodeKeys.length; j++) {
        pairIdx++;
        if (pairIdx % 500 === 0) onProgress?.("similarity", pairIdx, totalPairs);

        const embA = nodeEmbMap.get(nodeKeys[i])!;
        const embB = nodeEmbMap.get(nodeKeys[j])!;
        const sim = Math.min(1, Math.max(0, cosineSimilarity(embA, embB)));

        if (sim >= minSim) {
          const nodeA = nodeKeyToId.get(nodeKeys[i])!;
          const nodeB = nodeKeyToId.get(nodeKeys[j])!;
          candidateEdges.push({ sourceNodeId: nodeA, targetNodeId: nodeB, weight: sim });
        }
      }
    }

    // Top-K per node
    const edgeCountPerNode = new Map<string, number>();
    candidateEdges.sort((a, b) => b.weight - a.weight);

    for (const edge of candidateEdges) {
      const countA = edgeCountPerNode.get(edge.sourceNodeId) ?? 0;
      const countB = edgeCountPerNode.get(edge.targetNodeId) ?? 0;
      if (countA >= topK && countB >= topK) continue;

      await this.db.execute({
        sql: `INSERT INTO kg_edges (id, source_id, target_id, edge_type, weight, created_by)
              VALUES (?, ?, ?, 'semantic_similar', ?, 'system')
              ON CONFLICT(source_id, target_id, edge_type) DO UPDATE SET weight = excluded.weight`,
        args: [uuid(), edge.sourceNodeId, edge.targetNodeId, edge.weight],
      });

      edgeCountPerNode.set(edge.sourceNodeId, countA + 1);
      edgeCountPerNode.set(edge.targetNodeId, countB + 1);
    }

    // 5. Parent-child edges (doc/section only, not idea messages)
    for (const p of pending) {
      if (p.messageId || !p.parentSectionId) continue;
      const key = p.sectionId;
      const parentKey = p.parentSectionId;
      const childNodeId = nodeKeyToId.get(key);
      const parentNodeId = nodeKeyToId.get(parentKey);
      if (childNodeId && parentNodeId) {
        await this.db.execute({
          sql: `INSERT OR IGNORE INTO kg_edges (id, source_id, target_id, edge_type, weight, created_by)
                VALUES (?, ?, ?, 'parent_child', 1.0, 'system')`,
          args: [uuid(), parentNodeId, childNodeId],
        });
      }
    }

    onProgress?.("done", 1, 1);
    return this.getGraph();
  }

  // ─── Incremental sync ────────────────────────────────────────

  async syncNode(sectionId: string): Promise<void> {
    const section = await this.sectionsRepo.getById(sectionId);
    if (!section || section.deleted_at) {
      await this.removeNode(sectionId);
      return;
    }

    if (section.type === "idea") {
      // For ideas: remove all old message nodes and re-add
      await this.removeNode(sectionId);
      const messages = parseIdeaMessages(section);
      for (const msg of messages) {
        const label = msg.text.split("\n")[0].slice(0, 80) || "Idea";
        await this.db.execute({
          sql: `INSERT INTO kg_nodes (id, section_id, message_id, node_type, label, summary) VALUES (?, ?, ?, 'idea', ?, ?)`,
          args: [uuid(), sectionId, msg.id, label, msg.text.slice(0, 200)],
        });
      }
      return; // Semantic edges will be computed on next full analyze
    }

    if (section.type !== "file" && section.type !== "section") return;

    const nodeType = section.type === "file" ? "doc" : "section";
    const { summary, text } = extractDocText(section);

    // Upsert node
    await this.db.execute({
      sql: `INSERT INTO kg_nodes (id, section_id, message_id, node_type, label, summary)
            VALUES (?, ?, '', ?, ?, ?)
            ON CONFLICT(section_id, message_id) DO UPDATE SET
              node_type = excluded.node_type, label = excluded.label,
              summary = excluded.summary, updated_at = datetime('now')`,
      args: [uuid(), sectionId, nodeType, section.title, summary],
    });
  }

  async removeNode(sectionId: string): Promise<void> {
    // A section can have multiple kg_nodes (idea messages), delete all edges first
    const nodeRows = await this.db.execute({
      sql: "SELECT id FROM kg_nodes WHERE section_id = ?",
      args: [sectionId],
    });
    for (const row of nodeRows.rows) {
      const nodeId = row.id as string;
      await this.db.execute({ sql: "DELETE FROM kg_edges WHERE source_id = ? OR target_id = ?", args: [nodeId, nodeId] });
    }
    await this.db.execute({ sql: "DELETE FROM kg_nodes WHERE section_id = ?", args: [sectionId] });
  }

  // ─── Queries ─────────────────────────────────────────────────

  async getGraph(): Promise<KnowledgeGraphData> {
    const nodesResult = await this.db.execute("SELECT * FROM v_kg_graph");
    const edgesResult = await this.db.execute("SELECT * FROM kg_edges");

    const nodes: KGNode[] = nodesResult.rows.map((r: any) => ({
      id: r.id,
      section_id: r.section_id,
      message_id: r.message_id ?? "",
      node_type: r.node_type,
      label: r.label,
      summary: r.summary,
      created_at: r.created_at,
      updated_at: r.updated_at,
      degree: r.degree ?? 0,
    }));

    const edges: KGEdge[] = edgesResult.rows.map((r: any) => ({
      id: r.id,
      source_id: r.source_id,
      target_id: r.target_id,
      edge_type: r.edge_type,
      weight: r.weight,
      created_by: r.created_by,
      created_at: r.created_at,
    }));

    // Get latest analyzedAt from nodes
    const latest = nodes.length > 0
      ? nodes.reduce((a, b) => a.updated_at > b.updated_at ? a : b).updated_at
      : null;

    return { nodes, edges, analyzedAt: latest };
  }

  async getNeighbourhood(sectionId: string): Promise<{
    center: KGNode | null;
    neighbours: KGNode[];
    edges: KGEdge[];
  }> {
    const nodeRow = await this.db.execute({
      sql: "SELECT id FROM kg_nodes WHERE section_id = ?",
      args: [sectionId],
    });
    if (!nodeRow.rows.length) return { center: null, neighbours: [], edges: [] };

    const nodeId = nodeRow.rows[0].id as string;

    // Get all edges touching this node
    const edgesResult = await this.db.execute({
      sql: "SELECT * FROM kg_edges WHERE source_id = ? OR target_id = ?",
      args: [nodeId, nodeId],
    });

    const edges: KGEdge[] = edgesResult.rows.map((r: any) => ({
      id: r.id, source_id: r.source_id, target_id: r.target_id,
      edge_type: r.edge_type, weight: r.weight, created_by: r.created_by, created_at: r.created_at,
    }));

    // Collect neighbour node ids
    const neighbourIds = new Set<string>();
    for (const e of edges) {
      if (e.source_id !== nodeId) neighbourIds.add(e.source_id);
      if (e.target_id !== nodeId) neighbourIds.add(e.target_id);
    }

    // Load all relevant nodes
    const allIds = [nodeId, ...neighbourIds];
    const placeholders = allIds.map(() => "?").join(",");
    const nodesResult = await this.db.execute({
      sql: `SELECT *, (SELECT COUNT(*) FROM kg_edges e WHERE e.source_id = kg_nodes.id OR e.target_id = kg_nodes.id) AS degree FROM kg_nodes WHERE id IN (${placeholders})`,
      args: allIds,
    });

    const nodesMap = new Map<string, KGNode>();
    for (const r of nodesResult.rows as any[]) {
      nodesMap.set(r.id, {
        id: r.id, section_id: r.section_id, message_id: r.message_id ?? "",
        node_type: r.node_type, label: r.label, summary: r.summary,
        created_at: r.created_at, updated_at: r.updated_at, degree: r.degree ?? 0,
      });
    }

    return {
      center: nodesMap.get(nodeId) ?? null,
      neighbours: [...neighbourIds].map(id => nodesMap.get(id)!).filter(Boolean),
      edges,
    };
  }

  async getRelatedSections(sectionId: string, limit = 5): Promise<string[]> {
    const nodeRow = await this.db.execute({
      sql: "SELECT id FROM kg_nodes WHERE section_id = ?",
      args: [sectionId],
    });
    if (!nodeRow.rows.length) return [];
    const nodeId = nodeRow.rows[0].id as string;

    const result = await this.db.execute({
      sql: `SELECT n.section_id, e.weight
            FROM kg_edges e
            JOIN kg_nodes n ON n.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END
            WHERE (e.source_id = ? OR e.target_id = ?)
              AND e.edge_type = 'semantic_similar'
            ORDER BY e.weight DESC
            LIMIT ?`,
      args: [nodeId, nodeId, nodeId, limit],
    });

    return result.rows.map((r: any) => r.section_id as string);
  }

  async findOrphans(nodeType?: string): Promise<KGNode[]> {
    const sql = nodeType
      ? `SELECT * FROM v_kg_graph WHERE degree = 0 AND node_type = ?`
      : `SELECT * FROM v_kg_graph WHERE degree = 0`;
    const args = nodeType ? [nodeType] : [];
    const result = await this.db.execute({ sql, args });
    return result.rows.map((r: any) => ({
      id: r.id, section_id: r.section_id, message_id: r.message_id ?? "",
      node_type: r.node_type, label: r.label, summary: r.summary,
      created_at: r.created_at, updated_at: r.updated_at, degree: 0,
    }));
  }

  async getStats(): Promise<{ nodeCount: number; edgeCount: number; byType: Record<string, number> }> {
    const nodes = await this.db.execute("SELECT COUNT(*) as c FROM kg_nodes");
    const edges = await this.db.execute("SELECT COUNT(*) as c FROM kg_edges");
    const byType = await this.db.execute("SELECT node_type, COUNT(*) as c FROM kg_nodes GROUP BY node_type");

    const typeMap: Record<string, number> = {};
    for (const r of byType.rows as any[]) {
      typeMap[r.node_type] = r.c;
    }

    return {
      nodeCount: (nodes.rows[0] as any).c,
      edgeCount: (edges.rows[0] as any).c,
      byType: typeMap,
    };
  }
}
