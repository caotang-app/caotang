/**
 * Which caller a log row belongs to, for the one path the harness cannot tag itself.
 *
 * The harness tags the rows of an external call (`harness.external.call`) with
 * `source: 'mcp'` by giving the bus a wrapped log (`taggedLog` in the harness). A
 * write-confirm tool can never run on that path, because the harness refuses every
 * approval on a turn whose source is `mcp` (extensibility §9: an approval claimed on
 * the wire is an approval nobody gave). So a write the user confirmed through the
 * host's dialog runs as a native-sourced turn, and its rows would carry `native`.
 * Extensibility §9 says the log records everything an external caller did as
 * `mcp`, and this window is how the row says so.
 *
 * It is scoped, not global. The bus is synchronous (command-bus A2), so a harness
 * call returns only after every row it appends is in the log, and the window is
 * opened and closed around exactly that call. Rows appended outside a window are
 * passed through untouched, and the window restores the outer caller on exit even
 * when the call throws.
 *
 * The one-line restamp belongs in the harness (`busFor` could take the caller's
 * source from the approval it was given). Until that change lands, the log's
 * `append` is wrapped here, once, and this file is the only place that does it.
 */

import type { ActivityEntry, ActivityLog } from '@caotang/bus';

export type CallerSource = ActivityEntry['source'];

export interface SourceWindow {
  /** Runs `run` with every row it appends stamped `source`. Returns what `run` returns. */
  within<T>(source: CallerSource, run: () => T): T;
}

/**
 * Wraps the log's `append` so the rows of a call made inside `within` carry its source.
 * Call it once per log. A second wrap of the same log would stack, and each layer
 * would restamp the row the layer below it wrote.
 */
export function sourceWindow(log: ActivityLog): SourceWindow {
  const append = log.append.bind(log);
  let current: CallerSource | undefined;

  log.append = (entry: ActivityEntry) => {
    append(current === undefined ? entry : { ...entry, source: current });
  };

  return {
    within<T>(source: CallerSource, run: () => T): T {
      const outer = current;
      current = source;
      try {
        return run();
      } finally {
        current = outer;
      }
    },
  };
}
