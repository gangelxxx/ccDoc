import type { Client } from "@libsql/client";
import { SectionsRepo } from "../db/sections.repo.js";

export interface CrossRefTarget {
  valid: boolean;
  project_name: string;
  project_token: string | null;
  section_id: string | null;
  section_title: string | null;
  error?: string;
}

export interface ParsedCrossRef {
  raw: string;
  project_alias: string;
  section_slug: string;
}

/**
 * Matches `linked:{alias}/{slug}` patterns in content.
 * Alias and slug must not contain `/`, `]`, whitespace, or `)`.
 */
const CROSS_REF_PATTERN = /linked:([^\/\]\s)]+)\/([^\]\s)]+)/g;

/**
 * Resolves cross-project references of the form `linked:{alias}/{slug}`.
 *
 * Alias is matched against `LinkedProject.alias` first, then against
 * the last path segment of `source_path` as a fallback.
 *
 * Slug is matched against section titles: either exact match (with
 * hyphens replaced by spaces) or slug-form match (spaces to hyphens).
 */
export class CrossReferenceResolver {
  /** Parse all cross-references from text content. */
  parseRefs(content: string): ParsedCrossRef[] {
    const refs: ParsedCrossRef[] = [];
    const regex = new RegExp(CROSS_REF_PATTERN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      refs.push({
        raw: match[0],
        project_alias: match[1],
        section_slug: match[2],
      });
    }
    return refs;
  }

  /** Resolve a single cross-reference to a target section. */
  async resolve(
    ref: ParsedCrossRef,
    linkedProjects: ReadonlyArray<{
      alias: string | null;
      project_token: string | null;
      source_path: string;
      db?: Client;
    }>,
  ): Promise<CrossRefTarget> {
    const target = this.findProject(ref.project_alias, linkedProjects);

    if (!target) {
      return {
        valid: false,
        project_name: ref.project_alias,
        project_token: null,
        section_id: null,
        section_title: null,
        error: `Project "${ref.project_alias}" not found in workspace`,
      };
    }

    if (!target.project_token || !target.db) {
      return {
        valid: false,
        project_name: ref.project_alias,
        project_token: target.project_token,
        section_id: null,
        section_title: null,
        error: "Project has no documentation loaded",
      };
    }

    const found = await this.findSection(target.db, ref.section_slug);

    if (!found) {
      return {
        valid: false,
        project_name: ref.project_alias,
        project_token: target.project_token,
        section_id: null,
        section_title: null,
        error: `Section "${ref.section_slug}" not found in ${ref.project_alias}`,
      };
    }

    return {
      valid: true,
      project_name: ref.project_alias,
      project_token: target.project_token,
      section_id: found.id,
      section_title: found.title,
    };
  }

  /** Resolve all cross-references in content (deduplicates by raw string). */
  async resolveAll(
    content: string,
    linkedProjects: ReadonlyArray<{
      alias: string | null;
      project_token: string | null;
      source_path: string;
      db?: Client;
    }>,
  ): Promise<Map<string, CrossRefTarget>> {
    const refs = this.parseRefs(content);
    const results = new Map<string, CrossRefTarget>();

    for (const ref of refs) {
      if (!results.has(ref.raw)) {
        results.set(ref.raw, await this.resolve(ref, linkedProjects));
      }
    }

    return results;
  }

  // --- Private helpers ---

  private findProject(
    alias: string,
    linkedProjects: ReadonlyArray<{
      alias: string | null;
      project_token: string | null;
      source_path: string;
      db?: Client;
    }>,
  ) {
    return linkedProjects.find(
      (lp) =>
        lp.alias === alias ||
        lp.source_path.split(/[\\/]/).pop() === alias,
    );
  }

  private async findSection(
    db: Client,
    slug: string,
  ): Promise<{ id: string; title: string } | null> {
    const repo = new SectionsRepo(db);
    const allSections = await repo.listMeta();

    const normalizedSlug = slug.toLowerCase().replace(/-/g, " ");

    return (
      allSections.find((s) => {
        const titleLower = s.title.toLowerCase();
        return (
          titleLower === normalizedSlug ||
          titleLower.replace(/\s+/g, "-") === slug.toLowerCase()
        );
      }) ?? null
    );
  }
}
