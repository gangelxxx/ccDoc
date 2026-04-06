/**
 * Prompt and parser for splitting an implementation plan into independent phases.
 * Used as a second LLM call after plan generation in expandIdeaToPlan.
 */

export interface Phase {
  title: string;
  content: string;
}

export function buildPlanPhasesPrompt(planContent: string, language: string): string {
  const ru = language === "ru";

  return ru
    ? `Split the following implementation plan into independent phases.

Each phase must be atomic — it can be implemented separately, producing working code.

Response format — only markdown, each phase starts with ## Phase N: <title>

Structure of each phase:

## Phase N: <title>

**Goal**: what should be achieved
**Dependencies**: Phase M (if any, otherwise "none")
**Files**: file1.ts, file2.ts

### Steps
1. ...
2. ...

### Completion criteria
- [ ] ...

---

Constraints:
- 3 to 8 phases
- Each phase = independent step that can be passed to an agent as a prompt
- Phases are ordered by dependency (foundation first, then layers)
- Do NOT duplicate plan content — restructure it into phases

Plan:
${planContent}`
    : `Split the following implementation plan into independent phases.

Each phase must be atomic — it can be implemented separately, producing working code.

Response format — only markdown, each phase starts with ## Phase N: <title>

Structure of each phase:

## Phase N: <title>

**Goal**: what should be achieved
**Dependencies**: Phase M (if any, otherwise "none")
**Files**: file1.ts, file2.ts

### Steps
1. ...
2. ...

### Completion criteria
- [ ] ...

---

Constraints:
- 3 to 8 phases
- Each phase = independent step that can be passed to an agent as a prompt
- Phases are ordered by dependency (foundation first, then layers)
- Do NOT duplicate plan content — restructure it into phases

Plan:
${planContent}`;
}

export function parsePhasesResult(response: string): Phase[] {
  const phases: Phase[] = [];
  const phasePattern = /^##\s+(?:Фаза|Phase)\s+\d+[:\.\)\s—–-]+(.+)/gm;
  const matches: { index: number; title: string }[] = [];

  let match;
  while ((match = phasePattern.exec(response)) !== null) {
    matches.push({ index: match.index, title: match[1].trim() });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : response.length;
    const block = response.slice(start, end).trim();
    const contentStart = block.indexOf("\n");
    const content = contentStart >= 0 ? block.slice(contentStart + 1).trim() : "";

    if (content) {
      phases.push({ title: matches[i].title, content });
    }
  }

  return phases;
}
