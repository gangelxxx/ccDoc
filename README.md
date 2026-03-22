<p align="center">
  <img src="docs/media/AiHi.gif" alt="ccDoc" />
</p>

# ccDoc

A local-first desktop app for structured project documentation with a built-in AI assistant.

## What is ccDoc

ccDoc is a personal knowledge base for developers. Instead of scattered markdown files or heavy web services like Notion or Confluence, ccDoc stores documentation locally in a structured tree with Git-based versioning.

The key idea: documentation lives alongside your code and is managed by the same AI that writes your code — via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Features

- **Structured document tree** — folders, files, sections with unlimited nesting depth
- **Multiple content types** — rich text documents, kanban boards, todo lists, diagrams (Excalidraw), ideas
- **Rich text editor** — TipTap (ProseMirror) with tables, code blocks, checklists, images
- **Full-text search** — FTS5 across all content
- **Version control** — built-in Git history via isomorphic-git with rollback support
- **AI assistant** — integrated Anthropic Claude API with agentic tool use for generating, editing, and analyzing documentation
- **MCP server** — lets any LLM client (Claude Code, Cursor, Windsurf, etc.) read and edit your docs via a standard protocol
- **Code analysis** — project tree navigation, symbol search, file reading powered by Tree-sitter
- **Voice input** — speech recognition via local Whisper models
- **Local embeddings** — ONNX Runtime for semantic search without sending data to the cloud
- **Import/Export** — Markdown import with automatic heading-based splitting, full project export

## Content Types

ccDoc supports six distinct content types, each with its own editor and storage format.

### Rich Text Documents

Full-featured WYSIWYG editor powered by TipTap (ProseMirror) with:

- **Text formatting** — bold, italic, underline, strikethrough, inline code, highlight
- **Block elements** — headings (h1–h6), blockquotes, bullet/ordered lists, horizontal rules
- **Task lists** — nested checkboxes with toggle support
- **Tables** — resizable columns, header rows, cell operations via context menu
- **Code blocks** — syntax highlighting for 15+ languages (JS, TS, Python, Rust, Go, SQL, etc.) with auto-detect
- **Images** — drag-and-drop, resize handles, alignment (left/center/right), base64 storage
- **Links** — clickable URLs with manual activation mode

Content auto-saves with a 500ms debounce. When creating files via the AI or MCP, `##` headings are automatically split into child sections and `###` into nested sub-sections.

### Excalidraw Diagrams

Whiteboard-style diagrams defined via a text DSL and rendered as Excalidraw elements.

```
## Layout
direction: left-right

## Shapes
- rect "API Gateway" fill: #2e4a6e, stroke: #e0e0e0
- ellipse "Auth Service" fill: #264d35, stroke: #e0e0e0
- diamond "Decision" fill: #6e5c1e, stroke: #e0e0e0

## Arrows
- "API Gateway" --> "Auth Service" label: "validate"
- "Auth Service" --> "Decision"
```

**Supported shapes:** rectangle, ellipse, diamond, standalone text.

**Connections:** one-way arrows (`-->`), bidirectional (`<-->`), plain lines (`---`).

**Auto-layout:** powered by ELK (layered graph layout). Coordinates are optional — shapes are automatically positioned based on the chosen direction (top-down, left-right, etc.).

**Styling:** fill/stroke colors, stroke width and style (solid/dashed/dotted), rounded corners, opacity, font size and family.

### Kanban Boards

Project boards with columns, cards, and custom properties.

```
## Backlog
- [ ] Design the API schema
- [ ] Write integration tests

## In Progress
- [ ] Implement auth middleware

## Done
- [x] Set up project structure
```

**Card features:**
- Title, description, labels
- Checkbox for completion tracking
- Custom properties: text, number, select, multi-select, date, checkbox, URL, person
- Timestamps (created/updated)

**Board features:**
- Multiple columns with optional color coding
- Card sizes: small, medium, large
- Grouping and sub-grouping by any property
- Alternative views: board (kanban), table, list
- Filters and sorting per view
- Column visibility toggle

### Todo Lists

Simple task checklists for tracking progress.

```
- [x] Install dependencies
- [x] Configure database
- [ ] Write migration scripts
- [ ] Deploy to staging
```

Each item supports a title, description, labels, custom properties, and a checked/unchecked state. Items are stored with creation and update timestamps.

### Ideas

A chat-style scratchpad for brainstorming, requirements gathering, and quick notes.

- **Message-based** — add timestamped messages with text and images
- **Image attachments** — embed screenshots or diagrams directly
- **Implementation plans** — link messages to plans (stored as child sections)
- **Kanban integration** — generate a kanban board from an idea to track its execution
- **Edit history** — messages can be edited with timestamp tracking

### Folders

Organizational containers for grouping content. Folders can contain other folders, files, ideas, todos, kanban boards, and excalidraw diagrams. Only folders are allowed at the root level of a project.

## AI Agent

ccDoc includes a built-in AI assistant powered by the Anthropic Claude API. It operates as an agentic loop with tool use — the model can read your documentation, analyze your codebase, and make changes autonomously across multiple rounds.

### How it works

1. You send a message describing what you need
2. The agent reads relevant sections, searches content, or analyzes code
3. It creates, updates, or reorganizes documentation based on findings
4. The loop continues (up to 50 rounds) until the task is complete

Context is managed automatically: messages are compressed at 60% context fill to keep the conversation going without losing important information.

### Agent tools

**Documentation tools:**
- `get_tree` — browse the full document hierarchy
- `get_section` / `get_file_with_sections` / `get_sections_batch` — read content with pagination
- `search` — full-text search across all documentation
- `create_section` / `update_section` / `delete_section` — modify content
- `move_section` / `duplicate_section` — reorganize structure
- `commit_version` / `restore_version` — version control operations

**Source code tools** (optional):
- `get_project_tree` — browse project file tree with glob filtering
- `get_file_outlines` — extract function/class/type signatures with line numbers
- `read_project_file` — read source files with line range support
- `search_project_files` — regex search across the codebase
- `find_symbols` — search for functions, classes, types, interfaces by name

### Sub-agent delegation

For complex tasks, the main agent can delegate to specialized sub-agents:

| Sub-agent | Role | Access |
|-----------|------|--------|
| **Research** | Gather information across docs and code | Read-only, up to 15 rounds |
| **Writer** | Create and update documentation content | Read + write, up to 15 rounds |
| **Critic** | Review content for issues and suggest fixes | Read-only |
| **Planner** | Propose structure improvements and gap analysis | Read-only |

The orchestrator coordinates sub-agents, avoiding context bloat by routing heavy reads (especially code analysis) through the research sub-agent.

### Example use cases

- "Document the authentication flow based on the source code"
- "Create an architecture diagram for the data pipeline"
- "Review the API docs and fix any inconsistencies"
- "Reorganize the getting started guide into logical sections"
- "Generate a kanban board from this list of requirements"

## Architecture

Monorepo with three packages:

```
packages/
  core/          # Shared library: DB, services, converters (tsup, ESM + CJS)
  desktop/       # Electron + React app (electron-vite)
  mcp-server/    # MCP server for LLM client integration (stdio)
```

**Storage:** ProseMirror JSON in libSQL (SQLite fork). One database per project + a shared registry database.

**Format conversion:** ProseMirror JSON ↔ Markdown ↔ Plain text ↔ Structured JSON. Converters live in `packages/core/src/converters/`.

**IPC (Desktop):** Main process → `ipcMain.handle` → Preload (`contextBridge`) → Renderer (`window.api`). Type-safe via the exported `Api` type.

**State (Renderer):** Zustand store — single source of truth for navigation, section tree, history, search, and the LLM panel.

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm

### Development

```bash
# Install dependencies
pnpm install

# Full build (core → mcp → desktop)
pnpm build

# Dev mode
pnpm dev
```

> **Note:** VS Code sets `ELECTRON_RUN_AS_NODE=1` in its integrated terminal, which prevents Electron from launching as a GUI app. Use an external terminal or run `unset ELECTRON_RUN_AS_NODE` before starting.

### Building individual packages

```bash
pnpm build:core      # Core library only
pnpm build:mcp       # MCP server only
pnpm build:desktop   # Desktop app only
```

### Building distributable

```bash
cd packages/desktop
npx electron-builder
```

Produces a portable `.exe` for Windows (NSIS installer optionally available).

## MCP Server

The MCP server allows LLM clients (Claude Code, Cursor, Windsurf, etc.) to interact with your documentation via the [Model Context Protocol](https://modelcontextprotocol.io/).

### Configuration

```json
{
  "mcpServers": {
    "ccdoc": {
      "command": "node",
      "args": ["path/to/packages/mcp-server/dist/index.js", "--allow-write"],
      "env": {}
    }
  }
}
```

### Available tools

| Read | Write |
|------|-------|
| `list_projects` — list all projects | `create_section` — create a section |
| `overview` — project structure overview | `update_section` — update content |
| `read` — read a section | `delete_section` — delete a section |
| `find` — search content | `move_section` — move/reorder |
| | `bulk_create_sections` — batch create |
| | `import_markdown` — import from Markdown |
| | `export_project` — export entire project |
| | `commit_history` — save a version snapshot |

The `--allow-write` flag enables write tools.

## Tech Stack

| Component | Technologies |
|-----------|-------------|
| Desktop | Electron 28, React 19, electron-vite |
| Editor | TipTap (ProseMirror) |
| Database | libSQL (SQLite fork) with FTS5 |
| Version control | isomorphic-git |
| Search | MiniSearch + FTS5 |
| State management | Zustand |
| AI | Anthropic Claude API (tool use) |
| Code parsing | Tree-sitter (TS, JS, Python, Rust, Go) |
| Local models | ONNX Runtime, Whisper |
| Build | tsup, electron-vite, electron-builder |
| MCP | @modelcontextprotocol/sdk |

## License

TBD
