import { describe, expect, it } from 'vitest';
import { parseFountain, printedText, type ScreenplayElement } from '../src/index.js';
import { SCENE_FILE, SCRIPT_ONE_ACT, SCRIPT_WITH_TITLE_PAGE, text } from './fixtures/corpus.js';

const kinds = (source: string): string[] => parseFountain(source).elements.map((el) => el.type);

/** The text of an element, or undefined for the elements that carry none. */
const textOf = (el: ScreenplayElement | undefined): string | undefined => (el !== undefined && 'text' in el ? el.text : undefined);

describe('parseFountain — element inference', () => {
  it('reads a scene file as heading, synopsis, action, cue, parenthetical, dialogue, transition', () => {
    expect(kinds(SCENE_FILE)).toEqual([
      'scene_heading',
      'synopsis',
      'action',
      'character',
      'parenthetical',
      'dialogue',
      'transition',
    ]);
  });

  it('takes every scene-heading prefix from the spec, case-insensitively, after a blank line', () => {
    const source = text('EXT. ROOF - DAY', '', 'EST. PARK - DUSK', '', 'I/E. CAR - NIGHT', '', 'int. kitchen - day');
    expect(kinds(source)).toEqual(['scene_heading', 'scene_heading', 'scene_heading', 'scene_heading']);
  });

  it('reads a heading-like line inside a block as action, not as a heading', () => {
    expect(kinds(text('She waits.', 'INT. HALL - NIGHT is where she is.'))).toEqual(['action']);
    expect(textOf(parseFountain(text('She waits.', 'INT. HALL - NIGHT is where she is.')).elements[0])).toBe(
      'She waits.\nINT. HALL - NIGHT is where she is.',
    );
  });

  it('reads an uppercase line as a cue only when the next line is text', () => {
    expect(kinds(text('THE END'))).toEqual(['action']);
    expect(kinds(text('ANNA', 'Hello.'))).toEqual(['character', 'dialogue']);
  });

  it('keeps a cue extension in the name and strips the dual marker into a flag', () => {
    const [cue] = parseFountain(text('MARCUS (V.O.) ^', 'Hi.')).elements;
    expect(cue).toMatchObject({ type: 'character', text: 'MARCUS (V.O.)', dual: true });
  });

  it('reads a parenthetical only inside a dialogue block, and dialogue resumes after it', () => {
    const source = text('ANNA', '(beat)', 'Fine.', 'Really.');
    const elements = parseFountain(source).elements;
    expect(elements.map((el) => el.type)).toEqual(['character', 'parenthetical', 'dialogue']);
    expect(textOf(elements[2])).toBe('Fine.\nReally.');
  });

  it('reads a transition only as uppercase ending TO:, at a block start', () => {
    expect(kinds(text('SMASH CUT TO:'))).toEqual(['transition']);
    expect(kinds(text('She said cut to:'))).toEqual(['action']);
  });

  it('reads a centered line between angle brackets and a page break as three equals signs', () => {
    expect(kinds(text('> THE END <', '', '==='))).toEqual(['centered', 'page_break']);
  });
});

describe('parseFountain — forcing characters', () => {
  it('honours each forcing character and strips it from the text', () => {
    const source = text(
      '.Forced heading',
      '',
      '!Forced action',
      '',
      '@McCLANE',
      'Yippee.',
      '',
      '> Forced transition',
    );
    const elements = parseFountain(source).elements;
    expect(elements.map((el) => el.type)).toEqual(['scene_heading', 'action', 'character', 'dialogue', 'transition']);
    expect(elements[0]).toMatchObject({ text: 'Forced heading', forced: true });
    expect(elements[1]).toMatchObject({ text: 'Forced action', forced: true });
    expect(elements[2]).toMatchObject({ text: 'McCLANE', forced: true });
    expect(elements[4]).toMatchObject({ text: 'Forced transition', forced: true });
  });

  it('does not read an ellipsis as a forced heading', () => {
    expect(kinds(text('...and then'))).toEqual(['action']);
  });
});

describe('parseFountain — notes, boneyards, sections and synopses', () => {
  it('keeps a whole-line note as a note element and an inline note inside its line, as written', () => {
    const elements = parseFountain(text('[[A note.]]', '', 'She [[check this]] waits.')).elements;
    expect(elements.map((el) => el.type)).toEqual(['note', 'action']);
    expect(textOf(elements[0])).toBe('A note.');
    // The element keeps the note, so the Fountain round trip is unchanged. Printing removes it.
    expect(textOf(elements[1])).toBe('She [[check this]] waits.');
    expect(printedText(textOf(elements[1]) ?? '')).toBe('She waits.');
  });

  it('joins a boneyard that spans lines into one element', () => {
    const elements = parseFountain(text('/* first line', '   second line */', '', 'After.')).elements;
    expect(elements.map((el) => el.type)).toEqual(['boneyard', 'action']);
    expect(textOf(elements[0])).toBe('first line\n   second line');
  });

  it('records section depth and the synopsis of a scene', () => {
    const elements = parseFountain(text('# ACT ONE', '## Sequence', '### Scene group', '= Summary.')).elements;
    expect(elements.map((el) => el.type)).toEqual(['section', 'section', 'section', 'synopsis']);
    expect(elements.slice(0, 3).map((el) => (el.type === 'section' ? el.depth : 0))).toEqual([1, 2, 3]);
    expect(textOf(elements[3])).toBe('Summary.');
  });

  it('reads a section marker deeper than three as depth three, so nothing is lost as action', () => {
    const elements = parseFountain(text('#### Deep', '', '# ACT')).elements;
    expect(elements.map((el) => (el.type === 'section' ? [el.depth, el.text] : el.type))).toEqual([
      [3, 'Deep'],
      [1, 'ACT'],
    ]);
  });

  it('says so when a boneyard is never closed, since it hides everything after it', () => {
    expect(parseFountain('Before.\n\n/* never closed').notices).toEqual([
      'An unclosed boneyard runs to the end of the source; it is not printed.',
    ]);
    expect(parseFountain(SCENE_FILE).notices).toEqual([]);
  });
});

describe('parseFountain — annotations inside lines and around blocks (screenplay.md §2.1)', () => {
  it('reads a boneyard before text, and a note after text, as text: the printed line keeps only the text', () => {
    const elements = parseFountain(text('/* cut */ Action here.', '', 'Trailing text /* gone */')).elements;
    expect(elements.map((el) => el.type)).toEqual(['action', 'action']);
    expect(elements.map((el) => printedText(textOf(el) ?? ''))).toEqual(['Action here.', 'Trailing text']);
  });

  it('reads the text after the closer of a multi-line boneyard as a line of its own', () => {
    const elements = parseFountain(text('/* a', ' b */ JOHN says hi.', '', 'Next.')).elements;
    expect(elements.map((el) => el.type)).toEqual(['boneyard', 'action', 'action']);
    expect(textOf(elements[0])).toBe('a\n b');
    expect(textOf(elements[1])).toBe('JOHN says hi.');
    expect(textOf(elements[2])).toBe('Next.');
  });

  it('gives the text after a closer the range of the closing line', () => {
    const closing = ' b */ JOHN says hi.';
    const elements = parseFountain(text('/* a', closing)).elements;
    expect(elements[1]?.range).toEqual({ from: 5, to: 5 + closing.length });
  });

  it('keeps an annotation between a cue and its dialogue transparent, so the dialogue stays dialogue', () => {
    expect(kinds(text('ANNA', '[[production note]]', 'Hi there.'))).toEqual(['character', 'note', 'dialogue']);
    expect(kinds(text('ANNA', '/* a */', 'Hi there.'))).toEqual(['character', 'boneyard', 'dialogue']);
    expect(kinds(text('ANNA', '/* a', 'b */', 'Hi there.'))).toEqual(['character', 'boneyard', 'dialogue']);
  });

  it('reads a cue only when dialogue follows it, looking past annotations', () => {
    expect(kinds(text('ANNA', '[[x]]', '', 'Hi.'))).toEqual(['action', 'note', 'action']);
    expect(kinds(text('ANNA', '[[x]]', 'Hi.'))).toEqual(['character', 'note', 'dialogue']);
  });

  it('does not read a line before a forced page break as a cue, since the break is not dialogue', () => {
    expect(kinds(text('ANNA', '===', 'Hi.'))).toEqual(['action', 'page_break', 'action']);
  });

  it('prints a boneyard that opens mid-line and closes on the next line out of its paragraph', () => {
    const elements = parseFountain(text('Before /* x', 'y */ after.')).elements;
    expect(elements.map((el) => el.type)).toEqual(['action']);
    expect(printedText(textOf(elements[0]) ?? '')).toBe('Before after.');
  });

  it('does not split a paragraph at an annotation that sits inside it', () => {
    const elements = parseFountain(text('Before.', '[[note]]', 'After.')).elements;
    expect(elements.map((el) => el.type)).toEqual(['action', 'note']);
    expect(textOf(elements[0])).toBe('Before.\nAfter.');
  });

  it('reads a forcing character inside an open dialogue block as dialogue text', () => {
    const elements = parseFountain(text('ANNA', '!Get down!', '@home', '#1 rule', '> no', '.5 seconds', '= x')).elements;
    expect(elements.map((el) => el.type)).toEqual(['character', 'dialogue']);
    expect(textOf(elements[1])).toBe('!Get down!\n@home\n#1 rule\n> no\n.5 seconds\n= x');
  });

  it('reads Cyrillic and Greek cues, dialogue and transitions by their letter case', () => {
    const source = text('ИВАН', 'Привет.', '', 'ΝΙΚΟΣ', 'Γεια.', '', 'ЖЁСТКИЙ ПЕРЕХОД TO:');
    const elements = parseFountain(source).elements;
    expect(elements.map((el) => el.type)).toEqual(['character', 'dialogue', 'character', 'dialogue', 'transition']);
    expect(textOf(elements[0])).toBe('ИВАН');
    expect(textOf(elements[2])).toBe('ΝΙΚΟΣ');
  });

  it('keeps mixed-case Cyrillic text as action, as mixed-case Latin is', () => {
    expect(kinds(text('Иван', 'Привет.'))).toEqual(['action']);
  });
});

describe('parseFountain — title page, dual cues and scene spans', () => {
  it('reads the title page as the first element, with continuation lines joined', () => {
    const parsed = parseFountain(text('Title: The Keeper', 'Contact:', '   Next Level', '   1588 Mission Dr.', '', 'INT. A - DAY'));
    expect(parsed.titlePage).toEqual({ Title: 'The Keeper', Contact: 'Next Level\n1588 Mission Dr.' });
    expect(parsed.elements[0]).toMatchObject({ type: 'title_page' });
    expect(parsed.elements[1]?.type).toBe('scene_heading');
  });

  it('returns no title page when the source starts with a body element', () => {
    expect(parseFountain(SCENE_FILE).titlePage).toBeNull();
    expect(parseFountain(SCRIPT_WITH_TITLE_PAGE).titlePage).toMatchObject({ Title: 'The Lighthouse Keeper' });
  });

  it('lists scene headings in order with their scene numbers stripped from the heading', () => {
    const parsed = parseFountain(text('INT. HALL - DAY #24A#', '', 'Action.', '', 'EXT. YARD - NIGHT'));
    expect(parsed.scenes).toEqual([
      expect.objectContaining({ index: 0, heading: 'INT. HALL - DAY', sceneNumber: '24A' }),
      expect.objectContaining({ index: 1, heading: 'EXT. YARD - NIGHT', sceneNumber: null }),
    ]);
  });

  it('gives every element a source range that covers its own lines', () => {
    const source = SCRIPT_ONE_ACT;
    for (const el of parseFountain(source).elements) {
      const slice = source.slice(el.range.from, el.range.to);
      if (el.type === 'scene_heading') expect(slice.startsWith(el.text)).toBe(true);
      expect(el.range.to).toBeGreaterThanOrEqual(el.range.from);
    }
  });

  it('reads CRLF input and a leading byte-order mark to the same elements as LF input', () => {
    const lf = parseFountain(SCRIPT_ONE_ACT).elements.map((el) => [el.type, textOf(el)]);
    const crlf = parseFountain(`\uFEFF${SCRIPT_ONE_ACT.replace(/\n/g, '\r\n')}`).elements.map((el) => [el.type, textOf(el)]);
    expect(crlf).toEqual(lf);
  });

  it('never throws on malformed input and reads an unclosed boneyard to the end of the source', () => {
    expect(() => parseFountain('\u0000 ==== /* [[ @ ! > . = # ')).not.toThrow();
    const elements = parseFountain('Before.\n\n/* never closed').elements;
    expect(elements.map((el) => el.type)).toEqual(['action', 'boneyard']);
    expect(parseFountain('').elements).toEqual([]);
  });
});
