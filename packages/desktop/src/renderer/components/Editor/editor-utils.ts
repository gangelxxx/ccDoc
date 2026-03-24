import DOMPurify from "dompurify";

// --- Simple markdown -> HTML (shared between ContentArea, LlmPanel) ---
export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Section links: [text](ccdoc:ID_OR_SLUG) → clickable link to navigate to section
    .replace(/\[([^\]]+)\]\(ccdoc:([a-z0-9-]+)\)/g, '<a href="#section:$2" class="llm-section-link">📄 $1</a>')
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
  html = html.replace(/((?:<li>.*?<\/li>(?:<br\/>)?)+)/g, "<ul>$1</ul>");
  return DOMPurify.sanitize(html);
}

// --- Breadcrumb builder ---
export function buildBreadcrumbs(
  tree: any[],
  targetId: string | null
): { id: string; title: string }[] {
  if (!targetId) return [];

  function find(nodes: any[], path: { id: string; title: string }[]): { id: string; title: string }[] | null {
    for (const node of nodes) {
      if (node.id === targetId) return path;
      if (node.children?.length) {
        const result = find(node.children, [...path, { id: node.id, title: node.title }]);
        if (result) return result;
      }
    }
    return null;
  }

  return find(tree, []) || [];
}

// --- Sibling finder for section navigation ---
export function findSiblingInfo(tree: any[], sectionId: string): {
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  index: number;
  total: number;
} | null {
  function search(nodes: any[]): ReturnType<typeof findSiblingInfo> {
    for (const node of nodes) {
      if (node.children) {
        const idx = node.children.findIndex((c: any) => c.id === sectionId);
        if (idx !== -1) {
          const children = node.children;
          return {
            prev: idx > 0 ? { id: children[idx - 1].id, title: children[idx - 1].title } : null,
            next: idx < children.length - 1 ? { id: children[idx + 1].id, title: children[idx + 1].title } : null,
            index: idx,
            total: children.length,
          };
        }
        const result = search(node.children);
        if (result) return result;
      }
    }
    return null;
  }
  return search(tree);
}

// --- Find node in tree ---
export function findTreeNode(nodes: any[], id: string): any | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const found = findTreeNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

// --- Task counter for todo sections ---
export function countTasks(content: string): { checked: number; total: number } {
  let checked = 0;
  let total = 0;
  try {
    const doc = JSON.parse(content);
    const walk = (node: any) => {
      if (node.type === "taskItem") {
        total++;
        if (node.attrs?.checked) checked++;
      }
      if (node.content) node.content.forEach(walk);
    };
    walk(doc);
  } catch {}
  return { checked, total };
}

// --- Token formatting ---
export function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

// --- Model name formatting ---
export function formatModelName(model: string): string {
  // "claude-haiku-4-5-20251001" -> "Haiku 4.5"
  // "claude-sonnet-4-5-20250514" -> "Sonnet 4.5"
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (m) return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return model;
}

// --- Flatten children for inline display ---
export interface ChildSection {
  id: string;
  title: string;
  content: string;
  depth: number;
}

export function flattenChildren(sections: any[], depth = 0): ChildSection[] {
  const result: ChildSection[] = [];
  for (const s of sections) {
    result.push({ id: s.id, title: s.title, content: s.content, depth });
    if (s.children?.length) {
      result.push(...flattenChildren(s.children, depth + 1));
    }
  }
  return result;
}
