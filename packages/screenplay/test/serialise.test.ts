import { describe, expect, it } from 'vitest';
import { parseFountain, serialiseFountain, type ScreenplayElement } from '../src/index.js';
import { SCENE_FILE, SCRIPT_ONE_ACT, SCRIPT_TWO_DEPTHS, SCRIPT_WITH_TITLE_PAGE } from './fixtures/corpus.js';

/** The element types and texts, which is what a round trip must keep (forcing flags may be re-derived). */
const shape = (elements: readonly ScreenplayElement[]): [string, string][] =>
  elements.map((el) => [el.type, 'text' in el ? el.text : '']);

describe('serialiseFountain — round trip over the element model', () => {
  for (const [name, source] of [
    ['a scene file', SCENE_FILE],
    ['a one-act script', SCRIPT_ONE_ACT],
    ['a two-depth script', SCRIPT_TWO_DEPTHS],
    ['a script with a title page', SCRIPT_WITH_TITLE_PAGE],
  ] as const) {
    it(`parse(serialise(x)) keeps the element types and texts of ${name}`, () => {
      const first = parseFountain(source).elements;
      const again = parseFountain(serialiseFountain(first)).elements;
      expect(shape(again)).toEqual(shape(first));
    });
  }

  it('keeps dialogue that begins with a forcing character as dialogue, through a round trip', () => {
    for (const first of ['!', '@', '#', '>', '.', '=']) {
      const elements: ScreenplayElement[] = [
        { type: 'character', text: 'ANNA' },
        { type: 'dialogue', text: `${first}Get down!` },
      ];
      const again = parseFountain(serialiseFountain(elements)).elements;
      expect(shape(again), `dialogue beginning with "${first}"`).toEqual(shape(elements));
    }
  });

  it('keeps a note between a cue and its dialogue inside the block, so the dialogue stays dialogue', () => {
    const elements: ScreenplayElement[] = [
      { type: 'character', text: 'ANNA' },
      { type: 'note', text: 'production note' },
      { type: 'dialogue', text: 'Hi there.' },
    ];
    const again = parseFountain(serialiseFountain(elements)).elements;
    expect(shape(again)).toEqual(shape(elements));
  });

  it('writes a title page and the keys it had', () => {
    const elements: ScreenplayElement[] = [
      { type: 'title_page', entries: { Title: 'Keeper', Contact: 'Next Level\n1588 Mission Dr.' } },
      { type: 'scene_heading', text: 'INT. A - DAY', forced: false },
    ];
    const out = serialiseFountain(elements);
    expect(out.startsWith('Title: Keeper\nContact: Next Level\n   1588 Mission Dr.\n\nINT. A - DAY')).toBe(true);
    expect(parseFountain(out).titlePage).toEqual({ Title: 'Keeper', Contact: 'Next Level\n1588 Mission Dr.' });
  });

  it('returns the empty string for no elements', () => {
    expect(serialiseFountain([])).toBe('');
  });
});

describe('serialiseFountain — forcing only where the parser would misread', () => {
  it('forces a scene heading that is not INT, EXT, EST or I/E', () => {
    const out = serialiseFountain([{ type: 'scene_heading', text: 'The hall at dusk', forced: false }]);
    expect(out).toBe('.The hall at dusk\n');
    expect(parseFountain(out).elements[0]).toMatchObject({ type: 'scene_heading', text: 'The hall at dusk', forced: true });
  });

  it('forces an action line that would otherwise be read as a cue, and leaves ordinary action unforced', () => {
    const out = serialiseFountain([
      { type: 'action', text: 'BOOM' },
      { type: 'action', text: 'Dust falls.' },
    ]);
    expect(out).toBe('!BOOM\n\nDust falls.\n');
    expect(parseFountain(out).elements.map((el) => el.type)).toEqual(['action', 'action']);
  });

  it('forces a mixed-case cue, and a cue with no dialogue after it', () => {
    expect(serialiseFountain([{ type: 'character', text: 'McCLANE' }, { type: 'dialogue', text: 'Yippee.' }])).toBe(
      '@McCLANE\nYippee.\n',
    );
    expect(serialiseFountain([{ type: 'character', text: 'ANNA' }, { type: 'action', text: 'She leaves.' }])).toBe(
      '@ANNA\n\nShe leaves.\n',
    );
  });

  it('writes the dual marker for a dual cue', () => {
    const out = serialiseFountain([
      { type: 'character', text: 'MARCUS', dual: true },
      { type: 'dialogue', text: 'Hi.' },
    ]);
    expect(out).toBe('MARCUS ^\nHi.\n');
  });

  it('forces a transition that does not end TO:, and writes centred text between angle brackets', () => {
    expect(serialiseFountain([{ type: 'transition', text: 'FADE OUT.', forced: false }])).toBe('>FADE OUT.\n');
    expect(serialiseFountain([{ type: 'centered', text: 'THE END' }])).toBe('> THE END <\n');
  });

  it('writes sections at their depth, and notes and boneyards between their brackets', () => {
    const out = serialiseFountain([
      { type: 'section', depth: 2, text: 'Sequence' },
      { type: 'note', text: 'Check this.' },
      { type: 'boneyard', text: 'Cut.' },
    ]);
    expect(out).toBe('## Sequence\n\n[[Check this.]]\n\n/*Cut.*/\n');
  });
});
