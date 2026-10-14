/**
 * The trajectory matchers (agent-harness §9): strict requires the same items in order, unordered
 * requires the same items in any order, and a call's params are a subset check. A scenario that
 * relies on a matcher is only as good as the matcher, so the matcher has its own tests.
 */

import { describe, expect, it } from 'vitest';

import { matchCards, matchTrace } from '../../src/agent/eval.js';
import type { CardRecord, TraceEntry } from '../../src/index.js';

const call = (tool: string, outcome: TraceEntry['outcome'] = 'ok', params: Record<string, unknown> = {}): TraceEntry => ({
  tool,
  callId: `${tool}-${JSON.stringify(params)}`,
  outcome,
  params,
});

describe('the trace matcher', () => {
  it('strict: the same calls in the same order pass, and a swap fails at the first item it moves', () => {
    const actual = [call('meta.set'), call('synopsis.fill')];
    expect(matchTrace([{ tool: 'meta.set', outcome: 'ok' }, { tool: 'synopsis.fill', outcome: 'ok' }], actual, 'strict')).toEqual([]);
    const swapped = matchTrace([{ tool: 'synopsis.fill', outcome: 'ok' }, { tool: 'meta.set', outcome: 'ok' }], actual, 'strict');
    expect(swapped.length).toBe(2);
    expect(swapped[0]).toContain('item 1');
  });

  it('unordered: the same calls in any order pass, each matched once', () => {
    const actual = [call('synopsis.fill'), call('meta.set')];
    expect(matchTrace([{ tool: 'meta.set', outcome: 'ok' }, { tool: 'synopsis.fill', outcome: 'ok' }], actual, 'unordered')).toEqual([]);
    // Two expected calls cannot both be matched by one actual call.
    expect(matchTrace([{ tool: 'meta.set', outcome: 'ok' }, { tool: 'meta.set', outcome: 'ok' }], [call('meta.set')], 'unordered').length).toBeGreaterThan(0);
  });

  it('an outcome must agree: a refused call is not an ok call', () => {
    expect(matchTrace([{ tool: 'scene.draft', outcome: 'ok' }], [call('scene.draft', 'refused')], 'strict').length).toBeGreaterThan(0);
  });

  it('params are checked as a subset: keys the expectation does not name are not checked, and a named key must agree', () => {
    const actual = [call('meta.set', 'ok', { targets: ['a'], label: 'act-2', keywords_add: ['x'] })];
    expect(matchTrace([{ tool: 'meta.set', outcome: 'ok', params: { label: 'act-2' } }], actual, 'strict')).toEqual([]);
    expect(matchTrace([{ tool: 'meta.set', outcome: 'ok', params: { label: 'act-1' } }], actual, 'strict').length).toBeGreaterThan(0);
  });

  it('counts a missing call and an extra call as failures, whichever matcher is used', () => {
    expect(matchTrace([{ tool: 'meta.set', outcome: 'ok' }], [], 'unordered').length).toBeGreaterThan(0);
    expect(matchTrace([], [call('meta.set')], 'strict').length).toBeGreaterThan(0);
  });
});

describe('the card matcher', () => {
  const card = (tools: string[], decision: CardRecord['decision'] = 'approved', kind: CardRecord['kind'] = 'plan'): CardRecord => ({
    kind,
    tools,
    decision,
    edits: 0,
    retries: 0,
  });

  it('strict: a card’s tools are a sequence, so a permutation of them fails', () => {
    const actual = [card(['meta.set', 'synopsis.fill'])];
    expect(matchCards([{ kind: 'plan', tools: ['meta.set', 'synopsis.fill'], decision: 'approved' }], actual, 'strict')).toEqual([]);
    expect(matchCards([{ kind: 'plan', tools: ['synopsis.fill', 'meta.set'], decision: 'approved' }], actual, 'strict').length).toBeGreaterThan(0);
  });

  it('unordered: a card’s tools are a multiset, so a permutation passes', () => {
    const actual = [card(['synopsis.fill', 'meta.set'])];
    expect(matchCards([{ kind: 'plan', tools: ['meta.set', 'synopsis.fill'], decision: 'approved' }], actual, 'unordered')).toEqual([]);
  });

  it('kind and decision must agree, and the card count must agree', () => {
    expect(matchCards([{ kind: 'confirm', tools: ['scene.draft'], decision: 'approved' }], [card(['scene.draft'], 'approved', 'plan')], 'strict').length).toBeGreaterThan(0);
    expect(matchCards([{ kind: 'plan', tools: ['meta.set'], decision: 'cancelled' }], [card(['meta.set'])], 'strict').length).toBeGreaterThan(0);
    expect(matchCards([], [card(['meta.set'])], 'strict').length).toBeGreaterThan(0);
  });
});
