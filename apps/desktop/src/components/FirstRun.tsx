/**
 * The first-run card (context-assembly §6): the agent with no key. It runs the three demo intents on a sample manuscript,
 * through the demo provider, so the agent is shown working before any key is pasted. The second step is the key, in
 * Settings, where a `listModels` probe checks it at save time.
 */

import type { CSSProperties, ReactNode } from 'react';

import { DEMO_CHOICES } from '../app/demo.js';

/**
 * The key step's control, drawn as a link inside the sentence. It is a button, so it keeps the keyboard and the name a button
 * has; the look is the link's, with the sentence's own font, so the gap the bare button left in the line is gone.
 */
const LINK_LOOK: CSSProperties = {
  display: 'inline',
  minHeight: 0,
  padding: 0,
  border: 0,
  background: 'none',
  color: 'var(--accent)',
  textDecoration: 'underline',
  font: 'inherit',
  cursor: 'pointer',
};

export interface FirstRunProps {
  readonly onRun: (intent: string) => void;
  readonly onDismiss: () => void;
  readonly onAddKey: () => void;
  readonly busy: boolean;
}

export function FirstRun({ onRun, onDismiss, onAddKey, busy }: FirstRunProps): ReactNode {
  return (
    <section className="home-section first-run" aria-labelledby="home-first-run" data-testid="first-run">
      <h2 id="home-first-run">Try the agent with no key</h2>
      <p>
        Three requests run on a sample manuscript, through a demo provider that is built in. Nothing leaves this browser, and
        every change waits for your approval before it is written.
      </p>
      <div className="first-run-actions" role="group" aria-label="Demo intents">
        {DEMO_CHOICES.map((choice) => (
          <button key={choice.intent} type="button" className="button is-primary" disabled={busy} onClick={() => onRun(choice.intent)}>
            {choice.label}
          </button>
        ))}
      </div>
      <p className="muted first-run-next">
        When you want the agent to answer anything else,{' '}
        <button type="button" className="button is-quiet" style={LINK_LOOK} onClick={onAddKey}>
          add your provider key
        </button>
        . It is kept in this browser, encrypted, and is checked when you save it.
      </p>
      <button type="button" className="button is-quiet" onClick={onDismiss}>
        Got it
      </button>
    </section>
  );
}
