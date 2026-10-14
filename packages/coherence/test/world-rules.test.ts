import { setBody } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  CoherenceError,
  addFoundRule,
  addWorldRule,
  anchorWorldRule,
  editWorldRule,
  emptyCoherenceFile,
  isCanonRule,
  reconcileCoherence,
  removeWorldRule,
  type Evidence,
  type WorldRule,
} from '../src/index.js';

import { LATER, NOW, buildState } from './fixtures.js';

const BODY = 'Night came early. The bridge is out. Nobody crossed.';
const QUOTE = 'The bridge is out.';
/** The span of the quote in BODY, taken from the text so the offsets cannot drift. */
const SPAN: Evidence = { docId: 'sA', quote: QUOTE, from: BODY.indexOf(QUOTE), to: BODY.indexOf(QUOTE) + QUOTE.length };
const ID_BYTES = [new Uint8Array([3, 1, 4, 1, 5, 9, 2, 6]), new Uint8Array([2, 7, 1, 8, 2, 8, 1, 8])];

/** Two distinct random sources in turn, so a second rule never collides with the first. */
function deterministic(): (n: number) => Uint8Array {
  let call = 0;
  return (n) => {
    const bytes = ID_BYTES[call % ID_BYTES.length] ?? new Uint8Array(8);
    call += 1;
    return bytes.slice(0, n);
  };
}

/** A one-document project whose body the rules are checked against. */
function project(body: string = BODY): ReturnType<typeof buildState> {
  return buildState({ scenes: [{ id: 'sA', title: 'A', body }] });
}

function onlyRule(rules: readonly WorldRule[]): WorldRule {
  const [rule] = rules;
  if (rule === undefined) throw new Error('expected one world rule');
  return rule;
}

describe('world rules (§4.3)', () => {
  it('a writer rule is canon from the start, and carries a w_ id', () => {
    const { file, rule } = addWorldRule(emptyCoherenceFile(), '  Magic costs a memory.  ', NOW, deterministic());
    expect(rule).toMatchObject({ origin: 'manual', text: 'Magic costs a memory.', createdAt: NOW.toISOString() });
    expect(rule.id).toMatch(/^w_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    expect(file.worldRules).toEqual([rule]);
    expect(isCanonRule(rule)).toBe(true);
  });

  it('an extracted rule with no source stays out of canon, and never claims to be verified', () => {
    const { rule } = addFoundRule(emptyCoherenceFile(), project(), 'The ferry runs at dusk.', undefined, NOW, deterministic());
    expect(rule).toMatchObject({ origin: 'found', verified: false });
    expect(rule.source).toBeUndefined();
    expect(isCanonRule(rule)).toBe(false);
  });

  it('an extracted rule with a source that holds in the text is canon', () => {
    const { rule } = addFoundRule(emptyCoherenceFile(), project(), 'The bridge is out.', SPAN, NOW, deterministic());
    expect(rule).toMatchObject({ origin: 'found', verified: true, source: SPAN });
    expect(isCanonRule(rule)).toBe(true);
  });

  it('refuses an extracted rule whose source does not match the text at its offsets, and records nothing', () => {
    const wrongOffsets = { ...SPAN, from: 0, to: QUOTE.length };
    const absentQuote = { ...SPAN, quote: 'The ferry runs at dusk.' };
    for (const source of [wrongOffsets, absentQuote]) {
      expect(() => addFoundRule(emptyCoherenceFile(), project(), 'The bridge is out.', source, NOW, deterministic())).toThrow(CoherenceError);
    }
    try {
      addFoundRule(emptyCoherenceFile(), project(), 'The bridge is out.', wrongOffsets, NOW, deterministic());
    } catch (error) {
      expect((error as CoherenceError).code).toBe('rule-source-mismatch');
    }
  });

  it('refuses an anchor that does not match the text, and leaves the rule as it was', () => {
    const found = addFoundRule(emptyCoherenceFile(), project(), 'The bridge is out.', undefined, NOW, deterministic());
    expect(() => anchorWorldRule(found.file, project(), found.rule.id, { ...SPAN, to: SPAN.to + 1 }, LATER)).toThrow(/does not match "sA"/);
    const anchored = anchorWorldRule(found.file, project(), found.rule.id, SPAN, LATER);
    expect(anchored.rule).toMatchObject({ origin: 'manual', verified: true, source: SPAN });
  });

  it('editing a found rule flips it to manual, so the correction is the writer’s', () => {
    const found = addFoundRule(emptyCoherenceFile(), project(), 'The ferry runs at dusk.', undefined, NOW, deterministic());
    const edited = editWorldRule(found.file, found.rule.id, 'The ferry runs at dawn.', LATER);
    expect(edited.rule).toMatchObject({ origin: 'manual', text: 'The ferry runs at dawn.', updatedAt: LATER.toISOString() });
  });

  it('attaching a source to a found rule flips it to manual and keeps the source', () => {
    const found = addFoundRule(emptyCoherenceFile(), project(), 'The bridge is out.', undefined, NOW, deterministic());
    const anchored = anchorWorldRule(found.file, project(), found.rule.id, SPAN, LATER);
    expect(anchored.rule).toMatchObject({ origin: 'manual', verified: true, source: SPAN });
  });

  it('refuses empty text, text over the limit, and an unknown rule', () => {
    expect(() => addWorldRule(emptyCoherenceFile(), '   ', NOW)).toThrow(CoherenceError);
    expect(() => addWorldRule(emptyCoherenceFile(), 'x'.repeat(301), NOW)).toThrow(/at most 300 characters/);
    expect(() => editWorldRule(emptyCoherenceFile(), 'w_AAAAAAAAAA', 'Text.', NOW)).toThrow(/no world rule has id/);
  });

  it('removes a rule and leaves the rest', () => {
    const first = addWorldRule(emptyCoherenceFile(), 'One.', NOW, deterministic());
    const second = addWorldRule(first.file, 'Two.', NOW, deterministic());
    const after = removeWorldRule(second.file, first.rule.id);
    expect(after.worldRules.map((rule) => rule.text)).toEqual(['Two.']);
  });

  it('never mutates the file it was given', () => {
    const original = emptyCoherenceFile();
    addWorldRule(original, 'One.', NOW, deterministic());
    expect(original.worldRules).toEqual([]);
  });
});

describe('reconcile re-checks the verified spans against the text (§4.3)', () => {
  it('sends an extracted rule back to review when its passage has changed, so it is not canon on a stale quote', () => {
    const state = project();
    const { file } = addFoundRule(emptyCoherenceFile(), state, 'The bridge is out.', SPAN, NOW, deterministic());
    setBody(state, 'sA', BODY.replace(QUOTE, 'The bridge is back.'));

    const { file: next, notices } = reconcileCoherence(file, state);
    const rule = onlyRule(next.worldRules);
    expect(rule).toMatchObject({ origin: 'found' });
    expect(rule.verified).toBeUndefined();
    expect(rule.source).toBeUndefined();
    expect(isCanonRule(rule)).toBe(false);
    expect(notices.map((notice) => notice.code)).toEqual(['world-rule-source-changed']);
    expect(notices[0]?.message).toContain('back in review');
  });

  it('keeps a manual rule canon when its anchored passage has changed, and says that it stays canon', () => {
    const state = project();
    const created = addWorldRule(emptyCoherenceFile(), 'The bridge is out.', NOW, deterministic());
    const anchored = anchorWorldRule(created.file, state, created.rule.id, SPAN, LATER);
    setBody(state, 'sA', BODY.replace(QUOTE, 'The bridge is back.'));

    const { file: next, notices } = reconcileCoherence(anchored.file, state);
    const rule = onlyRule(next.worldRules);
    expect(rule).toMatchObject({ origin: 'manual', verified: false });
    expect(isCanonRule(rule)).toBe(true);
    expect(notices.map((notice) => notice.code)).toEqual(['world-rule-source-changed']);
    expect(notices[0]?.message).toContain('stays canon');
  });

  it('leaves a rule whose passage still matches alone, with no notice', () => {
    const state = project();
    const { file } = addFoundRule(emptyCoherenceFile(), state, 'The bridge is out.', SPAN, NOW, deterministic());
    const { file: next, notices } = reconcileCoherence(file, state);
    expect(notices).toEqual([]);
    expect(isCanonRule(onlyRule(next.worldRules))).toBe(true);
  });
});
