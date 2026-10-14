/**
 * The two reads every compiling host makes, once and in one place: the project's EPUB and byline fields (epub-metadata.md) and the
 * stored images the shot list and the prompt pack name (storyboard.md §2.2).
 */

import { describe, expect, it } from 'vitest';
import { ArtifactNotFoundError, MemoryArtifactFs, type ProjectIdentity } from '@caotang/store';

import { assetRecordsOf, exportMetadataOf } from '../src/index.js';

const PROJECT: ProjectIdentity = {
  id: 'p_9XK2M4Q7RZ',
  name: 'The Lighthouse Keeper',
  createdAt: '2026-10-01T09:00:00.000Z',
  modifiedAt: '2026-10-01T09:00:00.000Z',
  language: 'en',
  identifier: { uuid: 'urn:uuid:3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d', isbn: 'urn:isbn:9780000000002' },
  coverAssetId: 'a_7RQK2M9T4X',
  author: 'M. Ortega',
};

describe('exportMetadataOf', () => {
  it('carries the stored identifier, ISBN, language, byline and cover, and never the internal project id', () => {
    const metadata = exportMetadataOf(PROJECT);
    expect(metadata).toEqual({
      language: 'en',
      identifier: 'urn:uuid:3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d',
      isbn: 'urn:isbn:9780000000002',
      author: 'M. Ortega',
      coverAssetId: 'a_7RQK2M9T4X',
    });
    expect(JSON.stringify(metadata)).not.toContain('p_9XK2M4Q7RZ');
  });

  it('leaves an absent field absent, and an empty ISBN out', () => {
    const bare: ProjectIdentity = { ...PROJECT, language: undefined, identifier: undefined, author: undefined, coverAssetId: undefined };
    expect(exportMetadataOf(bare)).toEqual({});
    expect(exportMetadataOf({ ...PROJECT, identifier: { uuid: PROJECT.identifier?.uuid ?? '', isbn: null } })).not.toHaveProperty('isbn');
  });

  it('passes a cleared cover through as null, so the exporter reads it as no cover', () => {
    expect(exportMetadataOf({ ...PROJECT, coverAssetId: null })).toHaveProperty('coverAssetId', null);
  });
});

describe('assetRecordsOf', () => {
  it('lists the images under assets/ by id, with their file names, and skips a file that is not an asset', async () => {
    const fs = new MemoryArtifactFs();
    await fs.writeAtomic('assets/a_ABCDEFGHJK.png', 'image');
    await fs.writeAtomic('assets/a_7RQK2M9T4X.jpg', 'image');
    await fs.writeAtomic('assets/notes.txt', 'not an asset');
    const records = await assetRecordsOf(fs);
    expect([...records.keys()].sort()).toEqual(['a_7RQK2M9T4X', 'a_ABCDEFGHJK']);
    expect(records.get('a_ABCDEFGHJK')).toEqual({ id: 'a_ABCDEFGHJK', fileName: 'a_ABCDEFGHJK.png' });
  });

  it('holds no image for a project with no assets folder, so a shot reads as having no file', async () => {
    expect((await assetRecordsOf(new MemoryArtifactFs())).size).toBe(0);
  });

  it('reads an assets folder the store reports as absent as holding no image', async () => {
    const fs = new MemoryArtifactFs();
    fs.listFiles = async () => {
      throw new ArtifactNotFoundError('assets');
    };
    expect((await assetRecordsOf(fs)).size).toBe(0);
  });

  it('raises a folder it cannot list, rather than naming every image as having no file', async () => {
    const fs = new MemoryArtifactFs();
    await fs.writeAtomic('assets/a_ABCDEFGHJK.png', 'image');
    fs.listFiles = async () => {
      throw new Error('EACCES: permission denied, scandir assets');
    };
    await expect(assetRecordsOf(fs)).rejects.toThrow('EACCES');
  });
});
