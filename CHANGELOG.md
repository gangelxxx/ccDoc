# Changelog

## 0.1.18

### Semantic Search

- New semantic index: chunks code files by top-level declarations and docs by headings, embeds via e5-small (384 dims), cosine-similarity search.
- All heavy work (file I/O, embedding, search) runs in a dedicated worker thread.
- New `SemanticCacheRepo` — persistent cache of chunk embeddings in SQLite (`semantic_chunks` table, migrations 10-11).
- `IndexScheduler` — staleness detection and periodic background re-indexing (checks every 5 min).
- FTS reindex also moved to a worker thread (`fts-reindex.ts` / `fts-worker.ts`).
- New IPC handlers: `semantic:*` — thin proxy to the worker.

### PDF Export

- New "Export to PDF" button in the editor toolbar.
- Exports current section with all children to a styled PDF: auto-generated table of contents, page breaks per H2, syntax highlighting for code blocks.
- Uses a hidden `BrowserWindow` + `printToPDF` under the hood.
- Added `@media print` styles that hide UI chrome and remove scroll constraints, so browser print also works cleanly.

### GigaAM v3 Speech Recognition

- Standalone ONNX inference for GigaAM v3 (CTC-based ASR).
- Implements mel spectrogram + CTC decode directly, without `@huggingface/transformers` pipeline.
- Uses quantized `model.int8.onnx` encoder, 257-token vocab.

### Idea Processing

- LLM-based idea processing: title generation, text polishing, deduplication, grouping.
- New types: `IdeaProcessingMode`, `IdeaProcessingResult`.
- New `IdeaProcessingPreview` component — shows changes, duplicates, and groups before applying.
- Ideas now have `title`, `group`, and `originalIds` fields.

### LLM Tool Dedup

- Tracks tool call history within a session to detect redundant searches.
- Blocks exact duplicate searches, overlapping globs, cross-tool redundancy (e.g. search after find_symbols).
- Warns on overlapping/adjacent file reads with merged range suggestion.

### Settings & Appearance

- New settings: `fontFamily` (default / serif / sans / mono / system), `fontSize` (small / medium / large), `colorScheme` (teal / blue / purple).
- New Indexing tab in settings — configure semantic index intensity, excluded dirs, code extensions, max file size, staleness interval.
- New `ModelList` component in settings.

### Status Bar

- New `BgProcessItem` — reusable component for background processes (processing / done / error states, elapsed timer, cancel button).

### Other

- `TreeNode` now includes `updated_at` field.
- Package versions reset to `0.1.0` (core, desktop, source-tools); mcp-server bumped to `0.2.0`.

## 0.1.17

### Knowledge Graph

- Added a new "Knowledge Graph" section type that you can create inside folders.
- It builds a graph of connections between your ideas, docs, and sections using embeddings.
- Graph is visualized with an interactive node/edge view right in the editor.
- Nodes are created automatically from ideas (per message), docs, and sections.
- Edges are "semantic similarity" (based on embedding distance) or "parent-child".
- You can analyze the whole project or sync individual nodes.
- Find orphan nodes that aren't connected to anything.
- DB schema: new `kg_nodes` and `kg_edges` tables (migrations 7-9).

### Online Embeddings

- You can now use OpenAI or Voyage embeddings instead of local ONNX models.
- New `IEmbeddingProvider` interface — local and online providers share the same API.
- New `EmbeddingManager` in main process handles provider lifecycle.
- Hot-swap: changing embedding settings applies immediately, no restart needed. Triggers background reindex.
- Switched the local ONNX model file to a quantized version (int8 AVX512) — smaller and faster.
- Fixed a conflict where voice.ts was redirecting `onnxruntime-node` to `onnxruntime-web` globally, which broke embedding model loading. Now the embedding loader temporarily restores the original module resolver.
- Tokenizer now supports SentencePiece/Unigram format (not just WordPiece).

### Custom Agents (replaced sub-agents)

- Removed the old hardcoded sub-agent system (research, writer, critic, planner configs are gone).
- Added a custom agents system — you can create, edit, and delete your own agents.
- Each agent has: name, description, system prompt, prompt template, tool list, model, thinking toggle, effort level.
- Agents have a rating (0-10) and a rating log so the assistant can track which agents work well.
- New settings tabs: Agents tab with agent editor and agent editor modal.
- New `generate-agent` utility for AI-assisted agent creation.

### Session Buffer

- Added a shared buffer between assistant and agents within a session.
- Buffer entries have keys, content, summaries, authors, and tags.
- Buffer is saved/restored with sessions.
- Cleared when chat is reset or session is switched.

### Search

- Search is now hybrid: combines FTS5 full-text search with embedding similarity.
- Embedding-only results are now enriched with title and breadcrumbs from the FTS table.
- Added `titleHighlighted` field to search results (shows FTS match highlighting).
- Breadcrumbs are now included in search results.
- Default search limit bumped from 5 to 20.
- The search IPC handler now uses `FindService` instead of raw `FtsService`.

### LLM Chat Engine

- Added work plans: the assistant can create a plan with steps, shown as a checklist in the chat. Plans are saved in sessions and restored when you switch back.
- Added agent cards in messages — shows live agent activity (running, done, error) with action log.
- Token counter is now reset when you retry a message.
- Removed sub-agent orchestration code from the engine.

### History

- Version restore now shows progress: you see which section is being restored and how far along it is.
- Progress is streamed from main process to renderer via IPC events.

### Ideas

- New "Process with LLM" action: sends all idea messages to the AI to generate a title, improve wording, group similar ideas, and remove duplicates.
- Ideas are now exported as `.idea` files (raw JSON) instead of `.md` during history commits. This preserves the full structure including images, completion status, and plan links.

### Editor

- Text selection is now preserved visually when you click away from the editor (shown as a highlight). Clearing the selection removes the highlight.
- Editor selection is cleared when switching between sections.
- Editor view reference is now tracked in the store.

### Developer Mode

- New developer mode toggle in settings.
- "Track tool issues" option for debugging tool execution problems.
- New Developer tab in settings modal.

### Other

- Services initialization order changed: settings service is created before other services so embedding manager can read config at startup.
- `getMainWindow` is now exported from services for use in IPC handlers.
- Removed hardcoded window icon path (was failing on some setups).
- New tests: embedding repo, embedding service, history service, sections repo, sections service, online embedding.
