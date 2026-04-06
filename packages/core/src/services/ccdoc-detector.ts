import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { PROJECT_MARKER_DIR, PROJECT_TOKEN_FILE } from "../constants.js";

export interface CcdocDetectionResult {
  has_ccdoc: boolean;
  token: string | null;
  marker_path: string | null;
  config_path: string | null;
  last_updated: string | null;
}

const CONFIG_MARKERS = ["ccdoc.json", "ccdoc.yaml", ".ccdoc.json"];

export class CcdocDetector {
  detect(projectPath: string): CcdocDetectionResult {
    // Check primary marker: .ccdoc/project.token
    const markerDir = join(projectPath, PROJECT_MARKER_DIR);
    const tokenFile = join(markerDir, PROJECT_TOKEN_FILE);

    if (existsSync(tokenFile)) {
      const token = readFileSync(tokenFile, "utf-8").trim();
      let last_updated: string | null = null;
      try {
        last_updated = statSync(tokenFile).mtime.toISOString();
      } catch {
        // stat may fail on permission issues — proceed without timestamp
      }

      return {
        has_ccdoc: true,
        token: token || null,
        marker_path: markerDir,
        config_path: null,
        last_updated,
      };
    }

    // Check alternative config markers
    for (const marker of CONFIG_MARKERS) {
      const configPath = join(projectPath, marker);
      if (existsSync(configPath)) {
        let last_updated: string | null = null;
        try {
          last_updated = statSync(configPath).mtime.toISOString();
        } catch {
          // stat may fail on permission issues — proceed without timestamp
        }
        return {
          has_ccdoc: true,
          token: null,
          marker_path: null,
          config_path: configPath,
          last_updated,
        };
      }
    }

    // Check if .ccdoc directory exists at all (even without token)
    if (existsSync(markerDir)) {
      return {
        has_ccdoc: true,
        token: null,
        marker_path: markerDir,
        config_path: null,
        last_updated: null,
      };
    }

    return {
      has_ccdoc: false,
      token: null,
      marker_path: null,
      config_path: null,
      last_updated: null,
    };
  }
}
