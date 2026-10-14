/**
 * The card size control, S, M and L (ui-modules §3.2): a radio group that the corkboard and the storyboard's shot board share. It owns no
 * state: the caller keeps the level, so the choice survives a switch between the two boards (view state, never persisted). The arrow keys
 * move the choice and the focus together, as the WAI-ARIA radio pattern has them (radio-keys.ts).
 */

import type { KeyboardEvent, ReactNode } from 'react';

import { ZOOM_LEVELS, type ZoomLevel } from '../app/corkboard-model.js';

import { radioStep } from './radio-keys.js';

/**
 * What each level means on the corkboard. A level's accessible name is its letter, then its label (`S: Small cards, title only`), so
 * the name keeps the letter the button shows (WCAG 2.5.3) and says what the card shows.
 */
export const CORKBOARD_ZOOM_LABEL: Readonly<Record<ZoomLevel, string>> = {
  S: 'Small cards, title only',
  M: 'Medium cards, title and synopsis',
  L: 'Large cards, title, synopsis, status, label and keywords',
};

export interface ZoomControlProps {
  readonly zoom: ZoomLevel;
  readonly onZoom: (zoom: ZoomLevel) => void;
  /**
   * What each level shows, for a board whose cards show other things. Defaults to the corkboard's. A label is a phrase without a colon,
   * since the accessible name puts the letter before it with one.
   */
  readonly labels?: Readonly<Record<ZoomLevel, string>>;
  /** The group's accessible name. */
  readonly ariaLabel?: string;
}

export function ZoomControl({ zoom, onZoom, labels = CORKBOARD_ZOOM_LABEL, ariaLabel = 'Card size' }: ZoomControlProps): ReactNode {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = radioStep(ZOOM_LEVELS, zoom, event.key);
    if (next === null) return;
    event.preventDefault();
    onZoom(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-zoom="${next}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="segmented" onKeyDown={onKeyDown}>
      {ZOOM_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          data-zoom={level}
          aria-checked={zoom === level}
          tabIndex={zoom === level ? 0 : -1}
          aria-label={`${level}: ${labels[level]}`}
          title={labels[level]}
          className="segmented-item"
          onClick={() => onZoom(level)}
        >
          {level}
        </button>
      ))}
    </div>
  );
}
