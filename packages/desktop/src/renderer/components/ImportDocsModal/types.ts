import type { TranslationKey } from "../../i18n.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Phase = "scan" | "select" | "import" | "verify" | "cleanup" | "done";

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

export interface ImportResult {
  relativePath: string;
  absolutePath: string;
  fileId: string;
  success: boolean;
  error?: string;
}

export interface VerifyStats {
  headings: number;
  codeBlocks: number;
  links: number;
  images: number;
  charCount: number;
}

export interface VerifyLink {
  href: string;
  isImage: boolean;
  type: string;
  status: string;
  detail?: string;
}

export interface VerifyResult {
  relativePath: string;
  fileId: string;
  stats: { original: VerifyStats; imported: VerifyStats };
  match: boolean;
  links: VerifyLink[];
  brokenLinks: number;
  warnings: string[];
}

export interface ProgressData {
  phase: string;
  found?: number;
  current?: number;
  total?: number;
  file?: string;
}

export interface TreeNode {
  name: string;
  path: string;
  files: { index: number; file: ScannedFile }[];
  children: TreeNode[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STEP_KEYS: { key: Phase; labelKey: TranslationKey }[] = [
  { key: "scan", labelKey: "stepScan" },
  { key: "select", labelKey: "stepSelect" },
  { key: "import", labelKey: "stepImport" },
  { key: "verify", labelKey: "stepVerify" },
  { key: "cleanup", labelKey: "stepCleanup" },
  { key: "done", labelKey: "stepDone" },
];

export const PHASE_INDEX: Record<Phase, number> = Object.fromEntries(
  STEP_KEYS.map((s, i) => [s.key, i]),
) as Record<Phase, number>;
