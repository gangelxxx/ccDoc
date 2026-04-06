import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import type { LinkType } from "../types.js";

export interface SuggestedLink {
  source_path: string;
  name: string;
  link_type: LinkType;
  config_source: string;
}

export class DependencyScanner {
  scan(projectPath: string): SuggestedLink[] {
    const results: SuggestedLink[] = [];

    results.push(...this.scanPackageJson(projectPath));
    results.push(...this.scanPnpmWorkspace(projectPath));
    results.push(...this.scanGitmodules(projectPath));
    results.push(...this.scanPyprojectToml(projectPath));
    results.push(...this.scanGoMod(projectPath));
    results.push(...this.scanCargoToml(projectPath));

    // Deduplicate by resolved path
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = r.source_path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private scanPackageJson(projectPath: string): SuggestedLink[] {
    const pkgPath = join(projectPath, "package.json");
    if (!existsSync(pkgPath)) return [];

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const results: SuggestedLink[] = [];

      for (const depSection of ["dependencies", "devDependencies"]) {
        const deps = pkg[depSection];
        if (!deps || typeof deps !== "object") continue;

        for (const [name, version] of Object.entries(deps)) {
          if (typeof version !== "string") continue;

          // file: protocol — local dependency
          if (version.startsWith("file:")) {
            const relPath = version.slice(5);
            const absPath = resolve(projectPath, relPath);
            if (existsSync(absPath)) {
              results.push({
                source_path: absPath,
                name,
                link_type: "dependency",
                config_source: "package.json",
              });
            }
          }

          // link: protocol — local symlinked dependency
          if (version.startsWith("link:")) {
            const relPath = version.slice(5);
            const absPath = resolve(projectPath, relPath);
            if (existsSync(absPath)) {
              results.push({
                source_path: absPath,
                name,
                link_type: "dependency",
                config_source: "package.json",
              });
            }
          }
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private scanPnpmWorkspace(projectPath: string): SuggestedLink[] {
    const wsPath = join(projectPath, "pnpm-workspace.yaml");
    if (!existsSync(wsPath)) return [];

    try {
      const content = readFileSync(wsPath, "utf-8");
      const results: SuggestedLink[] = [];

      // Simple YAML parsing for packages: array
      const lines = content.split("\n");
      let inPackages = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "packages:") {
          inPackages = true;
          continue;
        }
        if (inPackages) {
          if (trimmed === "" || trimmed.startsWith("#")) continue;
          if (!trimmed.startsWith("- ")) break; // end of array
          const pattern = trimmed.slice(2).replace(/['"]/g, "").trim();
          // Skip glob patterns, only take direct paths
          if (pattern.includes("*")) continue;
          const absPath = resolve(projectPath, pattern);
          if (existsSync(absPath)) {
            const name = absPath.split(/[\\/]/).pop() || pattern;
            results.push({
              source_path: absPath,
              name,
              link_type: "monorepo_part",
              config_source: "pnpm-workspace.yaml",
            });
          }
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private scanGitmodules(projectPath: string): SuggestedLink[] {
    const modulesPath = join(projectPath, ".gitmodules");
    if (!existsSync(modulesPath)) return [];

    try {
      const content = readFileSync(modulesPath, "utf-8");
      const results: SuggestedLink[] = [];

      // Parse .gitmodules format
      const pathRegex = /path\s*=\s*(.+)/g;
      let match: RegExpExecArray | null;
      while ((match = pathRegex.exec(content)) !== null) {
        const relPath = match[1].trim();
        const absPath = resolve(projectPath, relPath);
        const name = relPath.split(/[\\/]/).pop() || relPath;
        if (existsSync(absPath)) {
          results.push({
            source_path: absPath,
            name,
            link_type: "reference",
            config_source: ".gitmodules",
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private scanPyprojectToml(projectPath: string): SuggestedLink[] {
    const tomlPath = join(projectPath, "pyproject.toml");
    if (!existsSync(tomlPath)) return [];

    try {
      const content = readFileSync(tomlPath, "utf-8");
      const results: SuggestedLink[] = [];

      // Match path = "..." in [tool.poetry.dependencies] or [project.dependencies]
      const pathRegex = /\bpath\s*=\s*["']([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = pathRegex.exec(content)) !== null) {
        const relPath = match[1];
        const absPath = resolve(projectPath, relPath);
        if (existsSync(absPath)) {
          const name = absPath.split(/[\\/]/).pop() || relPath;
          results.push({
            source_path: absPath,
            name,
            link_type: "dependency",
            config_source: "pyproject.toml",
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private scanGoMod(projectPath: string): SuggestedLink[] {
    const modPath = join(projectPath, "go.mod");
    if (!existsSync(modPath)) return [];

    try {
      const content = readFileSync(modPath, "utf-8");
      const results: SuggestedLink[] = [];

      // Match replace directives with local paths:
      // replace example.com/foo => ../local-foo
      const replaceRegex = /replace\s+\S+\s+=>\s+(\.\S+)/g;
      let match: RegExpExecArray | null;
      while ((match = replaceRegex.exec(content)) !== null) {
        const relPath = match[1];
        const absPath = resolve(projectPath, relPath);
        if (existsSync(absPath)) {
          const name = absPath.split(/[\\/]/).pop() || relPath;
          results.push({
            source_path: absPath,
            name,
            link_type: "dependency",
            config_source: "go.mod",
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private scanCargoToml(projectPath: string): SuggestedLink[] {
    const cargoPath = join(projectPath, "Cargo.toml");
    if (!existsSync(cargoPath)) return [];

    try {
      const content = readFileSync(cargoPath, "utf-8");
      const results: SuggestedLink[] = [];

      // Match path = "..." in [dependencies] sections
      const pathRegex = /\bpath\s*=\s*["']([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = pathRegex.exec(content)) !== null) {
        const relPath = match[1];
        const absPath = resolve(projectPath, relPath);
        if (existsSync(absPath)) {
          const name = absPath.split(/[\\/]/).pop() || relPath;
          results.push({
            source_path: absPath,
            name,
            link_type: "dependency",
            config_source: "Cargo.toml",
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }
}
