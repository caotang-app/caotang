/**
 * Reads a raw criteria object — the one reader both the load path and the save path
 * use, so "what is a legal criterion" has one answer.
 *
 * The two callers differ only in what they do with the findings. On load, an unknown key
 * is kept in memory and dropped on the next save with a notice, and a malformed value drops
 * the whole filter (binder-filters §4). On save, the same findings are refusals. Over-long
 * values are clamped on both paths: the clamp is what keeps matching cost bounded on a
 * manifest someone else wrote (§2's limits), and each clamp is reported in `clamped`.
 */
import { CRITERIA_KEYS, SEARCH_SURFACES, type CriteriaKey, type FilterCriteria, type SearchSurface } from './criteria.js';
import { MAX_CRITERIA_ENTRIES, MAX_TEXT_CHARS } from './limits.js';
import { clampCodePoints, isRecord, isWholeNumber } from './guards.js';

export interface CriteriaReading {
  readonly criteria: FilterCriteria;
  /** Keys this build does not know. Load keeps them in memory and drops them on save, with a notice. */
  readonly unknown: readonly string[];
  /** One message per value that has the wrong type or domain. The filter is not usable. */
  readonly malformed: readonly string[];
  /** Clamps applied, one note each. A note on load means the excess was dropped and will not be written back. */
  readonly clamped: readonly string[];
}

type Writable = { -readonly [K in keyof FilterCriteria]: FilterCriteria[K] };

/**
 * An absent criterion is `undefined` or `null` (binder-filters §2: "null value =
 * criterion absent"). An empty text, an empty tag list and an empty `textIn` are also
 * absent, because each of them already means "no constraint" to the matcher. A tag is
 * trimmed, and a blank tag is no tag at all, so `['']` is absent too.
 */
export function readCriteria(raw: unknown): CriteriaReading {
  const unknown: string[] = [];
  const malformed: string[] = [];
  const clamped: string[] = [];
  const out: Writable = {};

  if (!isRecord(raw)) {
    return { criteria: {}, unknown, malformed: ['criteria must be an object'], clamped };
  }

  for (const key of Object.keys(raw)) {
    if (!isCriteriaKey(key)) {
      unknown.push(key);
      continue;
    }
    const value = raw[key];
    if (value === undefined || value === null) continue;
    readOne(key, value, out, malformed, clamped);
  }
  return { criteria: out, unknown, malformed, clamped };
}

function readOne(key: CriteriaKey, value: unknown, out: Writable, malformed: string[], clamped: string[]): void {
  switch (key) {
    case 'text': {
      if (typeof value !== 'string') {
        malformed.push('text must be a string');
        return;
      }
      const fitted = clampCodePoints(value, MAX_TEXT_CHARS);
      if (fitted.clamped) clamped.push(`text clamped to ${MAX_TEXT_CHARS} characters`);
      if (fitted.text !== '') out.text = fitted.text;
      return;
    }
    case 'textIn': {
      const surfaces = readList(key, value, isSurface, 'a surface name (title, synopsis or body)', malformed, clamped);
      if (surfaces !== undefined && surfaces.length > 0) out.textIn = surfaces;
      return;
    }
    case 'statusId':
    case 'labelId': {
      if (typeof value !== 'string') {
        malformed.push(`${key} must be a vocabulary id`);
        return;
      }
      if (value !== '') out[key] = value;
      return;
    }
    case 'keywordsAll':
    case 'keywordsAny': {
      const tags = readList(key, trimTags(value), isString, 'a tag', malformed, clamped);
      if (tags !== undefined && tags.length > 0) out[key] = tags;
      return;
    }
    case 'minWords':
    case 'maxWords': {
      if (!isWholeNumber(value) || value < 0) {
        malformed.push(`${key} must be a whole number of words, 0 or more`);
        return;
      }
      out[key] = value;
      return;
    }
    case 'createdWithinDays':
    case 'modifiedWithinDays': {
      if (!isWholeNumber(value) || value < 1) {
        malformed.push(`${key} must be a whole number of days, 1 or more`);
        return;
      }
      out[key] = value;
      return;
    }
  }
}

/**
 * Tags are matched trimmed, and a blank tag is no tag. This runs before the cap, so blank
 * entries do not use up the 32 slots. A list with a non-string in it is left as it is, and
 * the list reader reports it as malformed.
 */
function trimTags(value: unknown): unknown {
  if (!Array.isArray(value) || !value.every(isString)) return value;
  return value.map((tag) => tag.trim()).filter((tag) => tag !== '');
}

function readList<T>(
  key: string,
  value: unknown,
  isItem: (item: unknown) => item is T,
  describe: string,
  malformed: string[],
  clamped: string[],
): T[] | undefined {
  if (!Array.isArray(value) || !value.every(isItem)) {
    malformed.push(`${key} must be a list of ${describe}`);
    return undefined;
  }
  if (value.length <= MAX_CRITERIA_ENTRIES) return [...value];
  clamped.push(`${key} clamped to ${MAX_CRITERIA_ENTRIES} entries`);
  return value.slice(0, MAX_CRITERIA_ENTRIES);
}

function isCriteriaKey(key: string): key is CriteriaKey {
  return (CRITERIA_KEYS as readonly string[]).includes(key);
}

function isSurface(value: unknown): value is SearchSurface {
  return (SEARCH_SURFACES as readonly unknown[]).includes(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
