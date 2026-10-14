/**
 * The project's EPUB and byline fields, and the stored images, as an export reads them (epub-metadata.md, exporter.md §2). Every host
 * that compiles reads them through these two functions, so the desktop and the MCP server write the same book from the same project.
 *
 * The identifier is the stored one, which is what makes a re-export the same book to a retailer; the exporter writes it in its URN form.
 * The project's internal id is never sent out: it is not a URN, and it would change the book's identity on a rebuild.
 */

import { ArtifactNotFoundError, type ProjectIdentity, type ArtifactFs } from '@caotang/store';
import { listAssets } from '@caotang/storyboard';
import type { AssetRecord } from '@caotang/video-prompt-pack';

import type { ExportMetadataInput } from './types.js';

/** The EPUB identifier, language and ISBN, and the byline and cover, as the manifest holds them. Absent fields stay absent. */
export function exportMetadataOf(project: ProjectIdentity): ExportMetadataInput {
  return {
    ...(project.language === undefined ? {} : { language: project.language }),
    ...(project.identifier === undefined ? {} : { identifier: project.identifier.uuid }),
    ...(project.identifier?.isbn ? { isbn: project.identifier.isbn } : {}),
    ...(project.author === undefined ? {} : { author: project.author }),
    ...(project.coverAssetId === undefined ? {} : { coverAssetId: project.coverAssetId }),
  };
}

/**
 * The images under the project's `assets/` folder, keyed by asset id, with their file names: what the exporter's `assets` option
 * takes. A folder with no `assets/` holds none, so the result is an empty map there, and a shot's image reads as having no file.
 *
 * Only that absent case is an empty map. Any other failure to list the folder is raised: an empty map would name every image as
 * having no file, and the compile would write a shot list that is wrong without saying so. The caller decides where that refusal
 * lands (the desktop and the MCP server each hold it until a compile asks for the images).
 */
export async function assetRecordsOf(fs: ArtifactFs): Promise<ReadonlyMap<string, AssetRecord>> {
  let assets: Awaited<ReturnType<typeof listAssets>>;
  try {
    assets = await listAssets(fs);
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) return new Map();
    throw error;
  }
  return new Map(assets.map((asset) => [asset.assetId, { id: asset.assetId, fileName: asset.fileName }]));
}
