/**
 * A minimal in-memory `EditorApi` — **the non-vacuity fixture, and a fixture only.**
 *
 * ## Why this file exists
 *
 * The criterion (c): *"a minimal in-memory implementation compiles against the
 * interface and the bridge round-trips **through that implementation**, with a
 * control that a widened or narrowed interface fails to compile — an interface
 * nothing implements satisfies every test written about it."*
 *
 * That last clause is the reason this is a **separate file in `test/`** rather
 * than a class inside `seam.test.ts`: `test/seam.test.ts` copies this file's text
 * into a temp project and runs the real compiler over three variants of it, so
 * the control reads the *same* implementation the round-trip test drives. A copy
 * inlined in the test would make the control a statement about a second artifact.
 *
 * It is **not** the product's second engine. §4's `mount` is the Tiptap adapter's;
 * this one exists to be measured. The four things it is honest about:
 *
 * - **It holds a real ProseMirror document and applies real transactions.**
 *   `@tiptap/pm/state`'s `EditorState` is the document model with no view and no
 *   DOM, so `insertAtSelection`/`replaceRange` go through the *same* bridge the
 *   Tiptap adapter's would and produce a transaction a real engine would accept.
 * - **It runs the real history plugin, and it was rebuilt to do so.**
 *   Before that change this file built `EditorState.create({ doc })` with **no plugins**,
 *   so there was no undo stack to exclude anything from and §7's mechanism
 *   could not be expressed here at all — which made a test for *"agent edits
 *   never enter the user's undo stack"* pass **for the wrong reason**: the
 *   absence of a lane is indistinguishable from the enforcement of one. The
 *   plugin is `prosemirror-history` itself, the same one Tiptap's `History`
 *   extension is, so §7's claim is measured against the stack the product will
 *   use. All three `historyExcluded` parameters are now read and routed through
 *   `markLane`, which is the only place that reads them.
 * - **`captureAnchor` takes its revision from an injected reader**, because §9
 *   makes the store the owner of `doc.revision` and §6's anchor has to carry it.
 *   An implementation that invented `0` would put a number in an anchor that
 *   claims to be the document's revision — the corpus's standing rule about a
 *   field reporting a different number from the one it counted. With no reader
 *   supplied it returns `null`, which is §6's own "no anchor" answer for a
 *   collapsed selection and the only honest answer without a store.
 * - **`readOnly` is carried, not enforced.** It is a *mount option* and Tiptap's
 *   `editable` is what turns it into behaviour, so enforcing it here would be a
 *   second enforcement with its own semantics. Named here so the omission is a
 *   decision and not an oversight.
 */
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { history, redo, undo } from '@tiptap/pm/history';
// §9's counting rule has one implementation, in the store — see `wordCount` below.
import { countBody } from '@caotang/store';
import {
  bodyOffsetFromPmPos,
  buildProjectionMap,
  insertionOf,
  markLane,
  parseWithDiagnostics,
  caotangSchema,
  serialize,
  textPositionFor,
} from '../src/index.js';
import type {
  EditorApi,
  EditorInstance,
  EditorMountOptions,
  EditorSelection,
  LaneOptions,
  ParseResult,
  TextAnchor,
} from '../src/index.js';

export interface MemoryApiOptions {
  /**
   * §9: the store owns `doc.revision`, so the anchor's `capturedRevision` is
   * *read* from the host. Absent means "no store" and `captureAnchor` returns
   * `null`.
   */
  readRevision?: () => number;
  /** §4: `mount` "fails only on a bad `host` (thrown, programmer error)". The
   *  adapter's own check; this one is the fixture's, so the clause is measured. */
  requireHost?: (host: HTMLElement) => void;
}

export const createMemoryEditorApi = (options: MemoryApiOptions = {}): EditorApi => ({
  async mount(host: HTMLElement, opts: EditorMountOptions): Promise<EditorInstance> {
    (options.requireHost ?? defaultHostCheck)(host);
    // `parseWithDiagnostics` is awaited here rather than inside the instance
    // because §5's load is async by unified's convention, and a `mount` that
    // returned an instance still holding a pending parse would be a seam whose
    // `getContent()` answers before the document exists.
    const loaded = await parseWithDiagnostics(opts.initialBody);
    return createInstance(opts, loaded, options.readRevision);
  },
});

/** §4's error-modes clause, in the only form the spec states it: a bad host throws. */
const defaultHostCheck = (host: HTMLElement): void => {
  if (host === null || host === undefined || typeof host !== 'object') {
    throw new TypeError('EditorApi.mount: host must be an element (programmer error)');
  }
};

const createInstance = (
  opts: EditorMountOptions,
  loaded: ParseResult,
  readRevision: (() => number) | undefined,
): EditorInstance => {
  let map = buildProjectionMap(loaded.doc);
  // **The history plugin is what makes §7 expressible here.** Plain
  // `EditorState.create({ doc })` has no undo stack at all, so an excluded
  // transaction would be indistinguishable from an excluded *nothing*.
  const state = { current: EditorState.create({ doc: loaded.doc, plugins: [history()] }) };
  let selection: EditorSelection | null = null;
  let destroyed = false;

  // §4's carrier: the diagnostics half of the load, by reference, ungrouped.
  opts.onLoadDiagnostics?.({ warnings: loaded.warnings, dialect: loaded.dialect });

  const announce = (): void => {
    const current = selection && selection.from === selection.to ? null : selection;
    opts.onSelectionChange?.(current);
  };

  /**
   * The single dispatch point, and the only place `laneOpts` is read. Every
   * mutating member of §4's interface funnels here, so a member that forgot to
   * pass its option would be a lane that silently does not exist — which is the
   * defect the two-lane undo has to rule out, and the reason the plumbing is here rather than at
   * each call site.
   */
  const apply = (tr: Transaction, laneOpts?: LaneOptions): void => {
    if (destroyed) return;
    state.current = state.current.apply(markLane(tr, laneOpts));
    // §4: "Rebuilt on every doc change". Measured rather than asserted: remove
    // this line and the seam test named "rebuilds on every doc change" fails on
    // the second primitive, which is the only place it can be observed. A Ctrl+Z
    // arrives through here too, so an undo rebuilds the map like any other edit.
    map = buildProjectionMap(state.current.doc);
    opts.onChange?.();
  };

  const replace = (sel: EditorSelection, text: string, laneOpts?: LaneOptions): void => {
    const from = textPositionFor(map, sel.from);
    const to = textPositionFor(map, sel.to);
    if (from === null || to === null) return;
    const [start, end] = from <= to ? [from, to] : [to, from];
    // The text is body Markdown, read by the same function the Tiptap adapter uses
    // (`insertionOf`), so the fixture and the product cannot disagree about
    // what `*x*` inserts. Fitting across a block boundary is ProseMirror's, as it is in the
    // adapter: `replace`, not `insertText`, which is smart and can move the range.
    //
    // The measured reason this comment exists at all is a constant one-position
    // error in the map, and it is worth keeping in view: with every PM position
    // one too high, `replaceWith(2, 7, …)` turned `hello` into `hgoodbyeeworld`
    // while every round-trip assertion in `seam.test.ts` stayed green. Internal
    // consistency cannot detect a constant offset; a transaction can.
    const tr = state.current.tr;
    apply(
      text.length === 0 ? tr.delete(start, end) : tr.replace(start, end, insertionOf(text, caotangSchema)),
      laneOpts,
    );
    const at = bodyOffsetFromPmPos(map, start);
    selection = start === end ? null : { from: at, to: at + text.length };
    announce();
  };

  const instance: EditorInstance = {
    getContent: () => serialize(state.current.doc),
    setContent: async (body: string, laneOpts?: LaneOptions) => {
      const next = await parseWithDiagnostics(body);
      apply(
        state.current.tr.replaceWith(0, state.current.doc.content.size, next.doc.content),
        // §7 rule 2: restore-to-before-turn *is* this call with the option set,
        // and §7 rule 3's asymmetry rides the same path — a replace of the whole
        // content discards whatever the user typed since the snapshot, which is
        // the honest behaviour the confirm text has to state.
        laneOpts,
      );
      // A replace is a load too: §4's carrier is defined for a load, and an agent
      // apply arriving through `setContent` is exactly the case that produced a
      // second, unreported banner in the shape this seam exists to prevent.
      opts.onLoadDiagnostics?.({ warnings: next.warnings, dialect: next.dialect });
      selection = null;
      announce();
    },

    getSelection: () => (selection && selection.from !== selection.to ? { ...selection } : null),

    captureAnchor: (): TextAnchor | null => {
      if (!selection || selection.from === selection.to) return null;
      if (!readRevision) return null;
      const body = map.body;
      return {
        from: selection.from,
        to: selection.to,
        exact: body.slice(selection.from, selection.to),
        prefix: body.slice(Math.max(0, selection.from - 32), selection.from),
        suffix: body.slice(selection.to, Math.min(body.length, selection.to + 32)),
        capturedRevision: readRevision(),
      };
    },

    revealRange: (sel: EditorSelection) => {
      selection = { from: sel.from, to: sel.to };
      announce();
    },

    insertAtSelection: (text: string, laneOpts?: LaneOptions) => {
      // No selection means the caret is at the start of the body, which is the
      // only position an empty document has.
      const at = selection ? { from: selection.to, to: selection.to } : { from: 0, to: 0 };
      replace(at, text, laneOpts);
    },

    replaceRange: (sel: EditorSelection, text: string, laneOpts?: LaneOptions) =>
      replace(sel, text, laneOpts),

    // §8's two named methods, and nothing else: the ghost region itself (a second
    // read-only instance, tinted, rendered below the focus doc) is §8's slice.
    ghost: {
      append: () => {
        /* the streamed text lives in the ghost instance, which is not this slice */
      },
      clear: () => {
        /* likewise */
      },
    },

    // §9's rule, verbatim: "words = block text split on whitespace; chars =
    // body-projection length". Delegated to `@caotang/store`'s `countBody` rather
    // than spelled out here — the store has the live producer for
    // `derived.wordCounts` (which §2 requires and which had no writer), and a
    // second literal copy of the rule here is exactly what docs/decisions.md
    // rejected when it refused a count inside `sessions.ts`: *"two word-count
    // rules is the drift the corpus spends its §2 discipline preventing."*
    // §9's *pipeline* — the debounce, the `doc.write` dispatch — is not in this
    // slice; the count it carries is.
    wordCount: () => countBody(map.body),

    focus: () => {
      /* nothing to focus without a view */
    },

    destroy: () => {
      destroyed = true;
    },
  };

  // The driver's own undo/redo run *through* `apply`, not around it: a real
  // Ctrl+Z goes through the editor's own dispatch and rebuilds the projection map
  // like any other change, and a driver that bypassed `apply` would leave
  // `wordCount`/`captureAnchor` reading a map from before the undo.
  const runCommand = (cmd: (st: EditorState, dispatch: (tr: Transaction) => void) => boolean): boolean =>
    cmd(state.current, (tr) => apply(tr));

  drivers.set(instance, {
    /** A user keystroke: a raw `insertText` with **no** lane option, which is
     *  exactly what a view's input pipeline dispatches. Never `insertAtSelection`
     *  — that is §4's `editor.insert` primitive, an agent-side entry point, and
     *  using it here would make the Lane 1 half of §7 a claim about the bus. */
    keystroke: (text: string, at: number) => {
      apply(state.current.tr.insertText(text, at));
    },
    undo: () => runCommand(undo),
    redo: () => runCommand(redo),
    state: () => state.current,
  });

  return instance;
};

/**
 * **The user-side operations, for a test that needs Lane 1 to be reachable.**
 *
 * §4's `EditorInstance` has no undo member — Ctrl+Z is a keymap, and a keymap is
 * the adapter's — so without this a headless test could not press it, and every
 * §7 claim about *what the user's undo does* would be untestable. That is the
 * same reason the file is a fixture: an interface nothing implements satisfies
 * every test written about it, and equally an interface with no way to reach
 * Lane 1 cannot have a falsifiable claim about it.
 *
 * **Test-only by construction.** It is not on §4's interface, it is not exported
 * from `src/`, and it is reached by {@link driverFor} rather than by a member —
 * so no production caller can pick it up by accident, and nothing here can be
 * mistaken for the adapter's keymap.
 */
export interface MemoryDriver {
  keystroke(text: string, at: number): void;
  undo(): boolean;
  redo(): boolean;
  state(): EditorState;
}

const drivers = new WeakMap<EditorInstance, MemoryDriver>();

export const driverFor = (instance: EditorInstance): MemoryDriver => {
  const driver = drivers.get(instance);
  if (!driver) {
    throw new TypeError('driverFor: not a memory-api instance (mount through createMemoryEditorApi)');
  }
  return driver;
};
