/**
 * The screenplay fixture corpus. Every string is written out in full so that the byte-level
 * assertions (the Fountain round trip, the element round trip) read the exact text.
 *
 * `text(...)` joins lines with `\n` and ends the document with one, which is the form the
 * Fountain round trip returns (screenplay.md §5.1).
 */

export function text(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** A single scene file, the way a screenplay document's body is stored (screenplay.md §2.1). */
export const SCENE_FILE = text(
  'INT. HOUSE - DAY',
  '= Elena returns to the island.',
  '',
  'Action paragraph here. More action.',
  '',
  'ELENA',
  '(quietly)',
  "I'm home.",
  '',
  'CUT TO:',
);

/**
 * A whole script with one act. It is canonical: one blank line between blocks and the
 * synopsis directly under each heading. Its Fountain export is byte-identical (screenplay.md §5.1).
 */
export const SCRIPT_ONE_ACT = text(
  '# ACT ONE',
  '',
  'INT. HOUSE - DAY',
  '= Elena returns to the island.',
  '',
  'Action paragraph here. More action.',
  '',
  'ELENA',
  '(quietly)',
  "I'm home.",
  '',
  'MARCUS (V.O.)',
  'Took you long enough.',
  '',
  'EXT. STREET - NIGHT',
  '= The rain starts.',
  '',
  'Rain.',
  '',
  '[[Fix this shot in the edit.]]',
  '',
  '/* A cut scene.',
  '   Still boneyard. */',
  '',
  'ELENA ^',
  'Dual speech.',
  '',
  'MARCUS ^',
  'Dual reply.',
  '',
  '===',
  '',
  'INT. ROOM - CONTINUOUS',
  '',
  '!THE END?',
  '',
  '> FADE OUT.',
  '',
  '> THE END <',
);

/** Two section depths. The export gives every section a `#` line, the documented synthesis (screenplay.md §2.2). */
export const SCRIPT_TWO_DEPTHS = text(
  '# ACT ONE',
  '',
  '## Sequence A',
  '',
  'INT. HOUSE - DAY',
  '= Opening.',
  '',
  'Action.',
  '',
  '# ACT TWO',
  '',
  'EXT. STREET - NIGHT',
  '',
  'More.',
);

/**
 * A section with a synopsis under its `#` line, the way the importer reads it back (screenplay.md §2.2). Canonical, so its
 * Fountain export is byte-identical: the section synopsis rides the flattened chapter block and is written as its `=` line.
 */
export const SCRIPT_SECTION_SYNOPSIS = text(
  '# ACT ONE',
  '= The keeper keeps the light.',
  '',
  'INT. HOUSE - DAY',
  '',
  'Action.',
);

/**
 * A non-canonical script: CRLF line endings, three blank lines between blocks, a scene synopsis, and trailing blank lines.
 * Its export is the same script in canonical form (render-fountain.ts, "what the round trip normalises"), and the test
 * pins that form exactly, so the normalisation cannot change without the test saying so.
 */
export const SCRIPT_NON_CANONICAL = [
  '# ACT ONE',
  '= The keeper keeps the light.',
  '',
  '',
  '',
  'INT. HOUSE - DAY',
  '= Elena returns.',
  '',
  'Action.',
  '',
  '',
  '',
  'INT. ROOM - DAY',
  '',
  'More.',
  '',
  '',
  '',
].join('\r\n');

/** The canonical form of {@link SCRIPT_NON_CANONICAL}: LF endings, one blank line between blocks, one final newline. */
export const SCRIPT_NON_CANONICAL_CANONICAL = text(
  '# ACT ONE',
  '= The keeper keeps the light.',
  '',
  'INT. HOUSE - DAY',
  '= Elena returns.',
  '',
  'Action.',
  '',
  'INT. ROOM - DAY',
  '',
  'More.',
);

/** The title page and a short body. The title page is not stored per file (screenplay.md §2.2). */
export const SCRIPT_WITH_TITLE_PAGE = text(
  'Title: The Lighthouse Keeper',
  'Credit: Written by',
  'Author: N. Attini',
  'Draft date: 2026-10-08',
  '',
  'INT. LIGHTHOUSE - NIGHT',
  '',
  'The lamp turns.',
  '',
  'ELENA',
  "Who's there?",
);

/** `=` lines out of place: one under no heading, and two in a row. Residue, not a second truth (screenplay.md §2.2). */
export const SCRIPT_RESIDUE = text(
  'INT. HOUSE - DAY',
  '',
  'Action first.',
  '',
  '= A stray synopsis.',
  '',
  '= A second stray line.',
  '',
  'More action.',
);

/** A FDX document with every paragraph type, entities, a scene length and a dual-dialogue pair. */
export const FDX_SAMPLE = [
  '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
  '<FinalDraft DocumentType="Script" Template="No" Version="3">',
  '  <Content>',
  '    <Paragraph Type="Scene Heading">',
  '      <SceneProperties Length="8" Page="1" Title="" />',
  '      <Text>INT. HOUSE - DAY</Text>',
  '    </Paragraph>',
  '    <Paragraph Type="Action">',
  '      <Text>Elena &amp; Marcus enter. &quot;Quiet,&quot; she says.</Text>',
  '    </Paragraph>',
  '    <Paragraph Type="Character"><Text>ELENA</Text></Paragraph>',
  '    <Paragraph Type="Parenthetical"><Text>(whispering)</Text></Paragraph>',
  "    <Paragraph Type=\"Dialogue\"><Text>I'm home.</Text></Paragraph>",
  '    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>',
  '    <Paragraph Type="Scene Heading"><Text>EXT. STREET - NIGHT</Text></Paragraph>',
  '    <Paragraph Type="Action"><Text></Text></Paragraph>',
  '    <Paragraph Type="General"><Text>THE END</Text></Paragraph>',
  '    <Paragraph Type="General" Alignment="Center"><Text>FIN</Text></Paragraph>',
  '    <DualDialogue>',
  '      <Paragraph Type="Character"><Text>ELENA</Text></Paragraph>',
  '      <Paragraph Type="Dialogue"><Text>Left.</Text></Paragraph>',
  '      <Paragraph Type="Character"><Text>MARCUS</Text></Paragraph>',
  '      <Paragraph Type="Dialogue"><Text>Right.</Text></Paragraph>',
  '    </DualDialogue>',
  '  </Content>',
  '</FinalDraft>',
  '',
].join('\n');
