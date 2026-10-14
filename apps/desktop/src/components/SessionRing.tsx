/**
 * The editor status bar's session ring (goals-progress §2.1): a ring that fills with today's words toward the daily target, and turns
 * the success colour when the target is met. It is a view over the progress reading, so it never stores anything. TargetQuickSet
 * puts the ring and today's line in one button, so the ring is decoration there: the words the button says are what a reader hears.
 */

import type { ReactNode } from 'react';

import { ringOffset, type TargetProgress } from '../app/session-progress.js';

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SessionRing({ progress }: { progress: TargetProgress }): ReactNode {
  if (progress.target === undefined) return null;
  return (
    <span className={`session-ring${progress.met ? ' is-met' : ''}`} data-testid="session-ring" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={ringOffset(progress.fraction, CIRCUMFERENCE)}
          transform="rotate(-90 8 8)"
        />
      </svg>
    </span>
  );
}
