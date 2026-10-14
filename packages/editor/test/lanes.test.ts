/**
 * [editor-engine.md] §7 — **the two-lane undo**, measured.
 *
 * ## Why this file had to be written at all
 *
 * §7's mechanism is `tr.setMeta('addToHistory', false)` and §4's parameter is
 * `historyExcluded` on three members of `EditorInstance`. Before that change that
 * parameter was **in the interface, in six documents, and in zero function
 * bodies**: `addToHistory` appeared in no source file, `@tiptap/pm/history` was
 * imported by no file, and the one implementer of `EditorInstance` in the tree
 * took the option three times and dropped it three times over
 * `EditorState.create({ doc })` — **no plugins, so no undo stack existed to
 * exclude anything from.**
 *
 * That last clause is the whole reason these tests can fail, and it is why the
 * fixture was rebuilt before the tests were written. A test asserting *"agent
 * edits never enter the user's undo stack"* was passing **for the wrong reason**:
 * with no history plugin the absence of a lane and the enforcement of a lane look
 * identical. So every claim here is a **number in both directions** — Lane 1
 * rising, Lane 2 not moving it — and every one of them carries a control that
 * shows the fixture able to fail.
 *
 * ## The clauses, and the control that kills each wrong implementation
 *
 * | §7 | what is asserted | the control |
 * |---|---|---|
 * | rule 1 | `undoDepth` both directions, then rule 1 end to end | the identical call **without** the option puts the agent's text on the stack |
 * | rule 2 | restore leaves the depth alone; a user undo acts on the user's event | without the option, one undo reverts the restore |
 * | rule 3 | the asymmetry: a restore discards the user's own later keystrokes | asserted as a fact, not smoothed over |
 * | rule 4a | an excluded apply between two user edits breaks neither | both keystrokes stay individually undoable |
 * | rule 4b | a transaction appended during an undo is not lost | it joins the undone branch and undoes |
 * | rule 4c | redo after an undo keeps the bookkeeping | the replayed transaction is identifiable, and the app meta loss is pinned |
 * | — | the option is **read**, in one place | one owner, guarded; mutation recorded in the row |
 *
 * **Rule 5 is deliberately absent.** §7 rule 5: *"Cross-doc bus-level undo stays
 * parked (v0.2); per-doc snapshot restore covers v0.1's promise."* No test here
 * asserts a cross-doc undo, and none may: a test for a parked v0.2 mechanism is
 * a test that fails when v0.2 lands and passes until then, which is a fixture
 * wearing a feature's clothes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { history, isHistoryTransaction, redo, redoDepth, undo, undoDepth } from '@tiptap/pm/history';
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { laneOf, markLane, caotangSchema, serialize } from '../src/index.js';
import type { EditorInstance } from '../src/index.js';
import { createMemoryEditorApi, driverFor } from './memory-api.js';
import type { MemoryDriver } from './memory-api.js';

const repoRoot = resolve(__dirname, '../../..');

/** §7's own number, read off a live state. `undoDepth` is `any` in the library's
 *  own d.ts, so it is narrowed here rather than leaking into the assertions. */
const depthOf = (state: EditorState): number => undoDepth(state) as number;
const redoableOf = (state: EditorState): number => redoDepth(state) as number;
const depth = (driver: MemoryDriver): number => depthOf(driver.state());

const mount = async (initialBody: string): Promise<{ instance: EditorInstance; driver: MemoryDriver }> => {
  const instance = await createMemoryEditorApi().mount({} as HTMLElement, {
    docId: 'doc-1',
    initialBody,
  });
  return { instance, driver: driverFor(instance) };
};

describe('§7 — two-lane undo, criterion 1: the separation as a number in both directions', () => {
  it('a user keystroke raises Lane 1, an excluded agent apply does not, and the same apply without the option does', async () => {
    const { instance, driver } = await mount('one\n\ntwo');

    expect(depth(driver)).toBe(0);

    // Lane 1 — engine-native, untouched by the policy.
    driver.keystroke('X', 1);
    expect(instance.getContent()).toContain('Xone');
    expect(depth(driver)).toBe(1);

    // Lane 2 — §4's parameter, read by the one place that reads it.
    instance.replaceRange({ from: 5, to: 8 }, 'TWO', { historyExcluded: true });
    expect(instance.getContent()).toContain('TWO');
    expect(depth(driver)).toBe(1);

    // **The control.** The identical call without the option *does* raise the
    // depth — so the assertion above is about the exclusion and not about a
    // fixture in which nothing can raise it.
    instance.replaceRange({ from: 5, to: 8 }, 'TWO', { historyExcluded: false });
    expect(depth(driver)).toBe(2);
    // A third apply, in a *different block*, so the library's own coalescing
    // (adjacency + `newGroupDelay`, which §7 leaves alone as "engine-default")
    // cannot merge it into the second one. Pinned at 3 rather than assumed: two
    // consecutive applies at the same position inside the grouping window are
    // one event, and a depth assertion that ignored that would be asserting the
    // library's timer rather than the policy.
    instance.replaceRange({ from: 0, to: 3 }, 'ONE', {});
    expect(instance.getContent()).toContain('ONE');
    expect(depth(driver)).toBe(3);
  });

  it('the excluded transaction carries the meta the library reads, and the user half is left untouched', async () => {
    // The policy is a pure function over a `Transaction`, so it can be asked
    // directly what it stamped — which is what makes "it sets the meta" a fact
    // about the policy rather than an inference from a depth number.
    //
    // `closeHistory` is stamped too, under a **module-private** `PluginKey` that
    // no caller can name, so it is *not* asserted here by key. It is asserted by
    // its effect in rule 4a's one-variable control, which is the better
    // instrument for it anyway: a key that exists is a fact about the library's
    // internals, and a separate undo event is a fact about the guarantee.
    const { driver } = await mount('one');
    const tr = driver.state().tr.insertText('Z', 1);
    markLane(tr, { historyExcluded: true });
    expect(tr.getMeta('addToHistory')).toBe(false);

    // Lane 1 is left *untouched*, per §7: "Untouched by the bus." The policy
    // returns the very same transaction object and stamps nothing on it.
    const user = driver.state().tr.insertText('Z', 1);
    expect(markLane(user, undefined)).toBe(user);
    expect(user.getMeta('addToHistory')).toBeUndefined();
    expect(markLane(user, { historyExcluded: false })).toBe(user);
    expect(user.getMeta('addToHistory')).toBeUndefined();
    // And the undo half of the claim, through the public API: that transaction
    // *is* in Lane 1, which is what "untouched" is protecting.
    expect(depthOf(driver.state().apply(user))).toBe(1);
  });

  it('`laneOf` is the single read, and it is strict', () => {
    expect(laneOf(undefined)).toBe('user');
    expect(laneOf({})).toBe('user');
    expect(laneOf({ historyExcluded: false })).toBe('user');
    expect(laneOf({ historyExcluded: true })).toBe('agent');
  });
});

describe('§7 rule 1 — agent edits are never replayed by Ctrl+Z', () => {
  it('undo reverts the user\'s own keystroke, leaves the agent\'s text alone, and returns the depth to its pre-agent value', async () => {
    const { instance, driver } = await mount('one\n\ntwo');
    const beforeAgent = depth(driver);

    driver.keystroke('X', 1);
    expect(depth(driver)).toBe(beforeAgent + 1);

    instance.replaceRange({ from: 5, to: 8 }, 'TWO', { historyExcluded: true });
    expect(instance.getContent()).toContain('TWO');
    // §7's sentence is a *number* before it is a body: the depth is back where
    // the agent turn found it.
    expect(depth(driver)).toBe(beforeAgent + 1);

    expect(driver.undo()).toBe(true);
    expect(depth(driver)).toBe(beforeAgent);
    // "The user's undo stack only ever reverts their own keystrokes": the
    // keystroke is gone, the agent's text is untouched, and it was never in the
    // stack to begin with — the depth never moved for it.
    expect(instance.getContent()).not.toContain('Xone');
    expect(instance.getContent()).toContain('TWO');
  });

  it('CONTROL — the identical script without the option puts the agent\'s text on the stack, and undo takes it off', async () => {
    const { instance, driver } = await mount('one\n\ntwo');

    driver.keystroke('X', 1);
    expect(depth(driver)).toBe(1);

    instance.replaceRange({ from: 5, to: 8 }, 'TWO');
    expect(instance.getContent()).toContain('TWO');
    // **This is the line that makes the test above falsifiable.** Without the
    // option the agent's apply is a second undoable event.
    expect(depth(driver)).toBe(2);

    expect(driver.undo()).toBe(true);
    expect(depth(driver)).toBe(1);
    expect(instance.getContent()).not.toContain('TWO');
    expect(instance.getContent()).toContain('Xone');
  });
});

describe('§7 rule 2 — "restore to before this turn" never travels through Lane 1', () => {
  it('the restore puts the body back, leaves the depth alone, and a user undo afterwards acts on the user\'s event', async () => {
    const { instance, driver } = await mount('one\n\ntwo');
    const beforeRestore = depth(driver);

    driver.keystroke('X', 1);
    expect(depth(driver)).toBe(beforeRestore + 1);

    await instance.setContent('restored body', { historyExcluded: true });
    expect(instance.getContent()).toContain('restored body');
    expect(depth(driver)).toBe(beforeRestore + 1);

    expect(driver.undo()).toBe(true);
    expect(depth(driver)).toBe(beforeRestore);
    // "Instead of re-applying the snapshot": the snapshot is not what the undo
    // toggled, and it is still the body.
    expect(instance.getContent()).toContain('restored body');
  });

  it('CONTROL — the same restore without the option is itself an undoable event, and one undo reverts it', async () => {
    const { instance, driver } = await mount('one\n\ntwo');

    driver.keystroke('X', 1);
    expect(depth(driver)).toBe(1);

    await instance.setContent('restored body');
    expect(instance.getContent()).toContain('restored body');
    // The depth does **not** reach 2, and the reason is the library's own
    // grouping rather than the restore being exempt: a full-content replace
    // overlaps the keystroke's range, so it is adjacent and inside
    // `newGroupDelay`, so it is appended to the keystroke's event. §7 leaves that
    // alone — Lane 1 is "engine-default coalescing" — and this pins the number
    // instead of assuming it. **The restore is on the stack either way**, which
    // is what the body assertion below shows.
    expect(depth(driver)).toBe(1);

    expect(driver.undo()).toBe(true);
    expect(depth(driver)).toBe(0);
    // The restore is gone: the body is the pre-restore one. This is the
    // behaviour rule 2 forbids, and the excluded test above shows the opposite.
    expect(instance.getContent()).not.toContain('restored body');
    expect(instance.getContent()).toContain('one');
  });
});

describe('§7 rule 3 — the asymmetry, asserted rather than smoothed over', () => {
  it('a restore to before the turn discards the user\'s own later keystroke, and says so in the spec\'s own words', async () => {
    const { instance, driver } = await mount('one\n\ntwo');
    const snapshot = instance.getContent();

    driver.keystroke('X', 1);
    instance.replaceRange({ from: 5, to: 8 }, 'TWO', { historyExcluded: true });
    driver.keystroke('Z', 1);
    expect(instance.getContent()).toContain('ZXone');
    expect(depth(driver)).toBe(2);

    // §7 rule 3: "edits after an agent turn, then restore-to-before-turn,
    // discard the user's own keystrokes too."  Measured here as the behaviour
    // it is, because the *other* half of rule 3 — the confirm text that states
    // the scope — is a UI string and this suite has no DOM to render it in. The
    // asymmetry is the part that can be falsified, and it is the part the
    // confirm exists to warn about.
    await instance.setContent(snapshot, { historyExcluded: true });
    expect(instance.getContent()).toBe(snapshot);
    expect(instance.getContent()).not.toContain('ZXone');
    expect(instance.getContent()).not.toContain('TWO');
    // The discarded keystroke is gone from the *body* and from the *stack*: the
    // depth holds the two pre-restore events, and the first undo has nothing
    // left to reverse in the body.
    expect(depth(driver)).toBe(2);
    expect(driver.undo()).toBe(true);
    expect(instance.getContent()).toBe(snapshot);
    expect(depth(driver)).toBe(1);
  });
});

describe('§7 rule 4a — an excluded transaction between two user edits', () => {
  it('breaks neither the bookkeeping nor those two edits\' undoability, and one undo is not one undo too many', async () => {
    const { instance, driver } = await mount('one');

    driver.keystroke('A', 1);
    expect(depth(driver)).toBe(1);

    // §4's parameter, through the fixture, so the policy is what decides the lane.
    instance.replaceRange({ from: 1, to: 1 }, 'M', { historyExcluded: true });
    expect(instance.getContent()).toBe('AMone\n');
    // The agent's step is out of the stack…
    expect(depth(driver)).toBe(1);

    driver.keystroke('C', 1);
    expect(instance.getContent()).toBe('CAMone\n');
    // …and it did not swallow the user's open event: the agent turn is a
    // boundary, so this is a *second* user event rather than an append to the
    // first. This is `closeHistory`'s whole job, and the depth is the proof.
    expect(depth(driver)).toBe(2);

    // "undo once → history empty" is the regression
    // names by name. It must not be reachable by pressing undo once.
    expect(driver.undo()).toBe(true);
    expect(depth(driver)).toBe(1);
    expect(instance.getContent()).toBe('AMone\n');

    expect(driver.undo()).toBe(true);
    expect(depth(driver)).toBe(0);
    // Both of the user's own keystrokes are gone and **the agent's text is still
    // there** — `M` survives both presses, which is §7 rule 1 as a body rather
    // than as a number: Lane 1 reverted the user's keystrokes and had never held
    // the agent's.
    expect(instance.getContent()).toBe('Mone\n');
  });

  it('CONTROL — one variable: the same transactions, marked by the policy or not', () => {
    // **This is the one-variable control**, and it is driven against the library
    // directly rather than through the fixture, for a reason worth stating: the
    // fixture's `apply` is private (correctly — it is not on §4's interface), so
    // a control that needed a *policy-free* transaction to go through the same
    // dispatch point would have to add a method to the fixture for it. The thing
    // under test here is the library's grouping, so the library is the instrument.
    //
    // Both arms run byte-for-byte the same three transactions — `A`, then an
    // insert of `M` at the **adjacent** position 2, then `C` back at position 1.
    // Adjacency is the whole point: it is what the library coalesces on its own,
    // so the arms differ by `markLane` and by nothing else.
    const docOf = (text: string): PmNode =>
      caotangSchema.topNodeType.create(null, [
        caotangSchema.nodes.paragraph!.create(null, [caotangSchema.text(text)]),
      ]) as PmNode;

    const run = (mark: (tr: Transaction) => Transaction): EditorState => {
      let s = EditorState.create({ doc: docOf('one'), plugins: [history()] });
      s = s.apply(s.tr.insertText('A', 1));
      s = s.apply(mark(s.tr.insertText('M', 2)));
      s = s.apply(s.tr.insertText('C', 1));
      return s;
    };

    // Arm 1 — the policy. Two user events.
    const withPolicy = run((tr) => markLane(tr, { historyExcluded: true }));
    expect(depthOf(withPolicy)).toBe(2);
    expect(serialize(withPolicy.doc)).toBe('CAMone\n');

    // Arm 2 — §7's table alone, one meta and no close. The excluded transaction
    // leaves the user's event open, the next keystroke is appended to it, and the
    // two user edits become **one** event: the skip-some-elements thread's
    // "undo once → history empty", reachable with a single press.
    const withoutPolicy = run((tr) => {
      tr.setMeta('addToHistory', false);
      return tr;
    });
    expect(depthOf(withoutPolicy)).toBe(1);
    expect(serialize(withoutPolicy.doc)).toBe('CAMone\n');

    // And the consequence, which is the reason `closeHistory` is in the policy.
    let after!: Transaction;
    undo(withoutPolicy, (tr) => {
      after = tr;
    });
    const collapsed = withoutPolicy.apply(after);
    expect(depthOf(collapsed)).toBe(0);
    expect(serialize(collapsed.doc)).toBe('Mone\n');
  });
});

describe('§7 rule 4b — a transaction appended during an undo is not lost', () => {
  it('joins the undone branch, is undoable, and leaves the redo branch coherent', async () => {
    // This case is driven **below** the seam on purpose, and the reason is named
    // rather than hidden: the transaction under test is one that an engine
    // *appends to its own undo* — a keystroke landing mid-undo. No §4 member
    // produces that, and no view exists headless to produce it either, so the
    // only honest instrument is the library's own state. The Caotang-side claim
    // (`markLane`) is clauses 1–3; this is PM's bookkeeping, which is what §7
    // rule 4 calls "Known PM sharp edges".
    const { driver } = await mount('one');
    driver.keystroke('A', 1);
    driver.keystroke('B', 2);

    const pre = driver.state();
    let undoTr!: Transaction;
    undo(pre, (tr) => {
      undoTr = tr;
    });
    expect(isHistoryTransaction(undoTr)).toBe(true);
    const undone = pre.apply(undoTr);
    expect(depthOf(undone)).toBe(0);
    expect(redoableOf(undone)).toBe(1);

    // The appended keystroke: `appendedTransaction` pointing at the undo.
    const appended = undone.tr.insertText('Q', 1).setMeta('appendedTransaction', undoTr);
    const afterAppend = undone.apply(appended);
    // **Not lost** — and the branch it lands on is the measured one, not the
    // assumed one. `applyTransaction` routes a transaction appended to an *undo*
    // onto the branch that was undone, so it is **redoable, not undoable**:
    // `undoDepth` stays 0. It is also *folded into* the undone event rather than
    // opening a second one, so `redoDepth` stays 1. A test that asserted either
    // depth *rose* here would be asserting the opposite branch, which is how this
    // class of case gets "verified" against a number nobody read off.
    expect(depthOf(afterAppend)).toBe(0);
    expect(redoableOf(afterAppend)).toBe(1);
    // The keystroke the undo removed is still removed, and the appended one is
    // in the document.
    expect(afterAppend.doc.textContent).not.toContain('A');
    expect(afterAppend.doc.textContent).toContain('Q');

    // One redo replays the whole undone event, appended step included: the
    // keystrokes come back **and** the appended one is taken back off.
    let replayed!: Transaction;
    redo(afterAppend, (tr) => {
      replayed = tr;
    });
    const redone = afterAppend.apply(replayed);
    expect(redone.doc.textContent).toContain('ABone');
    expect(redone.doc.textContent).not.toContain('Q');
    expect(depthOf(redone)).toBe(1);
    expect(redoableOf(redone)).toBe(0);

    // **And the next undo brings the appended keystroke back** — which is the
    // whole claim. Had the appended transaction been swallowed by the undo it
    // landed in, `Q` would be gone from the document for good and this
    // assertion is the one that fails.
    expect(undo(redone, (tr) => (replayed = tr))).toBe(true);
    const final = redone.apply(replayed);
    expect(depthOf(final)).toBe(0);
    expect(redoableOf(final)).toBe(1);
    expect(final.doc.textContent).toContain('Q');
    expect(final.doc.textContent).not.toContain('A');
  });
});

describe('§7 rule 4c — redo after an undo does not lose the bookkeeping', () => {
  it('the replay is identifiable, the content returns, and the app-meta loss is pinned', async () => {
    const { instance, driver } = await mount('one');

    driver.keystroke('A', 1);
    expect(instance.getContent()).toContain('Aone');
    expect(depth(driver)).toBe(1);

    // The app's own meta on the transaction — what §C14's "metadata lost on redo
    // replay" names. **Asserted present before the round trip** (A review,
    // 2026-10-06 06:0x): the loss assertion below is `toBeUndefined()`, and a
    // loss needs something to lose. Removing this `setMeta` call left all 14
    // tests green — the test asserted that a meta nobody set did not survive,
    // which is the shape of the very vacuity this suite was written to avoid.
    const marked = driver.state().tr.insertText('B', 1);
    marked.setMeta('caotangLane', 'user');
    expect(marked.getMeta('caotangLane'), 'the premise of the loss assertion').toBe('user');
    const withMeta = driver.state().apply(marked);
    expect(withMeta.doc.textContent).toContain('BAone');

    let undone!: Transaction;
    undo(withMeta, (tr) => {
      undone = tr;
    });
    expect(isHistoryTransaction(undone)).toBe(true);
    const undoneState = withMeta.apply(undone);
    expect(depthOf(undoneState)).toBe(0);
    expect(redoableOf(undoneState)).toBe(1);

    let replayed!: Transaction;
    redo(undoneState, (tr) => {
      replayed = tr;
    });
    // **The measured loss, pinned.** `prosemirror-history` replays the *steps*;
    // it cannot replay a meta the application set on a transaction that no longer
    // exists. A redone transaction is therefore recognisable only as a *replay*
    // (`isHistoryTransaction`) — which is why §7's policy reads state and never a
    // replayed transaction's meta. If a future version of the library starts
    // carrying app meta across a replay, this assertion is what fails, and that
    // is the correct direction for it to fail in.
    expect(isHistoryTransaction(replayed)).toBe(true);
    expect(replayed.getMeta('caotangLane')).toBeUndefined();

    // The bookkeeping survives the round trip in both directions, and the
    // content is back.
    const redone = undoneState.apply(replayed);
    expect(redone.doc.textContent).toContain('BAone');
    expect(depthOf(redone)).toBe(1);
    expect(redoableOf(redone)).toBe(0);
  });
});

describe('criterion 7 — the slice added no dependency and still runs headless', () => {
  it('`packages/editor` gained no entry, and the environment is still `node`', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages/editor/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    // The lane policy imports `@tiptap/pm/history`, which the package already
    // declared. A direct `prosemirror-history` entry would be a new dependency
    // adopted without the C16 preflight the pin table requires.
    expect(declared).not.toContain('prosemirror-history');
    expect(declared).not.toContain('prosemirror-state');
    expect(pkg.dependencies['@tiptap/pm']).toBe('3.31.4');

    const config = readFileSync(join(repoRoot, 'vitest.config.ts'), 'utf8');
    expect(config).toMatch(/environment:\s*'node'/);
  });
});

describe('criterion 5 — the parameter is read, in exactly one place', () => {
  it('no second writer of `addToHistory` and no second reader of `historyExcluded`', () => {
    const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');
    const lanes = read('packages/editor/src/lanes.ts');
    const fixture = read('packages/editor/test/memory-api.ts');
    const seam = read('packages/editor/src/seam.ts');
    // "The option is read somewhere" is unfalsifiable, so the claim is made
    // checkable: `src/lanes.ts` is the only place that *writes* the meta and the
    // only place that reads the option. A second writer would be a second
    // definition of §7's mechanism, and a reader in the fixture would be the
    // fixture deciding the lane instead of the policy. The pattern matches the
    // **call**, not the words — prose in a comment naming the meta is not a
    // second writer, and a guard that failed on one would be a guard that had to
    // be weakened the first time a file explained itself.
    const writesMeta = /setMeta\(\s*['"]addToHistory/;
    expect(lanes).toMatch(writesMeta);
    expect(fixture).not.toMatch(writesMeta);
    expect(seam).not.toMatch(writesMeta);

    // **Every** source file, not the three this slice happened to touch
    //. An earlier change named `lanes.ts`, the fixture and
    // `seam.ts` and read those three — so "no second writer" was a claim about
    // three files wearing the grammar of a claim about the package, and a writer
    // planted in `pipeline.ts` left all 14 tests green. The count below is the
    // control that makes the scan non-vacuous: it fails if the directory read
    // returns nothing, which a renamed or moved `src/` would otherwise cause.
    const srcDir = join(repoRoot, 'packages/editor/src');
    const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    expect(srcFiles.length, 'no source files found — the scan matched nothing').toBeGreaterThan(5);
    const writers = srcFiles.filter((f) => writesMeta.test(readFileSync(join(srcDir, f), 'utf8')));
    expect(writers, 'a second file writes addToHistory — §7 has a second definition').toEqual([
      'lanes.ts',
    ]);

    // The interface names the policy's type rather than repeating the shape, so
    // the parameter and its read cannot drift: widening `LaneOptions` changes all
    // three of §4's members at once, and a fourth `historyExcluded?: boolean`
    // written into `seam.ts` is the drift this assertion exists to catch.
    expect(seam).toMatch(/import type \{ LaneOptions \} from '\.\/lanes\.js'/);
    expect(seam).toMatch(/opts\?: LaneOptions/);
    expect(lanes).toMatch(/historyExcluded\?: boolean/);
    // The fixture carries the option all the way to the one dispatch point.
    expect(fixture).toMatch(/markLane\(tr, laneOpts\)/);
  });
});
