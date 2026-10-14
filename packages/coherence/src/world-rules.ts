/**
 * World rules — [coherence.md §4.3](../../../docs/architecture/coherence.md).
 *
 * A world rule is a non-entity canon fact ("the bridge is out after chapter four").
 * Two origins: `manual` is the writer's canon, and `found` is extracted and
 * stays in review until a verified source span anchors it. Correcting a found
 * rule, whether by editing its text or by attaching a source, flips it to `manual`,
 * so nothing is silently overwritten.
 *
 * "Verified" is a fact about the text, not a flag a caller can set. A source is
 * verified only when its quote is at its offsets in the document as it stands. Every
 * function here checks that against the body it is given, and `reconcileCoherence`
 * checks it again after the text changes.
 *
 * Every function returns a new file. None of them touch the manuscript.
 */

import { getBody, type ProjectState } from '@caotang/store';
import type { RandomBytes } from '@caotang/ids';

import { CoherenceError } from './errors.js';
import { mintCoherenceId } from './ids.js';
import { locateQuote } from './llm/parse.js';
import { EVIDENCE_QUOTE_LIMIT, WORLD_RULE_TEXT_LIMIT, type CoherenceFile, type Evidence, type WorldRule } from './model.js';
import { codePointLength } from './text.js';

function checkedText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') throw new CoherenceError('rule-text-invalid', 'a world rule needs some text');
  if (codePointLength(trimmed) > WORLD_RULE_TEXT_LIMIT) {
    throw new CoherenceError('rule-text-invalid', `a world rule is at most ${WORLD_RULE_TEXT_LIMIT} characters; this one is ${codePointLength(trimmed)}`);
  }
  return trimmed;
}

function ruleOrThrow(file: CoherenceFile, id: string): WorldRule {
  const rule = file.worldRules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new CoherenceError('rule-not-found', `no world rule has id "${id}"`);
  return rule;
}

/**
 * True when the source's quote is at its offsets in the document as it now stands. The
 * check reuses the parse-side helper, and it accepts only the offsets it was given: a
 * quote that could be found elsewhere is a stale span, not a match.
 */
export function sourceHolds(state: ProjectState, source: Evidence): boolean {
  if (source.quote === '' || codePointLength(source.quote) > EVIDENCE_QUOTE_LIMIT) return false;
  const located = locateQuote(getBody(state, source.docId), source.quote, source.from, source.to);
  return located !== undefined && located.from === source.from && located.to === source.to;
}

/** The source as it will be stored, or a refusal naming the mismatch. A rule is never recorded on a span that does not hold. */
function checkedSource(state: ProjectState, source: Evidence): Evidence {
  if (!sourceHolds(state, source)) {
    throw new CoherenceError(
      'rule-source-mismatch',
      `the source passage does not match "${source.docId}" at ${source.from}–${source.to}; quote the passage again from the current text, and the rule was not recorded`,
    );
  }
  return { ...source };
}

export interface WorldRuleChange {
  readonly file: CoherenceFile;
  readonly rule: WorldRule;
}

/** The writer's own rule. Always canon. */
export function addWorldRule(file: CoherenceFile, text: string, now: Date, randomBytes?: RandomBytes): WorldRuleChange {
  const next = structuredClone(file);
  const taken = new Set(next.worldRules.map((rule) => rule.id));
  const stamp = now.toISOString();
  const rule: WorldRule = {
    id: mintCoherenceId('w', taken, randomBytes),
    text: checkedText(text),
    origin: 'manual',
    createdAt: stamp,
    updatedAt: stamp,
  };
  next.worldRules.push(rule);
  return { file: next, rule };
}

/**
 * An extracted rule. It is canon only once a source span that holds in the text is
 * attached. With no span it stays in review (`verified: false`), and a span that does
 * not hold in the text is refused, never recorded as proof.
 */
export function addFoundRule(
  file: CoherenceFile,
  state: ProjectState,
  text: string,
  source: Evidence | undefined,
  now: Date,
  randomBytes?: RandomBytes,
): WorldRuleChange {
  const next = structuredClone(file);
  const taken = new Set(next.worldRules.map((rule) => rule.id));
  const stamp = now.toISOString();
  const rule: WorldRule = {
    id: mintCoherenceId('w', taken, randomBytes),
    text: checkedText(text),
    origin: 'found',
    verified: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  if (source !== undefined) {
    rule.source = checkedSource(state, source);
    rule.verified = true;
  }
  next.worldRules.push(rule);
  return { file: next, rule };
}

/** Editing a rule's text. A found rule becomes manual, so the correction is the writer's. */
export function editWorldRule(file: CoherenceFile, id: string, text: string, now: Date): WorldRuleChange {
  const next = structuredClone(file);
  const rule = ruleOrThrow(next, id);
  rule.text = checkedText(text);
  if (rule.origin === 'found') rule.origin = 'manual';
  rule.updatedAt = now.toISOString();
  return { file: next, rule };
}

/**
 * Attaching a verified source span. That is a correction too, so it flips a found rule to
 * manual (§4.3). The span must hold in the text as it stands, or the attach is refused.
 */
export function anchorWorldRule(file: CoherenceFile, state: ProjectState, id: string, source: Evidence, now: Date): WorldRuleChange {
  const next = structuredClone(file);
  const rule = ruleOrThrow(next, id);
  rule.source = checkedSource(state, source);
  rule.verified = true;
  if (rule.origin === 'found') rule.origin = 'manual';
  rule.updatedAt = now.toISOString();
  return { file: next, rule };
}

export function removeWorldRule(file: CoherenceFile, id: string): CoherenceFile {
  const next = structuredClone(file);
  ruleOrThrow(next, id);
  next.worldRules = next.worldRules.filter((rule) => rule.id !== id);
  return next;
}
