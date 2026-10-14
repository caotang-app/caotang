/**
 * Load-time tolerance for the manifest's `filters[]` — [binder-filters.md §4](docs/architecture/binder-filters.md),
 * [project-format.md §2, §6](docs/architecture/project-format.md).
 *
 * The rules, in the owning spec's words: an unknown criteria key is kept in memory and dropped
 * on the next save, with a notice (project-format §6); a malformed filter is dropped with a
 * load warning; and a broken saved query never blocks a project load. So this reader never
 * throws. It returns the filters it could read and one notice per thing it kept, dropped or clamped.
 *
 * Over-long criteria are clamped on load as well as on save. The clamp is what keeps matching
 * cost bounded on a manifest someone else wrote (binder-filters §2's limits). The excess is not
 * written back, and the notice says so.
 *
 * The notices use the store's `LoadNotice` shape so the app can show them with the rest. Their
 * text is plain text (see `noticeText`), so a value a manifest controls cannot reach a notice unflattened.
 */
import type { LoadNotice } from '@caotang/store';

import { FILTER_ROOTS, type FilterCriteria, type FilterRoot } from './criteria.js';
import { readCriteria } from './criteria-read.js';
import { isRecord, isStamp, keptValues, noticeText } from './guards.js';

/**
 * A saved filter as this package reads and writes it (binder-filters §2).
 *
 * CROSS-SCOPE REQUEST (packages/store): the store's `SavedFilter` in manifest.ts has no `root`,
 * and its `savedFilter()` serializer drops the field, so a scope set in this build is lost on
 * save. The request is recorded as a KNOWN GAP in test/known-gaps.test.ts.
 */
export interface SavedFilter {
  readonly id: string;
  readonly name: string;
  readonly root?: FilterRoot;
  readonly criteria: FilterCriteria;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Unknown fields on the filter, kept in memory and dropped on the next save (project-format §6). */
  readonly unknownFields?: Readonly<Record<string, unknown>>;
  /** Unknown criteria keys, kept in memory and dropped on the next save (binder-filters §4). */
  readonly unknownCriteria?: Readonly<Record<string, unknown>>;
}

export interface SavedFilterLoad {
  readonly filters: readonly SavedFilter[];
  readonly notices: readonly LoadNotice[];
}

const FILTER_KEYS: ReadonlySet<string> = new Set(['id', 'name', 'root', 'criteria', 'createdAt', 'updatedAt']);

/** Absent is "no saved filters" (the additive rule). The manifest's own array is passed in unchanged. */
export function parseSavedFilters(raw: unknown): SavedFilterLoad {
  const filters: SavedFilter[] = [];
  const notices: LoadNotice[] = [];
  if (raw === undefined) return { filters, notices };
  if (!Array.isArray(raw)) {
    notices.push({ path: 'filters', message: 'filters is not a list; no saved filters were loaded' });
    return { filters, notices };
  }

  raw.forEach((entry, index) => {
    const path = `filters[${index}]`;
    if (!isRecord(entry)) {
      notices.push({ path, message: 'saved filter is not an object; dropped on load and not written back' });
      return;
    }

    const read = readFilter(entry);
    if (read.ok === false) {
      notices.push({
        path,
        message: `saved filter ${describeId(entry)} dropped on load: ${read.reason}; it is not written back`,
      });
      return;
    }
    for (const key of read.unknownFields) {
      notices.push({
        path: `${path}.${noticeText(key)}`,
        message: `unknown field "${noticeText(key)}" is kept in memory and dropped on next save`,
      });
    }
    for (const key of read.unknownCriteria) {
      notices.push({
        path: `${path}.criteria.${noticeText(key)}`,
        message: `unknown criterion "${noticeText(key)}" is kept in memory and dropped on next save; the rest of the saved filter is kept`,
      });
    }
    for (const note of read.clamped) {
      notices.push({ path: `${path}.criteria`, message: `${note} on load; the excess is not written back` });
    }
    filters.push(read.filter);
  });

  return { filters, notices };
}

type FilterRead =
  | {
      ok: true;
      filter: SavedFilter;
      unknownFields: readonly string[];
      unknownCriteria: readonly string[];
      clamped: readonly string[];
    }
  | { ok: false; reason: string };

function readFilter(entry: Record<string, unknown>): FilterRead {
  if (typeof entry.id !== 'string' || entry.id === '') return { ok: false, reason: 'id must be a non-empty string' };
  if (typeof entry.name !== 'string') return { ok: false, reason: 'name must be a string' };
  if (!isStamp(entry.createdAt)) return { ok: false, reason: 'createdAt must be an ISO-8601 instant' };
  if (!isStamp(entry.updatedAt)) return { ok: false, reason: 'updatedAt must be an ISO-8601 instant' };

  let root: FilterRoot | undefined;
  if (entry.root !== undefined && entry.root !== null) {
    if (!(FILTER_ROOTS as readonly unknown[]).includes(entry.root)) {
      return { ok: false, reason: 'root must be "manuscript" or "research"' };
    }
    root = entry.root as FilterRoot;
  }

  // Past this line `entry.criteria` is a record: readCriteria reports anything else as malformed.
  const criteria = readCriteria(entry.criteria);
  if (criteria.malformed.length > 0) return { ok: false, reason: criteria.malformed[0]! };

  const unknownFields = Object.keys(entry).filter((key) => !FILTER_KEYS.has(key));
  const keptFields = keptValues(entry, unknownFields);
  const keptCriteria = keptValues(entry.criteria as Record<string, unknown>, criteria.unknown);

  const filter: SavedFilter = {
    id: entry.id,
    name: entry.name,
    ...(root !== undefined ? { root } : {}),
    criteria: criteria.criteria,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(keptFields !== undefined ? { unknownFields: keptFields } : {}),
    ...(keptCriteria !== undefined ? { unknownCriteria: keptCriteria } : {}),
  };
  return { ok: true, filter, unknownFields, unknownCriteria: criteria.unknown, clamped: criteria.clamped };
}

function describeId(entry: Record<string, unknown>): string {
  return typeof entry.id === 'string' ? `"${noticeText(entry.id)}"` : '(no id)';
}
