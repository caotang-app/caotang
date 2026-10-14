/**
 * The notes field's reading (ui-modules §4.1): the agent's divider line, `— agent, <date>`, is a separator and not text.
 * The store writes the divider with `notes.append` (commands.ts), and this is the one place that reads it back.
 */

/** A piece of the notes: a run of the writer's own lines, or a divider the agent's append left (with its date). */
export type NotesSegment = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'divider'; readonly date: string };

/** The divider line exactly as `notes.append` writes it: an em dash, `agent,`, and a `YYYY-MM-DD` date. */
const DIVIDER = /^— agent, (\d{4}-\d{2}-\d{2})$/;

/**
 * Splits notes into text runs and dividers, in order. A run keeps its line breaks, and blank lines at the edges of a run are
 * dropped, so the separator sits between two paragraphs and not inside one. Notes with no divider come back as one run.
 */
export function splitNotes(notes: string): NotesSegment[] {
  const segments: NotesSegment[] = [];
  let run: string[] = [];
  const flush = (): void => {
    while (run.length > 0 && run[0]?.trim() === '') run.shift();
    while (run.length > 0 && run[run.length - 1]?.trim() === '') run.pop();
    if (run.length > 0) segments.push({ kind: 'text', text: run.join('\n') });
    run = [];
  };
  for (const line of notes.split('\n')) {
    const match = DIVIDER.exec(line.trim());
    if (match !== null) {
      flush();
      segments.push({ kind: 'divider', date: match[1] ?? '' });
    } else {
      run.push(line);
    }
  }
  flush();
  return segments;
}

/** Whether the notes carry at least one agent divider, so the read view has a separator to show. */
export function hasDivider(notes: string): boolean {
  return splitNotes(notes).some((segment) => segment.kind === 'divider');
}
