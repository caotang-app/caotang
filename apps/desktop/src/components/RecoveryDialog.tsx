/**
 * The recovery offer (project-format §5): a folder or a bundle whose project file will not load, and a copy that Caotang can open
 * instead. The dialog names the copy it would use, and what a rebuild would lose. Nothing is written until the writer says yes:
 * Cancel leaves the folder or bundle as it was. An accept the folder check refuses writes nothing either, and the dialog says why.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { joinWords } from '@caotang/store';

import type { FolderFileChange, PendingRecovery, RecoveryRefusal } from '../app/lifecycle.js';

export interface RecoveryDialogProps {
  readonly recovery: PendingRecovery;
  /** The accept is in progress; both buttons wait for it. */
  readonly busy: boolean;
  /** Why the last accept was refused, with nothing written. `locked` asks again with the lock answered; `changed` and `files` ask the writer to reopen. */
  readonly refusal: RecoveryRefusal | null;
  /** The documents and codex entries another program changed, when `files` is the refusal (named by title). */
  readonly files: readonly FolderFileChange[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function RecoveryDialog({ recovery, busy, refusal, files, onConfirm, onCancel }: RecoveryDialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const copy = recoveryCopy(recovery);
  // A refusal that asks for a reopen, not a yes: the accept cannot be retried as it stands, so the only button is Close.
  const closeOnly = refusal === 'changed' || refusal === 'files';

  // Mounted only while there is an offer to answer, so it opens with the offer and closes when it is taken away.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      data-testid="recovery-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form method="dialog" className="confirm-body">
        <h2 id={titleId}>{copy.title}</h2>
        <div className="confirm-text">
          <p>{copy.lead}</p>
          {copy.loss.length > 0 ? (
            <>
              <p>Rebuilding loses:</p>
              <ul>
                {copy.loss.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p>{copy.keep}</p>
          {refusal === null ? null : <p role="alert">{refusalText(refusal, files)}</p>}
        </div>
        <div className="confirm-actions">
          <button type="button" className="button" autoFocus={!closeOnly} disabled={busy} onClick={onCancel}>
            {closeOnly ? 'Close' : 'Cancel'}
          </button>
          {closeOnly ? null : (
            <button type="button" className="button is-primary" disabled={busy} onClick={onConfirm}>
              {refusal === 'locked' ? `${copy.confirm} anyway` : copy.confirm}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

/** What a refused accept says: the reason, and the one thing to do about it. Nothing was written in either case. */
function refusalText(refusal: RecoveryRefusal, files: readonly FolderFileChange[]): string {
  if (refusal === 'locked') {
    return 'Another program may be using this folder: a lock file in it says so, and the Caotang MCP server may be writing this project too. Going ahead replaces caotang.json, so anything that program wrote could be lost. Go ahead anyway?';
  }
  if (refusal === 'files') {
    const changes = joinWords(files.map(({ change, label }) => `${change} ${label}`));
    return `Another program ${changes || 'changed a file in this folder'} after Caotang read the folder, so nothing was written. Close this, then open the folder again to see its current copy.`;
  }
  return 'caotang.json in this folder was changed by another program after Caotang read it, so nothing was written. Close this, then open the folder again to see its current copy.';
}

/** The words for one offer. A rebuild is the only one that loses structure, so it alone lists what is lost and asks for a yes. */
function recoveryCopy(recovery: PendingRecovery): {
  readonly title: string;
  readonly lead: string;
  readonly loss: readonly string[];
  readonly keep: string;
  readonly confirm: string;
} {
  const { offer, name } = recovery;
  // A folder keeps the damaged copy beside its new manifest. A bundle is read, and only the bundle file holds the damaged copy.
  const keep =
    recovery.folder !== null
      ? 'The unreadable caotang.json is kept in the folder, under a name with the date, so nothing is lost.'
      : 'The bundle file itself is not changed. Its unreadable caotang.json is not kept, so keep the bundle file if you may need that copy.';
  const source = offer.source;
  if (source.kind === 'rebuild') {
    return {
      title: 'Rebuild this project from its documents?',
      lead: `caotang.json in “${name}” and every backup copy of it cannot be read. Caotang can rebuild the project from its document files. The rebuilt project is a new one.`,
      loss: offer.loss,
      keep,
      confirm: 'Rebuild the project',
    };
  }
  if (source.kind === 'snapshot') {
    return {
      title: 'Open an older copy of this project?',
      lead: `caotang.json in “${name}” cannot be read. The newest backup that can be read is ${source.path}, which is backup ${source.generation} of 3 (1 is the newest). Caotang can open that copy instead.`,
      loss: [],
      keep,
      confirm: 'Open this copy',
    };
  }
  if (source.kind === 'legacy-snapshot') {
    return {
      title: 'Open an older copy of this project?',
      lead: `caotang.json in “${name}” cannot be read. The single backup an older version kept, ${source.path}, can be read. Caotang can open that copy instead.`,
      loss: [],
      keep,
      confirm: 'Open this copy',
    };
  }
  return {
    title: 'Open this project?',
    lead: `Caotang can read “${name}”.`,
    loss: [],
    keep,
    confirm: 'Open the project',
  };
}
