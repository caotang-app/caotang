/**
 * The `screenplay` document kind — [screenplay.md §2.1](../../../docs/architecture/screenplay.md),
 * with the media-track additivity notes of [project-format.md §2](../../../docs/architecture/project-format.md).
 *
 * A screenplay document node holds one scene. Its body is a standalone Fountain
 * file, `docs/<id>.fountain`, and a tree node without a `kind` is `prose`. The kind
 * marker is the only per-node metadata the spec defines for the kind, so there is no
 * metadata object here: the synopsis lives in the manifest, the heading in the body.
 */

export const SCREENPLAY_KIND = 'screenplay';
export type ScreenplayKind = typeof SCREENPLAY_KIND;

/** The body-file extension a screenplay document is stored under (screenplay.md §2.1). */
export const FOUNTAIN_EXTENSION = '.fountain';

/** True for the `screenplay` kind. An absent or `prose` kind is not a screenplay. */
export function isScreenplayKind(kind: string | null | undefined): kind is ScreenplayKind {
  return kind === SCREENPLAY_KIND;
}

/** The project-relative path of a screenplay document's body, `docs/<id>.fountain`. */
export function screenplayBodyPath(docId: string): string {
  return `docs/${docId}${FOUNTAIN_EXTENSION}`;
}
