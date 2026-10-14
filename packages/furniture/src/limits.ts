/**
 * The limits the specs fix, in one place, so a save-time clamp and the sentence that
 * states it can be read side by side.
 */

/** binder-filters.md §2 — ≤ 50 saved filters per project. */
export const MAX_SAVED_FILTERS = 50;

/** binder-filters.md §2 — each criteria array holds at most this many entries. */
export const MAX_CRITERIA_ENTRIES = 32;

/** binder-filters.md §2 — `text` is at most this many characters (code points). */
export const MAX_TEXT_CHARS = 200;

/** binder-filters.md §2 — a saved filter's name is at most this many characters. */
export const MAX_FILTER_NAME_CHARS = 60;

/** goals-progress.md §2.2 — ≤ 20 project goals per project. */
export const MAX_GOALS = 20;

/**
 * goals-progress.md §2.2 — the `about` comparator holds when `|progress − target|` is
 * within this percentage of the target, inclusive (§6 pins both edges).
 */
export const ABOUT_TOLERANCE_PERCENT = 10;

/** goals-progress.md §2.1 — the session target is clamped to 0–100 000 words. */
export const MAX_DAILY_TARGET_WORDS = 100_000;
