/**
 * Load-time tolerance for the manifest's `goals[]` — [goals-progress.md §3](docs/architecture/goals-progress.md),
 * [project-format.md §2, §6](docs/architecture/project-format.md).
 *
 * Rules, in the owning spec's words: an unknown comparator or metric drops the goal with a
 * load warning, and the dropped goal is not written back on save; a dangling `nodeId` keeps
 * the goal and flags it; an unknown field is kept in memory and dropped on the next save
 * (project-format §6); and a broken goal never blocks a project load. The reader never throws.
 *
 * The notices are plain text (see `noticeText`), so a value a manifest controls cannot reach
 * a notice unflattened.
 */
import type { LoadNotice, TreeNode } from '@caotang/store';

import { createBinderIndex } from './binder-index.js';
import { isLocalDay } from './day.js';
import { isRecord, isStamp, isWholeNumber, keptValues, noticeText } from './guards.js';
import { GOAL_COMPARATORS, GOAL_KINDS, sessionGoalProblems, type GoalComparator, type GoalKind, type GoalResetDay, type ProjectGoal } from './goal.js';

export interface ProjectGoalLoad {
  readonly goals: readonly ProjectGoal[];
  readonly notices: readonly LoadNotice[];
}

const GOAL_KEYS: ReadonlySet<string> = new Set([
  'id',
  'nodeId',
  'metric',
  'kind',
  'resetDay',
  'comparator',
  'target',
  'deadline',
  'archived',
  'createdAt',
  'updatedAt',
]);

/**
 * `tree` is optional. When it is given, a goal whose target is missing or is not a
 * folder gets a notice. The goal is still kept: a missing folder is a dangling id, which
 * the spec says must never block a load.
 */
export function parseProjectGoals(raw: unknown, tree?: readonly TreeNode[]): ProjectGoalLoad {
  const goals: ProjectGoal[] = [];
  const notices: LoadNotice[] = [];
  if (raw === undefined) return { goals, notices };
  if (!Array.isArray(raw)) {
    notices.push({ path: 'goals', message: 'goals is not a list; no project goals were loaded' });
    return { goals, notices };
  }

  const index = tree === undefined ? undefined : createBinderIndex(tree);

  raw.forEach((entry, position) => {
    const path = `goals[${position}]`;
    if (!isRecord(entry)) {
      notices.push({ path, message: 'project goal is not an object; dropped on load and not written back' });
      return;
    }

    const read = readGoal(entry);
    if (read.ok === false) {
      notices.push({ path, message: `project goal dropped on load: ${read.reason}; it is not written back` });
      return;
    }

    const unknownFields = Object.keys(entry).filter((key) => !GOAL_KEYS.has(key));
    for (const key of unknownFields) {
      notices.push({
        path: `${path}.${noticeText(key)}`,
        message: `unknown field "${noticeText(key)}" is kept in memory and dropped on next save`,
      });
    }
    if (index !== undefined && !index.isGoalTarget(read.goal.nodeId)) {
      notices.push({
        path: `${path}.nodeId`,
        message: `goal target "${noticeText(read.goal.nodeId)}" is missing or is not a folder; the goal is kept and flagged, and matches nothing`,
      });
    }
    const kept = keptValues(entry, unknownFields);
    goals.push(kept !== undefined ? { ...read.goal, unknownFields: kept } : read.goal);
  });

  return { goals, notices };
}

type GoalRead = { ok: true; goal: ProjectGoal } | { ok: false; reason: string };

function readGoal(entry: Record<string, unknown>): GoalRead {
  if (typeof entry.id !== 'string' || entry.id === '') return { ok: false, reason: 'id must be a non-empty string' };
  if (typeof entry.nodeId !== 'string' || entry.nodeId === '') {
    return { ok: false, reason: 'nodeId must be a non-empty string' };
  }
  if (entry.metric !== 'words' && entry.metric !== 'chars') {
    return { ok: false, reason: `unknown metric "${noticeText(entry.metric)}"` };
  }
  if (entry.kind !== undefined && entry.kind !== null && !(GOAL_KINDS as readonly unknown[]).includes(entry.kind)) {
    return { ok: false, reason: `unknown kind "${noticeText(entry.kind)}"` };
  }
  if (!(GOAL_COMPARATORS as readonly unknown[]).includes(entry.comparator)) {
    return { ok: false, reason: `unknown comparator "${noticeText(entry.comparator)}"` };
  }
  if (!isWholeNumber(entry.target) || entry.target <= 0) {
    return { ok: false, reason: 'target must be a positive whole number of words' };
  }
  if (entry.deadline !== undefined && entry.deadline !== null && !isLocalDay(entry.deadline)) {
    return { ok: false, reason: 'deadline must be a date in YYYY-MM-DD form' };
  }
  if (entry.archived !== undefined && entry.archived !== null && typeof entry.archived !== 'boolean') {
    return { ok: false, reason: 'archived must be true or false' };
  }
  if (!isStamp(entry.createdAt)) return { ok: false, reason: 'createdAt must be an ISO-8601 instant' };
  if (!isStamp(entry.updatedAt)) return { ok: false, reason: 'updatedAt must be an ISO-8601 instant' };

  const problems = sessionGoalProblems({
    kind: typeof entry.kind === 'string' ? entry.kind : undefined,
    nodeId: entry.nodeId,
    metric: entry.metric,
    comparator: String(entry.comparator),
    hasDeadline: entry.deadline !== undefined && entry.deadline !== null,
    resetDay: entry.resetDay,
  });
  if (problems.length > 0) return { ok: false, reason: problems[0] ?? 'a session goal breaks its rules' };

  const kind = typeof entry.kind === 'string' && entry.kind !== 'project' ? (entry.kind as GoalKind) : undefined;
  // goals-progress §9.3: a goal saved before reset days existed has none, and keeps the default window.
  const resetDay = entry.resetDay === undefined || entry.resetDay === null ? undefined : (entry.resetDay as GoalResetDay);
  const goal: ProjectGoal = {
    id: entry.id,
    nodeId: entry.nodeId,
    metric: entry.metric === 'chars' ? 'chars' : 'words',
    ...(kind !== undefined ? { kind } : {}),
    ...(resetDay !== undefined ? { resetDay } : {}),
    comparator: entry.comparator as GoalComparator,
    target: entry.target,
    ...(typeof entry.deadline === 'string' ? { deadline: entry.deadline } : {}),
    ...(typeof entry.archived === 'boolean' ? { archived: entry.archived } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  return { ok: true, goal };
}
