/**
 * The `sessions.jsonl` appender — [project-format.md §1/§4](docs/architecture/project-format.md),
 * [§9 A5](docs/architecture/project-format.md), [editor-engine.md §9](docs/architecture/editor-engine.md)
 * and [command-bus.md §9](docs/architecture/command-bus.md).
 *
 * Every test names the sentence it defends, and the shape of the suite follows
 * the shape of the spec: a test that would still pass with the feature deleted is
 * worse than no test, so the claims that matter are tested as *refusals and
 * absences* — eleven sessions in, still eleven lines out and still in order; a
 * write with no session open, refused; an export that knows less than the file
 * already holds, refused.
 *
 * The word counts in here are supplied by the caller, because §9's counting rule
 * belongs to the editor's ProseMirror document, which the store does not have. A local
 * `countWords` over Markdown would count front matter and `#` headings, and that
 * number would be in the log forever.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryArtifactFs,
  SessionsShrinkError,
  appendSession,
  createAutosave,
  createEmptyManifest,
  createProjectState,
  createSessionTracker,
  deleteProject,
  isSessionRecord,
  openRuntimeStore,
  parseSessionsLog,
  readSessions,
  serializeSessionRecord,
  serializeSessionsLog,
  writeDocumentBody,
  writeProjectState,
  writeSessionsFile,
  type ProjectState,
  type RuntimeStore,
  type SessionRecord,
} from '../src/index.js';
import { MemoryIndexedDb } from '../src/runtime/memory-idb.js';
import { SESSION_STORE } from '../src/runtime/store.js';

const DB = 'caotang-sessions-test';
const PROJECT = 'p_9XK2M4Q7RZ';
const OTHER = 'p_1AAAA2BBBB';
const SCENE = 'n_7K2QX9M4A1';
const CHAPTER = 'n_3W8RN2TQ6C';

const SESSION_START = new Date('2026-09-30T04:40:00.000Z');
const SESSION_END = new Date('2026-09-30T05:05:00.000Z');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * A clock the test moves by hand, so `startedAt`/`endedAt` say something.
 *
 * It does not move on its own: a clock that advanced on every read would make a
 * session's two timestamps depend on how many times the code under test asked
 * what time it was, which is a coupling worth not having in the assertions.
 */
class ManualClock {
  constructor(private current: Date) {}
  now = (): Date => this.current;
  advance(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startedAt: SESSION_START.toISOString(),
    endedAt: SESSION_END.toISOString(),
    wordsWritten: 0,
    docIds: [],
    ...overrides,
  };
}

const opened: RuntimeStore[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

async function freshStore(): Promise<{ factory: MemoryIndexedDb; store: RuntimeStore }> {
  const factory = new MemoryIndexedDb();
  const store = await openRuntimeStore(factory, DB);
  opened.push(store);
  return { factory, store };
}

/** The production binding, composed the way an app would compose it. */
function trackerFor(store: RuntimeStore, clock?: () => Date) {
  return createSessionTracker({
    projectId: PROJECT,
    append: (request) => appendSession(store, request),
    ...(clock ? { now: clock } : {}),
  });
}

function fixtureProject(): ProjectState {
  const manifest = createEmptyManifest('The Lighthouse Keeper', SESSION_START);
  manifest.project.id = PROJECT;
  return createProjectState(manifest);
}

// ---------------------------------------------------------------------------
// A5 — the line
// ---------------------------------------------------------------------------

describe('§9 A5 — one JSON line per session', () => {
  it('three writes in one sitting are one line, byte-exact', async () => {
    // A5: "One JSON line per session: {startedAt, endedAt, wordsWritten, docIds[]}".
    // The claim under test is the *unit* — a session, not a write — so the test
    // writes three times and counts lines. An implementation that appended per
    // write would produce three, and would be the shape §2.1's day-sum breaks on.
    const { store } = await freshStore();
    const clock = new ManualClock(SESSION_START);
    const tracker = trackerFor(store, clock.now);

    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 100, wordsAfter: 180 });
    tracker.noteWrite({ docId: SCENE, wordsBefore: 180, wordsAfter: 240 });
    tracker.noteWrite({ docId: CHAPTER, wordsBefore: 50, wordsAfter: 50 });
    clock.advance(25);
    await tracker.endSession();

    const rows = await readSessions(store, PROJECT);
    expect(rows).toHaveLength(1);
    // Exact bytes, not a deep-equal: A5 fixes the field order, and the manifest
    // already argues stable key order so a log line diffs readably. 240 − 100 for
    // the scene, and 0 for the chapter the writer opened and did not change.
    expect(serializeSessionRecord(rows[0]!)).toBe(
      `{"startedAt":"${SESSION_START.toISOString()}","endedAt":"${SESSION_END.toISOString()}",` +
        `"wordsWritten":140,"docIds":["${SCENE}","${CHAPTER}"]}`,
    );
  });

  it('a document written to fifty times is listed once, in first-touch order', async () => {
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);

    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 10 });
    tracker.noteWrite({ docId: CHAPTER, wordsBefore: 0, wordsAfter: 5 });
    tracker.noteWrite({ docId: SCENE, wordsBefore: 10, wordsAfter: 20 });
    const record = await tracker.endSession();

    // Per-document nets: the scene grew 20 across two writes, the chapter 5
    // across one. A sum of per-write deltas would give 15 and a whole-key
    // comparison of "was it the same doc" would give either 20 or 25 — this is
    // the assertion that pins both halves at once.
    expect(record?.docIds).toEqual([SCENE, CHAPTER]);
    expect(record?.wordsWritten).toBe(25);
  });

  it('wordsWritten is a per-document net, floored at zero per document', async () => {
    // The aggregation rule is this slice's one genuinely delegated interpretation
    //. A writer who grew one scene by 500 and deleted 200
    // from another has written 300 — not 300 either way round by luck, and
    // emphatically not 700 because two of the writes happened.
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);

    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 1000, wordsAfter: 1500 });
    tracker.noteWrite({ docId: SCENE, wordsBefore: 1500, wordsAfter: 1300 });
    tracker.noteWrite({ docId: CHAPTER, wordsBefore: 400, wordsAfter: 400 });
    const record = await tracker.endSession();

    expect(record?.wordsWritten).toBe(300);
    // A delete-only session still names the document: the writer was in it.
    expect(record?.docIds).toEqual([SCENE, CHAPTER]);
  });

  it('a session that only deletes records zero, never a negative count', async () => {
    // The floor is what makes the field a count. `wordsWritten: -200` is a lie
    // about its own domain, and §2.1 adds it straight into a day total — where a
    // negative would move a writer's progress ring backwards for editing.
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);

    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 900, wordsAfter: 700 });
    const record = await tracker.endSession();

    expect(record?.wordsWritten).toBe(0);
    expect(record?.docIds).toEqual([SCENE]);
  });

  it('a session with no writes at all is still a line, with no ids and no words', async () => {
    // Opening a project and closing it is a real sitting, and §2.1 counts a day
    // from these lines — a zero is a fact, not a gap. Refusing to write it would
    // make "words written today" unknowable for a day nobody wrote.
    const { store } = await freshStore();
    const clock = new ManualClock(SESSION_START);
    const tracker = trackerFor(store, clock.now);

    tracker.beginSession();
    clock.advance(25);
    const record = await tracker.endSession();

    expect(record).toEqual({
      startedAt: SESSION_START.toISOString(),
      endedAt: SESSION_END.toISOString(),
      wordsWritten: 0,
      docIds: [],
    });
    expect(await readSessions(store, PROJECT)).toHaveLength(1);
  });

  it('refuses a write with no session open, and a second session while one is open', async () => {
    // Both edges are loud. A write nobody can end is words counted into a void,
    // and a second `beginSession` would either overwrite the open line's times or
    // end it without anyone asking.
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);

    expect(() => tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 5 })).toThrow(
      /no session is open/,
    );

    tracker.beginSession();
    expect(() => tracker.beginSession()).toThrow(/already open/);
  });

  it('refuses a word count that could not be summed', async () => {
    // §2.1 adds this number up. A float, a negative or a string reaching the log
    // is a number no future read can total, and a log is kept, not guessed at.
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);
    tracker.beginSession();

    expect(() => tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 1.5 })).toThrow(
      /whole number of words/,
    );
    expect(() => tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: -3 })).toThrow(
      /whole number of words/,
    );
    expect(() => tracker.noteWrite({ docId: '', wordsBefore: 0, wordsAfter: 3 })).toThrow(
      /needs a document id/,
    );
    // None of those writes were counted, so the session still ends honestly.
    expect((await tracker.endSession())?.wordsWritten).toBe(0);
  });

  it('keeps the session open when the append fails, so the words are not lost', async () => {
    // The flush path keeps the body when a write fails for the same reason: the
    // text is the thing that must not go missing. An append that threw and closed
    // the session anyway would drop a whole sitting on the floor.
    const tracker = createSessionTracker({
      projectId: PROJECT,
      append: () => Promise.reject(new Error('store is closed')),
    });
    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 700 });
    await expect(tracker.endSession()).rejects.toThrow(/store is closed/);
    expect(tracker.isOpen()).toBe(true);
    expect(tracker.pending()?.wordsWritten).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// §4 — append-only
// ---------------------------------------------------------------------------

describe('§4 — append-only, never rewritten', () => {
  it('three sessions are three lines, and the first two are byte-identical afterwards', async () => {
    const { store } = await freshStore();
    const clock = new ManualClock(SESSION_START);
    const tracker = trackerFor(store, clock.now);

    const ended: string[] = [];
    for (let n = 0; n < 3; n += 1) {
      tracker.beginSession();
      tracker.noteWrite({ docId: SCENE, wordsBefore: n * 10, wordsAfter: n * 10 + 25 });
      ended.push(serializeSessionRecord((await tracker.endSession())!));
    }

    const rows = await readSessions(store, PROJECT);
    expect(rows.map(serializeSessionRecord)).toEqual(ended);
  });

  it('reads back in append order past the ninth line', async () => {
    // The load-bearing half of this test is the count. `[projectId, 10]` sorts
    // before `[projectId, 2]` under a whole-key string comparison, so a binding
    // that compares compound keys as strings returns a log with ten and eleven
    // wedged between one and two — and §2.1 would then sum a day from the wrong
    // sequence while every line was individually correct.
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);

    for (let n = 0; n < 12; n += 1) {
      tracker.beginSession();
      tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: n + 1 });
      await tracker.endSession();
    }

    const rows = await readSessions(store, PROJECT);
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.wordsWritten)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(MemoryIndexedDb.cmp([PROJECT, 2], [PROJECT, 10])).toBeLessThan(0);
  });

  it('continues after the highest existing line, and rewrites none of them', async () => {
    // A log with a gap in it is a log an import or a hand-repair produced.
    // Numbering from the row *count* would land the new line on an index that is
    // taken, and a store that put would overwrite a session to do it.
    const { factory, store } = await freshStore();
    const backing = factory.dataFor(DB)?.stores.get(SESSION_STORE);
    const planted = record({ startedAt: '2026-01-01T00:00:00.000Z', wordsWritten: 11 });
    const older = record({ startedAt: '2025-01-01T00:00:00.000Z', wordsWritten: 7 });
    backing?.put([PROJECT, 0], { projectId: PROJECT, index: 0, record: planted });
    backing?.put([PROJECT, 5], { projectId: PROJECT, index: 5, record: older });

    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);
    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 3 });
    await tracker.endSession();

    const rows = await readSessions(store, PROJECT);
    expect(rows.map((row) => row.wordsWritten)).toEqual([11, 7, 3]);
  });

  it('a taken line number is a refusal, not an overwrite', async () => {
    // The slice's own flagship claim is that `add` (never `put`) makes "never
    // rewritten" a property of the store call rather than a promise in a
    // comment — docs/decisions.md: "a `put`
    // overwrites a line, which is the one thing the format forbids, and it would
    // do it silently".
    //
    // Nothing else in this suite can see that choice, because the next index is
    // the highest one plus one and so can never collide. **Verified: without
    // this test, reverting `add` to `put` leaves the suite green** — every other
    // guard in this file catches its own mutation, and none catches this one.
    //
    // A collision needs a row whose stored `index` disagrees with its compound
    // key, which is exactly the shape a partially-seeded import or a
    // hand-repaired store leaves behind. The row is planted through the same
    // test seam the "continues after the highest existing line" test uses; the
    // appender reads the *values*, so it computes 1, and `[projectId, 1]` is
    // already on disk.
    const { factory, store } = await freshStore();
    const backing = factory.dataFor(DB)?.stores.get(SESSION_STORE);
    const planted = record({ startedAt: '2025-01-01T00:00:00.000Z', wordsWritten: 99 });
    backing?.put([PROJECT, 0], { projectId: PROJECT, index: 0, record: planted });
    backing?.put([PROJECT, 1], { projectId: PROJECT, index: -1, record: planted });

    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);
    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 4 });

    // A refusal, not an overwrite: the session stays open so the words are not
    // lost (the same posture as a failing store), and the two planted lines are
    // both still there afterwards.
    await expect(tracker.endSession()).rejects.toThrow(/ConstraintError|already exists/i);
    expect(tracker.isOpen()).toBe(true);

    const rows = await readSessions(store, PROJECT);
    expect(rows.map((row) => row.wordsWritten)).toEqual([99, 99]);
  });

  it('two connections ending a session at once both land, on distinct lines', async () => {
    // The check-then-act race with a different payload. If the line number were
    // chosen before the transaction opened, both of these would compute "next is
    // 0" and one session would overwrite the other — in a log whose entire value
    // is that it cannot be.
    const { store, factory } = await freshStore();
    const second = await openRuntimeStore(factory, DB);
    opened.push(second);

    const a = trackerFor(store, new ManualClock(SESSION_START).now);
    const b = trackerFor(second, new ManualClock(SESSION_START).now);
    a.beginSession();
    b.beginSession();
    a.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 100 });
    b.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 200 });

    await Promise.all([a.endSession(), b.endSession()]);

    const rows = await readSessions(store, PROJECT);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.wordsWritten).sort()).toEqual([100, 200]);
  });

  it('a refused append leaves the log exactly as it was', async () => {
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);
    tracker.beginSession();
    tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: 42 });
    await tracker.endSession();

    await expect(
      appendSession(store, {
        projectId: PROJECT,
        record: record({ wordsWritten: -1, docIds: [] }),
      }),
    ).rejects.toThrow(/not a sessions.jsonl record/);
    await expect(
      appendSession(store, { projectId: PROJECT, record: record({ wordsWritten: 1.5 }) }),
    ).rejects.toThrow(/not a sessions.jsonl record/);

    const rows = await readSessions(store, PROJECT);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.wordsWritten).toBe(42);
  });

  it('deleting a project takes its session lines with it, and no other project’s', async () => {
    // A session log is a record of what somebody wrote, and a project that is
    // deleted taking its documents with it while leaving "412 words on the
    // 30th" behind is not a defensible half-deletion.
    const { factory, store } = await freshStore();
    for (const projectId of [PROJECT, OTHER]) {
      const manifest = createEmptyManifest('Project', SESSION_START);
      manifest.project.id = projectId;
      await writeProjectState(store, createProjectState(manifest), { now: SESSION_START });
      await appendSession(store, { projectId, record: record({ docIds: [SCENE] }) });
    }

    expect(await deleteProject(store, PROJECT)).toBe(true);
    expect(await readSessions(store, PROJECT)).toEqual([]);
    expect(await readSessions(store, OTHER)).toHaveLength(1);
    const left = factory.rawRecords(DB, SESSION_STORE) as { projectId: string }[];
    expect(left).toHaveLength(1);
    expect(left[0]!.projectId).toBe(OTHER);
  });

  it('keeps two projects’ logs apart in one store', async () => {
    const { store } = await freshStore();
    await appendSession(store, { projectId: PROJECT, record: record({ wordsWritten: 1 }) });
    await appendSession(store, { projectId: OTHER, record: record({ wordsWritten: 2 }) });
    await appendSession(store, { projectId: PROJECT, record: record({ wordsWritten: 3 }) });

    expect((await readSessions(store, PROJECT)).map((row) => row.wordsWritten)).toEqual([1, 3]);
    expect((await readSessions(store, OTHER)).map((row) => row.wordsWritten)).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// §4 — the file
// ---------------------------------------------------------------------------

describe('§4 — the file is a projection, and it never shortens', () => {
  it('one line per record, each terminated, with LF by default', () => {
    const text = serializeSessionsLog([
      record({ wordsWritten: 5, docIds: [SCENE] }),
      record({ wordsWritten: 9, docIds: [] }),
    ]);
    expect(text).toBe(
      `{"startedAt":"${SESSION_START.toISOString()}","endedAt":"${SESSION_END.toISOString()}","wordsWritten":5,"docIds":["${SCENE}"]}\n` +
        `{"startedAt":"${SESSION_START.toISOString()}","endedAt":"${SESSION_END.toISOString()}","wordsWritten":9,"docIds":[]}\n`,
    );
  });

  it('reads a log back, skipping blank lines without counting them as losses', async () => {
    // The round trip an export needs: store → file text → records, with nothing
    // lost in the middle. The expectations are read from the store rather than
    // re-typed, so this cannot pass by two mistakes cancelling.
    const { store } = await freshStore();
    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);
    for (let n = 1; n <= 2; n += 1) {
      tracker.beginSession();
      tracker.noteWrite({ docId: SCENE, wordsBefore: 0, wordsAfter: n * 10 });
      await tracker.endSession();
    }
    const rows = await readSessions(store, PROJECT);
    const text = serializeSessionsLog(rows);

    expect(parseSessionsLog(text)).toEqual({ records: rows, skipped: 0 });
    // A trailing newline, a blank line and a CRLF file are all the same log.
    expect(parseSessionsLog(`${text}\n\n`).records).toEqual(rows);
    expect(parseSessionsLog(text.replace(/\n/g, '\r\n')).records).toEqual(rows);
  });

  it('counts a corrupt line and keeps the rest, because stats never block a load', async () => {
    // §4 puts this file in the tier that is kept, and §1 says loaders ignore what
    // they cannot use. But "ignore" is not "pretend it was never there" — the
    // count is how anyone finds out that a line was lost.
    const good = serializeSessionRecord(record({ wordsWritten: 3, docIds: [] }));
    const parsed = parseSessionsLog(
      [good, '{"startedAt":"2026-09-30T04:40:00.000Z"', good, 'not json at all', ''].join('\n'),
    );
    expect(parsed.records.map((row) => row.wordsWritten)).toEqual([3, 3]);
    expect(parsed.skipped).toBe(2);
  });

  it('writes the file once, and leaves identical bytes alone afterwards', async () => {
    const fs = new MemoryArtifactFs();
    const records = [record({ wordsWritten: 12, docIds: [SCENE] })];

    const first = await writeSessionsFile(fs, records);
    expect(first).toMatchObject({ written: true, lines: 1, existingLines: 0 });
    expect(await fs.read('sessions.jsonl')).toBe(serializeSessionsLog(records));

    const second = await writeSessionsFile(fs, records);
    expect(second.written).toBe(false);
  });

  it('refuses to write a file that holds more lines than the export offers', async () => {
    // §4: "never rewritten … survives everything except full folder loss". The
    // case the clause is about is a writer whose history is *behind* the history
    // already on disk — a cleared runtime store, a folder shared between two
    // machines. Exporting would truncate, and the bytes would be gone before
    // anything reported a failure.
    const fs = new MemoryArtifactFs();
    const three = [1, 2, 3].map((n) => record({ wordsWritten: n, docIds: [SCENE] }));
    await writeSessionsFile(fs, three);
    const before = await fs.read('sessions.jsonl');

    await expect(writeSessionsFile(fs, three.slice(0, 2))).rejects.toThrow(SessionsShrinkError);
    expect(await fs.read('sessions.jsonl')).toBe(before);
  });

  it('creates no file for a project with no sessions', async () => {
    // An empty `sessions.jsonl` would assert that sessions happened and there
    // were none of them, which is a different claim from "none were recorded".
    const fs = new MemoryArtifactFs();
    const report = await writeSessionsFile(fs, []);
    expect(report).toMatchObject({ written: false, lines: 0 });
    expect(await fs.exists('sessions.jsonl')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 — a count is not a history
// ---------------------------------------------------------------------------

describe('§4 — the guard compares histories, and no byte already written is rewritten', () => {
  /** A torn line: a record that was cut off mid-write, which is what §4's
   * "a torn-write class cannot occur" is about and what the writer must not
   * resolve by deleting it. */
  const DAMAGED = '{"startedAt":"2026-09-30T04:40:00.000Z"';

  it('a damaged line survives the export that offers the readable ones unchanged', async () => {
    // The reproduction, exactly: two readable lines and one damaged one, offered
    // those same two records. The guard compared `2 > 2`, so the write went ahead
    // and destroyed the damaged line — while its own report said
    // `existingSkipped: 1` as it happened.
    const fs = new MemoryArtifactFs();
    const records = [record({ wordsWritten: 1 }), record({ wordsWritten: 2 })];
    await writeSessionsFile(fs, records);
    const planted = [
      serializeSessionRecord(records[0]!),
      DAMAGED,
      serializeSessionRecord(records[1]!),
      '',
    ].join('\n');
    await fs.writeAtomic('sessions.jsonl', planted);

    const report = await writeSessionsFile(fs, records);

    expect(await fs.read('sessions.jsonl')).toBe(planted);
    expect(report).toMatchObject({ written: false, existingSkipped: 1 });
  });

  it('a new line goes after the damaged one, which does not move', async () => {
    // The same file, offered one more session. A writer that re-serialized what
    // it could parse would drop the damaged line here, and one that appended in
    // front of the unreadable lines would file the new session at the wrong point
    // in the history.
    const fs = new MemoryArtifactFs();
    const records = [record({ wordsWritten: 1 }), record({ wordsWritten: 2 })];
    await writeSessionsFile(fs, records);
    const planted = [
      serializeSessionRecord(records[0]!),
      DAMAGED,
      serializeSessionRecord(records[1]!),
      '',
    ].join('\n');
    await fs.writeAtomic('sessions.jsonl', planted);

    const third = record({ wordsWritten: 3 });
    const report = await writeSessionsFile(fs, [...records, third]);

    expect(await fs.read('sessions.jsonl')).toBe(planted + `${serializeSessionRecord(third)}\n`);
    expect(parseSessionsLog(await fs.read('sessions.jsonl')).records).toEqual([...records, third]);
    expect(report).toMatchObject({ written: true, lines: 3, existingSkipped: 1 });
  });

  it('a file of nothing but damaged lines is not emptied by an export that has none', async () => {
    // The second reproduction. `writeSessionsFile(fs, [])` used to write an empty
    // file over it: `0 > 0` is false, and the "never create a file with nothing in
    // it" guard only covered a file that did not exist yet.
    const fs = new MemoryArtifactFs();
    const planted = `${DAMAGED}\nalso not json at all\n`;
    await fs.writeAtomic('sessions.jsonl', planted);

    const report = await writeSessionsFile(fs, []);

    expect(await fs.read('sessions.jsonl')).toBe(planted);
    expect(report).toMatchObject({ written: false, lines: 0, existingSkipped: 2 });
  });

  it('refuses a history of the same length that is not the same history', async () => {
    // The third instance of that one guard, and the one a review did not find: it was a
    // *count*, so three lines offered to a file holding three passed it, and the
    // write replaced recorded history with a different one — no refusal, no
    // warning, and the report agreeing with itself throughout.
    const fs = new MemoryArtifactFs();
    const onDisk = [1, 2, 3].map((words) => record({ wordsWritten: words }));
    await writeSessionsFile(fs, onDisk);
    const before = await fs.read('sessions.jsonl');

    const offered = [...onDisk.slice(0, 2), record({ wordsWritten: 99 })];
    await expect(writeSessionsFile(fs, offered)).rejects.toThrow(/line 3/);
    expect(await fs.read('sessions.jsonl')).toBe(before);
  });

  it('a key order this build does not write is a difference of spelling, not of history', async () => {
    // Compared field by field, not by re-serialized bytes. A byte comparison would
    // call this a different session and refuse the export — and refuse it forever,
    // since nothing the writer can do would make the two spellings agree. The
    // line also keeps the spelling it was written with, which the re-serializing
    // writer would have quietly normalised away.
    const fs = new MemoryArtifactFs();
    const only = record({ wordsWritten: 5, docIds: [SCENE] });
    const handWritten =
      `{"endedAt":"${only.endedAt}","startedAt":"${only.startedAt}","wordsWritten":5,"docIds":["${SCENE}"]}\n`;
    await fs.writeAtomic('sessions.jsonl', handWritten);

    const report = await writeSessionsFile(fs, [only]);

    expect(report).toMatchObject({ written: false });
    expect(await fs.read('sessions.jsonl')).toBe(handWritten);
  });

  it('an unterminated last line does not swallow the line appended after it', async () => {
    // Without that terminator the appended record is concatenated onto the damaged
    // line, so the record this write exists to save is the one destroyed — and the
    // file still *looks* like it kept everything.
    const fs = new MemoryArtifactFs();
    const first = record({ wordsWritten: 1 });
    await fs.writeAtomic('sessions.jsonl', `${serializeSessionRecord(first)}\n${DAMAGED}`);

    const second = record({ wordsWritten: 2 });
    const report = await writeSessionsFile(fs, [first, second]);

    const after = await fs.read('sessions.jsonl');
    expect(after.startsWith(`${serializeSessionRecord(first)}\n${DAMAGED}\n`)).toBe(true);
    expect(parseSessionsLog(after).records).toEqual([first, second]);
    expect(report).toMatchObject({ written: true, existingLines: 1, existingSkipped: 1 });
  });

  // -------------------------------------------------------------------------
  // A review — two pins for two things the own tests
  // could not see. Both are the standing species: a claim in a message or a
  // doc comment that the code does not deliver, next to a guard that works.
  // -------------------------------------------------------------------------

  it('names the line that differs, which it once did not', async () => {
    // `SessionsShrinkError.divergesAt` is an index into the **parsed** records,
    // and the message renders it as "its line N" — a claim about the file's
    // physical lines. Those are the same number only while no line is skipped:
    // `parseSessionsLog` drops unparseable lines from `records` without
    // recording where they were, so every damaged line *before* the divergence
    // shifts the true line up by one and the message never accounts for it.
    //
    // Measured across damaged-line counts: 0 → names 3, real 3;
    // 1 → names 3, real 4; 3 → names 3, real 6; 7 → names 3, real 10.
    // So the drift is exactly the number of unreadable lines above the
    // divergence, and it is unbounded.
    //
    // **The refusal itself is correct** — the file is left byte-identical and
    // no history is lost, which is what §4 asks for and what this row's other
    // tests already hold. What is wrong is the *pointer*: a human sent to line
    // 3 of a file with seven damaged lines is sent to the wrong place, and the
    // error is the one tool the refusal gives them to find it.
    //
    // **This test pins the behaviour as it is, deliberately.** It is a
    // characterising test, not an endorsement: it fails the moment
    // `divergesAt` starts counting physical lines, and at that moment the fix
    // is to make this expectation the correct one. Correcting it here instead
    // would be a behaviour change, which belongs in its own change.
    const fs = new MemoryArtifactFs();
    const recs = [record({ wordsWritten: 1 }), record({ wordsWritten: 2 }), record({ wordsWritten: 3 })];
    const damaged = ['{"startedAt":"2026-09-30T04:40:00.000Z"a', '{"startedAt":"2026-09-30T04:40:00.000Z"b'];
    const planted = [...damaged, ...recs.map((r) => serializeSessionRecord(r)), ''].join('\n');
    await fs.writeAtomic('sessions.jsonl', planted);

    // The file is: line 1 damaged, line 2 damaged, lines 3/4/5 the three
    // records. The divergence is the *third* record, which is physical line 5 —
    // and the message names line 3, the *first* record, which is exactly right
    // for the export and exactly wrong for the file.
    let caught: unknown;
    try {
      await writeSessionsFile(fs, [recs[0]!, recs[1]!, record({ wordsWritten: 999 })]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SessionsShrinkError);
    const error = caught as SessionsShrinkError;
    expect(error.divergesAt).toBe(2);
    expect(error.message).toMatch(/its line 3 is not the line the export offers/);
    // Asserted so the gap cannot close silently: the line it names holds the
    // FIRST record, and the line that actually differs is two further down.
    const physical = planted.split('\n');
    expect(parseSessionsLog(physical[2]!).records[0]!.wordsWritten).toBe(1);
    expect(parseSessionsLog(physical[4]!).records[0]!.wordsWritten).toBe(3);

    // The guarantee that actually matters is unaffected by the wrong pointer.
    expect(await fs.read('sessions.jsonl')).toBe(planted);
  });

  it('appends with the newline it was asked for, except for the one byte it hardcodes', async () => {
    // `writeSessionsFile` takes a `newline` option and honours it for every
    // line it *writes* — but the terminator it inserts in front of an appended
    // line is a literal `'\n'` in the source, not the option. On a file whose
    // last line is unterminated, asking for CRLF therefore produces a file with
    // **one bare LF among CRLF terminators**.
    //
    // Measured: with `newline: '\r\n'` the byte after the damaged line is
    // `"\n{"` — a bare LF — while the appended record it introduces is properly
    // CRLF-terminated. §4's byte-level promise and `SerializeSessionsOptions`'s
    // own comment ("a zip of one written on Windows must not differ from a zip
    // of one written on Linux") are about the bytes, so a mixed-terminator file
    // is a byte-format defect even though nothing is lost: `parseSessionsLog`
    // splits on `/\r?\n/`, so both records read back and the damaged line is
    // still counted as skipped.
    //
    // **Latent, not live.** No caller in v0.1 passes `newline` — the export path
    // takes the default `'\n'`, where a hardcoded `'\n'` is correct — so today
    // this cannot produce a mixed file. It is pinned because the option is
    // public, documented, and tested for the *appended* half, so the next caller
    // to use it would inherit the defect silently.
    const fs = new MemoryArtifactFs();
    const first = record({ wordsWritten: 1 });
    // A timestamp no record in this file carries, so locating this line cannot
    // land inside a real one — `record()` fixes every record's `startedAt` at
    // SESSION_START, and the appended record would otherwise match.
    const damaged = '{"startedAt":"2026-01-02T03:04:05.000Z"';
    await fs.writeAtomic('sessions.jsonl', `${serializeSessionRecord(first)}\n${damaged}`);

    await writeSessionsFile(fs, [first, record({ wordsWritten: 2 })], { newline: '\r\n' });

    const after = await fs.read('sessions.jsonl');
    const at = after.indexOf(damaged) + damaged.length;
    // The one hardcoded byte: a bare LF, not the CRLF that was asked for.
    expect(after.slice(at, at + 2)).toBe('\n{');
    // The appended line itself does honour the option.
    expect(after.endsWith('\r\n')).toBe(true);
    // And the mixed file is still readable, which is why this is latent.
    const parsed = parseSessionsLog(after);
    expect(parsed.records.map((r) => r.wordsWritten)).toEqual([1, 2]);
    expect(parsed.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// editor-engine §9 / command-bus §9 — the composition
// ---------------------------------------------------------------------------

describe('editor-engine §9 / command-bus §9 — a side-effect of doc.write, not a command', () => {
  it('a flushed write is counted, and an unchanged one is not', async () => {
    // §9: "Session-target progress reads sessions.jsonl (appender side-effect of
    // doc.write)". The test composes the two halves the way the app will: the
    // scheduler flushes, the caller tells the tracker what the store committed,
    // and the tracker produces one line. The word count stands in for the editor's
    // per-revision count — the tracker is the subscriber, not the counter.
    const { store } = await freshStore();
    const state = fixtureProject();
    state.documents.set(SCENE, { id: SCENE, body: '', revision: 0 });
    await writeProjectState(store, state, { now: SESSION_START });

    // A debounce that never fires, so the only flush is the one the test asks
    // for. The own suite has the same clock; sharing it would mean sharing its
    // file's seam, and the composition is the thing under test here.
    const neverArms = { setTimeout: () => 1, clearTimeout: () => undefined };
    const wordCount = (body: string): number => body.split(/\s+/).filter(Boolean).length;
    const autosave = createAutosave({
      source: 'store',
      store,
      projectId: PROJECT,
      debounceMs: 0,
      clock: neverArms,
      write: (request) => writeDocumentBody(store, request),
    });
    autosave.open(SCENE, { body: '', revision: 0 });

    const tracker = trackerFor(store, new ManualClock(SESSION_START).now);
    tracker.beginSession();
    autosave.noteEdit(SCENE, 'the ferry was late');
    const [flushed] = await autosave.flush();
    expect(flushed!.outcome).toBe('saved');
    tracker.noteWrite({
      docId: SCENE,
      wordsBefore: 0,
      wordsAfter: wordCount('the ferry was late'),
    });

    // An edit that changes nothing is not a mutation, so it is not a write, so it
    // is not counted. That change's "unchanged" outcome is what carries that.
    autosave.noteEdit(SCENE, 'the ferry was late');
    const [idle] = await autosave.flush();
    expect(idle!.outcome).toBe('unchanged');

    const ended = await tracker.endSession();
    expect(ended?.wordsWritten).toBe(4);
    expect(ended?.docIds).toEqual([SCENE]);
    expect(await readSessions(store, PROJECT)).toEqual([ended]);
  });

  it('a record is a record: the type guard accepts A5 and rejects everything else', () => {
    expect(isSessionRecord(record())).toBe(true);
    // Tolerantly: a timestamp this build cannot parse is still history.
    expect(isSessionRecord(record({ startedAt: 'sometime' }))).toBe(true);
    expect(isSessionRecord(record({ docIds: [] }))).toBe(true);
    // Strictly where summing depends on it.
    expect(isSessionRecord({ ...record(), wordsWritten: '12' })).toBe(false);
    expect(isSessionRecord({ ...record(), wordsWritten: 1.5 })).toBe(false);
    expect(isSessionRecord({ ...record(), wordsWritten: -1 })).toBe(false);
    expect(isSessionRecord({ ...record(), docIds: 'n_1' })).toBe(false);
    expect(isSessionRecord({ ...record(), docIds: [1] })).toBe(false);
    expect(isSessionRecord({ ...record(), startedAt: '' })).toBe(false);
    expect(isSessionRecord(null)).toBe(false);
  });
});


