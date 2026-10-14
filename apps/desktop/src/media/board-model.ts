/**
 * The board's header figures (storyboard.md §2.2, media-track M3 "animatic timing"): the timed total of one storyboard's shots,
 * and how many are left out of it for want of a duration. The engine's arithmetic (`animaticTotals`) decides both; this file
 * only turns them into the words the header shows.
 */

import type { ProjectState } from '@caotang/store';

import { animaticTotals, shotsIn } from './engines.js';

export interface AnimaticLine {
  /** The timed total, in seconds, to two places. */
  readonly seconds: number;
  /** How many shots carry a duration. */
  readonly timed: number;
  /** How many shots have none, and so are left out of the total. */
  readonly untimed: number;
  /** The line the header shows. */
  readonly text: string;
}

/** The header's animatic line for one storyboard folder. A folder with no shots has a total of zero and nothing left out. */
export function animaticLineOf(state: ProjectState, folderId: string): AnimaticLine {
  const shotIds = shotsIn(state, folderId).map((node) => node.id);
  const totals = animaticTotals(state, shotIds);
  const untimed = totals.untimed.length;
  const total = `${String(totals.seconds)} s of animatic`;
  const left = untimed === 0 ? '' : `, with ${untimed} ${untimed === 1 ? 'shot' : 'shots'} left out for want of a duration`;
  return { seconds: totals.seconds, timed: totals.timedCount, untimed, text: `${total}${left}` };
}
