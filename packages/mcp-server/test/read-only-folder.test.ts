/**
 * A read never saves the project folder (extensibility.md §9). `coherence.scan` is a read, but it logs its run in the
 * harness log, and a log row used to make the session save the whole folder: every document body, `caotang.json`, and the
 * rotated backups. A run a read records now stays in the server's memory, on a read-only server and on a writable one
 * alike, and the folder keeps every byte it had.
 */

import { describe, expect, it } from 'vitest';

import { connectClient, folderBytes, startFixture } from './support.js';

describe('a read leaves the project folder as it was', () => {
  it('coherence.scan on a read-only server records its run in memory, and the folder keeps every byte', async () => {
    const fixture = await startFixture({ label: 'ro-scan', allowWrites: false, seed: true });
    const client = await connectClient(fixture.url, fixture.token);
    try {
      const before = folderBytes(fixture.root);
      const logged = fixture.session.harness.log.length;
      const result = await client.callTool({ name: 'coherence.scan', arguments: {} });
      expect(result.isError).not.toBe(true);
      // The premise: the scan did log a row, which is what made the old session save the folder.
      expect(fixture.session.harness.log.length).toBeGreaterThan(logged);
      expect(folderBytes(fixture.root)).toEqual(before);
    } finally {
      await client.close();
      await fixture.close();
    }
  });

  it('coherence.scan on a writable server also leaves the folder alone, because a read asks for no save', async () => {
    const fixture = await startFixture({ label: 'rw-scan', allowWrites: true, seed: true });
    const client = await connectClient(fixture.url, fixture.token);
    try {
      const before = folderBytes(fixture.root);
      const logged = fixture.session.harness.log.length;
      const result = await client.callTool({ name: 'coherence.scan', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(fixture.session.harness.log.length).toBeGreaterThan(logged);
      expect(folderBytes(fixture.root)).toEqual(before);
    } finally {
      await client.close();
      await fixture.close();
    }
  });
});
