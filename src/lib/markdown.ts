/**
 * Markdown rendering + description parsing for tool pages.
 *
 * The ingestion pipeline (scripts/sync.ts) stores `## Pros`, `## Cons` and a
 * `**Target audience:**` line inside `description_md`. We split those out so the
 * tool page can render a dedicated Pros/Cons box while still showing the rest
 * of the description as Markdown — no schema change required.
 */
import { marked } from 'marked';

export interface ParsedDescription {
  /** Everything before `## Pros` (the repo description / intro). */
  lead: string;
  pros: string[];
  cons: string[];
  audience?: string;
}

const PROS_RE = /^\s*##\s*Pros\b/i;
const CONS_RE = /^\s*##\s*Cons\b/i;
const AUDIENCE_RE = /^\s*\*\*Target audience:\*\*\s*(.+)$/i;

function bullet(line: string): string | null {
  const t = line.trim();
  if (t.startsWith('- ') || t.startsWith('* ')) return t.slice(2).trim();
  return null;
}

/**
 * Split a tool's `description_md` into a lead section plus extracted pros/cons.
 * Robust to missing sections (returns empty arrays when absent).
 */
export function parseDescription(md: string | null | undefined): ParsedDescription {
  if (!md || !md.trim()) return { lead: '', pros: [], cons: [] };

  let section: 'lead' | 'pros' | 'cons' = 'lead';
  const lead: string[] = [];
  const pros: string[] = [];
  const cons: string[] = [];
  let audience: string | undefined;

  for (const line of md.split(/\r?\n/)) {
    if (PROS_RE.test(line)) {
      section = 'pros';
      continue;
    }
    if (CONS_RE.test(line)) {
      section = 'cons';
      continue;
    }
    const aud = line.match(AUDIENCE_RE);
    if (aud) {
      audience = aud[1].trim();
      continue;
    }
    if (section === 'lead') lead.push(line);
    else if (section === 'pros') {
      const b = bullet(line);
      if (b) pros.push(b);
    } else if (section === 'cons') {
      const b = bullet(line);
      if (b) cons.push(b);
    }
  }

  return { lead: lead.join('\n').trim(), pros, cons, audience };
}

/** Render Markdown to an HTML string (synchronous). */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md) return '';
  return marked.parse(md, { async: false }) as string;
}
