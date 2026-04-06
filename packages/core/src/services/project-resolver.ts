import { existsSync, realpathSync, statSync } from "fs";
import { resolve, normalize, isAbsolute } from "path";

export interface ResolvedProject {
  resolved_path: string;
  name: string;
  exists: boolean;
}

export class ProjectResolver {
  /**
   * Resolve a source string to a validated absolute path.
   * @param source - absolute or relative path
   * @param basePath - base directory for resolving relative paths
   * @param allowedRoots - optional whitelist of allowed root directories
   */
  resolve(source: string, basePath: string, allowedRoots?: string[]): ResolvedProject {
    // Resolve to absolute path
    let resolvedPath: string;
    if (isAbsolute(source)) {
      resolvedPath = normalize(source);
    } else {
      resolvedPath = resolve(basePath, source);
    }

    // Normalize and resolve symlinks to real path for security
    let realPath: string;
    try {
      realPath = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath;
    } catch {
      realPath = resolvedPath;
    }

    // Security: check path traversal - ensure resolved path doesn't escape allowed roots
    if (allowedRoots && allowedRoots.length > 0) {
      const normalizedReal = normalize(realPath).toLowerCase();
      const isAllowed = allowedRoots.some((root) => {
        const normalizedRoot = normalize(root).toLowerCase();
        return normalizedReal.startsWith(normalizedRoot);
      });
      if (!isAllowed) {
        throw new Error(`Path "${source}" resolves to "${realPath}" which is outside allowed directories`);
      }
    }

    // Security: block obvious traversal patterns even without allowedRoots
    const normalizedSource = normalize(source);
    if (normalizedSource.includes("..")) {
      // After normalization, ".." segments that go above basePath are dangerous
      // Check that the resolved path is still under basePath (for relative paths)
      if (!isAbsolute(source)) {
        const normalizedBase = normalize(basePath).toLowerCase();
        const normalizedResolved = normalize(realPath).toLowerCase();
        if (!normalizedResolved.startsWith(normalizedBase)) {
          throw new Error(`Path "${source}" attempts to escape the base directory`);
        }
      }
    }

    const exists = existsSync(realPath);
    const name = realPath.split(/[\\/]/).pop() || "unnamed";

    // Verify it's a directory if it exists
    if (exists) {
      const stat = statSync(realPath);
      if (!stat.isDirectory()) {
        throw new Error(`Path "${source}" is not a directory`);
      }
    }

    return { resolved_path: realPath, name, exists };
  }
}
