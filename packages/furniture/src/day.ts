/**
 * Device-local calendar days — [goals-progress.md §2.1–§2.2](docs/architecture/goals-progress.md),
 * assumption A3.
 *
 * "Today" is the device's local calendar day: a browser app has no other honest
 * timezone. Every day comparison in this package runs on the integer day numbers
 * below, so the same fixture gives the same pace in every timezone. The one place a
 * clock is read is {@link localDayOf}, and it reads only the instant it is handed.
 */

/** `YYYY-MM-DD` in the device's local calendar. A plain string on purpose: the manifest stores it so. */
export type LocalDay = string;

export const MILLISECONDS_PER_DAY = 86_400_000;

const LOCAL_DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form — `2026-02-30` is not one. */
export function isLocalDay(value: unknown): value is LocalDay {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DAY_SHAPE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const back = new Date(Date.UTC(year, month - 1, day));
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
}

/**
 * Whole days since the Unix epoch for a local day. Computed in UTC so that the
 * difference of two of them is exact calendar arithmetic in every timezone: the
 * deadline arithmetic of §2.2 (`daysLeft = deadline − today`) never sees a DST hour.
 * The day must already satisfy {@link isLocalDay}; anything else yields NaN.
 */
export function dayNumber(day: LocalDay): number {
  const match = LOCAL_DAY_SHAPE.exec(day);
  if (match === null) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MILLISECONDS_PER_DAY;
}

/** The device-local calendar day of an instant. */
export function localDayOf(instant: Date): LocalDay {
  return [
    String(instant.getFullYear()).padStart(4, '0'),
    String(instant.getMonth() + 1).padStart(2, '0'),
    String(instant.getDate()).padStart(2, '0'),
  ].join('-');
}

/** The device-local day of an ISO-8601 instant, or undefined when the text does not parse. */
export function localDayOfInstant(iso: string): LocalDay | undefined {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : localDayOf(new Date(ms));
}
