import { expect, test } from '@playwright/test';

import { fillSegments, fountainSegments, type Segment } from '../../apps/desktop/src/media/source-decor.js';
import { cueCompletion, cueNames, enterAfterCue, enterOnEmptyDialogue } from '../../apps/desktop/src/media/screenplay-keys.js';

/** The text the segments draw, joined back together: a decoration must never change a character (screenplay.md §3). */
function textOf(source: string, segments: readonly Segment[]): string {
  return segments.map((segment) => source.slice(segment.from, segment.to)).join('');
}

/** The class of the first segment whose text starts with `needle`, or `undefined` when none does. */
function classOf(source: string, segments: readonly Segment[], needle: string): string | null | undefined {
  return segments.find((segment) => source.slice(segment.from, segment.to).includes(needle))?.cls;
}

const SCRIPT = [
  'INT. HOUSE - DAY',
  '= The first night.',
  '',
  'Action paragraph here.',
  '',
  'ELENA',
  '(quietly)',
  "I'm home.",
  '',
  'CUT TO:',
  '',
].join('\n');

test.describe('the decoration layer covers the text and changes none of it', () => {
  test('the segments of a Fountain body concatenate back to the body, with no gap or overlap', () => {
    const segments = fountainSegments(SCRIPT);
    expect(textOf(SCRIPT, segments)).toBe(SCRIPT);
    // Each segment starts where the one before it ended.
    segments.forEach((segment, index) => {
      if (index > 0) expect(segment.from).toBe(segments[index - 1]?.to);
    });
  });

  test('an empty body has no segments, and the layer has nothing to draw', () => {
    expect(fountainSegments('')).toEqual([]);
  });

  test('fillSegments clips a mark that starts inside an earlier one, so the outer class wins', () => {
    const segments = fillSegments(10, [
      { from: 0, to: 10, cls: 'outer' },
      { from: 2, to: 4, cls: 'inner' },
    ]);
    expect(segments).toEqual([{ from: 0, to: 10, cls: 'outer' }]);
  });
});

test.describe('the Source tab draws the parse', () => {
  test('a scene heading, a cue, a parenthetical, a transition and a synopsis each get their class', () => {
    const segments = fountainSegments(SCRIPT);
    expect(classOf(SCRIPT, segments, 'INT. HOUSE')).toBe('tok-heading');
    expect(classOf(SCRIPT, segments, 'The first night')).toBe('tok-synopsis');
    expect(classOf(SCRIPT, segments, 'ELENA')).toBe('tok-cue');
    expect(classOf(SCRIPT, segments, '(quietly)')).toBe('tok-paren');
    expect(classOf(SCRIPT, segments, 'CUT TO:')).toBe('tok-transition');
  });

  test('action and dialogue are drawn plain', () => {
    const segments = fountainSegments(SCRIPT);
    expect(classOf(SCRIPT, segments, 'Action paragraph')).toBeNull();
    expect(classOf(SCRIPT, segments, "I'm home")).toBeNull();
  });

  test('a note and a boneyard are drawn as annotations', () => {
    const source = 'INT. A - DAY\n\n[[a note]]\n\n/* a boneyard */\n';
    const segments = fountainSegments(source);
    expect(textOf(source, segments)).toBe(source);
    expect(classOf(source, segments, 'a note')).toBe('tok-note');
  });
});

test.describe('Enter after a cue and on empty dialogue', () => {
  test('Enter at the end of a cue moves the caret onto its dialogue, and makes no blank line between them', () => {
    const text = 'INT. HOUSE - DAY\n\nELENA\nHi.';
    const cueEnd = text.indexOf('\nHi.');
    expect(enterAfterCue(text, cueEnd)).toEqual({ text, caret: cueEnd + 1 });
  });

  test('a line that is not a cue, and the middle of a cue, keep the Enter key\'s meaning', () => {
    const text = 'INT. HOUSE - DAY\n\nELENA\nHi.';
    expect(enterAfterCue(text, 3)).toBeNull();
    expect(enterAfterCue(text, text.indexOf('Hi.') + 3)).toBeNull();
    // A line that the parser reads as action, even in capitals, is not a cue until dialogue follows it.
    expect(enterAfterCue('INT. HOUSE - DAY\n\nELENA', 'INT. HOUSE - DAY\n\nELENA'.length)).toBeNull();
  });

  test('Enter on an empty line after dialogue ends the block, and the caret starts action', () => {
    const text = 'ELENA\nI\'m home.\n';
    const edit = enterOnEmptyDialogue(text, text.length);
    expect(edit).toEqual({ text: "ELENA\nI'm home.\n\n", caret: text.length + 1 });
  });

  test('Enter on an empty line after action keeps its meaning', () => {
    const text = 'Action paragraph.\n';
    expect(enterOnEmptyDialogue(text, text.length)).toBeNull();
  });
});

test.describe('Tab completes a cue name', () => {
  // The codex holds a character with an alias, and a location and a lore entry whose names a cue must never complete to.
  const names = cueNames(
    ['ELENA'],
    [
      { name: 'Marcus', type: 'character', aliases: ['Marc'] },
      { name: 'Harbour House', type: 'location', aliases: ['Harbor'] },
      { name: 'Salt Lore', type: 'lore', aliases: ['Saltish'] },
    ],
  );

  test('the names are the cued characters and the codex characters, in capitals, once each, in order', () => {
    expect(names).toEqual(['ELENA', 'MARC', 'MARCUS']);
  });

  test('a location or lore entry, and its alias, never completes a cue', () => {
    const location = 'INT. HOUSE - DAY\n\nhar';
    expect(cueCompletion(location, location.length, names)).toBeNull();
    const lore = 'INT. HOUSE - DAY\n\nsal';
    expect(cueCompletion(lore, lore.length, names)).toBeNull();
  });

  test('a name typed in full keeps Tab\'s meaning, even when a longer name starts with it', () => {
    const pair = cueNames([], [
      { name: 'Anna', type: 'character', aliases: [] },
      { name: 'Annabel', type: 'character', aliases: [] },
    ]);
    const full = 'INT. HOUSE - DAY\n\nANNA';
    expect(cueCompletion(full, full.length, pair)).toBeNull();
    // What is typed is only the start of "ANNA", so it completes to the first name that starts with it.
    const partial = 'INT. HOUSE - DAY\n\nANN';
    expect(cueCompletion(partial, partial.length, pair)).toEqual({ text: 'INT. HOUSE - DAY\n\nANNA', caret: partial.length + 1 });
  });

  test('a half-typed cue completes to the first name that starts with it, in capitals', () => {
    const text = 'INT. HOUSE - DAY\n\nmar';
    // "MARC" is the first of "MARC" and "MARCUS" in alphabetical order, and the caret ends after it.
    expect(cueCompletion(text, text.length, names)).toEqual({ text: 'INT. HOUSE - DAY\n\nMARC', caret: text.length + 1 });
  });

  test('a name already typed in full has nothing to complete, and Tab keeps its meaning', () => {
    const text = 'INT. HOUSE - DAY\n\nELENA';
    expect(cueCompletion(text, text.length, names)).toBeNull();
  });

  test('a line under other text is not a cue position, so Tab does nothing there', () => {
    const text = 'The gulls wheel.\nmar';
    expect(cueCompletion(text, text.length, names)).toBeNull();
  });

  test('leading spaces the writer typed are kept, and only the name is replaced', () => {
    const text = 'INT. HOUSE - DAY\n\n  EL';
    // The name starts after the two spaces, so the caret is two spaces and the five letters of "ELENA" past the line start.
    expect(cueCompletion(text, text.length, names)).toEqual({ text: 'INT. HOUSE - DAY\n\n  ELENA', caret: text.length + 3 });
  });
});
