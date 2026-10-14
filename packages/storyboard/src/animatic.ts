/**
 * The animatic's arithmetic — [storyboard.md](../../../docs/architecture/storyboard.md) §2.2, where
 * `durationSec` is "the animatic substrate", and the rule that a shot without one is "excluded from
 * animatic computations and flagged by the coverage check".
 *
 * The animatic MP4 is parked (§1, §6). What is here is the part that is not parked: the total a timeline
 * would show, and the list of shots that have no duration yet, so a writer can see what is still untimed.
 * The coverage check that flags them belongs to coherence's registry (§5), not to this module.
 */

import type { ProjectState } from '@caotang/store';

import { shotFieldOf } from './nodes.js';
import { shotsInBinderOrder } from './ordering.js';
import { readShotMeta } from './shot-meta.js';

export interface AnimaticTotals {
  /** The sum of the timed shots' durations, in seconds, to two places. */
  readonly seconds: number;
  /** How many shots carry a duration. A zero-second shot is timed. */
  readonly timedCount: number;
  /** Ids of the shots left out of the sum, in binder order. */
  readonly untimed: readonly string[];
}

/**
 * The totals over a selection (or the whole project), in binder order. A duration the load dropped as
 * malformed counts as missing, because the read has already decided it is not a duration.
 */
export function animaticTotals(state: ProjectState, selection?: readonly string[]): AnimaticTotals {
  let seconds = 0;
  let timedCount = 0;
  const untimed: string[] = [];
  for (const node of shotsInBinderOrder(state, selection)) {
    const duration = readShotMeta(shotFieldOf(node)).meta.durationSec;
    if (duration === undefined) {
      untimed.push(node.id);
    } else {
      seconds += duration;
      timedCount += 1;
    }
  }
  return { seconds: Math.round(seconds * 100) / 100, timedCount, untimed };
}
