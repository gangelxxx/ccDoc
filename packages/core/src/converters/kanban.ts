import type { KanbanData, KanbanColumn, KanbanCard } from "../types.js";

export function kanbanToMarkdown(data: KanbanData): string {
  return data.columns
    .map((col) => {
      const header = `## ${col.title}`;
      const cards = col.cards
        .map((card) => {
          let line = `- [${card.checked ? "x" : " "}] ${card.title}`;
          // Append metadata lines for properties
          const meta: string[] = [];
          if (card.description) meta.push(`  description: ${card.description}`);
          if (card.labels && card.labels.length > 0) meta.push(`  labels: ${card.labels.join(", ")}`);
          if (card.properties) {
            for (const [key, val] of Object.entries(card.properties)) {
              if (val != null && val !== "") {
                const v = Array.isArray(val) ? val.join(", ") : String(val);
                meta.push(`  ${key}: ${v}`);
              }
            }
          }
          return meta.length > 0 ? `${line}\n${meta.join("\n")}` : line;
        })
        .join("\n");
      return cards ? `${header}\n${cards}` : header;
    })
    .join("\n\n");
}

export function kanbanToPlain(data: KanbanData): string {
  return data.columns
    .flatMap((col) => col.cards.map((card) => card.title))
    .join("\n");
}

export function markdownToKanban(markdown: string): KanbanData {
  const columns: KanbanColumn[] = [];
  let currentColumn: KanbanColumn | null = null;
  let currentCard: KanbanCard | null = null;
  let cardIndex = 0;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();

    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) {
      currentCard = null;
      currentColumn = {
        id: `col-${columns.length + 1}`,
        title: h2Match[1].trim(),
        cards: [],
      };
      columns.push(currentColumn);
      continue;
    }

    const taskMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    const plainMatch = !taskMatch ? trimmed.match(/^-\s+(.+)$/) : null;
    if ((taskMatch || plainMatch) && currentColumn) {
      cardIndex++;
      const now = new Date().toISOString();
      currentCard = {
        id: `card-${cardIndex}`,
        title: taskMatch ? taskMatch[2].trim() : plainMatch![1].trim(),
        description: "",
        labels: [],
        checked: taskMatch ? taskMatch[1] !== " " : false,
        properties: {},
        createdAt: now,
        updatedAt: now,
      };
      currentColumn.cards.push(currentCard);
      continue;
    }

    // Parse metadata lines (indented key: value under a card)
    const metaMatch = trimmed.match(/^(\w[\w.-]*)\s*:\s*(.+)$/);
    if (metaMatch && currentCard && line.startsWith("  ")) {
      const [, key, val] = metaMatch;
      if (key === "description") {
        currentCard.description = val;
      } else if (key === "labels") {
        currentCard.labels = val.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        currentCard.properties[key] = val;
      }
    }
  }

  return { columns };
}

export function emptyKanbanData(): KanbanData {
  return {
    columns: [
      { id: "col-1", title: "Backlog", cards: [] },
      { id: "col-2", title: "In progress", cards: [] },
      { id: "col-3", title: "Done", cards: [] },
    ],
    properties: [],
    settings: {
      cardSize: "medium",
      cardPreview: "none",
      colorColumns: false,
      hideEmptyGroups: false,
    },
  };
}
