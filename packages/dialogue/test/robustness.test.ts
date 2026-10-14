/**
 * A seeded sweep over generated Ink-shaped bodies. The fixtures pin the cases I thought of; this
 * pins the invariants over the cases I did not (§6: the id must survive, §2.3: offsets must hold).
 * Three properties: the parse never throws and its offsets index the masked text; the findings
 * never throw; and minting ids into a body that compiles keeps it compiling.
 */

import { describe, expect, it } from 'vitest';

import { compileInk, ensureLineIds, maskComments, parseInk, validateContainer } from '../src/index.js';

const FRAGMENTS = [
  '=== a ===',
  '=== b ===',
  '=== function f(x) ===',
  '= s',
  '* [Yes] -> a',
  '* [Yes # lineId: l_0000000001] -> b',
  '+ [No]',
  '- gather',
  '- (lbl) text here',
  '* (choice) {v > 1} [Cond] -> END',
  '* Plain choice -> a',
  'Alice: hi there',
  'Hello. -> b',
  'Tail text. -> END',
  '~ x = 1',
  'VAR v = 3',
  'VAR d = -> a',
  '// comment',
  'Speech /* block */ more.',
  '{ cond:',
  '- else:',
  '}',
  '  indented text',
  '# tag only',
  '# lineId: l_0000000002',
  '',
  '-> END',
  '-> DONE',
  'INCLUDE x.ink',
  'Ünïcödé text ✨',
  '\tTabbed line',
  '-> a ->',
  '* [Ask] Oh? # lineId: l_0000000003_c',
  'The end.',
];

/** A small, deterministic PRNG: the same seed gives the same bodies, every run. */
function prng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function bodyFor(seed: number): string {
  const next = prng(seed);
  const count = 4 + Math.floor(next() * 20);
  const lines: string[] = ['-> a'];
  for (let i = 0; i < count; i += 1) lines.push(FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? '');
  return `${lines.join(next() < 0.2 ? '\r\n' : '\n')}\n`;
}

/**
 * Structurally valid bodies: knots that end in a divert, speech in several shapes, a choice and a
 * gather, a conditional choice, and a tag-only line above a divert. Random fragments rarely compile,
 * so the minting property would otherwise run over almost nothing.
 */
function validBodyFor(seed: number): string {
  const next = prng(seed * 7919);
  const knots = 2 + Math.floor(next() * 3);
  const names = Array.from({ length: knots }, (_, i) => `k${i}`);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const lines: string[] = ['VAR seed = 1', `-> ${names[0] ?? 'k0'}`];
  for (const name of names) {
    lines.push(`=== ${name} ===`);
    const speech = [
      'Plain speech.',
      'Alice: a cue line.',
      `Hello there. -> ${pick(names)}`,
      `  Indented speech. -> ${pick(names)}`,
      'Speech /* block */ more.',
      '// a comment line',
      '# lineId: l_0000000009',
      'Sure. -> END',
    ];
    for (let i = 0; i < 2 + Math.floor(next() * 3); i += 1) lines.push(pick(speech));
    lines.push(`* [Yes # lineId: l_0000000005_c] Oh, yes.`, `  -> ${pick(names)}`);
    lines.push(`* {seed > 0} [Maybe] -> ${pick(names)}`, `+ [No]`, `  Refused.`, `- Gather point.`, '-> END');
  }
  return `${lines.join('\n')}\n`;
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('the parse, over generated bodies', () => {
  it('never throws, and every line indexes the masked text at its offsets', () => {
    for (const seed of SEEDS) {
      const body = bodyFor(seed);
      const masked = maskComments(body);
      const parsed = parseInk(body);
      for (const line of parsed.lines) {
        expect(masked.slice(line.from, line.to), `seed ${seed}, line ${line.line}`).toBe(line.text);
      }
    }
  });

  it('gives every speakable line an index that counts from zero in body order', () => {
    for (const seed of SEEDS) {
      const parsed = parseInk(bodyFor(seed));
      expect(parsed.lines.map((l) => l.index), `seed ${seed}`).toEqual(parsed.lines.map((_, i) => i));
      for (let i = 1; i < parsed.lines.length; i += 1) {
        expect(parsed.lines[i]?.from ?? 0, `seed ${seed}`).toBeGreaterThanOrEqual(parsed.lines[i - 1]?.from ?? 0);
      }
    }
  });
});

describe('the findings and the compile gate, over generated bodies', () => {
  it('never throw, and report a body that fails to compile by its errors rather than by a finding', () => {
    for (const seed of SEEDS) {
      const body = bodyFor(seed);
      const report = validateContainer(`d${seed}`, body, { entries: [] });
      expect(report.compile.ok, `seed ${seed}`).toBe(report.errors.length === 0);
    }
    // 300 inkjs compiles: well inside 5 s alone, past it when the whole suite shares the machine.
    // Same budget as the minting test below, which compiles half as many.
  }, 60_000);
});

describe('minting, over generated bodies', () => {
  it('keeps a body that compiles compiling after its ids are written, and leaves no minted id unfound', () => {
    let compiledBodies = 0;
    for (const seed of SEEDS.slice(0, 150)) {
      const body = validBodyFor(seed);
      if (!compileInk(body).ok) {
        expect.fail(`the valid generator produced a body that does not compile, seed ${seed}`);
      }
      compiledBodies += 1;
      let counter = seed;
      const result = ensureLineIds(body, {
        randomBytes: (n) => {
          const out = new Uint8Array(n);
          for (let i = 0; i < n; i += 1) {
            counter = (Math.imul(counter, 1664525) + 1013904223) >>> 0;
            out[i] = (counter >>> 24) & 0xff;
          }
          return out;
        },
      });
      expect(compileInk(result.body).ok, `seed ${seed}`).toBe(true);
      const found = new Set(parseInk(result.body).lines.map((l) => l.lineId));
      for (const minted of result.minted) expect(found.has(minted.lineId), `seed ${seed}, ${minted.lineId}`).toBe(true);
    }
    expect(compiledBodies).toBe(150);
  }, 60_000);
});
