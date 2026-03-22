import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { init, cleanup } from "./shared.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";
import { registerV2Tools } from "./tools-v2.js";
import { registerWriteTools } from "./tools-write.js";

const server = new McpServer(
  {
    name: "ccdoc",
    version: "0.3.0",
  },
  {
    instructions: `CCDoc is a structured documentation management system. You have tools to read, create, update, delete, and organize documentation sections.

SECTION TYPES AND HIERARCHY:
- 'folder': container for organizing items. The ONLY type allowed at root level (no parent).
- 'file': a document with rich text content. Can only be inside a 'folder'. Content is automatically split by ## headings into child sections and ### into nested sub-sections.
- 'section': a sub-section within a document. Can only be inside a 'file' or another 'section'.
- 'idea': a prompt/requirement for what needs to be done. Can be inside a 'folder'. Can contain 'section' children (implementation plans). Use get_latest_idea to retrieve the most recent idea with its plan.
- 'todo': a task list with checkboxes. Can only be inside a 'folder'.
- 'kanban': a kanban board with columns and cards. Can only be inside a 'folder'. Content format: "## Column Name\\n- Card 1\\n- Card 2\\n\\n## Another Column\\n- Card 3"
- 'drawing': a whiteboard/drawing canvas. Can only be inside a 'folder'. Content uses a text DSL:
  ## Layout (optional): direction: top-down | left-right (default: top-down).
  ## Shapes: - [rect|ellipse|diamond|text] "Label" [at x,y] [size WxH] [inline properties].
  ## Arrows: - "Source" --> "Target" (one-way), <--> (bidirectional), --- (line) [inline properties].
  Properties can be inline (comma-separated after label) or on the next indented line.

  SHAPE PROPERTIES:
  - fill: <hex color> — background fill color (e.g. fill: #264d35)
  - stroke: <hex color> — outline/border color (e.g. stroke: #e0e0e0)
  - width: <1|2|4> — stroke thickness in pixels (default: 2)
  - stroke-style: <solid|dashed|dotted> — line style (default: solid)
  - round — rounded corners (for rect/diamond)
  - opacity: <0-100> — element transparency (default: 100)
  - bound-font: <12|16|22|32> — text size inside shapes (default: 16, for S/M/L/XL)

  TEXT ELEMENT PROPERTIES (for standalone [text]):
  - font: <hand|normal|code|headline> — font family
  - size: <14|20|28|40> — font size S/M/L/XL (default: 20)
  - align: <left|center|right> — text alignment

  ARROW/LINE PROPERTIES:
  - label: <text> — text label on the arrow
  - style: <solid|dashed|dotted> — line style
  - stroke: <hex color> — arrow color
  - width: <1|2|4> — stroke thickness
  - arrowType: <sharp|round|elbow> — line shape (default: round/curved)

  DRAWING RULES: The "Label" of a rect/ellipse/diamond IS the text inside that shape. Use [text] ONLY for standalone titles. Use \\n for line breaks. OMIT coordinates — auto-layout handles placement. Keep diagrams simple: max 8-12 shapes. Every diagram MUST have ## Arrows section.

Nesting summary: root → folder; folder → folder, file, idea, todo, kanban, drawing; file → section; section → section; idea → section (for implementation plans).

CONTENT CREATION RULES:
- When creating a file/idea/section with text, you MUST pass the 'content' parameter with the full markdown text. Do NOT leave it empty.
- For large documents, create ONE 'file' and put ALL content as rich markdown in the 'content' parameter. The system will automatically split ## headings into sections and ### into nested sub-sections.
- When you need to create 2+ sections, ALWAYS use bulk_create_sections instead of multiple create_section calls. Use '$0', '$1' etc. to reference parent sections created earlier in the same batch.
- ALWAYS call commit_history after making changes to save a version.
- Be generous with content — write detailed, substantive documentation. Never create empty or stub sections.

BEST PRACTICES FOR RICH DOCUMENTATION:
- Use DIVERSE section types — don't just create files. A good project documentation includes:
  - 'file' for detailed text documentation (architecture, guides, API docs)
  - 'drawing' for visual diagrams (architecture diagrams, data flow, component relationships)
  - 'kanban' for task tracking (backlog, in progress, done)
  - 'todo' for checklists (setup steps, release checklist)
  - 'idea' for quick notes and observations
- When documenting a project, aim to create at least one drawing diagram showing the system architecture or data flow.
- ALWAYS use update_icon to set emoji icons on created sections for visual distinction. Recommended icons:
  - Folders: 📁 or thematic (🏗️ for architecture, 📚 for docs, ⚙️ for config)
  - Files: 📄, 📝, 📋, or thematic (🔌 for API, 🚀 for getting started, 🧪 for testing)
  - Drawing: 📊, 🗺️, 🔀
  - Kanban: 📋, 🗂️
  - Ideas: 💡
  - Todos: ✅
  Always pass exactly ONE emoji character per call.

DRAWING COLOR PALETTE (dark UI):
- Stroke colors: "#e0e0e0" (default light), "#e03131" (red), "#2f9e44" (green), "#1971c2" (blue), "#f08c00" (orange), "#7048e8" (purple), "#0d7c66" (teal), "#ffffff" (white)
- Fill colors (use different ones for different shapes): "#264d35" (green), "#6b3040" (red), "#2e4a6e" (blue), "#6e5c1e" (amber), "#1e5e5e" (teal), "#553772" (purple)
- Text/stroke is light on dark background — choose fill colors with good contrast.
- ALWAYS specify fill and stroke colors for shapes. Use different fill colors for different shapes to make diagrams visually rich.

- Respond in the same language as the user.`,
  }
);

registerResources(server);
registerPrompts(server);

registerV2Tools(server);

registerWriteTools(server);

process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });

async function main() {
  await init();
  const transport = new StdioServerTransport();
  server.server.onclose = () => { cleanup().catch(console.warn); };
  await server.connect(transport);
}

main().catch(console.error);
