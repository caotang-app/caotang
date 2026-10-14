/**
 * The coherence report — the one-source compile's Review row (media-track.md §1: "Coherence report (MD/JSON)"), the findings
 * export that is the standard report path (coherence.md §8).
 *
 * It reads the findings file the store holds and writes what it says: every finding with its status, grouped as the
 * inbox groups them (by severity, then by fact, so one problem with its citations is one heading), and the run history.
 * The report changes nothing. A finding dismissed or fixed by the writer is in it with that status, because the report is
 * a record of the file, not a to-do list.
 *
 * Pure: the caller passes the file, the project's title and the day the report is dated. Nothing here reads a clock.
 */

import { checkWordsOf, dismissalLabelOf, type CoherenceFindingState, type CoherenceRunState, type CoherenceState } from '@caotang/store';

/** The Markdown report's MIME type (the same one the prose Markdown export carries). */
export const COHERENCE_MARKDOWN_MIME = 'text/markdown;charset=utf-8';
/** The JSON report's MIME type. */
export const COHERENCE_JSON_MIME = 'application/json';

export interface CoherenceReportInput {
  /** The project's title, for the heading. */
  readonly title: string;
  /** `YYYY-MM-DD`, the day the report is dated. */
  readonly date: string;
  /** The findings file as the store holds it. Absent means the project has none, and the report says so. */
  readonly file: CoherenceState | undefined;
  /** A document's title by id, or a plain fallback for a document that is no longer in the project. */
  readonly docTitle: (docId: string) => string;
}

/** The severity sections, most severe first, in the words the inbox uses (findings-model.ts). */
const SECTIONS = [
  { severity: 'error', label: 'Errors' },
  { severity: 'warning', label: 'Warnings' },
  { severity: 'info', label: 'Notes' },
] as const;

const STATUS_WORD: Readonly<Record<string, string>> = { open: 'Open', dismissed: 'Dismissed', fixed: 'Marked fixed' };

function countOf(findings: readonly CoherenceFindingState[], status: string): number {
  return findings.filter((finding) => finding.status === status).length;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The findings of one severity, grouped by fact: one group per `factGroup`, in the order the file holds them. */
function groupsOf(findings: readonly CoherenceFindingState[]): CoherenceFindingState[][] {
  const groups = new Map<string, CoherenceFindingState[]>();
  for (const finding of findings) {
    const key = finding.factGroup ?? `finding:${finding.id}`;
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** One finding as a Markdown bullet with its quotes and its verdict. */
function findingLines(finding: CoherenceFindingState, docTitle: (docId: string) => string): string[] {
  const check = finding.checkId === undefined ? '' : ` · ${checkWordsOf(finding.checkId)}`;
  const head = `- ${STATUS_WORD[finding.status] ?? finding.status}${check}`;
  const lines = [head];
  if (finding.message !== undefined) lines.push(`  ${finding.message}`);
  if (finding.expected !== undefined) lines.push(`  Expected: ${finding.expected}`);
  for (const passage of finding.evidence ?? []) {
    if (passage.quote === undefined || passage.quote === '') continue;
    lines.push(`  > “${passage.quote}” (${docTitle(passage.docId)})`);
  }
  if (finding.dismissedReason !== undefined) lines.push(`  Dismissed as: ${dismissalLabelOf(finding.dismissedReason)}`);
  if (finding.note !== undefined) lines.push(`  Note: ${finding.note}`);
  return lines;
}

/**
 * A run's kind in the writer's words, as `RUN_KIND_LABELS` names them in @caotang/coherence. This package does not depend on the coherence module,
 * so the two rows are copied here, and the report's test pins what it prints. A kind this table does not hold is printed as it is written.
 */
const RUN_KIND_WORDS: Readonly<Record<string, string>> = {
  deterministic: 'Quick scan',
  llm: 'Model review',
};

function runLines(run: CoherenceRunState): string[] {
  const checks = run.checkIds.length === 0 ? 'no checks named' : run.checkIds.map((id) => checkWordsOf(id)).join('; ');
  const kind = RUN_KIND_WORDS[run.kind] ?? run.kind;
  const lines = [`- ${run.at} · ${kind} · ${run.status} · ${plural(run.findingsUpserted.length, 'finding')} · ${checks}`];
  for (const note of run.notes ?? []) lines.push(`  ${note}`);
  return lines;
}

/** The Markdown report: a summary, the findings by severity and fact, and the run history, newest first. */
export function coherenceReportMarkdown(input: CoherenceReportInput): string {
  const lines: string[] = [`# Coherence report: ${input.title}`, '', `Dated ${input.date}.`, ''];
  const file = input.file;
  if (file === undefined || (file.findings.length === 0 && file.runs.length === 0)) {
    lines.push('No check has run on this project yet, so there are no findings to report.', '');
    return `${lines.join('\n')}\n`;
  }

  const runs = file.runs;
  lines.push('## Summary', '');
  lines.push(
    `- ${plural(countOf(file.findings, 'open'), 'open finding')}, ${countOf(file.findings, 'dismissed')} dismissed, ${countOf(file.findings, 'fixed')} marked fixed.`,
  );
  const latest = runs[runs.length - 1];
  lines.push(
    latest === undefined
      ? '- No run is recorded.'
      : `- ${plural(runs.length, 'run')} recorded; the latest is ${latest.at} (${latest.status}).`,
  );
  lines.push('');

  for (const section of SECTIONS) {
    const findings = file.findings.filter((finding) => finding.severity === section.severity);
    if (findings.length === 0) continue;
    lines.push(`## ${section.label}`, '');
    for (const group of groupsOf(findings)) {
      const first = group[0];
      if (first === undefined) continue;
      lines.push(`### ${first.message ?? first.type ?? 'Finding'}`, '');
      for (const finding of group) lines.push(...findingLines(finding, input.docTitle), '');
    }
  }

  if (runs.length > 0) {
    lines.push('## Run history', '');
    for (const run of [...runs].reverse()) lines.push(...runLines(run));
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/**
 * The JSON report: the same findings and runs as the file holds them, with the summary counts. The findings are written
 * as the file carries them, so a reader of the report and a reader of `coherence.json` see the same records.
 */
export function coherenceReportJson(input: CoherenceReportInput): string {
  const file = input.file;
  const findings = file?.findings ?? [];
  const runs = file?.runs ?? [];
  const payload = {
    formatVersion: 1,
    project: input.title,
    date: input.date,
    summary: {
      open: countOf(findings, 'open'),
      dismissed: countOf(findings, 'dismissed'),
      fixed: countOf(findings, 'fixed'),
      runs: runs.length,
    },
    findings,
    runs,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
