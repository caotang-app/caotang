/**
 * The `ink-json` export — [dialogue-narrative.md §4](../../../docs/architecture/dialogue-narrative.md).
 *
 * The Ink passthrough: a container's body compiles with inkjs into the compiled story
 * (`.ink.json`), the target engines consume (D2). The acceptance gate is zero compile errors;
 * warnings do not block, and they are listed verbatim in the compile log.
 */

import { compileInk, type InkMessage } from './compile.js';

/** The recipe format name `export.compile` takes for this renderer (exporter.md §2, media-track M6). */
export const INK_JSON_FORMAT = 'ink-json';

export const INK_JSON_MIME = 'application/json';

export interface InkJsonArtifact {
  readonly ok: true;
  /** `<container id>.ink.json`, the artifact name the exporter writes under `exports/`. */
  readonly fileName: string;
  readonly mimeType: string;
  readonly json: string;
  /** The compile log's notes: every warning, verbatim, in the order inkjs emitted them. */
  readonly notes: readonly string[];
}

export interface InkJsonRefusal {
  readonly ok: false;
  readonly errors: readonly InkMessage[];
  readonly notes: readonly string[];
}

/** Compiles one container body. The refusal carries the compile errors verbatim, for the author to fix. */
export function exportInkJson(containerId: string, body: string): InkJsonArtifact | InkJsonRefusal {
  const compiled = compileInk(body);
  const notes = compiled.warnings.map((w) => w.text);
  if (!compiled.ok || compiled.json === null) return { ok: false, errors: compiled.errors, notes };
  return { ok: true, fileName: `${containerId}.ink.json`, mimeType: INK_JSON_MIME, json: compiled.json, notes };
}
