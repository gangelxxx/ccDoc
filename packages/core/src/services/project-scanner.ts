import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";

export interface ProjectScanResult {
  name: string;
  path: string;
  language: string;
  frameworks: string[];
  totalFiles: number;
  totalLoc: number;
  entryPoints: string[];
  configFiles: string[];
  sourceFiles: SourceFileInfo[];
}

export interface SourceFileInfo {
  relativePath: string;
  extension: string;
  sizeBytes: number;
  loc: number;
}

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "target",
  "vendor", "__pycache__", ".venv", "venv", ".cache", "coverage",
  ".idea", ".vscode", ".ccdoc", "out",
]);

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".cs", ".rb",
  ".php", ".vue", ".svelte", ".astro",
]);

const CONFIG_PATTERNS = [
  "package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml",
  "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json",
  "Makefile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
];

const MAX_FILES = 500;
const MAX_LOC = 100_000;

export class ProjectScanner {
  scan(projectPath: string): ProjectScanResult {
    const name = basename(projectPath);
    const sourceFiles: SourceFileInfo[] = [];
    const configFiles: string[] = [];
    let totalLoc = 0;

    this.walk(projectPath, projectPath, sourceFiles, configFiles);

    for (const f of sourceFiles) {
      totalLoc += f.loc;
    }

    const language = this.detectLanguage(sourceFiles);
    const frameworks = this.detectFrameworks(projectPath, configFiles);
    const entryPoints = this.findEntryPoints(sourceFiles);

    return {
      name,
      path: projectPath,
      language,
      frameworks,
      totalFiles: sourceFiles.length,
      totalLoc,
      entryPoints,
      configFiles,
      sourceFiles: sourceFiles.slice(0, MAX_FILES),
    };
  }

  checkLimits(result: ProjectScanResult): { withinLimits: boolean; reason?: string } {
    if (result.totalFiles > MAX_FILES) {
      return { withinLimits: false, reason: `Too many files: ${result.totalFiles} (max ${MAX_FILES})` };
    }
    if (result.totalLoc > MAX_LOC) {
      return { withinLimits: false, reason: `Too many lines of code: ${result.totalLoc} (max ${MAX_LOC})` };
    }
    return { withinLimits: true };
  }

  private walk(
    rootPath: string,
    currentPath: string,
    sourceFiles: SourceFileInfo[],
    configFiles: string[],
    depth = 0,
  ): void {
    if (depth > 10 || sourceFiles.length > MAX_FILES) return;

    let entries: string[];
    try {
      entries = readdirSync(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry)) {
          this.walk(rootPath, fullPath, sourceFiles, configFiles, depth + 1);
        }
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        const relativePath = fullPath.slice(rootPath.length + 1).replace(/\\/g, "/");

        if (CONFIG_PATTERNS.includes(entry)) {
          configFiles.push(relativePath);
        }

        if (SOURCE_EXTS.has(ext) && stat.size < 500_000) {
          let loc = 0;
          try {
            const content = readFileSync(fullPath, "utf-8");
            loc = content.split("\n").length;
          } catch {
            loc = 0;
          }
          sourceFiles.push({
            relativePath,
            extension: ext,
            sizeBytes: stat.size,
            loc,
          });
        }
      }
    }
  }

  private detectLanguage(files: SourceFileInfo[]): string {
    const extCounts: Record<string, number> = {};
    for (const f of files) {
      extCounts[f.extension] = (extCounts[f.extension] || 0) + f.loc;
    }

    const langMap: Record<string, string> = {
      ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
      ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java",
      ".kt": "Kotlin", ".swift": "Swift", ".c": "C", ".cpp": "C++",
      ".cs": "C#", ".rb": "Ruby", ".php": "PHP",
      ".vue": "Vue", ".svelte": "Svelte",
    };

    let maxLoc = 0;
    let primary = "Unknown";
    for (const [ext, loc] of Object.entries(extCounts)) {
      if (loc > maxLoc && langMap[ext]) {
        maxLoc = loc;
        primary = langMap[ext];
      }
    }
    return primary;
  }

  private detectFrameworks(projectPath: string, configFiles: string[]): string[] {
    const frameworks: string[] = [];
    const pkgPath = join(projectPath, "package.json");

    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.react) frameworks.push("React");
        if (allDeps.vue) frameworks.push("Vue");
        if (allDeps.svelte) frameworks.push("Svelte");
        if (allDeps.next) frameworks.push("Next.js");
        if (allDeps.express) frameworks.push("Express");
        if (allDeps.fastify) frameworks.push("Fastify");
        if (allDeps.electron) frameworks.push("Electron");
        if (allDeps.nestjs || allDeps["@nestjs/core"]) frameworks.push("NestJS");
      } catch {
        // ignore malformed package.json
      }
    }

    if (configFiles.includes("Cargo.toml")) frameworks.push("Rust/Cargo");
    if (configFiles.includes("go.mod")) frameworks.push("Go Modules");
    if (configFiles.includes("pyproject.toml")) frameworks.push("Python/Poetry");

    return frameworks;
  }

  private findEntryPoints(files: SourceFileInfo[]): string[] {
    const patterns = [
      /^src\/(index|main|app)\.(ts|tsx|js|jsx)$/,
      /^(index|main|app)\.(ts|tsx|js|jsx|py)$/,
      /^src\/main\.(py|go|rs)$/,
      /^cmd\/.*\/main\.go$/,
    ];
    return files
      .filter(f => patterns.some(p => p.test(f.relativePath)))
      .map(f => f.relativePath);
  }
}
