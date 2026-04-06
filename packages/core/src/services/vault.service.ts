import type { VaultBackend, RevisionInfo } from "../db/vault.repo.js";

export interface VaultOptions {
  maxRevisions?: number;
}

export class Vault {
  private maxRevisions: number;

  constructor(private backend: VaultBackend, opts?: VaultOptions) {
    this.maxRevisions = opts?.maxRevisions ?? 50;
  }

  async get<T = any>(key: string): Promise<T | null> {
    const raw = await this.backend.getLatest(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async getAll(): Promise<Record<string, any>> {
    const raw = await this.backend.getAllLatest();
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        result[k] = JSON.parse(v);
      } catch {
        result[k] = v;
      }
    }
    return result;
  }

  async set(entries: Record<string, any>, source: string): Promise<number> {
    const serialized: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      serialized[k] = JSON.stringify(v);
    }
    const rev = await this.backend.commit(serialized, source);
    if (this.maxRevisions > 0) {
      await this.backend.prune(this.maxRevisions);
    }
    return rev;
  }

  async history(limit = 50): Promise<RevisionInfo[]> {
    return this.backend.getRevisions(limit);
  }

  async snapshot(revision: number): Promise<Record<string, any>> {
    const raw = await this.backend.getRevision(revision);
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        result[k] = JSON.parse(v);
      } catch {
        result[k] = v;
      }
    }
    return result;
  }

  async rollback(revision: number, source: string): Promise<number> {
    const snap = await this.backend.getRevision(revision);
    return this.backend.commit(snap, source);
  }
}
