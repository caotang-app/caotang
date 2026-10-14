/**
 * The `sessions.jsonl` appender — [project-format.md §1](docs/architecture/project-format.md),
 * [§4](docs/architecture/project-format.md), [§9 A5](docs/architecture/project-format.md),
 * [editor-engine.md §9](docs/architecture/editor-engine.md) and
 * [command-bus.md §9](docs/architecture/command-bus.md).
 *
 * Four sentences from the corpus, and the shape of the file falls out of them.
 *
 * **A5, quoted:** "One JSON line per session: `{startedAt, endedAt, wordsWritten,
 * docIds[]}` — spec'd here, no research needed." A line is a *session*, not a
 * write. So the unit this file accumulates is not a flush: three edits in one
 * sitting are one line, and the numbers on it are that sitting's totals.
 *
 * **§4, quoted:** "`sessions.jsonl` — append-only, never rewritten, survives
 * everything except full folder loss", and in the severity ranking, "stats =
 * `sessions.jsonl` (append-only, keep)". Append-only is the load-bearing word.
 * A log that can be rewritten is a log whose history can be edited after the
 * fact, and this one records how much a person wrote and when — the one file in
 * the artifact nobody would notice being falsified.
 *
 * **editor-engine §9, quoted:** "Session-target progress reads `sessions.jsonl`
 * (appender side-effect of `doc.write`)". And command-bus §9: "`sessions.jsonl`
 * appends are session-tracker side-effects of doc writes, **not commands**". So
 * this is a subscriber to the write path, not a participant in it: it has no
 * command, no permission class and no undo group, and it can never fail a
 * `doc.write`.
 *
 * **§8, quoted:** "**Runtime truth (v0.1):** IndexedDB … All commands read/write
 * the runtime store", with the artifact "exported on demand". In a browser the
 * canonical store for a session line is therefore the runtime store (see
 * `runtime/store.ts`'s `appendSession`/`readSessions`), and the file is its
 * projection — written by {@link writeSessionsFile} when an artifact is emitted.
 * "Never rewritten" is enforced on the *log* (no line is ever altered, reordered
 * or dropped) **and on the file's own bytes for everything already written to
 * them**, because a browser cannot hold the folder open and still honour §4's
 * temp-rename write path. The write remains one atomic `writeAtomic`; what
 * changed is the content handed to it — the file's existing bytes, plus only
 * the lines the file does not already hold. Reasoning and the rejected
 * alternatives in docs/decisions.md; the byte-level
 * half added, which also closed the one limit this header used to
 * point at.
 *
 * ## Why the word counts come in as numbers
 *
 * §9 of editor-engine pins the counting rule to the ProseMirror document
 * ("words = block text split on whitespace"), and M1 has no ProseMirror document:
 * the editor is M5. So the tracker is told `{wordsBefore, wordsAfter}` by the
 * caller that *does* have the count, rather than counting bodies itself. A local
 * word counter over Markdown would count front matter, `***` separators and `#`
 * headings, and that number would then be in the log forever — the same
 * two-rules drift an earlier change refused for the body write path. What the tracker owns is
 * the *aggregation* rule, which is where the ambiguity actually lives.
 */

import type { ArtifactFs } from './artifact-fs.js';
import { SESSIONS_FILE } from './paths.js';

// ---------------------------------------------------------------------------
// The record — §9 A5
// ---------------------------------------------------------------------------

/**
 * A5's four fields, exactly. The key order below is the key order on disk,
 * because A5 lists them in that order and the manifest already makes a point of
 * stable key order so diffs stay readable.
 */
export interface SessionRecord {
  /** ISO-8601 instant the session opened. */
  readonly startedAt: string;
  /** ISO-8601 instant it was ended and the line was appended. */
  readonly endedAt: string;
  /** Words written during the session — see {@link SessionWrite}. */
  readonly wordsWritten: number;
  /** Every document written to in the session, first touch first, no repeats. */
  readonly docIds: readonly string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Is this value a session record?
 *
 * The bar is the A5 shape and nothing stricter — a timestamp is not required to
 * parse, because a future build may write an instant this build cannot read and
 * the line is still history. The one hard requirement is that `wordsWritten` is
 * a real count: §2.1 sums it, and a string or a float in that field would make
 * the number either un-addable or silently wrong.
 */
export function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.startedAt)) return false;
  if (!isNonEmptyString(candidate.endedAt)) return false;
  if (!Number.isInteger(candidate.wordsWritten)) return false;
  if ((candidate.wordsWritten as number) < 0) return false;
  if (!Array.isArray(candidate.docIds)) return false;
  return candidate.docIds.every(isNonEmptyString);
}

/**
 * Refuse a record that is not one.
 *
 * Called on the *write* side, not only the read side: a line no reader accepts is
 * worse than a refused write, because every later read of this project's history
 * would skip it and report nothing. §4 puts this file in the tier that is kept,
 * so it is not allowed to become the tier that quietly loses lines.
 */
export function assertSessionRecord(record: SessionRecord, what: string): void {
  if (isSessionRecord(record)) return;
  throw new Error(`${what}: not a sessions.jsonl record (A5: {startedAt, endedAt, wordsWritten, docIds[]})`);
}

// ---------------------------------------------------------------------------
// The file — one JSON object per line
// ---------------------------------------------------------------------------

/** One line, no newline of its own: the caller decides the separator. */
export function serializeSessionRecord(record: SessionRecord): string {
  assertSessionRecord(record, 'serializeSessionRecord');
  // Written as an explicit object literal rather than by stringifying whatever
  // shape arrived, so the key order is this function's and not a property of
  // how the caller happened to build the record.
  return JSON.stringify({
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    wordsWritten: record.wordsWritten,
    docIds: [...record.docIds],
  });
}

export interface SerializeSessionsOptions {
  /** Line ending. `\n` by default — JSONL is a byte format and a zip of one
   * written on Windows must not differ from a zip of one written on Linux. */
  newline?: '\n' | '\r\n';
}

/** The whole `sessions.jsonl` text: one line per record, each line terminated. */
export function serializeSessionsLog(
  records: readonly SessionRecord[],
  options: SerializeSessionsOptions = {},
): string {
  const newline = options.newline ?? '\n';
  return records.map((record) => `${serializeSessionRecord(record)}${newline}`).join('');
}

export interface ParsedSessionsLog {
  /** Every line that was a well-formed A5 record, in file order. */
  readonly records: SessionRecord[];
  /**
   * Lines that were neither blank nor a well-formed record.
   *
   * Counted rather than thrown, and never silent: §4 ranks this file as stats,
   * so a corrupt line is not worth refusing a project over — but dropping one
   * without saying so is how a history quietly stops being complete.
   */
  readonly skipped: number;
}

/**
 * Read `sessions.jsonl` back.
 *
 * Blank lines are not skips — a trailing newline, an editor's habit or a
 * concatenated log all produce them, and none of them is a lost session. Both
 * `\n` and `\r\n` are accepted, because a file that travelled through a Windows
 * sync client arrives with the separator it was given.
 */
export function parseSessionsLog(text: string): ParsedSessionsLog {
  const records: SessionRecord[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!isSessionRecord(parsed)) {
      skipped += 1;
      continue;
    }
    records.push(parsed);
  }
  return { records, skipped };
}

// ---------------------------------------------------------------------------
// Writing the file
// ---------------------------------------------------------------------------

/**
 * A write that would have made the log shorter.
 *
 * §4's clause is "never rewritten … survives everything except full folder
 * loss", and the case that clause is about is not a writer editing a line — it is
 * a writer whose idea of the history is *behind* the history that is already
 * there. A cleared runtime store, an import that seeded lines the caller forgot
 * to carry, a second machine writing into a shared folder. Every one of them
 * turns "export" into "truncate", and the bytes are gone before anything failed.
 *
 * **`divergesAt` is the second shape the same clause covers, and it is the one a
 * count cannot see.** Two histories of *equal* length are not thereby the *same*
 * history: a store re-seeded with different sessions offers three lines to a file
 * holding three, and every `length`-comparison passes it while it replaces
 * recorded history with a different one. The refusal is therefore raised on a
 * line-for-line comparison, and this is where the first disagreement is named so
 * the message can point at it instead of describing a count.
 */
export class SessionsShrinkError extends Error {
  constructor(
    readonly path: string,
    readonly existingLines: number,
    readonly offeredLines: number,
    /**
     * Index of the first line the file and the export disagree about, or `-1`
     * when the refusal is the plain case — the offer is shorter than the file.
     */
    readonly divergesAt: number = -1,
  ) {
    // **KNOWN GAP: `divergesAt` is an index into the
    // *parsed* records, and this message renders it as a physical line.** Those
    // agree only while no line was skipped — `parseSessionsLog` drops
    // unparseable lines from `records` without recording their positions — so
    // every damaged line above the divergence shifts the true line up by one and
    // the offset is unbounded. Measured: 1 damaged line → names 3, real 4;
    // 3 → names 3, real 6; 7 → names 3, real 10. **The refusal is correct and
    // the file is left untouched**; the pointer is what is wrong, and it is the
    // only tool the refusal hands a human for finding the line. Fixing it means
    // carrying each record's physical line out of the parser, which is a
    // behaviour change and so is a build slice, not a review correction.
    // Pinned as-is by sessions.test.ts ("a review").
    super(
      divergesAt === -1
        ? `refusing to write ${path}: it holds ${existingLines} session lines and the export offers ${offeredLines} — writing it would drop history, and §4 says the log is never rewritten`
        : `refusing to write ${path}: its line ${divergesAt + 1} is not the line the export offers — the two histories disagree, so writing would replace recorded history with a different one, and §4 says the log is never rewritten`,
    );
    this.name = 'SessionsShrinkError';
  }
}

/**
 * Are these two lines the same session?
 *
 * Compared by **field**, not by re-serialized bytes, and the distinction is the
 * point rather than a detail: a line on disk may carry a key order this build
 * does not write, or a field A5 does not name, and a byte comparison would call
 * that a *different* history and refuse an export over it — wedging the file
 * permanently, which is the one outcome this guard must never produce. What the
 * guard asks is whether the export would *lose* what the file records, and the
 * four fields A5 names answer that. {@link docIds} is compared in order, because
 * first-touch order is part of what a line says.
 */
export function sameSessionLine(a: SessionRecord, b: SessionRecord): boolean {
  return (
    a.startedAt === b.startedAt &&
    a.endedAt === b.endedAt &&
    a.wordsWritten === b.wordsWritten &&
    a.docIds.length === b.docIds.length &&
    a.docIds.every((id, i) => id === b.docIds[i])
  );
}

export interface WriteSessionsOptions extends SerializeSessionsOptions {
  /** Omit to write {@link SESSIONS_FILE} at the project root. */
  path?: string;
}

export interface WriteSessionsReport {
  readonly path: string;
  /** False when the file already held exactly these bytes. */
  readonly written: boolean;
  /** Session lines now in the file. A line no reader accepts is carried forward
   * untouched and counted in `existingSkipped`, not here. */
  readonly lines: number;
  /** Lines the file held before, parsed. */
  readonly existingLines: number;
  /** Unparseable lines already in the file — **carried forward verbatim now,
   * not repaired here**, and reported because "reported" was half's
   * finding and the other half was that they did not survive. */
  readonly existingSkipped: number;
}

/**
 * Project the log into the artifact as `sessions.jsonl`.
 *
 * This is the *only* writer of that file, and it holds three rules:
 *
 *  1. **It never drops a line the file already holds.** A writer whose history
 *     is *behind* is a refusal, not a write — see {@link SessionsShrinkError} —
 *     and "behind" is compared line for line, because a count cannot tell a
 *     shorter history from a different one.
 *  2. **It never rewrites a byte that is already there.** An export of an
 *     unchanged project leaves the file's mtime alone, and one that *does* change
 *     it still leaves every existing byte alone.
 *  3. **It never creates a file with nothing in it.** A project with no recorded
 *     sessions has no session history, and an empty file would claim otherwise.
 *
 * ## The write is an append onto the file's own bytes, and that is what closes a review
 *
 * Rule 1 used to be `existing.records.length > records.length` — a **count**
 * standing in for a claim about **history**, and it failed three times for the
 * same reason: a count of what the *parser* understood says nothing about what is
 * on disk. The finding 2 (2026-10-01) was the lossy half and it was reproduced:
 * a file holding two readable lines and one damaged one, offered those same two
 * records, is not seen as a shrink, so the write went ahead and **destroyed the
 * damaged line** while the report said `existingSkipped: 1` as it happened; and a
 * file holding only unparseable lines was **emptied outright** by
 * `writeSessionsFile(fs, [])`. The third instance is the same guard and was not
 * in the finding: two histories of *equal* length that are not the *same*
 * history pass a count-only guard and replace recorded history with a different
 * one.
 *
 * Both are fixed by one change to what this function composes, and it is the
 * change §4 asks for rather than a patch around the guard:
 *
 * - **The bytes already on disk are the head of the next write, and are never
 *   re-serialized.** A line no reader accepts therefore keeps its exact bytes
 *   *and its exact position* — the knowledge the parser does not have is not
 *   thrown away by the writer that lacks it too. It also means a hand-written
 *   line carrying a field A5 does not name is no longer silently normalised away
 *   on the next export, which was a third loss the count-only guard could not see
 *   either.
 * - **The refusal compares the histories**, line for line, so equal length is no
 *   longer mistaken for sameness.
 *
 * **Preserve, not refuse — and the corpus had already taken this position.**
 * {@link ParsedSessionsLog}'s `skipped` says a corrupt line "is not worth
 * refusing a project over", and a refusal here has the property that makes it
 * permanent: one damaged line would wedge *every* artifact write for that project
 * until a human edited the file by hand, which is a far worse fate for a stats
 * file than carrying a bad line forward. Preserving is also the more literal
 * reading of §4: nothing is ever dropped, so nothing has to be refused.
 *
 * **The one byte this design adds.** A file whose last line is unterminated gets
 * that terminator before the first appended line, because without it the appended
 * line is glued onto the damaged one and *that* record is destroyed instead. The
 * damaged line's own text is unchanged; it simply gains the ending every line
 * this module writes already has.
 *
 * **This is still one atomic `writeAtomic`, not a per-line file append.**
 * docs/decisions.md rejected a real per-line append — `ArtifactFs` has no
 * append by design, and a crash mid-append leaves a torn line, the single failure
 * an append-only log exists to prevent — and that rejection stands. What changed
 * is the content handed to the one atomic write, not the mechanism.
 *
 * **Rejected: refusing** when the file holds a line the writer cannot read (the
 * wedge above, and it refuses a project over the very line §4 says to keep).
 * **Rejected: repairing a corrupt line**, which means choosing which of two
 * histories was real, and this file is not where that decision gets made by
 * accident.
 */
export async function writeSessionsFile(
  fs: ArtifactFs,
  records: readonly SessionRecord[],
  options: WriteSessionsOptions = {},
): Promise<WriteSessionsReport> {
  const path = options.path ?? SESSIONS_FILE;
  const newline = options.newline ?? '\n';

  let existingText: string | null = null;
  if (await fs.exists(path)) {
    existingText = await fs.read(path);
  }
  const existing = parseSessionsLog(existingText ?? '');
  const kept = existing.records.length;

  // Rule 1. The count first, because it is the case the error already described,
  // and then the lines — a shorter offer and a *different* offer are both refused
  // for the same reason and neither is a matter of degree.
  if (kept > records.length) {
    throw new SessionsShrinkError(path, kept, records.length);
  }
  for (let i = 0; i < kept; i += 1) {
    if (!sameSessionLine(existing.records[i]!, records[i]!)) {
      throw new SessionsShrinkError(path, kept, records.length, i);
    }
  }

  // Everything the file already holds is already on disk, so there is nothing to
  // do — and saying so without writing is what keeps rule 2 true even for a file
  // this function would otherwise normalise.
  const appended = serializeSessionsLog(records.slice(kept), { newline });
  if (appended === '') {
    return {
      path,
      written: false,
      lines: records.length,
      existingLines: kept,
      existingSkipped: existing.skipped,
    };
  }

  // Rules 1 and 2 together: the existing bytes, verbatim, then only what is new.
  const head = existingText ?? '';
  // **KNOWN GAP: the terminator inserted here is a
  // literal `\n`, not `newline`.** Every line this function *writes* honours the
  // option, so on an unterminated head asking for `\r\n` yields one bare LF
  // among CRLF terminators — measured, and it is the only byte in the file that
  // ignores the option. Latent rather than live: no v0.1 caller passes
  // `newline` (the export path takes the default `'\n'`, where a hardcoded
  // `'\n'` is right), and `parseSessionsLog` splits on `/\r?\n/`, so no record is
  // lost — but §4's claim is about bytes, and a mixed-terminator file is a
  // byte-format defect the moment the option is used. Pinned as-is by
  // sessions.test.ts ("a review").
  const text = head === '' || head.endsWith('\n') ? `${head}${appended}` : `${head}\n${appended}`;

  await fs.writeAtomic(path, text);
  return {
    path,
    written: true,
    lines: records.length,
    existingLines: kept,
    existingSkipped: existing.skipped,
  };
}

// ---------------------------------------------------------------------------
// The tracker
// ---------------------------------------------------------------------------

/**
 * One write's contribution to a session, as counts.
 *
 * `wordsBefore`/`wordsAfter` rather than a delta, because the per-document net
 * is the rule this file has to own: a document's contribution is how much it
 * *grew* across the session, and a delta handed in per write cannot express
 * "grow 500 here, delete 200 there" as anything other than 300 for one
 * document. See the aggregation below and docs/decisions.md.
 */
export interface SessionWrite {
  readonly docId: string;
  readonly wordsBefore: number;
  readonly wordsAfter: number;
}

/**
 * The append port.
 *
 * Bound to the runtime store by the caller as
 * `append: (request) => appendSession(store, request)` — the same shape as
 * editor-engine's `DocumentWriter` port in `runtime/autosave.ts`, and for the
 * same reason: this module must not import `runtime/store.ts`, because the store
 * imports the {@link SessionRecord} type from here. One import edge, no cycle.
 */
export type SessionAppender = (request: {
  projectId: string;
  record: SessionRecord;
}) => Promise<void>;

export interface SessionTrackerOptions {
  readonly projectId: string;
  readonly append: SessionAppender;
  /**
   * The clock seam, for the same reason `createAutosave` takes one: a session's
   * `startedAt` and `endedAt` are two separate reads, and a test that wants
   * them to say something has to control what "now" is.
   */
  readonly now?: () => Date;
}

/** What a session has accumulated so far — what a status ring would read. */
export interface SessionProgress {
  readonly startedAt: string;
  readonly wordsWritten: number;
  readonly docIds: readonly string[];
}

export interface SessionTracker {
  /** Open a session. Throws if one is already open — see below. */
  beginSession(): void;
  /** Record one write against the open session. Throws if none is open. */
  noteWrite(write: SessionWrite): void;
  /** Append the open session's line and close it. Null when none was open. */
  endSession(): Promise<SessionRecord | null>;
  /** The open session's running totals, or null. */
  pending(): SessionProgress | null;
  isOpen(): boolean;
}

/**
 * The session tracker: the thing that turns a stream of writes into "one JSON
 * line per session".
 *
 * **The state machine is one open session at a time, and both edges are loud.**
 * `noteWrite` with nothing open throws, because a write nobody can ever end
 * would be words counted into a void; `beginSession` with one open throws,
 * because the alternative — closing the old session implicitly — puts a write
 * on a lifecycle path and makes "which session was this?" a question about
 * timing. The caller ends a session before starting the next, and both edges
 * name the mistake. `runtime/autosave.ts` takes the same posture for the same
 * reason: a scheduler that guesses is a scheduler that guesses wrong silently.
 *
 * **`wordsWritten` is a per-document net, floored at zero per document.**
 *
 * A session that ends 200 words shorter because the writer deleted a scene is
 * not a session where the author wrote −200 words: `wordsWritten` is a count,
 * and a count that goes negative is a lie about the field's own domain. The
 * floor is per document rather than per session so that deleting one scene
 * cannot cancel the 500 words genuinely added to another — and it is a floor on
 * the *net*, not a sum of positive per-write deltas, because counting a
 * delete-and-retype as 2 000 words written would make a daily target (the
 * [goals-progress.md §2.1](docs/architecture/goals-progress.md) ring this number
 * feeds) reward rewriting. Alternatives and the reading they were rejected
 * against in docs/decisions.md.
 *
 * **`docIds` is first-touch order with no repeats.** The array answers "which
 * documents was this session spent in", so a document written to fifty times
 * appears once; the order is the one the writer found them in, which is what a
 * reader of the line will recognise.
 *
 * **A session is never lost to a second `beginSession`, because there is no
 * second one.** The open session ends when the caller ends it or when the page
 * goes away — and the one thing that is genuinely lost is an *unclean* close
 * (a crash, a killed tab), which takes the in-memory session with it. That bound
 * is the price of "one line per session": a line is only complete once the
 * session has ended, and §4's torn-write class cannot be defeated by writing
 * half a line.
 */
export function createSessionTracker(options: SessionTrackerOptions): SessionTracker {
  const now = options.now ?? (() => new Date());
  /** docId → the first count seen and the last count seen in this session. */
  const touched = new Map<string, { before: number; after: number }>();
  let startedAt: string | null = null;
  let order: string[] = [];

  function assertCount(value: number, what: string): void {
    if (Number.isInteger(value) && value >= 0) return;
    throw new Error(
      `${what} must be a whole number of words ≥ 0, got ${String(value)} — §9 counts words from the editor's document, and this log is kept, so a number it cannot sum must never reach it`,
    );
  }

  function wordsWritten(): number {
    let total = 0;
    for (const entry of touched.values()) {
      const net = entry.after - entry.before;
      if (net > 0) total += net;
    }
    return total;
  }

  function progress(): SessionProgress | null {
    if (startedAt === null) return null;
    return { startedAt, wordsWritten: wordsWritten(), docIds: [...order] };
  }

  return {
    beginSession(): void {
      if (startedAt !== null) {
        throw new Error(
          `a session is already open (started ${startedAt}); end it before beginning another — the log is one line per session, so an implicitly-ended one is a line with the wrong times in it`,
        );
      }
      startedAt = now().toISOString();
      touched.clear();
      order = [];
    },

    noteWrite(write: SessionWrite): void {
      if (startedAt === null) {
        throw new Error(
          `cannot count a write to "${write.docId}": no session is open — every write belongs to a session, or the words are counted into a void`,
        );
      }
      if (!isNonEmptyString(write.docId)) {
        throw new Error(`a session write needs a document id, got ${JSON.stringify(write.docId)}`);
      }
      assertCount(write.wordsBefore, `words before "${write.docId}"`);
      assertCount(write.wordsAfter, `words after "${write.docId}"`);
      const existing = touched.get(write.docId);
      if (existing) {
        existing.after = write.wordsAfter;
        return;
      }
      touched.set(write.docId, { before: write.wordsBefore, after: write.wordsAfter });
      order.push(write.docId);
    },

    async endSession(): Promise<SessionRecord | null> {
      if (startedAt === null) return null;
      const record: SessionRecord = {
        startedAt,
        endedAt: now().toISOString(),
        wordsWritten: wordsWritten(),
        docIds: [...order],
      };
      // The line is built and handed over before the session is forgotten, so a
      // rejected append (a store that is failing, a record the writer refuses)
      // surfaces to the caller with the session still open to retry — the body
      // is never quietly dropped, which is the one failure the flush path also
      // refuses to commit.
      await options.append({ projectId: options.projectId, record });
      startedAt = null;
      touched.clear();
      order = [];
      return record;
    },

    pending: progress,
    isOpen: () => startedAt !== null,
  };
}
