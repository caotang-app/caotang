/**
 * §8's report surface and the missing-report refusal — the pipeline half.
 *
 * ## What the pipeline can enforce, and what only this file can
 *
 * The central decision was to make an apply hand the pipeline §8's `affected`
 * and `summary`, and to **refuse** a dispatch that handed over nothing. That
 * refusal is a runtime behaviour, so the store half needs no test to
 * confirm the applies report: `packages/store/test/activity-log.test.ts` is red
 * the moment one forgets. What it *does* need is a subject — an apply that fails
 * to report — and `pipeline.test.ts` has no such apply, because every fake in it
 * now reports. This file is the subject, and it is written so the refusal is
 * **falsifiable**: every test that asserts the refusal runs beside one that
 * asserts the same dispatch succeeding with a report.
 *
 * ## Why a refusal and not a default
 *
 * `summary` is a required field of §8's interface. The bus can fill neither
 * `summary` nor `affected` — it does not own project state (§1), and the snapshot
 * it holds was read *before* the apply — so a silent default would be either an
 * empty digest (a claim about a change nobody described) or a restatement of the
 * command name (a digest that says nothing the `command` field does not already
 * say). Both are the "row that claimed a digest it had not computed" the log refuses
 * to write in the first place. The third option is to say so, loudly, and it is
 * the same shape §5's registration refusal already has.
 *
 * ## The placement, which is the load-bearing detail
 *
 * The refusal runs **after** §5's registration and not before. A refusal placed
 * earlier would be tidier — nothing half-done to describe — and would strand a
 * committed effect that nothing can reverse, because the group is what makes the
 * effect recoverable. So the two refusals are siblings: both find a required
 * hand-off missing, both say which one, and both are placed where the user can
 * still get back. `names the undo group, because the refusal runs after
 * registration` below is the test that would fail if that order were ever
 * inverted — and its own `details.undoGroupId` assertion is what makes this
 * header's earlier claim wrong, so the two are not independent. (Named here
 * wrongly as `refusal_names_the_group`: a
 * pointer to a test that does not exist, in the one file whose subject is
 * knowing which test does the work.)
 */

import { describe, expect, it } from 'vitest';
import {
  COMMAND_REGISTRY,
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  ok,
  type ApplyContext,
  type BusContext,
  type Command,
  type CommandApply,
  type CommandDescriptor,
  type CommandRegistry,
  type ActivityEntry,
  type ExecutionOutcome,
} from '@caotang/bus';

import { makeSnapshot, THE_LANDING } from './fixtures.js';

const TICK = 1_760_000_000_000;

interface Harness {
  readonly bus: BusContext;
  readonly log: ReturnType<typeof createActivityLog>;
  readonly notified: ExecutionOutcome[];
}

function harness(): Harness {
  const undo = createUndoStore();
  const log = createActivityLog();
  const notified: ExecutionOutcome[] = [];
  const bus: BusContext = {
    state: { name: 'project state, never handed to a view command' },
    view: createViewState(),
    read: () => makeSnapshot({}),
    // §4's flow facts, as a *context object* — `checkPermission` takes the object,
    // not a function to call. Present so an *agent* command can be dispatched,
    // which `entriesForGroup` needs: §5 makes one agent turn one group, and a turn
    // is the thing whose rows the checkpoint row reads.
    permission: { approvedPlan: true },
    undo,
    log,
    idempotency: createIdempotencyCache(),
    notify: (outcome) => notified.push(outcome),
  };
  return { bus, log, notified };
}

type FakeApply = (state: unknown, params: Record<string, unknown>, context: ApplyContext) => unknown;

function entryFor(descriptor: Partial<CommandDescriptor>, apply: FakeApply) {
  return {
    descriptor: {
      mutates: 'project' as const,
      agentRisk: 'write-confirm' as const,
      undo: 'none' as const,
      validate: (params: unknown) => ok(params as Record<string, unknown>),
      ...descriptor,
    },
    apply: apply as CommandApply<never, unknown>,
  };
}

/** An apply that reports, the way all sixteen shipped ones do. */
function reporting(
  descriptor: Partial<CommandDescriptor>,
  apply: FakeApply,
): { descriptor: CommandDescriptor; apply: CommandApply<never, unknown> } {
  return entryFor(descriptor, (state, params, context) => {
    const result = apply(state, params, context);
    context.report({ affected: [], summary: `the apply for ${context.name}` });
    return result;
  });
}

/**
 * `entryFor` bare — the entry for an apply that reports **itself**.
 *
 * Deliberately not `reporting()`: that wrapper adds a report of its own, so an
 * apply which also reported would be a *second* report, and `createActivityScope`
 * refuses one. Getting this wrong fails loudly, which is the point, but it is a
 * confusing way to learn it.
 */
function selfReporting(
  descriptor: Partial<CommandDescriptor>,
  apply: FakeApply,
): { descriptor: CommandDescriptor; apply: CommandApply<never, unknown> } {
  return entryFor(descriptor, apply);
}

/** The same, minus the report. §8's refusal subject and nothing else. */
function silent(
  descriptor: Partial<CommandDescriptor>,
  apply: FakeApply,
): { descriptor: CommandDescriptor; apply: CommandApply<never, unknown> } {
  return entryFor(descriptor, apply);
}

function registryWith(entry: { descriptor: CommandDescriptor; apply: CommandApply<never, unknown> }): CommandRegistry {
  return { ...COMMAND_REGISTRY, 'doc.write': entry } as CommandRegistry;
}

let ordinal = 0;
function cmd(partial: Partial<Command> & Pick<Command, 'name' | 'params'>): Command {
  ordinal += 1;
  return {
    id: `cmd_B19A${String(ordinal).padStart(6, '0')}`,
    issuedBy: 'user',
    createdAt: TICK,
    ...partial,
  };
}

const wrote = (_s: unknown, p: Record<string, unknown>) => ({ written: p.body });
const captured = (_s: unknown, p: Record<string, unknown>, context: ApplyContext) => {
  context.undo.compensate('restore the previous body', () => undefined);
  return { written: p.body };
};

describe('§8 — a dispatch whose apply reported nothing', () => {
  it('is refused as internal, and the refusal says the report is what was missing', () => {
    const { bus, log } = harness();
    const registry = registryWith(silent({ undo: 'compensable' }, captured));

    const result = execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Not a validation or a permission problem: the effect exists and the bus is
    // reporting a defect in the apply, which is what `internal` is for.
    expect(result.error.code).toBe('internal');
    expect(result.error.message).toContain('doc.write');
    expect(result.error.message).toContain('did not report');
    expect(result.error.message).toContain('activity log');
    expect(result.error.correctiveHint).toContain('context.report');
    // The effect exists, so the executed command gets its row — marked as the
    // bus can mark it, with no affected list and a digest that says nothing was
    // reported. Before this a refusal that left an effect wrote nothing, and the
    // change was invisible to the log that §8 exists to make auditable.
    expect(log.length).toBe(1);
    expect(log.entries()[0]?.affected).toEqual([]);
    expect(log.entries()[0]?.summary).toContain('did not report');
  });

  it('names the undo group, because the refusal runs after registration', () => {
    // The load-bearing ordering claim. Placed before §5's step the effect would
    // be committed with nothing registered, and `details` is the only field that
    // could have told the user how to get it back.
    const { bus } = harness();
    const registry = registryWith(silent({ undo: 'compensable' }, captured));

    const result = execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details?.undoGroupId).toMatch(/^grp_/);
    expect(result.error.message).toContain('registered for undo');
  });

  it('says plainly that there was no group to name, rather than implying one', () => {
    // §5's registration refusal and this one are the two post-apply refusals with
    // nothing to name, and each has to own that in its own message — a refusal
    // that said "registered for undo as undefined" would be worse than either.
    const { bus, log } = harness();
    const registry = registryWith(silent({}, wrote));

    const result = execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details?.undoGroupId).toBeUndefined();
    expect(result.error.message).toContain('Nothing was registered for undo');
    // The row is written, and it names no group, because there is none.
    expect(log.entries()[0]?.undoGroupId).toBeUndefined();
  });

  it('the same apply, reporting, succeeds — so the refusal is about the report and nothing else', () => {
    // The control. Without it, the refusal tests above would pass against a bus
    // that refuses every `doc.write` for some unrelated reason.
    const { bus, log } = harness();
    const registry = registryWith(reporting({ undo: 'compensable' }, captured));

    const result = execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry);

    expect(result.ok).toBe(true);
    expect(log.length).toBe(1);
    expect(log.entries()[0]?.summary).toBe('the apply for doc.write');
  });
});

describe('§8 — one report per dispatch', () => {
  it('refuses a second report, and the refusal is the apply-threw path with the group intact', () => {
    // `undo.ts`'s scope keeps a single payload and a second `compensate()`
    // overwrites the first — which is how the batch came to restore one entry
    // out of five. A second report has the same shape of defect, so it is closed
    // the only way that is not silent. The group surviving is the assertion that
    // matters: the throw happens *after* the capture, and an apply that reported
    // first would throw with nothing to hand back.
    const { bus, log } = harness();
    const registry = registryWith(
      selfReporting({ undo: 'compensable' }, (_s, _p, context) => {
        context.undo.compensate('restore the previous body', () => undefined);
        context.report({ affected: [], summary: 'the first report' });
        context.report({ affected: [], summary: 'the second, illegal report' });
        return null;
      }),
    );

    const result = execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal');
    expect(result.error.message).toContain('twice');
    expect(result.error.details?.undoGroupId).toMatch(/^grp_/);
    // One row, carrying the group the refusal names: the apply captured a
    // compensation before its second report threw, so the effect is reversible and
    // the log says where it is. The row's report is the first one, which the apply
    // did make.
    expect(log.length).toBe(1);
    expect(log.entries()[0]?.undoGroupId).toBe(result.error.details?.undoGroupId);
    expect(log.entries()[0]?.summary).toBe('the first report');
  });

  it('copies the affected list, so an apply that keeps editing it cannot rewrite the row', () => {
    // **The escape this pins.** `createActivityScope.report()` copies the array for
    // the reason its own comment gives, and with the copy removed **the whole suite
    // is green** — 737 passing, measured against `vitest run` with no filter
    //. The reason nothing caught it is the reason the
    // copy is easy to delete: all sixteen shipped applies pass a fresh literal, so
    // no fixture in the repo is an apply that builds a list, hands it over, and
    // keeps editing it. That is ordinary code, and the row §8 writes is the audit
    // record — `activity-log.ts:23` calls a row "a statement about what the bus did".
    const { bus, log } = harness();
    const shared: { nodeId: string; title: string }[] = [];
    const registry = registryWith(
      selfReporting({ undo: 'none' }, (_s, _p, context) => {
        context.report({ affected: shared, summary: 'reported with an empty list' });
        shared.push({ nodeId: 'n_late', title: 'Added after the report' });
        return null;
      }),
    );

    const result = execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry);

    expect(result.ok).toBe(true);
    expect(log.entries()[0]?.affected).toEqual([]);
    // §3's second consumer reads the **same** array, so a copy made in the log alone
    // would satisfy the assertion above and leave the notification lying.
    expect(result.ok ? result.value.affected : 'dispatch failed').toEqual([]);
  });
});

describe('§3 and §8 — one declaration, two consumers', () => {
  it('the notification carries the apply’s affected nodes, and it is the row’s array', () => {
    // §3: subscribers get "command id + affected node ids" and re-render from the
    // store. The `toBe` is the assertion that matters — not deep equality, but
    // *identity*, because a second assembly of the same declaration is the drift
    // that leaves the panel and the log telling different stories.
    const affected = [{ nodeId: THE_LANDING, title: 'The Landing' }];
    const { bus, log, notified } = harness();
    const registry = registryWith(
      selfReporting({}, (_s, _p, context) => {
        context.report({ affected, summary: 'wrote the body of "The Landing"' });
        return null;
      }),
    );
    const command = cmd({ name: 'doc.write', params: { body: 'x' } });

    execute(command, bus, registry);

    const row = log.entries()[0]!;
    expect(row.affected).toEqual(affected);
    const outcome = notified[0]!;
    // §3's "command id + affected node ids" — both halves, and the ids are the
    // row's array rather than a re-derivation.
    expect(outcome.commandId).toBe(command.id);
    expect(outcome.affected).toBe(row.affected);
  });

  it('a postcondition failure still writes the row, so a failed command is auditable', () => {
    // The log is the audit (§1), and a command whose postcondition failed is the
    // one a reader most needs to find. The refusal runs *before* this, so it
    // applies identically on the failure path — and a reporting apply is unaffected
    // by it, which is what keeps the refusal from swallowing legitimate failures.
    const { bus, log } = harness();
    const registry = registryWith(
      reporting(
        {
          postconditions: [{ describe: 'the body is longer', assert: () => false }],
        },
        wrote,
      ),
    );

    const result = execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('postcondition');
    expect(log.length).toBe(1);
    expect(log.entries()[0]?.summary).toBe('the apply for doc.write');
  });
});

describe('§8 — the log itself', () => {
  it('carries a copy per call, so a subscriber cannot rewrite history', () => {
    const log = createActivityLog();
    log.append({ at: TICK, command: 'doc.write', issuedBy: 'user', source: 'native', affected: [], summary: 'one' });
    // The cast is the assertion: `entries()` is typed `readonly`, so reaching for
    // `push` is the only way to *attempt* the mutation a caller must not be able
    // to make. If the log ever handed out its own array this would succeed and
    // the log would have two rows.
    const first = log.entries() as ActivityEntry[];
    first.push({ at: TICK, command: 'binder.rename', issuedBy: 'user', source: 'native', affected: [], summary: 'two' });
    expect(log.length).toBe(1);
    expect(log.entries()[0]?.summary).toBe('one');
  });

  it('entriesForGroup returns one group’s rows in append order, and no other group’s', () => {
    // §5's checkpoint row reads this: "restore to before this turn" needs the
    // turn's commands in the order they ran, and nothing from the next turn.
    const { bus, log } = harness();
    // `compensable` and a capturing apply, because §5 makes one agent *turn* one
    // undo group, and a group is what the checkpoint row's "restore to before
    // this turn" reads. With `undo: 'none'` the three dispatches would run and
    // register nothing, and this test would be grouping rows that do not exist.
    const registry = registryWith(reporting({ undo: 'compensable' }, captured));
    const first = execute(
      cmd({ name: 'doc.write', params: { body: 'a' }, issuedBy: 'agent', turnId: 'turn_1' }),
      bus,
      registry,
    );
    if (!first.ok) throw new Error('expected the first dispatch to succeed');
    execute(
      cmd({ name: 'doc.write', params: { body: 'b' }, issuedBy: 'agent', turnId: 'turn_1' }),
      bus,
      registry,
    );
    execute(
      cmd({ name: 'doc.write', params: { body: 'c' }, issuedBy: 'agent', turnId: 'turn_2' }),
      bus,
      registry,
    );

    const group = first.value.undoGroupId!;
    expect(log.entriesForGroup(group).map((entry) => entry.summary)).toEqual([
      'the apply for doc.write',
      'the apply for doc.write',
    ]);
    expect(log.length).toBe(3);
  });
});

describe('the caller names the source, and a refusal that left an effect is logged', () => {
  it('stamps the source the caller names, and native when it names none', () => {
    const { bus, log } = harness();
    const registry = registryWith(reporting({ undo: 'compensable' }, captured));

    expect(execute(cmd({ name: 'doc.write', params: { body: 'x' } }), bus, registry, 'mcp').ok).toBe(true);
    expect(execute(cmd({ name: 'doc.write', params: { body: 'y' } }), bus, registry).ok).toBe(true);

    expect(log.entries().map((entry) => entry.source)).toEqual(['mcp', 'native']);
  });

  it('names the command on a registration refusal, so the refusal can be traced to its dispatch', () => {
    // A registration refusal names no group, because none was registered — but the
    // command it refused is always named. Before this the details were absent.
    const { bus } = harness();
    const registry = registryWith(silent({ undo: 'compensable' }, () => undefined));
    const command = cmd({ name: 'doc.write', params: { body: 'x' } });

    const result = execute(command, bus, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details?.commandId).toBe(command.id);
    expect(result.error.details?.undoGroupId).toBeUndefined();
  });
});
