/**
 * Builds the user prompt and doc tree summary for the "Update Documentation" feature.
 */

import type { TreeNode } from "../types.js";

const TYPE_ICONS: Record<string, string> = {
  folder: "\u{1F4C1}",
  file: "\u{1F4C4}",
  section: "\u{1F4CE}",
  idea: "\u{1F4A1}",
  todo: "\u2705",
  kanban: "\u{1F4CB}",
  drawing: "\u{1F4CA}",
};

function renderTree(nodes: TreeNode[], depth: number): string {
  return nodes
    .map((node) => {
      const indent = "  ".repeat(depth);
      const icon = node.icon || TYPE_ICONS[node.type] || "\u{1F4C4}";
      const children =
        node.children.length > 0
          ? "\n" + renderTree(node.children, depth + 1)
          : "";
      return `${indent}${icon} ${node.title} [${node.id.slice(0, 8)}]${children}`;
    })
    .join("\n");
}

export function buildDocTreeSummary(tree: TreeNode[]): string {
  if (tree.length === 0) return "(empty documentation)";
  return renderTree(tree, 0);
}

export function buildDocUpdatePrompt(docTree: string): string {
  return `## Задача: Обновление документации проекта

Проанализируй текущую документацию проекта и исходный код, найди расхождения и обнови документацию.

### Текущая структура документации:
${docTree}

### Инструкции:
1. **Прочитай ключевые секции документации** через \`get_section\` и \`get_file_with_sections\`
2. **Изучи исходный код** через \`get_project_tree\`, \`get_file_outlines\`, \`find_symbols\`
3. **Найди расхождения**:
   - Новые функции/классы/модули, не описанные в документации
   - Удалённые или переименованные сущности, всё ещё упомянутые в документации
   - Изменённые API (новые параметры, изменённые типы возврата)
   - Устаревшие примеры кода
4. **Обнови секции** через \`update_section\` — только те, где есть реальные расхождения
5. **Создай новые секции** через \`create_section\` для новой функциональности, если нужно

### Важно:
- НЕ переписывай всю документацию — обновляй только устаревшие части
- Сохраняй стиль и структуру существующей документации
- Если сомневаешься — спроси пользователя через ask_user
- Начни с обзора дерева, затем читай секции по приоритету
- Выведи краткий отчёт в конце: что обновлено, что добавлено, что требует ручной проверки`;
}
