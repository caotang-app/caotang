/**
 * Tool pinning — [extensibility.md §3.4](../../../docs/architecture/extensibility.md), the
 * connect flow's pin diff, as pure functions over the persisted pins and the listing the server
 * just returned.
 *
 * The diff runs over **every** listed tool, enabled or not (§3.4 runs the pin check before the
 * `enabledTools` filter). So a disabled tool whose description changed still demotes its server:
 * switching a tool off does not make a change go unreviewed.
 *
 * Pins are only ever written by a review. Nothing in this file writes one; `pinsAfterReview`
 * builds the map a review would persist, and the client persists it only when the person has
 * approved the exact listing (see {@link listingFingerprint}).
 */

import { canonicalJson, sha256Hex } from './canonical.js';
import type { ToolPin } from './config.js';

/** One listed tool, as the diff sees it: its qualified name and its candidate hash, and the server's own name for it when a review keeps it. */
export interface ListedPin {
  readonly qualifiedName: string;
  readonly hash: string;
  readonly toolName?: string;
}

/** What changed between the persisted pins and a listing (§3.4 step 2). */
export interface PinDelta {
  /** No pins existed at all: a first connect. Every listed tool is `added`. */
  readonly firstConnect: boolean;
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

export type PinState = 'verified' | 'changed' | 'new';

/** A tool's pin state against the persisted map: `verified` (the hash matches), `changed` (it does not), or `new` (never reviewed). */
export function pinStateOf(pins: Readonly<Record<string, ToolPin>>, qualifiedName: string, hash: string): PinState {
  const pin = Object.prototype.hasOwnProperty.call(pins, qualifiedName) ? pins[qualifiedName] : undefined;
  if (pin === undefined) return 'new';
  return pin.hash === hash ? 'verified' : 'changed';
}

/** The diff between the persisted pins and a listing. Each list is sorted, so the delta is the same on every run. */
export function diffPins(pins: Readonly<Record<string, ToolPin>>, listed: readonly ListedPin[]): PinDelta {
  const pinned = Object.keys(pins);
  const listedNames = new Set(listed.map((tool) => tool.qualifiedName));
  const added: string[] = [];
  const changed: string[] = [];
  for (const tool of listed) {
    const state = pinStateOf(pins, tool.qualifiedName, tool.hash);
    if (state === 'new') added.push(tool.qualifiedName);
    if (state === 'changed') changed.push(tool.qualifiedName);
  }
  const removed = pinned.filter((name) => !listedNames.has(name));
  return {
    firstConnect: pinned.length === 0 && listed.length > 0,
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
  };
}

/** True when the listing differs from the reviewed pins in any way (§3.4 step 2c). */
export function hasDelta(delta: PinDelta): boolean {
  return delta.added.length + delta.changed.length + delta.removed.length > 0;
}

/**
 * The fingerprint of a listing and what a review would remove. An approval carries it back, and
 * the client refuses an approval whose fingerprint differs from the listing it holds: the person
 * approves what they saw, and a server that changed again between the card and the click does not
 * get approved by accident.
 */
export async function listingFingerprint(listed: readonly ListedPin[], removed: readonly string[]): Promise<string> {
  const sortedListed = [...listed].sort((a, b) => (a.qualifiedName < b.qualifiedName ? -1 : a.qualifiedName > b.qualifiedName ? 1 : 0));
  return sha256Hex(canonicalJson({ listed: sortedListed.map((tool) => [tool.qualifiedName, tool.hash]), removed: [...removed].sort() }));
}

/** The pins a review persists for a listing: each listed tool at its candidate hash, keeping `firstSeen` for a tool it already knew. */
export function pinsAfterReview(
  previous: Readonly<Record<string, ToolPin>>,
  listed: readonly ListedPin[],
  reviewedAt: string,
): Record<string, ToolPin> {
  const next: Record<string, ToolPin> = {};
  for (const tool of listed) {
    const prior = Object.prototype.hasOwnProperty.call(previous, tool.qualifiedName) ? previous[tool.qualifiedName] : undefined;
    next[tool.qualifiedName] = {
      hash: tool.hash,
      firstSeen: prior?.firstSeen ?? reviewedAt,
      lastReviewedAt: reviewedAt,
      // The server's name is kept with the pin, so a tool the server later removes is still named as the server named it.
      ...(tool.toolName === undefined ? {} : { toolName: tool.toolName }),
    };
  }
  return next;
}
