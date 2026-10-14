/**
 * Group cards for the inbox and the scan summary — [coherence.md §4.2 and §7](../../../docs/architecture/coherence.md).
 *
 * Findings that share a check and a `factGroup` are one problem with several
 * citations, so they render as one card. The grouping is computed, not stored,
 * so it never drifts from the findings it summarises.
 */

import { FINDING_SEVERITIES, type Finding, type FindingSeverity } from './model.js';

export interface FindingGroup {
  readonly checkId: string;
  readonly factGroup: string;
  readonly type: string;
  readonly severity: FindingSeverity;
  readonly count: number;
  readonly findingIds: readonly string[];
  readonly docIds: readonly string[];
}

const RANK = new Map(FINDING_SEVERITIES.map((severity, index) => [severity, index] as const));

/** Groups by check and factGroup. The most severe group first, then by key, so the order is stable. */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
  const groups = new Map<string, { checkId: string; factGroup: string; type: string; severity: FindingSeverity; ids: string[]; docs: Set<string> }>();
  for (const finding of findings) {
    const key = JSON.stringify([finding.checkId, finding.factGroup]);
    const group = groups.get(key) ?? {
      checkId: finding.checkId,
      factGroup: finding.factGroup,
      type: finding.type,
      severity: finding.severity,
      ids: [],
      docs: new Set<string>(),
    };
    if ((RANK.get(finding.severity) ?? 0) < (RANK.get(group.severity) ?? 0)) group.severity = finding.severity;
    group.ids.push(finding.id);
    for (const passage of finding.evidence) group.docs.add(passage.docId);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([keyA, a], [keyB, b]) => (RANK.get(a.severity) ?? 0) - (RANK.get(b.severity) ?? 0) || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .map(([, group]) => ({
      checkId: group.checkId,
      factGroup: group.factGroup,
      type: group.type,
      severity: group.severity,
      count: group.ids.length,
      findingIds: [...group.ids],
      docIds: [...group.docs].sort(),
    }));
}
