/**
 * Semantic Index — chunks code and documentation, embeds via e5-small,
 * provides cosine-similarity search for LLM context pre-fetch.
 *
 * Runs in the main process (requires file access + ONNX embedding model).
 *
 * Architecture:
 * - Code files → split by top-level declarations (functions, classes, types)
 * - Doc sections → split by headings, then by paragraphs if too large
 * - Each chunk → embedded via e5-small (384 dims)
 * - Search: cosine similarity (= dot product for L2-normalized vectors)
 */

import { readdir, stat, readFile } from "fs/promises";
import { join, extname } from "path";
import type { IEmbeddingProvider } from "@ccdoc/core";
import { cosineSimilarity } from "@ccdoc/core";
import { extractSymbols, CODE_EXTS } from "./source-tools";

// ── Types ──────────────────────────────────────────────────────────

export interface CodeChunk {
  kind: "code";
  id: string;                    // `${filePath}::${symbolName}` or `${filePath}::L${start}-${end}`
  filePath: string;
  symbolName: string | null;
  symbolType: string;            // function, class, type, interface, variable, block
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  exported: boolean;
}

export interface DocChunk {
  kind: "doc";
  id: string;                    // `doc::${sectionId}::${index}`
  sectionId: string;
  sectionPath: string;           // breadcrumb path in doc tree
  heading: string | null;
  content: string;
  contentType: string;           // text, kanban, todo, idea
}

export type Chunk = CodeChunk | DocChunk;

interface IndexedChunk {
  chunk: Chunk;
  embedding: Float32Array;       // 384 dimensions
}

export interface SearchResult {
  chunk: Chunk;
  score: number;                 // cosine similarity, 0..1
}

export interface SemanticIndexStats {
  totalChunks: number;
  codeChunks: number;
  docChunks: number;
  indexSizeBytes: number;
  indexingTimeMs: number;
}

// ── Constants ──────────────────────────────────────────────────────

const MIN_CHUNK_TOKENS = 30;
const MAX_CHUNK_TOKENS = 500;
const MAX_CHUNKS = 30_000;
const EMBED_BATCH_SIZE = 16;

export type YieldFn = () => Promise<void>;

export interface IndexingOptions {
  codeExts: Set<string>;
  excludedDirs: Set<string>;
  maxFileSize: number;       // bytes
  codeChunkSize: number;
  docChunkSize: number;
}

export const DEFAULT_EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".ccdoc", "dist", "build", ".next", "vendor",
  "__pycache__", ".vscode", ".idea", ".svn", "coverage", ".nyc_output",
  ".cache", ".turbo", "release", "out", ".output", "logs",
]);

/** @deprecated Use IndexingOptions.excludedDirs instead */
export const SOURCE_EXCLUDED = DEFAULT_EXCLUDED_DIRS;

export const DEFAULT_INDEXING_OPTIONS: IndexingOptions = {
  codeExts: CODE_EXTS,
  excludedDirs: DEFAULT_EXCLUDED_DIRS,
  maxFileSize: 500 * 1024,
  codeChunkSize: 50,
  docChunkSize: 30,
};
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".zip", ".tar", ".gz", ".rar",
  ".pdf", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dll", ".so",
  ".dylib", ".node", ".map", ".lock",
]);

// ── SemanticIndex class ────────────────────────────────────────────

export class SemanticIndex {
  private chunks: IndexedChunk[] = [];
  private fileChunkIds = new Map<string, Set<string>>();
  private sectionChunkIds = new Map<string, Set<string>>();
  private indexingTime = 0;
  private yieldFn: YieldFn | undefined;
  private onProgress: ((item: string) => void) | undefined;
  private liveExcludedDirs: Set<string> | undefined;

  constructor(private provider: IEmbeddingProvider) {}

  setYieldFn(fn: YieldFn | undefined): void { this.yieldFn = fn; }

  setOnProgress(fn: ((item: string) => void) | undefined): void {
    this.onProgress = fn;
  }

  /** Update excluded dirs live (checked per-file during indexing). */
  setExcludedDirs(dirs: Set<string> | undefined): void { this.liveExcludedDirs = dirs; }

  private isPathExcluded(rel: string): boolean {
    if (!this.liveExcludedDirs) return false;
    const segments = rel.split("/");
    return segments.some(seg => this.liveExcludedDirs!.has(seg));
  }

  // ── Indexing ──────────────────────────────────────────────────

  /**
   * Index all code files in a project directory.
   */
  async indexCodeProject(projectPath: string, yieldFn?: YieldFn, opts: IndexingOptions = DEFAULT_INDEXING_OPTIONS, pathPrefix?: string): Promise<number> {
    const start = Date.now();
    const files = await walkSourceFiles(projectPath, opts.excludedDirs, opts.codeExts);
    let indexed = 0;
    let processed = 0;

    for (const rel of files) {
      if (this.chunks.length >= MAX_CHUNKS) break;
      if (this.isPathExcluded(rel)) continue;

      const ext = extname(rel).toLowerCase();
      const prefixedRel = pathPrefix ? `[${pathPrefix}]/${rel}` : rel;
      this.onProgress?.(prefixedRel);
      const abs = join(projectPath, rel);
      try {
        const st = await stat(abs);
        if (st.size > opts.maxFileSize) continue;
        const content = await readFile(abs, "utf-8");
        const count = await this.indexCodeFile(prefixedRel, content, ext);
        indexed += count;
      } catch { /* skip unreadable */ }

      if (yieldFn && ++processed % opts.codeChunkSize === 0) await yieldFn();
    }

    this.indexingTime = Date.now() - start;
    console.log(`[SemanticIndex] Indexed ${indexed} code chunks from ${files.length} files in ${this.indexingTime}ms`);
    return indexed;
  }

  /**
   * Index a single code file, replacing any previous chunks for it.
   */
  async indexCodeFile(filePath: string, content: string, ext: string): Promise<number> {
    // Remove old chunks for this file
    this.removeFileChunks(filePath);

    const chunks = chunkCodeFile(filePath, content, ext);
    if (chunks.length === 0) return 0;

    await this.embedAndStore(chunks);
    const ids = new Set(chunks.map(c => c.id));
    this.fileChunkIds.set(filePath, ids);
    return chunks.length;
  }

  /**
   * Index doc sections from ccDoc project.
   * @param sections Array of { id, title, path, content, type }
   */
  async indexDocSections(sections: Array<{
    id: string;
    title: string;
    path: string;
    content: string;
    type: string;
  }>, yieldFn?: YieldFn, docChunkSize = DEFAULT_INDEXING_OPTIONS.docChunkSize): Promise<number> {
    const start = Date.now();
    let indexed = 0;

    for (let i = 0; i < sections.length; i++) {
      if (this.chunks.length >= MAX_CHUNKS) break;
      const sec = sections[i];
      this.onProgress?.(sec.title);
      const chunks = chunkDocSection(sec.id, sec.path, sec.content, sec.type);
      if (chunks.length === 0) continue;

      await this.embedAndStore(chunks);
      const ids = new Set(chunks.map(c => c.id));
      this.sectionChunkIds.set(sec.id, ids);
      indexed += chunks.length;

      if (yieldFn && (i + 1) % docChunkSize === 0) await yieldFn();
    }

    const elapsed = Date.now() - start;
    this.indexingTime += elapsed;
    console.log(`[SemanticIndex] Indexed ${indexed} doc chunks from ${sections.length} sections in ${elapsed}ms`);
    return indexed;
  }

  /**
   * Remove all chunks for a file (for incremental reindex).
   */
  removeFileChunks(filePath: string): void {
    const ids = this.fileChunkIds.get(filePath);
    if (!ids || ids.size === 0) return;
    this.chunks = this.chunks.filter(ic => !ids.has(ic.chunk.id));
    this.fileChunkIds.delete(filePath);
  }

  /**
   * Remove all chunks for a doc section.
   */
  removeSectionChunks(sectionId: string): void {
    const ids = this.sectionChunkIds.get(sectionId);
    if (!ids || ids.size === 0) return;
    this.chunks = this.chunks.filter(ic => !ids.has(ic.chunk.id));
    this.sectionChunkIds.delete(sectionId);
  }

  // ── Incremental Re-indexing ──────────────────────────────────

  /**
   * Re-index only code files that changed since given mtime.
   */
  async indexCodeProjectIncremental(projectPath: string, sinceMs: number, opts: IndexingOptions = DEFAULT_INDEXING_OPTIONS, pathPrefix?: string): Promise<number> {
    const files = await walkSourceFiles(projectPath, opts.excludedDirs, opts.codeExts);
    let reindexed = 0;

    for (const rel of files) {
      if (this.chunks.length >= MAX_CHUNKS) break;
      if (this.isPathExcluded(rel)) continue;

      const ext = extname(rel).toLowerCase();
      const prefixedRel = pathPrefix ? `[${pathPrefix}]/${rel}` : rel;
      this.onProgress?.(prefixedRel);
      const abs = join(projectPath, rel);
      try {
        const st = await stat(abs);
        if (st.mtimeMs <= sinceMs) continue; // skip unchanged
        if (st.size > opts.maxFileSize) continue;

        const content = await readFile(abs, "utf-8");
        const count = await this.indexCodeFile(prefixedRel, content, ext);
        reindexed += count;
      } catch { /* skip unreadable */ }
    }

    return reindexed;
  }

  /**
   * Re-index only changed doc sections by ID.
   */
  async indexDocSectionsIncremental(
    sections: Array<{ id: string; title: string; path: string; content: string; type: string }>,
    changedIds: Set<string>,
  ): Promise<number> {
    let reindexed = 0;

    for (const sec of sections) {
      if (!changedIds.has(sec.id)) continue;
      if (this.chunks.length >= MAX_CHUNKS) break;

      this.removeSectionChunks(sec.id);
      const chunks = chunkDocSection(sec.id, sec.path, sec.content, sec.type);
      if (chunks.length > 0) {
        await this.embedAndStore(chunks);
        this.sectionChunkIds.set(sec.id, new Set(chunks.map(c => c.id)));
        reindexed += chunks.length;
      }
    }

    return reindexed;
  }

  // ── Search ────────────────────────────────────────────────────

  async search(query: string, topK = 10, filter?: "code" | "doc" | "all"): Promise<SearchResult[]> {
    if (this.chunks.length === 0) return [];

    const queryEmb = await this.provider.encodeQuery(query);
    const filterKind = filter === "all" || !filter ? null : filter;

    const scored: SearchResult[] = [];
    for (const ic of this.chunks) {
      if (filterKind && ic.chunk.kind !== filterKind) continue;
      const score = cosineSimilarity(queryEmb, ic.embedding);
      scored.push({ chunk: ic.chunk, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  // ── Stats ─────────────────────────────────────────────────────

  getStats(): SemanticIndexStats {
    const codeChunks = this.chunks.filter(c => c.chunk.kind === "code").length;
    const docChunks = this.chunks.filter(c => c.chunk.kind === "doc").length;
    // 384 floats × 4 bytes per chunk + ~200 bytes metadata overhead
    const indexSizeBytes = this.chunks.length * (384 * 4 + 200);
    return {
      totalChunks: this.chunks.length,
      codeChunks,
      docChunks,
      indexSizeBytes,
      indexingTimeMs: this.indexingTime,
    };
  }

  clear(): void {
    this.chunks = [];
    this.fileChunkIds.clear();
    this.sectionChunkIds.clear();
    this.indexingTime = 0;
  }

  getIndexedSectionIds(): string[] {
    return Array.from(this.sectionChunkIds.keys());
  }

  getIndexedFilePaths(): string[] {
    return Array.from(this.fileChunkIds.keys());
  }

  get size(): number {
    return this.chunks.length;
  }

  // ── Cache serialization ───────────────────────────────────────

  /** Serialize all chunks for persistent cache storage (includes content for prefetch). */
  serializeForCache(): Array<{ id: string; kind: string; embedding: Float32Array; textHash: string; metadata: string; content: string }> {
    return this.chunks.map(ic => {
      const c = ic.chunk;
      const textHash = simpleHash(c.content);
      const metadata = c.kind === "code"
        ? JSON.stringify({
            kind: c.kind, filePath: c.filePath, symbolName: c.symbolName,
            symbolType: c.symbolType, startLine: c.startLine, endLine: c.endLine,
            language: c.language, exported: c.exported,
          })
        : JSON.stringify({
            kind: c.kind, sectionId: c.sectionId, sectionPath: c.sectionPath,
            heading: c.heading, contentType: c.contentType,
          });
      return { id: c.id, kind: c.kind, embedding: ic.embedding, textHash, metadata, content: c.content };
    });
  }

  /**
   * Restore index from cached data (no embedding recomputation needed).
   * @returns number of restored chunks.
   */
  restoreFromCache(cached: Array<{ id: string; kind: string; embedding: Float32Array; metadata: string; content?: string }>): number {
    for (const row of cached) {
      const meta = JSON.parse(row.metadata);
      const content = row.content || "";
      let chunk: Chunk;
      if (row.kind === "code") {
        chunk = {
          kind: "code", id: row.id, filePath: meta.filePath,
          symbolName: meta.symbolName, symbolType: meta.symbolType,
          content, startLine: meta.startLine, endLine: meta.endLine,
          language: meta.language, exported: meta.exported,
        };
      } else {
        chunk = {
          kind: "doc", id: row.id, sectionId: meta.sectionId,
          sectionPath: meta.sectionPath, heading: meta.heading,
          content, contentType: meta.contentType,
        };
      }
      this.chunks.push({ chunk, embedding: row.embedding });
      // Rebuild lookup maps
      if (chunk.kind === "code") {
        const ids = this.fileChunkIds.get(chunk.filePath) ?? new Set<string>();
        ids.add(chunk.id);
        this.fileChunkIds.set(chunk.filePath, ids);
      } else {
        const ids = this.sectionChunkIds.get(chunk.sectionId) ?? new Set<string>();
        ids.add(chunk.id);
        this.sectionChunkIds.set(chunk.sectionId, ids);
      }
    }
    return cached.length;
  }

  // ── Private ───────────────────────────────────────────────────

  private async embedAndStore(chunks: Chunk[]): Promise<void> {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      for (const chunk of batch) {
        if (this.chunks.length >= MAX_CHUNKS) return;
        try {
          const text = chunk.kind === "code"
            ? `${chunk.symbolType} ${chunk.symbolName || ""} in ${chunk.filePath}\n${chunk.content}`
            : `${chunk.sectionPath} ${chunk.heading || ""}\n${chunk.content}`;
          const embedding = await this.provider.encode(text, "passage: ");
          this.chunks.push({ chunk, embedding });
        } catch (err) {
          console.warn(`[SemanticIndex] embed failed for ${chunk.id}:`, err);
        }
        if (this.yieldFn) await this.yieldFn();
      }
    }
  }
}

// ── Code Chunker ───────────────────────────────────────────────────

function chunkCodeFile(filePath: string, content: string, ext: string): CodeChunk[] {
  const lines = content.split("\n");
  const language = extToLanguage(ext);

  // Extract symbols using existing source-tools
  const symbols = extractSymbols(content, ext, filePath);

  if (symbols.length === 0) {
    // No symbols found — create a single chunk for the whole file (if small enough)
    const contentTokens = estimateTokens(content);
    if (contentTokens >= MIN_CHUNK_TOKENS && contentTokens <= MAX_CHUNK_TOKENS) {
      return [{
        kind: "code",
        id: `${filePath}::L1-${lines.length}`,
        filePath,
        symbolName: null,
        symbolType: "block",
        content,
        startLine: 1,
        endLine: lines.length,
        language,
        exported: false,
      }];
    }
    return [];
  }

  const chunks: CodeChunk[] = [];

  // Sort symbols by start line
  const sorted = [...symbols].sort((a, b) => a.line - b.line);

  for (const sym of sorted) {
    const startLine = sym.line;
    const endLine = findSymbolEnd(lines, startLine - 1, sym.kind);
    const chunkContent = lines.slice(startLine - 1, endLine).join("\n");
    const tokens = estimateTokens(chunkContent);

    if (tokens < MIN_CHUNK_TOKENS) continue;

    if (tokens <= MAX_CHUNK_TOKENS) {
      chunks.push({
        kind: "code",
        id: `${filePath}::${sym.name}`,
        filePath,
        symbolName: sym.name,
        symbolType: sym.kind,
        content: chunkContent,
        startLine,
        endLine,
        language,
        exported: sym.exported,
      });
    } else {
      // Large symbol (e.g. big class) — just take the first MAX_CHUNK_TOKENS worth
      const truncated = truncateToTokens(chunkContent, MAX_CHUNK_TOKENS);
      chunks.push({
        kind: "code",
        id: `${filePath}::${sym.name}`,
        filePath,
        symbolName: sym.name,
        symbolType: sym.kind,
        content: truncated,
        startLine,
        endLine: startLine + truncated.split("\n").length - 1,
        language,
        exported: sym.exported,
      });
    }

  }

  // Capture import block as a separate chunk if substantial
  const importEnd = findImportBlockEnd(lines);
  if (importEnd > 0) {
    const importContent = lines.slice(0, importEnd).join("\n");
    if (estimateTokens(importContent) >= MIN_CHUNK_TOKENS) {
      chunks.push({
        kind: "code",
        id: `${filePath}::imports`,
        filePath,
        symbolName: "imports",
        symbolType: "block",
        content: importContent,
        startLine: 1,
        endLine: importEnd,
        language,
        exported: false,
      });
    }
  }

  return chunks;
}

/**
 * Find the end line of a symbol (heuristic: matching brace depth).
 */
function findSymbolEnd(lines: string[], startIdx: number, kind: string): number {
  if (kind === "variable" || kind === "type" || kind === "enum") {
    // Simple declarations — look for ; or end of expression
    let depth = 0;
    for (let i = startIdx; i < Math.min(startIdx + 100, lines.length); i++) {
      for (const ch of lines[i]) {
        if (ch === "{" || ch === "(") depth++;
        if (ch === "}" || ch === ")") depth--;
      }
      if (depth <= 0 && i > startIdx) return i + 1;
      if (lines[i].trimEnd().endsWith(";") && depth === 0) return i + 1;
    }
    return Math.min(startIdx + 5, lines.length);
  }

  // Functions, classes, interfaces — brace matching
  let depth = 0;
  let foundOpen = false;
  for (let i = startIdx; i < Math.min(startIdx + 500, lines.length); i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; foundOpen = true; }
      if (ch === "}") depth--;
    }
    if (foundOpen && depth <= 0) return i + 1;
  }
  return Math.min(startIdx + 50, lines.length);
}

function findImportBlockEnd(lines: string[]): number {
  let lastImport = 0;
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    if (/^\s*(import|from|require)\s/.test(lines[i]) ||
        /^\s*(export\s+\{|export\s+\*)/.test(lines[i])) {
      lastImport = i + 1;
    } else if (lines[i].trim().length > 0 && lastImport > 0) {
      break;
    }
  }
  return lastImport;
}

// ── Doc Chunker ────────────────────────────────────────────────────

function chunkDocSection(
  sectionId: string,
  sectionPath: string,
  content: string,
  contentType: string,
): DocChunk[] {
  if (!content || content.trim().length === 0) return [];

  const chunks: DocChunk[] = [];

  if (contentType === "kanban") {
    // Split by columns (## headings)
    const sections = splitByHeadings(content);
    for (let i = 0; i < sections.length; i++) {
      const { heading, body } = sections[i];
      if (estimateTokens(body) < MIN_CHUNK_TOKENS) continue;
      chunks.push({
        kind: "doc",
        id: `doc::${sectionId}::${i}`,
        sectionId,
        sectionPath,
        heading,
        content: body,
        contentType,
      });
    }
    return chunks;
  }

  if (contentType === "idea") {
    // Ideas: treat whole content as one chunk if small
    const ideaTokens = estimateTokens(content);
    if (ideaTokens <= MAX_CHUNK_TOKENS) {
      if (ideaTokens >= MIN_CHUNK_TOKENS) {
        chunks.push({
          kind: "doc",
          id: `doc::${sectionId}::0`,
          sectionId,
          sectionPath,
          heading: null,
          content,
          contentType,
        });
      }
      return chunks;
    }
    // Split by paragraphs for large ideas
    return splitByParagraphs(sectionId, sectionPath, content, contentType);
  }

  // Regular text docs: split by headings first
  const sections = splitByHeadings(content);

  if (sections.length <= 1) {
    // No headings — split by paragraphs
    const singleTokens = estimateTokens(content);
    if (singleTokens >= MIN_CHUNK_TOKENS && singleTokens <= MAX_CHUNK_TOKENS) {
      chunks.push({
        kind: "doc",
        id: `doc::${sectionId}::0`,
        sectionId,
        sectionPath,
        heading: null,
        content,
        contentType,
      });
      return chunks;
    }
    return splitByParagraphs(sectionId, sectionPath, content, contentType);
  }

  for (let i = 0; i < sections.length; i++) {
    const { heading, body } = sections[i];
    if (estimateTokens(body) < MIN_CHUNK_TOKENS) continue;

    if (estimateTokens(body) <= MAX_CHUNK_TOKENS) {
      chunks.push({
        kind: "doc",
        id: `doc::${sectionId}::${i}`,
        sectionId,
        sectionPath,
        heading,
        content: body,
        contentType,
      });
    } else {
      // Large section — split by paragraphs
      const sub = splitByParagraphs(sectionId, sectionPath, body, contentType, i * 100);
      chunks.push(...sub);
    }
  }

  return chunks;
}

function splitByHeadings(text: string): Array<{ heading: string | null; body: string }> {
  const lines = text.split("\n");
  const sections: Array<{ heading: string | null; body: string }> = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, body: currentLines.join("\n").trim() });
      }
      currentHeading = line.replace(/^#{1,3}\s+/, "").trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, body: currentLines.join("\n").trim() });
  }

  return sections;
}

function splitByParagraphs(
  sectionId: string,
  sectionPath: string,
  text: string,
  contentType: string,
  startIndex = 0,
): DocChunk[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: DocChunk[] = [];
  let current = "";
  let idx = startIndex;

  for (const para of paragraphs) {
    if (estimateTokens(current + "\n\n" + para) > MAX_CHUNK_TOKENS && current.length > 0) {
      if (estimateTokens(current) >= MIN_CHUNK_TOKENS) {
        chunks.push({
          kind: "doc",
          id: `doc::${sectionId}::${idx}`,
          sectionId,
          sectionPath,
          heading: null,
          content: current.trim(),
          contentType,
        });
        idx++;
      }
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current.trim().length > 0 && estimateTokens(current) >= MIN_CHUNK_TOKENS) {
    chunks.push({
      kind: "doc",
      id: `doc::${sectionId}::${idx}`,
      sectionId,
      sectionPath,
      heading: null,
      content: current.trim(),
      contentType,
    });
  }

  return chunks;
}

// ── Project Snapshot ───────────────────────────────────────────────

export interface ProjectSnapshot {
  codeTree: string;
  docTree: string;
}

/**
 * Generate a compact code tree with annotations from the semantic index.
 * Max ~500 tokens.
 */
export async function generateCodeSnapshot(
  projectPath: string,
  excludedDirs: Set<string> = DEFAULT_EXCLUDED_DIRS,
  codeExts: Set<string> = CODE_EXTS,
): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, relBase: string, depth: number) {
    if (depth > 4) return; // max depth for snapshot
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

    const dirs: string[] = [];
    const fileNames: string[] = [];
    for (const e of entries) {
      if (e.isDirectory() && !excludedDirs.has(e.name)) dirs.push(e.name);
      else if (e.isFile() && codeExts.has(extname(e.name).toLowerCase())) fileNames.push(e.name);
    }
    dirs.sort();
    fileNames.sort();

    const indent = "  ".repeat(depth);
    for (const d of dirs) {
      lines.push(`${indent}${d}/`);
      await walk(join(dir, d), relBase ? `${relBase}/${d}` : d, depth + 1);
    }
    for (const f of fileNames) {
      lines.push(`${indent}${f}`);
    }
  }

  await walk(projectPath, "", 0);

  // Truncate if too long
  const MAX_LINES = 80;
  if (lines.length > MAX_LINES) {
    return lines.slice(0, MAX_LINES).join("\n") + `\n  ... (${lines.length - MAX_LINES} more files)`;
  }
  return lines.join("\n");
}

/**
 * Generate a compact doc tree from ccDoc sections.
 */
export function generateDocSnapshot(tree: Array<{
  title: string;
  type: string;
  icon?: string | null;
  children?: any[];
}>): string {
  const lines: string[] = [];
  const typeIcons: Record<string, string> = {
    folder: "\uD83D\uDCC1", file: "\uD83D\uDCC4", section: "\u00A7",
    idea: "\uD83D\uDCA1", todo: "\u2705", kanban: "\uD83D\uDCCB", drawing: "\uD83C\uDFA8",
  };

  function walk(nodes: any[], depth: number) {
    if (depth > 3) return; // max depth
    const indent = "  ".repeat(depth);
    for (const n of nodes) {
      const icon = n.icon || typeIcons[n.type] || "\u2022";
      lines.push(`${indent}${icon} ${n.title}`);
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }

  walk(tree, 0);

  const MAX_LINES = 60;
  if (lines.length > MAX_LINES) {
    return lines.slice(0, MAX_LINES).join("\n") + `\n  ... (${lines.length - MAX_LINES} more sections)`;
  }
  return lines.join("\n");
}

// ── Search Result Formatter ────────────────────────────────────────

export function formatSearchResults(results: SearchResult[]): string {
  return results.map((r, i) => {
    const chunk = r.chunk;
    if (chunk.kind === "code") {
      return `[${i + 1}] ${chunk.filePath} :: ${chunk.symbolName || `L${chunk.startLine}-${chunk.endLine}`}\n` +
        `    Type: ${chunk.symbolType} | Score: ${(r.score * 100).toFixed(0)}%\n` +
        `    Lines ${chunk.startLine}-${chunk.endLine}\n` +
        "```" + chunk.language + "\n" + chunk.content + "\n```";
    } else {
      return `[${i + 1}] doc: ${chunk.sectionPath}${chunk.heading ? " > " + chunk.heading : ""}\n` +
        `    Score: ${(r.score * 100).toFixed(0)}%\n` +
        chunk.content;
    }
  }).join("\n\n---\n\n");
}

// ── Hash ──────────────────────────────────────────────────────────

/** Simple non-crypto hash for content change detection (DJB2-like). */
function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ── Utility functions ──────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  // Cut at a line boundary
  const lines = text.split("\n");
  let chars = 0;
  for (let i = 0; i < lines.length; i++) {
    chars += lines[i].length + 1;
    if (chars > maxChars) {
      return lines.slice(0, i).join("\n") + "\n// ... truncated";
    }
  }
  return text.slice(0, maxChars);
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx",
    ".mts": "ts", ".mjs": "js", ".py": "py", ".go": "go", ".rs": "rs",
  };
  return map[ext] || ext.replace(".", "");
}

async function walkSourceFiles(rootDir: string, excludedDirs: Set<string> = DEFAULT_EXCLUDED_DIRS, codeExts?: Set<string>): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, relBase: string) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && !excludedDirs.has(e.name)) {
        await walk(join(dir, e.name), relBase ? `${relBase}/${e.name}` : e.name);
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase();
        if (BINARY_EXT.has(ext)) continue;
        // If codeExts filter provided, only collect matching files
        if (codeExts && !codeExts.has(ext)) continue;
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        files.push(rel);
      }
    }
  }
  await walk(rootDir, "");
  return files;
}
