/**
 * Device-local days — goals-progress §2.2 (deadline arithmetic) and assumption A3.
 */
import { describe, expect, it } from 'vitest';

import { dayNumber, isLocalDay, localDayOf, localDayOfInstant } from '../src/index.js';

describe('isLocalDay: a real calendar date in YYYY-MM-DD form', () => {
  it('accepts real dates, including a leap day', () => {
    expect(isLocalDay('2026-10-31')).toBe(true);
    expect(isLocalDay('2028-02-29')).toBe(true);
  });

  it('refuses a date that does not exist, and a malformed one', () => {
    expect(isLocalDay('2026-02-30')).toBe(false);
    expect(isLocalDay('2027-02-29')).toBe(false);
    expect(isLocalDay('2026-13-01')).toBe(false);
    expect(isLocalDay('2026-1-01')).toBe(false);
    expect(isLocalDay('31/10/2026')).toBe(false);
    expect(isLocalDay('2026-10-31T00:00:00Z')).toBe(false);
    expect(isLocalDay(20261031)).toBe(false);
  });
});

describe('dayNumber: exact calendar arithmetic, timezone-free', () => {
  it('counts one day between consecutive dates', () => {
    expect(dayNumber('2026-10-08') - dayNumber('2026-10-07')).toBe(1);
  });

  it('crosses a month end by calendar days', () => {
    expect(dayNumber('2026-11-01') - dayNumber('2026-10-08')).toBe(24);
  });

  it('crosses a leap day, and a non-leap year end', () => {
    expect(dayNumber('2028-03-01') - dayNumber('2028-02-27')).toBe(3);
    expect(dayNumber('2027-03-01') - dayNumber('2027-02-27')).toBe(2);
  });

  it('is NaN for something that is not a local day', () => {
    expect(dayNumber('next Friday')).toBeNaN();
  });
});

describe('localDayOf: the device-local calendar day of an instant', () => {
  it('reads the local date of an instant built from local parts', () => {
    expect(localDayOf(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08');
    expect(localDayOf(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('parses an ISO instant to its local day, and returns undefined for garbage', () => {
    const instant = new Date(2026, 9, 8, 14, 30).toISOString();
    expect(localDayOfInstant(instant)).toBe('2026-10-08');
    expect(localDayOfInstant('not a timestamp')).toBeUndefined();
  });
});
