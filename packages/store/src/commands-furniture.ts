/**
 * The applies of the writing-furniture commands: saved binder filters and project goals
 * ([binder-filters.md §5](docs/architecture/binder-filters.md), [goals-progress.md §4](docs/architecture/goals-progress.md)).
 *
 * The lists they write are the manifest's `filters[]` and `goals[]`, so the writes belong to the store. Their descriptors
 * are the bus's own (`packages/bus/src/descriptors-furniture.ts`), which check the shape, the vocabulary and the target.
 * What the store checks here is what only the whole list can show: the list is not full, and an id it was asked to
 * update or delete is present or absent as the command says. A refusal is thrown before anything is written, so it
 * leaves no partial effect (command-bus §3).
 *
 * Each apply registers its exact inverse. Creating a filter or goal is undone by deleting it. Updating one, or deleting
 * one, is undone by saving the record as it was: its parameters carry the draft, and the restore table (`RestoreTable`,
 * in `commands.ts`) carries the timestamps the record had, so the restored record is the record it replaced.
 */
import { CROCKFORD_ALPHABET, newId } from '@caotang/ids';
import {
  ApplyRefusal,
  type ApplyContext,
  type Command,
  type CommandApply,
  type CommandError,
  type CommandName,
  type CommandParams,
} from '@caotang/bus';

import type { RestoredStamps, RestoreTable } from './commands.js';
import type { ProjectGoal, SavedFilter, TreeNode } from './manifest.js';
import { nodeById, type ProjectState } from './state.js';

/** binder-filters §2: at most 50 saved filters per project. The bus names the same limit for its own checks. */
export const SAVED_FILTERS_LIMIT = 50;
/** goals-progress §2.2: at most 20 goals per project. */
export const GOALS_LIMIT = 20;

/** The clock seam the applies read for `createdAt` and `updatedAt`, as the rest of the store does. */
export interface FurnitureClock {
  now(): number;
}

type ProjectApply<P> = CommandApply<P, ProjectState>;

/** The four applies, keyed by the command name they serve. */
export interface FurnitureApplies {
  readonly 'binder.saveFilter': ProjectApply<CommandParams['binder.saveFilter']>;
  readonly 'binder.deleteFilter': ProjectApply<CommandParams['binder.deleteFilter']>;
  readonly 'project.saveGoal': ProjectApply<CommandParams['project.saveGoal']>;
  readonly 'project.deleteGoal': ProjectApply<CommandParams['project.deleteGoal']>;
}

/** The record a save names, as the command takes it: the same shape the bus validated. */
type FilterDraft = CommandParams['binder.saveFilter']['filter'];
type GoalDraft = CommandParams['project.saveGoal']['goal'];

/** The inverse, minted. The id is new, as every command id is; the params are the values the inverse restores. */
function inverseCommand<N extends CommandName>(name: N, params: CommandParams[N], clock: FurnitureClock): Command<CommandParams[N]> {
  return { id: newId('cmd'), name, params, issuedBy: 'user', createdAt: clock.now() };
}

/** An inverse minted with the timestamps it must restore remembered under its own id (see `RestoreTable`). */
function inverseWithStamps<N extends CommandName>(
  name: N,
  params: CommandParams[N],
  clock: FurnitureClock,
  restore: RestoreTable,
  stamps: RestoredStamps,
): Command<CommandParams[N]> {
  const command = inverseCommand(name, params, clock);
  restore.remember(command.id, stamps);
  return command;
}

/** A random furniture id (`q_` or `g_` and ten Crockford characters), unused in `taken`. Only drawn when the caller gave none. */
function mintId(prefix: 'q' | 'g', taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const bytes = new Uint8Array(10);
    globalThis.crypto.getRandomValues(bytes);
    let body = '';
    for (const byte of bytes) body += CROCKFORD_ALPHABET[byte & 31] ?? '0';
    const id = `${prefix}_${body}`;
    if (!taken.has(id)) return id;
  }
  throw new Error(`could not draw an unused ${prefix}_ id in 16 attempts`);
}

function filterDraftOf(filter: SavedFilter): FilterDraft {
  return {
    id: filter.id,
    name: filter.name,
    ...(filter.root !== undefined ? { root: filter.root } : {}),
    criteria: { ...filter.criteria },
  };
}

/** The goal as the command takes it, so an inverse replays it through the same validator. The metric and kind come back only when set. */
function goalDraftOf(goal: ProjectGoal): GoalDraft {
  return {
    id: goal.id,
    nodeId: goal.nodeId,
    ...(goal.metric === 'chars' ? { metric: 'chars' as const } : {}),
    ...(goal.kind === 'weekly' || goal.kind === 'monthly' ? { kind: goal.kind } : {}),
    ...(goal.resetDay !== undefined ? { resetDay: goal.resetDay } : {}),
    comparator: goal.comparator,
    target: goal.target,
    ...(goal.deadline !== undefined ? { deadline: goal.deadline } : {}),
    ...(goal.archived === true ? { archived: true } : {}),
  };
}

/** The reason a full list refuses one more record, in the bus's own error shape. */
function limitRefusal(what: string, singular: string, limit: number, target: string): ApplyRefusal {
  const error: CommandError = {
    code: 'limit-exceeded',
    message: `a project holds at most ${limit} ${what}`,
    target,
    correctiveHint: `delete a ${singular} before saving another`,
  };
  return new ApplyRefusal(error);
}

function missingRefusal(message: string, target: string, hint: string): ApplyRefusal {
  return new ApplyRefusal({ code: 'not-found', message, target, correctiveHint: hint });
}

function isGoalTarget(node: TreeNode | undefined): node is TreeNode {
  return node !== undefined && (node.type === 'folder' || node.id === 'manuscript');
}

/** The applies for the four furniture commands. The descriptors stay the bus's; the registry assembly attaches these. */
export function furnitureApplies(clock: FurnitureClock, restore: RestoreTable): FurnitureApplies {
  const saveFilter: ProjectApply<CommandParams['binder.saveFilter']> = (state, params, context: ApplyContext) => {
    const incoming = params.filter;
    const list: SavedFilter[] = state.manifest.filters ?? [];
    const index = incoming.id === undefined ? -1 : list.findIndex((filter) => filter.id === incoming.id);
    const existing = index < 0 ? undefined : list[index];
    if (existing === undefined && list.length >= SAVED_FILTERS_LIMIT) {
      throw limitRefusal('saved filters', 'saved filter', SAVED_FILTERS_LIMIT, 'binder.saveFilter');
    }

    const id = existing?.id ?? incoming.id ?? mintId('q', new Set(list.map((filter) => filter.id)));
    const now = new Date(clock.now()).toISOString();
    // An inverse puts back the timestamps its forward command replaced; a forward command finds none and takes the clock.
    const restored = restore.recall(context.commandId);
    const next: SavedFilter = {
      id,
      name: incoming.name,
      ...(incoming.root !== undefined ? { root: incoming.root } : {}),
      criteria: { ...incoming.criteria },
      createdAt: restored?.createdAt ?? existing?.createdAt ?? now,
      updatedAt: restored?.updatedAt ?? now,
    };

    if (existing !== undefined) {
      list[index] = next;
      context.undo.inverse(
        inverseWithStamps(
          'binder.saveFilter',
          { filter: filterDraftOf(existing) },
          clock,
          restore,
          { createdAt: existing.createdAt, updatedAt: existing.updatedAt },
        ),
      );
    } else {
      list.push(next);
      context.undo.inverse(inverseCommand('binder.deleteFilter', { filterId: id }, clock));
    }
    state.manifest.filters = list;
    context.report({
      affected: [],
      summary: existing === undefined ? `saved the filter "${next.name}"` : `changed the saved filter "${next.name}"`,
    });
    return { filterId: id };
  };

  const deleteFilter: ProjectApply<CommandParams['binder.deleteFilter']> = (state, params, context: ApplyContext) => {
    const list: SavedFilter[] = state.manifest.filters ?? [];
    const index = list.findIndex((filter) => filter.id === params.filterId);
    const removed = index < 0 ? undefined : list[index];
    if (removed === undefined) {
      throw missingRefusal(
        `no saved filter with id "${params.filterId}"`,
        params.filterId,
        'the filter may already be deleted; read the saved filters in the binder rail',
      );
    }
    list.splice(index, 1);
    state.manifest.filters = list;
    context.undo.inverse(
      inverseWithStamps(
        'binder.saveFilter',
        { filter: filterDraftOf(removed) },
        clock,
        restore,
        { createdAt: removed.createdAt, updatedAt: removed.updatedAt },
      ),
    );
    context.report({ affected: [], summary: `deleted the saved filter "${removed.name}"` });
    return { filterId: removed.id };
  };

  const saveGoal: ProjectApply<CommandParams['project.saveGoal']> = (state, params, context: ApplyContext) => {
    const incoming = params.goal;
    const node = nodeById(state, incoming.nodeId);
    if (!isGoalTarget(node)) {
      throw new ApplyRefusal({
        code: 'invalid-params',
        message: `goal target "${incoming.nodeId}" is not the manuscript root or a folder any more`,
        target: incoming.nodeId,
        correctiveHint: 'attach the goal to the manuscript root or a folder that still exists',
      });
    }
    const list: ProjectGoal[] = state.manifest.goals ?? [];
    const index = incoming.id === undefined ? -1 : list.findIndex((goal) => goal.id === incoming.id);
    const existing = index < 0 ? undefined : list[index];
    if (existing === undefined && list.length >= GOALS_LIMIT) {
      throw limitRefusal('goals', 'goal', GOALS_LIMIT, 'project.saveGoal');
    }

    const id = existing?.id ?? incoming.id ?? mintId('g', new Set(list.map((goal) => goal.id)));
    const now = new Date(clock.now()).toISOString();
    const restored = restore.recall(context.commandId);
    const next: ProjectGoal = {
      id,
      nodeId: incoming.nodeId,
      metric: incoming.metric ?? 'words',
      ...(incoming.kind === 'weekly' || incoming.kind === 'monthly' ? { kind: incoming.kind } : {}),
      ...(incoming.resetDay !== undefined ? { resetDay: incoming.resetDay } : {}),
      comparator: incoming.comparator,
      target: incoming.target,
      ...(incoming.deadline !== undefined ? { deadline: incoming.deadline } : {}),
      ...(incoming.archived === true ? { archived: true } : {}),
      createdAt: restored?.createdAt ?? existing?.createdAt ?? now,
      updatedAt: restored?.updatedAt ?? now,
    };

    if (existing !== undefined) {
      list[index] = next;
      context.undo.inverse(
        inverseWithStamps(
          'project.saveGoal',
          { goal: goalDraftOf(existing) },
          clock,
          restore,
          { createdAt: existing.createdAt, updatedAt: existing.updatedAt },
        ),
      );
    } else {
      list.push(next);
      context.undo.inverse(inverseCommand('project.deleteGoal', { goalId: id }, clock));
    }
    state.manifest.goals = list;
    context.report({
      affected: [],
      summary: existing === undefined ? `set a goal for "${node.title}"` : `changed the goal for "${node.title}"`,
    });
    return { goalId: id };
  };

  const deleteGoal: ProjectApply<CommandParams['project.deleteGoal']> = (state, params, context: ApplyContext) => {
    const list: ProjectGoal[] = state.manifest.goals ?? [];
    const index = list.findIndex((goal) => goal.id === params.goalId);
    const removed = index < 0 ? undefined : list[index];
    if (removed === undefined) {
      throw missingRefusal(
        `no goal with id "${params.goalId}"`,
        params.goalId,
        'the goal may already be deleted; read the goals in the inspector',
      );
    }
    list.splice(index, 1);
    state.manifest.goals = list;
    context.undo.inverse(
      inverseWithStamps(
        'project.saveGoal',
        { goal: goalDraftOf(removed) },
        clock,
        restore,
        { createdAt: removed.createdAt, updatedAt: removed.updatedAt },
      ),
    );
    const title = nodeById(state, removed.nodeId)?.title ?? removed.nodeId;
    context.report({ affected: [], summary: `removed the goal for "${title}"` });
    return { goalId: removed.id };
  };

  return {
    'binder.saveFilter': saveFilter,
    'binder.deleteFilter': deleteFilter,
    'project.saveGoal': saveGoal,
    'project.deleteGoal': deleteGoal,
  };
}
