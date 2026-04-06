<p align="center">
  <img src="docs/media/AiHi.gif" alt="ccDoc" />
</p>

# ccDoc

Desktop app for project documentation with a built-in AI assistant. Runs locally, data stays on your machine.

## Why?

Cloud doc platforms are too heavy for personal/team docs. A folder of markdown files gets messy fast. ccDoc is somewhere in between — structured docs in a local app, with version history out of the box.

It also exposes your docs via [MCP](https://modelcontextprotocol.io/), so AI tools like Claude Code, Cursor or Windsurf can read and edit them directly.

## What's inside

**Documents** — rich text editor with tables, code blocks, images, checklists. Spellcheck with multi-language support. Export to PDF with auto-generated table of contents.

**Kanban boards** — columns, cards, labels, custom properties. Board / table / list views.

**Diagrams** — whiteboard with shapes and arrows, described in text and laid out automatically.

**Ideas** — quick chat-style notes with progress tracking. Can be turned into a plan or a kanban board later. Process with AI to generate titles, group similar ideas, and remove duplicates.

**Knowledge graph** — visualize connections between your ideas, docs, and sections. Nodes and edges are built from embeddings automatically.

**Todo lists** — simple checklists with auto-commit on changes.

**Search** — hybrid full-text + semantic search across everything. Cross-project search when working with linked projects.

**Version history** — Git-based, with rollback. Section snapshots for local undo history with word-level diffs. Auto-commit with a review modal.

**Multi-project workspaces** — link external projects as dependencies or references. Unified tree view, cross-project search, automatic dependency scanning (package.json, pnpm-workspace, go.mod, Cargo.toml, etc.).

**Trash** — deleted ideas from the idea chat go to a trash section instead of being removed permanently.

## AI assistant

Built-in LLM integration with model tiers (strong / medium / weak). Configure different providers per tier — use a powerful model for complex tasks and a lightweight one for quick edits. Each tier can be tested with an automated suite that checks tool use, structured output, error recovery, and more.

Custom agents — create your own AI agents with individual system prompts, tool sets, and thinking settings. Rate agents to track which ones work best.

Voice input via GigaAM v3 — local speech-to-text, no cloud required.

Examples:
- *"document the auth flow based on the source code"*
- *"create an architecture diagram for the API layer"*
- *"scan my project and generate docs for all public APIs"*

## MCP

ccDoc includes an MCP server. Install it for your AI tool from the app menu — no manual config needed.

## Getting started

### From a release

Grab the installer from the [Releases](https://github.com/dilaverdmn/ccDoc/releases) page.

### From source

```bash
pnpm install
pnpm build
pnpm dev
```

Node.js 20+ required.

## Build

After `pnpm install && pnpm build`:

```bash
cd packages/desktop

# Windows — installer + portable .exe
npx electron-builder --win

# macOS — .dmg + .zip
npx electron-builder --mac

# Linux — AppImage + .deb
npx electron-builder --linux
```

Output goes to `packages/desktop/release/`.

macOS and Linux builds are untested — issues and PRs welcome.

## Tech stack

Electron, React, TipTap, libSQL, isomorphic-git, Zustand, Tree-sitter, ONNX Runtime, MCP SDK.

## License

MIT
