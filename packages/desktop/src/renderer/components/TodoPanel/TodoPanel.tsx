import { useMemo } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

interface TaskInfo {
  sectionId: string;
  sectionTitle: string;
  text: string;
  checked: boolean;
}

interface TreeNode {
  id: string;
  title: string;
  type: string;
  children: TreeNode[];
}

export function TodoPanel() {
  const { tree, selectSection, currentProject } = useAppStore();
  const t = useT();

  // We need section content to extract tasks - but tree doesn't have content.
  // For now, show a summary of todo-type sections from the tree.
  const todoSections = useMemo(() => {
    const result: { id: string; title: string }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "todo") {
          result.push({ id: node.id, title: node.title });
        }
        if (node.children?.length) walk(node.children);
      }
    };
    walk(tree);
    return result;
  }, [tree]);

  if (!currentProject) return null;

  return (
    <div className="todo-panel">
      {todoSections.length === 0 ? (
        <div className="todo-panel-empty">{t("noTodoSections")}</div>
      ) : (
        todoSections.map((s) => (
          <div
            key={s.id}
            className="todo-panel-item"
            onClick={() => selectSection(s.id)}
          >
            <span className="todo-panel-item-icon">{"\u2611\uFE0F"}</span>
            <span className="todo-panel-item-title">{s.title}</span>
          </div>
        ))
      )}
    </div>
  );
}
