import { useMemo } from "react";
import { useAppStore } from "../../stores/app.store.js";
import { useT, type TranslationKey } from "../../i18n.js";

interface TreeNode {
  id: string;
  title: string;
  type: string;
  children: TreeNode[];
}

export function TodoPanel() {
  const { tree, selectSection, userTree, selectUserSection } = useAppStore();
  const t = useT();
  // Project todos from tree
  const projectTodos = useMemo(() => {
    const result: { id: string; title: string }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "todo") result.push({ id: node.id, title: node.title });
        if (node.children?.length) walk(node.children);
      }
    };
    walk(tree);
    return result;
  }, [tree]);

  // User todos from user tree
  const userTodos = useMemo(() => {
    const result: { id: string; title: string }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "todo") result.push({ id: node.id, title: node.title });
        if (node.children?.length) walk(node.children);
      }
    };
    walk(userTree);
    return result;
  }, [userTree]);

  const hasTodos = projectTodos.length > 0 || userTodos.length > 0;

  return (
    <div className="todo-panel">
      {!hasTodos ? (
        <div className="todo-panel-empty">{t("noTodoSections")}</div>
      ) : (
        <>
          {userTodos.map((s) => (
            <div
              key={`user-${s.id}`}
              className="todo-panel-item"
              onClick={() => selectUserSection(s.id)}
            >
              <span className="todo-panel-item-icon">{"\uD83D\uDC64"}</span>
              <span className="todo-panel-item-title">{s.title}</span>
              <span className="todo-panel-item-badge" style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>
                {t("userFolder.todoLabel" as TranslationKey)}
              </span>
            </div>
          ))}
          {projectTodos.map((s) => (
            <div
              key={s.id}
              className="todo-panel-item"
              onClick={() => selectSection(s.id)}
            >
              <span className="todo-panel-item-icon">{"\u2611\uFE0F"}</span>
              <span className="todo-panel-item-title">{s.title}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
