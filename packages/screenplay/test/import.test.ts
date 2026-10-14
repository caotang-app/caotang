import { describe, expect, it } from 'vitest';
import { importFountainScript, type ImportedScene } from '../src/index.js';
import { SCRIPT_ONE_ACT, SCRIPT_RESIDUE, SCRIPT_WITH_TITLE_PAGE, text } from './fixtures/corpus.js';

function scenes(source: string): ImportedScene[] {
  return importFountainScript(source).nodes.filter((node): node is ImportedScene => node.kind === 'scene');
}

describe('importFountainScript — structure (screenplay.md §2.2)', () => {
  it('maps sections to section nodes and each scene heading to one scene node, in order', () => {
    const nodes = importFountainScript(SCRIPT_ONE_ACT).nodes;
    expect(nodes.map((node) => (node.kind === 'section' ? `section:${node.title}` : `scene:${node.title}`))).toEqual([
      'section:ACT ONE',
      'scene:INT. HOUSE - DAY',
      'scene:EXT. STREET - NIGHT',
      'scene:INT. ROOM - CONTINUOUS',
    ]);
  });

  it('takes the first = line as the synopsis and removes it from the body', () => {
    const [first, second, third] = scenes(SCRIPT_ONE_ACT);
    expect(first?.synopsis).toBe('Elena returns to the island.');
    expect(second?.synopsis).toBe('The rain starts.');
    expect(third?.synopsis).toBe('');
    expect(first?.body.split('\n').some((line) => line.startsWith('='))).toBe(false);
  });

  it('keeps each scene body as its own verbatim Fountain text, heading first and without surrounding blank lines', () => {
    const [first] = scenes(SCRIPT_ONE_ACT);
    expect(first?.body).toBe(
      [
        'INT. HOUSE - DAY',
        '',
        'Action paragraph here. More action.',
        '',
        'ELENA',
        '(quietly)',
        "I'm home.",
        '',
        'MARCUS (V.O.)',
        'Took you long enough.',
      ].join('\n'),
    );
  });

  it('strips a scene number from the title and reports it separately', () => {
    const [scene] = scenes(text('INT. HALL - DAY #24A#', '', 'Action.'));
    expect(scene).toMatchObject({ title: 'INT. HALL - DAY', heading: 'INT. HALL - DAY #24A#', sceneNumber: '24A' });
  });

  it('gives a section its own = line when the line sits directly under it', () => {
    const [section] = importFountainScript(text('# ACT ONE', '= Act summary.', '', 'INT. A - DAY')).nodes;
    expect(section).toMatchObject({ kind: 'section', title: 'ACT ONE', synopsis: 'Act summary.' });
  });

  it('keeps text before the first heading as an untitled scene, with a notice', () => {
    const script = importFountainScript(text('Opening action.', '', 'INT. A - DAY', '', 'x'));
    const [preamble] = script.nodes;
    expect(preamble).toMatchObject({ kind: 'scene', title: 'Untitled', heading: null, body: 'Opening action.' });
    expect(script.notices).toContain('Text before the first scene heading became an untitled scene.');
  });

  it('returns the title page without storing it in any scene', () => {
    const script = importFountainScript(SCRIPT_WITH_TITLE_PAGE);
    expect(script.titlePage).toMatchObject({ Title: 'The Lighthouse Keeper', Author: 'N. Attini' });
    expect(script.nodes).toHaveLength(1);
    expect(scenes(SCRIPT_WITH_TITLE_PAGE)[0]?.body).toBe(
      ['INT. LIGHTHOUSE - NIGHT', '', 'The lamp turns.', '', 'ELENA', "Who's there?"].join('\n'),
    );
  });

  it('leaves lengthEighths empty when the source carries no length', () => {
    expect(scenes(SCRIPT_ONE_ACT).every((scene) => scene.lengthEighths === null)).toBe(true);
  });
});

describe('importFountainScript — residue (screenplay.md §2.2 and A5)', () => {
  it('keeps the first stray synopsis, drops the rest with a notice, and closes the gap they leave', () => {
    const script = importFountainScript(SCRIPT_RESIDUE);
    const [scene] = scenes(SCRIPT_RESIDUE);
    expect(scene).toMatchObject({ synopsis: 'A stray synopsis.', droppedSynopses: 1 });
    expect(scene?.body).toBe(['INT. HOUSE - DAY', '', 'Action first.', '', 'More action.'].join('\n'));
    expect(script.notices.join(' ')).toMatch(/1 extra synopsis line dropped/);
  });

  it('drops a second synopsis under a section, with a notice, and opens no untitled scene for it', () => {
    const script = importFountainScript(text('# ACT ONE', '= one', '= two', '', 'INT. A - DAY', '', 'Action.'));
    expect(script.nodes.map((node) => node.kind)).toEqual(['section', 'scene']);
    expect(script.nodes[0]).toMatchObject({ kind: 'section', title: 'ACT ONE', synopsis: 'one' });
    expect(script.nodes[1]).toMatchObject({ kind: 'scene', title: 'INT. A - DAY', synopsis: '' });
    expect(script.notices.join(' ')).toMatch(/"ACT ONE": extra synopsis line dropped; the first is kept\./);
  });
});
