/**
 * Focus for a dialog that opens over the workspace (ui-modules §0.4): when the dialog closes, focus goes back to the control that
 * had it when the dialog opened, as Settings, the shared menu and the export dialog do.
 *
 * The control is read on the dialog's first commit. A picker menu that opened the dialog has closed by then and handed its focus
 * back to the chip it opened from, so the chip is what is read. The focus moves back only for a close the dialog asked for
 * (`markClosing`), and only when the dialog unmounts. A development build (StrictMode) runs an effect's cleanup and its setup
 * again without any close, and that must not move the focus.
 */

import { useEffect, useRef } from 'react';

/** Returns the function a dialog calls, before it closes, to say the close is its own. */
export function useReturnFocus(): () => void {
  const opener = useRef<HTMLElement | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    if (opener.current === null && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  }, []);

  useEffect(
    () => () => {
      const target = opener.current;
      if (closing.current && target !== null && target.isConnected) target.focus();
    },
    [],
  );

  return () => {
    closing.current = true;
  };
}
