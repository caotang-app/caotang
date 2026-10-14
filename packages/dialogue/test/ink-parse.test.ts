import { describe, expect, it } from 'vitest';

import { BLOCK_BRANCHES, COLON_GATHER, CUE_NAMES, DRAFT_OK, LOOSE_AND_DEAD, SPEAKERS, STITCH_ONLY, TAVERN, TAVERN_TAGGED, WHOLE_STORY } from './fixtures.js';
import { END_TARGET, FALLTHROUGH_TARGET, ROOT_NODE_ID, beatIds, findNode, nodeAtOffset, parseInk } from '../src/index.js';

describe('the graph of the tavern fixture', () => {
  const parsed = parseInk(TAVERN);

  it('has the root, the two knots and the stitch, in body order', () => {
    expect(parsed.graph.nodes.map((n) => [n.id, n.kind])).toEqual([
      [ROOT_NODE_ID, 'root'],
      ['tavern', 'knot'],
      ['tavern.ale', 'stitch'],
      ['leave', 'knot'],
    ]);
  });

  it('reads the root entry divert and the knot diverts', () => {
    expect(findNode(parsed.graph, ROOT_NODE_ID)?.diverts.map((d) => d.target)).toEqual(['tavern']);
    expect(findNode(parsed.graph, 'tavern.ale')?.diverts.map((d) => d.target)).toEqual(['tavern']);
    expect(findNode(parsed.graph, 'leave')?.diverts.map((d) => d.target)).toEqual([END_TARGET]);
  });

  it('gives every choice its label, once-only flag, condition and target', () => {
    const choices = parsed.graph.choices.map((c) => ({ label: c.label, target: c.target, onceOnly: c.onceOnly, condition: c.condition }));
    expect(choices).toEqual([
      { label: 'Order an ale', target: 'tavern.ale', onceOnly: true, condition: undefined },
      { label: 'Pay off the tab', target: END_TARGET, onceOnly: true, condition: 'gold > 5' },
      { label: 'Leave quietly', target: 'leave', onceOnly: false, condition: undefined },
    ]);
  });

  it('keeps the spoken lines, choice labels and speakers in body order', () => {
    expect(parsed.lines.map((l) => [l.kind, l.node, l.speaker, l.text])).toEqual([
      ['line', 'tavern', null, 'The innkeeper looks up.'],
      ['line', 'tavern', 'Innkeeper', "Ah, a traveller. What'll it be?"],
      ['choice', 'tavern', null, 'Order an ale'],
      ['choice', 'tavern', null, 'Pay off the tab'],
      ['choice', 'tavern', null, 'Leave quietly'],
      ['line', 'tavern', null, 'You slip out the door.'],
      ['line', 'tavern', null, 'Nobody stops you.'],
      ['line', 'tavern.ale', null, 'Ale arrives, foaming.'],
      ['line', 'tavern.ale', 'Innkeeper', 'Enjoy.'],
      ['line', 'leave', null, 'The street is cold.'],
    ]);
  });

  it('numbers the speakable lines from zero, and points each at its physical line', () => {
    expect(parsed.lines.map((l) => l.index)).toEqual(parsed.lines.map((_, i) => i));
    for (const line of parsed.lines) {
      expect(TAVERN.slice(line.from, line.to)).toBe(line.text);
    }
  });

  it('marks a fall-through choice when its line has no divert and its body has none', () => {
    const fall = parseInk('-> s\n=== s ===\n* Yes, please.\n  Thanks.\n- -> END\n');
    expect(fall.graph.choices.map((c) => c.target)).toEqual([FALLTHROUGH_TARGET]);
  });

  it('finds a knot by name and a body offset by its node', () => {
    const offsetInLeave = TAVERN.indexOf('The street is cold.');
    expect(nodeAtOffset(parsed.graph, offsetInLeave)?.id).toBe('leave');
    expect(beatIds(parsed.graph)).toEqual(['tavern', 'tavern.ale', 'leave']);
  });
});

describe('line ids and placement', () => {
  it('reads the id of a tagged line and of a bracketed choice label', () => {
    const parsed = parseInk(TAVERN_TAGGED);
    const ids = parsed.lines.map((l) => l.lineId);
    expect(ids).toEqual([
      'l_0000000001',
      'l_0000000002',
      'l_0000000003_c',
      'l_0000000004_c',
      'l_0000000005_c',
      'l_0000000006',
      'l_0000000007',
      'l_0000000008',
      'l_0000000009',
      'l_0000000010',
    ]);
  });

  it('takes the id of a tag-only line above when the next line has none, and says so', () => {
    const above = parseInk(TAVERN_TAGGED).lines.find((l) => l.text === 'You slip out the door.');
    expect(above?.lineId).toBe('l_0000000006');
    expect(above?.tagAbove).toBe(true);
  });

  it('places a tag by the rule the runtime measurement allows', () => {
    const parsed = parseInk(TAVERN);
    const byText = (text: string): string | undefined => parsed.lines.find((l) => l.text === text)?.mint;
    expect(byText('The innkeeper looks up.')).toBe('inline');
    expect(byText('Order an ale')).toBe('bracket');
    expect(byText('You slip out the door.')).toBe('inline');
    expect(byText('Nobody stops you.')).toBe('inline');
  });

  it('marks a content line with a divert for a tag-only line above it, not an inline tag', () => {
    const parsed = parseInk('-> s\n=== s ===\nHello there. -> t\n=== t ===\nBye.\n-> END\n');
    const hello = parsed.lines.find((l) => l.text === 'Hello there.');
    expect(hello?.mint).toBe('above');
    expect(hello?.lineStart).toBe('-> s\n=== s ===\n'.length);
  });

  it('marks a choice tail with a divert as unplaceable, since moving the divert changes the output', () => {
    const parsed = parseInk('-> s\n=== s ===\n* [Yes] Oh yes. -> t\n=== t ===\nBye.\n-> END\n');
    const tail = parsed.lines.find((l) => l.text === 'Oh yes.');
    expect(tail?.mint).toBe('none');
  });

  it('keeps a malformed tag as malformed, and never as an id', () => {
    const parsed = parseInk('-> s\n=== s ===\nHi. # lineId: l_OOPS\n-> END\n');
    const hi = parsed.lines.find((l) => l.text === 'Hi.');
    expect(hi?.lineId).toBeNull();
    expect(hi?.malformedId).toBe('l_OOPS');
  });

  it('refuses a choice id without the _c suffix, and a content id with it', () => {
    const parsed = parseInk('-> s\n=== s ===\n* [Yes # lineId: l_0000000001] -> END\nHi. # lineId: l_0000000002_c\n-> END\n');
    expect(parsed.lines.find((l) => l.kind === 'choice')?.malformedId).toBe('l_0000000001');
    expect(parsed.lines.find((l) => l.text === 'Hi.')?.malformedId).toBe('l_0000000002_c');
  });
});

describe('the parse reads what Ink reads', () => {
  it('ignores comments without moving any offset', () => {
    const body = '-> s\n=== s ===\n// Alice: not a line\nHi there. // a note\n/* a block\nspanning lines */ Yo.\n-> END\n';
    const parsed = parseInk(body);
    expect(parsed.lines.map((l) => l.text)).toEqual(['Hi there.', 'Yo.']);
    for (const line of parsed.lines) expect(body.slice(line.from, line.to)).toBe(line.text);
  });

  it('keeps offsets exact under CRLF line endings', () => {
    const body = TAVERN.replace(/\n/g, '\r\n');
    const parsed = parseInk(body);
    expect(parsed.lines.length).toBe(10);
    for (const line of parsed.lines) expect(body.slice(line.from, line.to)).toBe(line.text);
  });

  it('lists variables with their defaults and leaves function bodies out of the graph', () => {
    const parsed = parseInk(WHOLE_STORY);
    expect(parsed.graph.variables.map((v) => [v.name, v.default])).toEqual([
      ['coins', '0'],
      ['unused_flag', 'false'],
    ]);
    expect(parsed.graph.functions.map((f) => f.name)).toEqual(['bump']);
    expect(parsed.graph.nodes.some((n) => n.id === 'bump')).toBe(false);
  });

  it('reads a gather label and resolves a divert to it inside the same knot', () => {
    const parsed = parseInk('-> s\n=== s ===\n* [Go]\n  -> hold\n- (hold) Waiting.\n-> END\n');
    const choice = parsed.graph.choices[0];
    expect(choice?.target).toBe('s');
  });

  it('keeps a speaker prefix off a choice label', () => {
    const parsed = parseInk('-> s\n=== s ===\n* Yes: sure\n  Good.\n- -> END\n');
    expect(parsed.graph.choices.map((c) => c.label)).toEqual(['Yes: sure']);
  });

  it('does not take a sentence with a colon for a speaker', () => {
    const parsed = parseInk('-> s\n=== s ===\nThe sign said: keep out.\n-> END\n');
    expect(parsed.lines[0]?.speaker).toBeNull();
    expect(parsed.lines[0]?.text).toBe('The sign said: keep out.');
  });

  it('stops at a knot header and reports which knot a stitch belongs to', () => {
    const parsed = parseInk(STITCH_ONLY);
    expect(findNode(parsed.graph, 'hub.a')?.knot).toBe('hub');
    expect(findNode(parsed.graph, 'hub')?.to).toBe(STITCH_ONLY.indexOf('= a'));
  });

  it('reads the speakers of a cue-style script', () => {
    const parsed = parseInk(SPEAKERS);
    expect(parsed.lines.map((l) => l.speaker)).toEqual(['Alice', 'Bob', 'Lantern']);
  });

  it('reports an unknown divert target as a parse warning, not a crash', () => {
    const parsed = parseInk('-> s\n=== s ===\nHi.\n-> nowhere\n');
    expect(parsed.graph.warnings.map((w) => w.message)).toEqual(['divert target "nowhere" is not a knot, stitch or label in this body']);
  });

  it('reads a draft with a new knot as one beat', () => {
    expect(beatIds(parseInk(DRAFT_OK).graph)).toEqual(['reply']);
  });

  it('lists the lines of a knot whose flow runs out, so a loose end can be placed on its node', () => {
    const parsed = parseInk(LOOSE_AND_DEAD);
    expect(findNode(parsed.graph, 'middle')?.lines.map((l) => l.text)).toEqual(['The room is quiet.']);
  });
});

describe('branches, cues and gathers', () => {
  it('drops the value of each branch of an open conditional block, and speaks the text after it', () => {
    const parsed = parseInk(BLOCK_BRANCHES);
    expect(parsed.lines.map((l) => [l.speaker, l.text])).toEqual([
      [null, 'Glad to see you.'],
      [null, 'Oh no.'],
      [null, 'Hmm.'],
    ]);
  });

  it('skips a bare branch opener, since its text is on the lines below it', () => {
    const parsed = parseInk(BLOCK_BRANCHES);
    expect(parsed.lines.some((l) => l.text === '2:' || l.text === 'else:')).toBe(false);
  });

  it('reads a cue whose name opens with a Unicode capital as a speaker, and keeps the cue out of the text', () => {
    const parsed = parseInk(CUE_NAMES);
    expect(parsed.lines.map((l) => [l.speaker, l.text])).toEqual([
      ['Zoë', 'Bonjour.'],
      ['Émile', 'Salut.'],
      [null, 'Plain line.'],
    ]);
  });

  it('keeps a gather line that ends in a colon as speech when no conditional block is open', () => {
    const parsed = parseInk(COLON_GATHER);
    expect(parsed.lines.map((l) => l.text)).toEqual(['Hi.', 'Here they are:', 'Nice.']);
  });

  it('closes a conditional block at its brace, so a gather after it is speech again', () => {
    const parsed = parseInk('VAR mood = 1\n-> s\n=== s ===\n{ mood:\n- 1: One.\n}\n- Here they are:\n-> END\n');
    expect(parsed.lines.map((l) => l.text)).toEqual(['One.', 'Here they are:']);
  });
});
