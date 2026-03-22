import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";

const PROJECT_MARKER_DIR = ".ccdoc";
const PROJECT_TOKEN_FILE = "project.token";

function detectToken(projectPath: string): string | null {
  const tokenFile = join(projectPath, PROJECT_MARKER_DIR, PROJECT_TOKEN_FILE);
  if (existsSync(tokenFile)) {
    return readFileSync(tokenFile, "utf-8").trim();
  }
  return null;
}

function generateFiles(token: string, mcpServerPath: string): Map<string, string> {
  const files = new Map<string, string>();

  // --- MCP config (will be merged into settings.json) ---
  files.set("__mcp_config__", JSON.stringify({
    command: "node",
    args: [mcpServerPath, "--allow-write"],
  }));

  // --- Commands ---

  files.set(".claude/commands/tree.md", `Покажи дерево документации ccDoc проекта.

Используй MCP-инструмент \`overview\` с project_token "${token}". Он вернёт паспорт проекта и компактное дерево (глубина 2).

Отобрази результат как читаемое дерево с отступами и иконками типов:
- 📁 folder
- 📄 file
- 📝 section
- 💡 idea
- ✅ todo
- 📋 kanban
- 🎨 drawing

Если есть паспорт проекта — покажи его в начале.

$ARGUMENTS
`);

  files.set(".claude/commands/search.md", `Поиск по документации ccDoc проекта.

Используй MCP-инструмент \`find\` с project_token "${token}" и запросом ниже.

Покажи результаты с путями, релевантностью и сниппетами.
Если нужны полные детали — используй \`read\` для конкретной секции.
Если запрос пуст — спроси что искать.

Запрос: $ARGUMENTS
`);

  files.set(".claude/commands/section.md", `Прочитай секцию из ccDoc проекта.

1. Используй \`find\` с project_token "${token}" и именем секции ниже как запрос
2. Используй \`read\` с найденным section_id для получения полного содержимого и дочерних секций

Если имя неоднозначно — покажи подходящие варианты и уточни у пользователя.

Секция: $ARGUMENTS
`);

  files.set(".claude/commands/create-doc.md", `Создай структурированный документ в ccDoc проекте.

Шаги:
1. \`overview\` с project_token "${token}" — посмотри текущую структуру
2. Выбери подходящую папку или предложи создать новую
3. \`create_section\` — создай секцию type "file" в выбранной папке с полным markdown содержимым
4. Создай подсекции type "section" для каждой основной части документа

Правила иерархии:
- Корневой уровень: только folders
- Folders содержат: folders, files, ideas, todos, kanban, drawing
- Files содержат: sections
- Sections содержат: sections (для вложенности)

Пиши содержимое в markdown формате.
После создания — вызови \`commit_history\` с описательным сообщением.

Тема/требования: $ARGUMENTS
`);

  files.set(".claude/commands/import.md", `Импортируй markdown содержимое в ccDoc проект.

Шаги:
1. \`overview\` с project_token "${token}" — посмотри доступные папки
2. Уточни целевую папку если не указана ниже
3. \`import_markdown\` с project_token "${token}", folder_id целевой папки, именем файла и markdown содержимым

Инструмент автоматически разбивает markdown по заголовкам на секции.

Если пользователь указал путь к файлу — прочитай содержимое файла.
Если предоставлен raw markdown — используй напрямую.

После импорта — вызови \`commit_history\` с описанием.

Что импортировать: $ARGUMENTS
`);

  files.set(".claude/commands/scaffold.md", `Создай структуру документации в ccDoc проекте за один вызов.

Шаги:
1. \`overview\` с project_token "${token}" — текущая структура
2. Спланируй структуру папок, файлов и секций по требованиям ниже
3. \`bulk_create_sections\` с project_token "${token}" — создай всё одним вызовом
   - Используй '$N' ссылки для parent_id (0-indexed, ссылка на N-ю созданную секцию в батче)
   - Пример: '$0' ссылается на первую созданную секцию

Правила иерархии: root→folder, folder→file/idea/todo/kanban/drawing, file→section, section→section

После создания — \`commit_history\` с описанием.

Структура для создания: $ARGUMENTS
`);

  files.set(".claude/commands/review.md", `Проанализируй структуру документации ccDoc проекта.

Шаги:
1. \`overview\` с project_token "${token}" — структура и паспорт
2. Оцени организацию:
   - Логичность иерархии папок
   - Консистентность именования
   - Папки с избытком или недостатком элементов
   - Возможности группировки плоских структур
   - Пробелы в документации
3. Прочитай ключевые секции через \`read\` для оценки качества содержимого
4. Предоставь конкретные рекомендации по улучшению

Если указан фокус — приоритизируй эту область.

Фокус: $ARGUMENTS
`);

  files.set(".claude/commands/summarize.md", `Суммаризируй документацию ccDoc проекта.

Если указана конкретная секция:
1. \`find\` с project_token "${token}" — найди секцию
2. \`read\` — прочитай полное содержимое

Если секция не указана — суммаризируй весь проект:
1. \`overview\` с project_token "${token}" — структура и паспорт
2. Прочитай ключевые секции через \`read\`
3. Дай обзор высокого уровня

Результат:
- Краткое резюме (2-3 предложения)
- Ключевые темы
- Важные решения и детали
- Пробелы в документации

Что суммаризировать: $ARGUMENTS
`);

  files.set(".claude/commands/history.md", `Покажи историю версий ccDoc проекта.

Используй \`commit_history\` для создания снимков и \`get_history\` (legacy) для просмотра истории.

Project token: "${token}"

$ARGUMENTS
`);

  // --- Agent ---

  files.set(".claude/agents/ccdoc.md", `---
name: ccdoc
description: "ccDoc documentation assistant — manages project documentation structure, creates and edits documents, searches content, and tracks version history using the ccDoc MCP server."
model: sonnet
---

Ты — специалист по документации, работающий с системой управления документацией ccDoc.

## Контекст проекта

Project token: ${token}

Документация организована иерархически:
- **Folders** (только на корневом уровне) — организационные контейнеры
- **Files** (внутри папок) — документы с содержимым
- **Sections** (внутри files или других sections) — части документа
- **Ideas** (внутри папок) — быстрые заметки
- **Todos** (внутри папок) — списки задач
- **Kanban** (внутри папок) — канбан-доски
- **Drawing** (внутри папок) — диаграммы

## Доступные MCP-инструменты

### Чтение (воронка: ориентация → поиск → чтение)
- \`overview\` — **точка входа**. Возвращает паспорт проекта и компактное дерево (depth 2). Вызови один раз в начале.
- \`find\` — **основной инструмент** для поиска. Возвращает сниппеты с путями секций. Часто сниппета достаточно.
- \`read\` — полное содержимое секции по ID. Используй только когда сниппета из find недостаточно.
- \`list_projects\` — список проектов

### Запись
- \`create_section\` — создать секцию
- \`update_section\` — обновить заголовок и/или содержимое
- \`delete_section\` — мягкое удаление
- \`move_section\` — переместить в дереве
- \`import_markdown\` — импорт markdown
- \`bulk_create_sections\` — массовое создание
- \`export_project\` — экспорт в markdown файлы
- \`commit_history\` — сохранить снимок версии

## Принципы работы

1. **overview → find → read** — следуй воронке. Начни с overview для ориентации, используй find для поиска, read только для полных деталей.
2. **Сниппетов часто достаточно** — find возвращает короткие сниппеты, не читай полную секцию если ответ виден в сниппете.
3. **Соблюдай иерархию** — root→folder, folder→file/idea/todo/kanban/drawing, file→section, section→section
4. **Коммить после изменений** — вызывай \`commit_history\` после значимых модификаций
5. **Читай перед обновлением** — всегда читай текущее содержимое через \`read\` перед update_section
`);

  return files;
}

function mergeAndWriteSettings(projectPath: string, mcpConfigJson: string): void {
  const settingsPath = join(projectPath, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      const backupPath = settingsPath + ".bak";
      writeFileSync(backupPath, readFileSync(settingsPath, "utf-8"));
      console.warn(`Backed up corrupted settings.json to ${backupPath}`);
    }
  }

  if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
    settings.mcpServers = {};
  }
  (settings.mcpServers as Record<string, unknown>).ccdoc = JSON.parse(mcpConfigJson);

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

function runInstall(): void {
  const projectPath = resolve(process.argv[2] || ".");

  const token = detectToken(projectPath);
  if (!token) {
    console.error(`Error: No ccDoc project found at ${projectPath}`);
    console.error(`Expected token file at ${projectPath}/.ccdoc/project.token`);
    process.exit(1);
  }

  const mcpServerPath = resolve(dirname(__filename), "index.js").replace(/\\/g, "/");

  const files = generateFiles(token, mcpServerPath);
  const created: string[] = [];

  // Handle settings.json merge
  const mcpConfigJson = files.get("__mcp_config__");
  files.delete("__mcp_config__");
  if (mcpConfigJson) {
    mergeAndWriteSettings(projectPath, mcpConfigJson);
    created.push(".claude/settings.json");
  }

  // Write all other files
  for (const [relPath, content] of files) {
    const fullPath = join(projectPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
    created.push(relPath);
  }

  console.log(`Claude Code plugin installed for ccDoc project (token: ${token})`);
  console.log(`Created ${created.length} files:`);
  for (const f of created) {
    console.log(`  ${f}`);
  }
}

// Auto-run when executed directly
runInstall();
