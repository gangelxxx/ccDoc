# ccDoc

Desktop app for project documentation with a built-in AI assistant. Everything is stored locally, versioned with Git, and accessible to your LLM tools through the [Model Context Protocol](https://modelcontextprotocol.io/).

![ccDoc UI](docs/assets/AiHi.gif)

## What it does

You point ccDoc at your project folder, and it becomes your documentation workspace. Docs are organized as a tree: folders, files, sections with any nesting depth. Everything auto-saves, and you can roll back to any previous version.

The AI assistant reads your code, understands the structure, and writes documentation for you. Or you write it yourself in a rich text editor. Or both.

## What's inside

**Rich text editor** with tables, code blocks (syntax highlighting for 15+ languages), task lists, images, and all the formatting you'd expect. Content auto-saves and stays in sync when the AI edits it.

**Diagrams** via Excalidraw with a simple text-based DSL. Describe shapes and connections, and the auto-layout engine arranges everything for you.

**Kanban boards** with columns, cards, labels, custom properties, and multiple views (board, table, list). Good for tracking tasks right next to the docs.

**Ideas** — a chat-style scratchpad for brainstorming. Jot down thoughts, attach screenshots, turn ideas into implementation plans or kanban boards.

**Todo lists** for simple checklists when a kanban board is overkill.

**Full-text search** across all content, plus local semantic search via embeddings — no data leaves your machine.

**Version control** — every change is tracked with Git history. Roll back any section to a previous state.

**Voice input** — dictate text using local Whisper models.

**Import** — drag-and-drop `.md`, `.txt`, or `.pdf` files right onto the sidebar. Markdown files are automatically split by headings into sections. PDFs are imported with both text and images extracted.

**Export** — full project export to Markdown, or copy individual sections to clipboard.

## AI Assistant

The assistant uses the Anthropic Claude API and has access to both your documentation and your source code. You describe what you need, and it goes to work: reads the relevant code, creates or updates docs, builds diagrams, reorganizes structure.

For bigger tasks it delegates to sub-agents — a researcher gathers information, a writer produces content, a critic reviews quality, a planner suggests structure improvements.

What you can ask it to do:

- "Document the auth flow based on the source code"
- "Create an architecture diagram for the data pipeline"
- "Review the API docs and fix inconsistencies"
- "Generate a kanban board from this list of requirements"

## MCP Server

ccDoc exposes your documentation to any MCP-compatible client (Claude Code, Cursor, Windsurf, etc.). Everything is configured from the app menu — no need to edit config files by hand. The Claude Code plugin is installed automatically when you add a project.

## Getting Started

Requires Node.js >= 20 and pnpm.

```bash
pnpm install
pnpm build
pnpm dev
```

> If you're using VS Code's integrated terminal, run `unset ELECTRON_RUN_AS_NODE` first — VS Code sets a flag that prevents Electron from launching as a GUI app.

Building a distributable:

```bash
# Windows (nsis installer + portable)
cd packages/desktop
npx electron-builder --win

# macOS (dmg + zip)
cd packages/desktop
npx electron-builder --mac

# Linux (AppImage + deb)
cd packages/desktop
npx electron-builder --linux
```

> macOS builds must be run on macOS. Cross-compilation from Windows/Linux is not supported by Electron Builder for the mac target.

## Tech Stack

Electron + React, TipTap editor, libSQL for storage, isomorphic-git for versioning, Zustand for state, Tree-sitter for code parsing, ONNX Runtime + Whisper for local models.

## License

TBD
