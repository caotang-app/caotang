/**
 * The furniture engine, headless — [binder-filters.md](docs/architecture/binder-filters.md),
 * [goals-progress.md](docs/architecture/goals-progress.md).
 *
 * Saved binder filters, project goals with pace, the daily session target and the sprint
 * timer. Nothing here touches the store's runtime, the editor or the network. Every
 * function is pure: the clock, the word counts and the vocabulary come in as arguments.
 */

export {
  createBinderIndex,
  isReservedRoot,
  type BinderIndex,
} from './binder-index.js';

export {
  CRITERIA_KEYS,
  FILTER_ROOTS,
  SEARCH_SURFACES,
  danglingVocabulary,
  foldText,
  matchNode,
  vocabularyIds,
  type CriteriaKey,
  type FilterCriteria,
  type FilterProbe,
  type FilterRoot,
  type SearchSurface,
  type VocabularyIds,
} from './criteria.js';

export { readCriteria, type CriteriaReading } from './criteria-read.js';

export { evaluateFilter, type FilterResult, type FilterSpec } from './result.js';

export { parseSavedFilters, type SavedFilter, type SavedFilterLoad } from './filter-load.js';

export {
  DEFAULT_FIRST_WEEKDAY,
  GOAL_COMPARATORS,
  GOAL_KINDS,
  MONTHLY_RESET_MAX,
  goalCharsOf,
  goalMet,
  goalProgress,
  goalWindowOf,
  isResetDayOf,
  localeFirstWeekday,
  orderGoalsForFooter,
  sessionGoalProblems,
  type GoalComparator,
  type GoalKind,
  type GoalMetric,
  type GoalPace,
  type GoalProbe,
  type GoalProgress,
  type GoalProgressOptions,
  type GoalResetDay,
  type GoalState,
  type GoalWindow,
  type GoalWindowOptions,
  type ProjectGoal,
} from './goal.js';

export { parseProjectGoals, type ProjectGoalLoad } from './goal-load.js';

export {
  prepareProjectGoal,
  prepareSavedFilter,
  type ProjectGoalDraft,
  type ProjectGoalSaveContext,
  type SaveOutcome,
  type SavedFilterDraft,
  type SavedFilterSaveContext,
  type VocabularyShape,
} from './save.js';

export {
  clampDailyTarget,
  sessionTargetProgress,
  wordsByLocalDay,
  wordsWrittenBetween,
  type SessionTargetProgress,
} from './session-target.js';

export {
  SPRINT_DEFAULT_MINUTES,
  SPRINT_MAX_MINUTES,
  SPRINT_MIN_MINUTES,
  createSprint,
  sprintView,
  transitionSprint,
  type SprintEndReason,
  type SprintEvent,
  type SprintState,
  type SprintStatus,
  type SprintView,
} from './sprint.js';

export {
  dayNumber,
  isLocalDay,
  localDayOf,
  localDayOfInstant,
  type LocalDay,
} from './day.js';

export {
  ABOUT_TOLERANCE_PERCENT,
  MAX_CRITERIA_ENTRIES,
  MAX_DAILY_TARGET_WORDS,
  MAX_FILTER_NAME_CHARS,
  MAX_GOALS,
  MAX_SAVED_FILTERS,
  MAX_TEXT_CHARS,
} from './limits.js';

export { paceWords } from './pace.js';
export {
  HISTORY_BAR_DAYS,
  historyCsv,
  historyReading,
  type HistoryDay,
  type HistoryReading,
  type HistorySession,
} from './history.js';
