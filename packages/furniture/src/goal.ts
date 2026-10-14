/**
 * Project goals — progress and pace — [goals-progress.md §2.2, §4, §6](docs/architecture/goals-progress.md).
 *
 * A goal is a completion target attached to the manuscript root or a folder, measured
 * in words, or in characters (goals-progress §9.2). Its progress is the subtree sum, and
 * its pace is the amount per day still needed to finish by the deadline. A weekly or
 * monthly session goal (§9.3) counts the words written in its window instead. Every
 * function is pure: the counts, the session records and an injected `today` come in as
 * arguments. Nothing is stored, so nothing can go stale.
 */
import { ABOUT_TOLERANCE_PERCENT } from './limits.js';
import { MILLISECONDS_PER_DAY, dayNumber, type LocalDay } from './day.js';

/**
 * goals-progress §9.2: `chars` counts the non-whitespace code points of a body
 * ({@link goalCharsOf}). Session goals count words, because a session records words.
 */
export type GoalMetric = 'words' | 'chars';

const WHITESPACE = /\s/u;

/**
 * The characters a `chars` goal counts in one body (goals-progress §9.2): its non-whitespace code points. A surrogate pair counts
 * once, so a CJK manuscript counts each ideograph, and the markup of a body counts as it is written, because the body is what the
 * writer typed. Not `countBody`'s `chars`, which is the body's length in code units, whitespace included.
 */
export function goalCharsOf(body: string): number {
  let count = 0;
  for (const character of body) {
    if (!WHITESPACE.test(character)) count += 1;
  }
  return count;
}

/**
 * goals-progress §9.3: `project` is a §2.2 goal on a node's subtree, a total with an optional
 * deadline. `weekly` and `monthly` are writing-pace windows: the words written in the week or month that holds today, read from
 * sessions.jsonl, where the window starts on the goal's own reset day ({@link GoalResetDay}). A session goal attaches to the manuscript
 * root, is a minimum (`at-least`), and recurs, so it takes no deadline. A daily target is the app's session target (session-target.ts),
 * not a goal kind. An absent kind is `project`.
 */
export type GoalKind = 'project' | 'weekly' | 'monthly';

export const GOAL_KINDS: readonly GoalKind[] = ['project', 'weekly', 'monthly'];

/** goals-progress §2.2: Ulysses' comparator triple, adopted verbatim. */
export type GoalComparator = 'at-least' | 'at-most' | 'about';

export const GOAL_COMPARATORS: readonly GoalComparator[] = ['at-least', 'at-most', 'about'];

/**
 * The rules a weekly or monthly goal keeps (goals-progress §9.3), as the reasons it breaks them. Empty for a project goal, and for a session
 * goal that keeps every rule. The save check and the load check both read this, so a goal either path accepts is the same goal.
 */
export function sessionGoalProblems(goal: {
  readonly kind?: string | null;
  readonly nodeId: string;
  readonly metric: string;
  readonly comparator: string;
  readonly hasDeadline: boolean;
  /** The goal's reset day as given, if any (goals-progress §9.3). Absent or null means the default. */
  readonly resetDay?: unknown;
}): string[] {
  if (goal.kind !== 'weekly' && goal.kind !== 'monthly') {
    return goal.resetDay === undefined || goal.resetDay === null ? [] : ['a project goal does not reset, so it takes no reset day'];
  }
  const problems: string[] = [];
  if (goal.nodeId !== 'manuscript') problems.push(`a ${goal.kind} goal counts the whole project, so it attaches to the manuscript root`);
  if (goal.metric !== 'words') problems.push(`a ${goal.kind} goal counts words, because a session records words`);
  if (goal.comparator !== 'at-least') problems.push(`a ${goal.kind} goal is a minimum, so its comparator is at-least`);
  if (goal.hasDeadline) problems.push(`a ${goal.kind} goal recurs, so it takes no deadline`);
  if (goal.resetDay !== undefined && goal.resetDay !== null && !isResetDayOf(goal.kind, goal.resetDay)) {
    problems.push(
      goal.kind === 'weekly'
        ? 'a weekly goal resets on a weekday, 0 (Sunday) to 6 (Saturday)'
        : 'a monthly goal resets on a day from 1 to 28, or on "last" for the last day of the month',
    );
  }
  return problems;
}

/**
 * The day a weekly or monthly goal starts its window on (goals-progress §9.3). For a weekly goal, a weekday: 0 is Sunday and 6 is
 * Saturday, as `Date.getDay` counts them. For a monthly goal, a day of the month from 1 to 28 (every month has one), or `last` for the
 * last day of each month. Absent means the default: the locale's first weekday, or the 1st.
 */
export type GoalResetDay = number | 'last';

/** The latest day a monthly goal can reset on by number: every month, February included, has a 28th. */
export const MONTHLY_RESET_MAX = 28;

/** Whether `value` is a reset day a goal of `kind` takes. */
export function isResetDayOf(kind: 'weekly' | 'monthly', value: unknown): value is GoalResetDay {
  if (kind === 'weekly') return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
  return value === 'last' || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MONTHLY_RESET_MAX);
}

/** The weekday a week starts on when no locale says otherwise: Monday (ISO 8601). */
export const DEFAULT_FIRST_WEEKDAY = 1;

/**
 * The first day of the week in `locale`, as a weekday 0 (Sunday) to 6 (Saturday). `Intl.Locale` reports it as ISO 1 (Monday) to
 * 7 (Sunday), through `getWeekInfo()` where the engine has it and the older `weekInfo` getter where it does not. Monday when the
 * locale is missing or malformed, or the engine reports neither.
 */
export function localeFirstWeekday(locale: string | undefined): number {
  if (locale === undefined || locale === '') return DEFAULT_FIRST_WEEKDAY;
  try {
    const tag = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const firstDay = tag.getWeekInfo?.().firstDay ?? tag.weekInfo?.firstDay;
    return Number.isInteger(firstDay) && (firstDay as number) >= 1 && (firstDay as number) <= 7 ? (firstDay as number) % 7 : DEFAULT_FIRST_WEEKDAY;
  } catch {
    return DEFAULT_FIRST_WEEKDAY;
  }
}

/** A span of local days, both ends included. */
export interface GoalWindow {
  readonly from: LocalDay;
  readonly to: LocalDay;
}

/** How a window is placed: the goal's own reset day, and the first weekday a weekly goal without one starts on. */
export interface GoalWindowOptions {
  readonly resetDay?: GoalResetDay;
  /** 0 (Sunday) to 6 (Saturday); see {@link localeFirstWeekday}. Monday when absent. */
  readonly firstWeekday?: number;
}

/**
 * The window a session goal counts over (goals-progress §9.3), both ends included. Pure: `today` is passed in, and the arithmetic is
 * the UTC day arithmetic of day.ts, so the same day gives the same window in every timezone.
 *
 * - Weekly: the seven days starting on the latest reset weekday on or before `today`. The reset weekday is the goal's own, else
 *   `firstWeekday`, else Monday.
 * - Monthly with a reset day N (1 to 28; the 1st when unset): from the latest N-th on or before `today` to the day before the next
 *   N-th. With N = 1 that is the calendar month.
 * - Monthly with `last`: the same rule, with each month's own last day as its reset day. The window starts on the last day of a month
 *   and ends the day before the last day of the next month, so on 15 October it is 30 September to 30 October, and on 31 October it is
 *   31 October to 29 November.
 */
export function goalWindowOf(kind: 'weekly' | 'monthly', today: LocalDay, options: GoalWindowOptions = {}): GoalWindow {
  const reset = options.resetDay !== undefined && isResetDayOf(kind, options.resetDay) ? options.resetDay : undefined;
  if (kind === 'weekly') {
    const day = dayNumber(today);
    const startsOn = typeof reset === 'number' ? reset : (options.firstWeekday ?? DEFAULT_FIRST_WEEKDAY);
    const since = (new Date(day * MILLISECONDS_PER_DAY).getUTCDay() - startsOn + 7) % 7;
    const start = day - since;
    return { from: dayOfNumber(start), to: dayOfNumber(start + 6) };
  }
  const [year, month, date] = today.split('-').map(Number) as [number, number, number];
  // The reset day of a month, `month` counted from 1; Date.UTC carries a month of 0 or 13 into the next year either way.
  const resetIn = (y: number, m: number): number => {
    if (reset === 'last') return new Date(Date.UTC(y, m, 0)).getUTCDate();
    return reset ?? 1;
  };
  const dayIn = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d) / MILLISECONDS_PER_DAY;
  const thisReset = resetIn(year, month);
  const start = date >= thisReset ? dayIn(year, month, thisReset) : dayIn(year, month - 1, resetIn(year, month - 1));
  const nextReset = date >= thisReset ? dayIn(year, month + 1, resetIn(year, month + 1)) : dayIn(year, month, thisReset);
  return { from: dayOfNumber(start), to: dayOfNumber(nextReset - 1) };
}

/** The local day a whole day number names (the inverse of dayNumber). */
function dayOfNumber(day: number): LocalDay {
  return new Date(day * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * A project goal as this package reads and writes it (goals-progress §2.2).
 *
 * CROSS-SCOPE REQUEST (packages/store): the store's `ProjectGoal` in manifest.ts is the
 * pre-spec shape `{id, name, target, createdAt, updatedAt}`, and its `projectGoal()`
 * serializer writes `"name": undefined` for a goal of this shape, which is not valid JSON.
 * Nothing here writes a goal to the store until the store takes this shape. The request
 * is recorded as a KNOWN GAP in test/known-gaps.test.ts.
 */
export interface ProjectGoal {
  readonly id: string;
  /** The manuscript root or any folder. A dangling id is kept and flagged, never dropped. */
  readonly nodeId: string;
  readonly metric: GoalMetric;
  /** Additive (goals-progress §9.3). Absent means `project`. */
  readonly kind?: GoalKind;
  /** A weekly or monthly goal's reset day (goals-progress §9.3). Absent means the default: the locale's first weekday, or the 1st. */
  readonly resetDay?: GoalResetDay;
  readonly comparator: GoalComparator;
  /** Positive whole number of words, or of characters for the `chars` metric. */
  readonly target: number;
  /** Date only, local calendar. Absent means open-ended. */
  readonly deadline?: LocalDay;
  /** Completed or abandoned goals leave the rail but stay in the manifest. */
  readonly archived?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Unknown manifest fields, kept in memory and dropped on the next save (project-format §6).
   * Set by the loader only, and only when there are any; a save builds a goal without them.
   */
  readonly unknownFields?: Readonly<Record<string, unknown>>;
}

/**
 * What a goal reads as right now.
 * - `met`: the comparator holds. Pace is omitted.
 * - `target-missing`: the node is gone or is not a folder. Matches nothing, pace omitted.
 * - `overdue`: the deadline has passed and the goal is unmet. Pace omitted. A state, never a failure.
 * - `exceeded`: a cap or band the writer has passed. Writing cannot bring it back, so
 *   there is no plan to show, and pace is omitted for the same reason.
 * - `open`: still achievable by writing.
 */
export type GoalState = 'open' | 'met' | 'exceeded' | 'overdue' | 'target-missing';

export interface GoalPace {
  /** `ceil(max(0, target − current) / max(1, daysLeft))` — whole words per day. */
  readonly perDay: number;
  /** Calendar days to the deadline, floored at 1 so the deadline day itself is a writing day (§6). */
  readonly daysLeft: number;
}

export interface GoalProgress {
  /** Subtree word sum for the goal's node. 0 for a target-missing goal. */
  readonly current: number;
  readonly met: boolean;
  readonly state: GoalState;
  /**
   * Present only when the goal is `open` with a deadline that has not passed. A consumer
   * that reads a missing pace as "nothing to plan" is therefore never handed a `perDay` of 0
   * for a goal writing cannot finish.
   */
  readonly pace?: GoalPace;
}

/**
 * What progress needs from the binder and the sessions: a word sum, and whether an id names a goal target. `charsOf` and `wordsWrittenIn` are
 * optional so a caller that does not measure them still compiles: a `chars` goal reads as 0 characters without `charsOf`, and a session goal
 * reads as 0 words without `wordsWrittenIn`. Every caller in the app that measures a goal supplies them.
 */
export interface GoalProbe {
  wordsOf(nodeId: string): number;
  isGoalTarget(nodeId: string): boolean;
  /** Characters of the node's subtree, for the `chars` metric (goals-progress §9.2). */
  charsOf?(nodeId: string): number;
  /** Words written in the sessions that ended within a window (goals-progress §9.3). */
  wordsWrittenIn?(window: GoalWindow): number;
}

/** The comparator, as §2.2 defines it. `about` is inclusive at both edges (§6). */
export function goalMet(comparator: GoalComparator, current: number, target: number): boolean {
  if (comparator === 'at-least') return current >= target;
  if (comparator === 'at-most') return current <= target;
  // |current − target| ≤ 10% of target, multiplied out so the edge is exact in integers.
  return Math.abs(current - target) * 100 <= target * ABOUT_TOLERANCE_PERCENT;
}

/** What a session goal's window needs besides the goal: the first weekday a weekly goal with no reset day starts on. */
export interface GoalProgressOptions {
  /** 0 (Sunday) to 6 (Saturday), from {@link localeFirstWeekday}. Monday when absent. */
  readonly firstWeekday?: number;
}

/** Progress and pace for one goal (goals-progress §2.2). `today` is injected and never read here. */
export function goalProgress(goal: ProjectGoal, probe: GoalProbe, today: LocalDay, options: GoalProgressOptions = {}): GoalProgress {
  if (goal.kind === 'weekly' || goal.kind === 'monthly') return sessionGoalProgress(goal, goal.kind, probe, today, options);
  if (!probe.isGoalTarget(goal.nodeId)) {
    return { current: 0, met: false, state: 'target-missing' };
  }

  const current = goal.metric === 'chars' ? (probe.charsOf?.(goal.nodeId) ?? 0) : probe.wordsOf(goal.nodeId);
  if (goalMet(goal.comparator, current, goal.target)) {
    return { current, met: true, state: 'met' };
  }

  const exceeded = current > goal.target;
  if (goal.deadline === undefined) {
    return { current, met: false, state: exceeded ? 'exceeded' : 'open' };
  }

  const untilDeadline = dayNumber(goal.deadline) - dayNumber(today);
  if (untilDeadline < 0) {
    return { current, met: false, state: 'overdue' };
  }
  if (exceeded) return { current, met: false, state: 'exceeded' };

  // Open question for the spec owner (goals-progress §2.2): an `about` goal below its band aims at
  // the exact target, but the goal is met from the band's lower edge, 90% of target. So this pace
  // can ask for up to 10% of the target more words than the goal needs. Not decided here.
  const daysLeft = Math.max(1, untilDeadline);
  const perDay = Math.ceil(Math.max(0, goal.target - current) / daysLeft);
  return { current, met: false, state: 'open', pace: { perDay, daysLeft } };
}

/**
 * A weekly or monthly goal's progress (goals-progress §9.3): the words written in the sessions of the window that holds today. It never
 * reads the binder, so it needs no target node. The pace is over the days left in the window, today included, and is omitted once met.
 */
function sessionGoalProgress(
  goal: ProjectGoal,
  kind: 'weekly' | 'monthly',
  probe: GoalProbe,
  today: LocalDay,
  options: GoalProgressOptions,
): GoalProgress {
  const window = goalWindowOf(kind, today, {
    ...(goal.resetDay !== undefined ? { resetDay: goal.resetDay } : {}),
    ...(options.firstWeekday !== undefined ? { firstWeekday: options.firstWeekday } : {}),
  });
  const current = probe.wordsWrittenIn?.(window) ?? 0;
  if (goalMet(goal.comparator, current, goal.target)) return { current, met: true, state: 'met' };
  const daysLeft = dayNumber(window.to) - dayNumber(today) + 1;
  const perDay = Math.ceil(Math.max(0, goal.target - current) / Math.max(1, daysLeft));
  return { current, met: false, state: 'open', pace: { perDay, daysLeft } };
}

/**
 * The binder footer's goal line (goals-progress §4): active goals, nearest deadline
 * first. A goal with no deadline comes after every dated goal. Ties go to the older
 * goal, then to the id, so the order is total and stable.
 */
export function orderGoalsForFooter(goals: readonly ProjectGoal[]): ProjectGoal[] {
  return goals
    .filter((goal) => goal.archived !== true)
    .sort((a, b) => {
      if (a.deadline !== b.deadline) {
        if (a.deadline === undefined) return 1;
        if (b.deadline === undefined) return -1;
        return a.deadline < b.deadline ? -1 : 1;
      }
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}
