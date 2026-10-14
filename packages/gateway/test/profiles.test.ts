/**
 * Provider profiles — provider-gateway.md §2. CRUD, stable ids, the exactly-one-active
 * invariant, the MOCK type, and the rule that a view never carries a key.
 */

import { describe, expect, it } from 'vitest';
import {
  createKeyStore,
  createMemoryVaultPort,
  createProfileStore,
  PROFILE_ID_PATTERN,
  ProfileError,
  type ProfileStore,
} from '../src/index.js';
import { KEY, lcg } from './helpers.js';

function store(): { profiles: ProfileStore; keys: ReturnType<typeof createKeyStore> } {
  const keys = createKeyStore(createMemoryVaultPort());
  return { profiles: createProfileStore({ keys }), keys };
}

const endpoint = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  kind: 'openai-compatible' as const,
  baseUrl: 'https://a.example/v1',
  apiKey: KEY,
  defaultModel: 'model-x',
  ...extra,
});

/** The invariant from §2: once any profile exists, exactly one is active. */
function expectOneActive(profiles: ProfileStore): void {
  const all = profiles.list();
  if (all.length === 0) {
    expect(profiles.active()).toBeUndefined();
    return;
  }
  expect(all.filter((p) => p.isActive)).toHaveLength(1);
  expect(profiles.active()?.id).toBe(all.find((p) => p.isActive)?.id);
}

describe('profile CRUD and ids', () => {
  it('mints a stable, prefixed, unguessable-looking id that never changes on update', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('OpenRouter main'));
    expect(created.id).toMatch(PROFILE_ID_PATTERN);
    expect(created.id).not.toContain('OpenRouter');

    const renamed = await profiles.update(created.id, { name: 'Renamed' });
    expect(renamed.id).toBe(created.id);
    expect(profiles.get(created.id)?.name).toBe('Renamed');
  });

  it('gives every profile its own id', async () => {
    const { profiles } = store();
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) ids.add((await profiles.create(endpoint(`p${i}`))).id);
    expect(ids.size).toBe(20);
  });

  it('lists profiles in creation order and removes them cleanly', async () => {
    const { profiles } = store();
    const first = await profiles.create(endpoint('first'));
    const second = await profiles.create(endpoint('second'));
    expect(profiles.list().map((p) => p.id)).toEqual([first.id, second.id]);
    await profiles.remove(first.id);
    expect(profiles.get(first.id)).toBeUndefined();
    expect(profiles.list().map((p) => p.id)).toEqual([second.id]);
  });

  it('refuses to update or remove an id that does not exist', async () => {
    const { profiles } = store();
    await expect(profiles.update('prv_0000000000', { name: 'x' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(profiles.remove('prv_0000000000')).rejects.toBeInstanceOf(ProfileError);
    expect(() => profiles.activate('prv_0000000000')).toThrow(ProfileError);
  });

  it('ignores a probe result for a profile that was removed while the probe ran', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('gone soon'));
    await profiles.remove(created.id);
    expect(() => profiles.recordProbe(created.id, { supportsJsonObject: true, probedAt: 1 })).not.toThrow();
  });
});

describe('exactly one active profile (§2)', () => {
  it('makes the first profile active and leaves later ones inactive', async () => {
    const { profiles } = store();
    const first = await profiles.create(endpoint('first'));
    const second = await profiles.create(endpoint('second'));
    expect(first.isActive).toBe(true);
    expect(second.isActive).toBe(false);
    expectOneActive(profiles);
  });

  it('makes a profile created with isActive the only active one', async () => {
    const { profiles } = store();
    await profiles.create(endpoint('first'));
    const chosen = await profiles.create(endpoint('chosen', { isActive: true }));
    expect(profiles.active()?.id).toBe(chosen.id);
    expectOneActive(profiles);
  });

  it('moves activity with activate and keeps exactly one', async () => {
    const { profiles } = store();
    const a = await profiles.create(endpoint('a'));
    const b = await profiles.create(endpoint('b'));
    profiles.activate(b.id);
    expect(profiles.active()?.id).toBe(b.id);
    expect(profiles.get(a.id)?.isActive).toBe(false);
    expectOneActive(profiles);
  });

  it('promotes the oldest remaining profile when the active one is removed', async () => {
    const { profiles } = store();
    const a = await profiles.create(endpoint('a'));
    const b = await profiles.create(endpoint('b'));
    await profiles.create(endpoint('c'));
    await profiles.remove(a.id);
    expect(profiles.active()?.id).toBe(b.id);
    expectOneActive(profiles);
  });

  it('leaves no active profile when the last one is removed', async () => {
    const { profiles } = store();
    const only = await profiles.create(endpoint('only'));
    await profiles.remove(only.id);
    expect(profiles.active()).toBeUndefined();
    expectOneActive(profiles);
  });

  it('holds the invariant across a long random sequence of creates, activations, and removals', async () => {
    const { profiles } = store();
    const random = lcg(20261008);
    for (let step = 0; step < 300; step += 1) {
      const roll = random();
      const all = profiles.list();
      if (roll < 0.4 || all.length === 0) {
        await profiles.create(endpoint(`p${step}`, { isActive: random() < 0.2 }));
      } else if (roll < 0.7) {
        profiles.activate(all[Math.floor(random() * all.length)]!.id);
      } else {
        await profiles.remove(all[Math.floor(random() * all.length)]!.id);
      }
      expectOneActive(profiles);
    }
  });
});

describe('the MOCK profile type (§8)', () => {
  it('needs no key, takes the mock base, and gets a default model', async () => {
    const { profiles } = store();
    const mock = await profiles.create({ name: 'Offline', kind: 'mock' });
    expect(mock.kind).toBe('mock');
    expect(mock.baseUrl).toBe('mock://caotang');
    expect(mock.defaultModel).toBe('mock/echo-1');
    expect(mock.hasKey).toBe(false);
  });

  it('does not store a key for a mock, even if one is supplied', async () => {
    const { profiles, keys } = store();
    const mock = await profiles.create({ name: 'Offline', kind: 'mock', apiKey: KEY });
    expect(mock.hasKey).toBe(false);
    expect(await keys.has(mock.id)).toBe(false);
  });

  it('refuses any base other than mock://caotang for a mock', async () => {
    const { profiles } = store();
    await expect(profiles.create({ name: 'Bad', kind: 'mock', baseUrl: 'https://a.example/v1' })).rejects.toMatchObject({
      field: 'baseUrl',
    });
  });
});

describe('validation', () => {
  it('needs a name, a model, and a base for an endpoint', async () => {
    const { profiles } = store();
    await expect(profiles.create(endpoint('   '))).rejects.toMatchObject({ field: 'name' });
    await expect(profiles.create(endpoint('x', { defaultModel: ' ' }))).rejects.toMatchObject({ field: 'defaultModel' });
    await expect(profiles.create(endpoint('x', { baseUrl: 'mock://caotang' }))).rejects.toMatchObject({ field: 'baseUrl' });
  });

  it('requires a key for a remote endpoint, but not for a loopback one', async () => {
    const { profiles } = store();
    await expect(profiles.create(endpoint('remote', { apiKey: '' }))).rejects.toMatchObject({ field: 'apiKey' });
    const local = await profiles.create(endpoint('local', { baseUrl: 'http://localhost:1234/v1', apiKey: '' }));
    expect(local.hasKey).toBe(false);
  });

  it('refuses a key-less remote endpoint on a host that only starts with 127.', async () => {
    const { profiles } = store();
    await expect(profiles.create(endpoint('x', { baseUrl: 'https://127.attacker.test/v1', apiKey: '' }))).rejects.toMatchObject({
      field: 'apiKey',
    });
    await expect(profiles.create(endpoint('x', { baseUrl: 'http://127.attacker.test/v1', apiKey: '' }))).rejects.toMatchObject({
      field: 'baseUrl',
    });
  });

  it('refuses a key with a space or a line break in it, which would fail every request', async () => {
    const { profiles } = store();
    await expect(profiles.create(endpoint('x', { apiKey: 'sk-abc def' }))).rejects.toMatchObject({ field: 'apiKey' });
    await expect(profiles.create(endpoint('x', { apiKey: 'sk-abc\n' }))).resolves.toBeDefined();
  });

  it('bounds temperature, the output limit, and prices', async () => {
    const { profiles } = store();
    await expect(profiles.create(endpoint('x', { temperature: 3 }))).rejects.toMatchObject({ field: 'temperature' });
    await expect(profiles.create(endpoint('x', { maxOutputTokens: 0 }))).rejects.toMatchObject({ field: 'maxOutputTokens' });
    await expect(profiles.create(endpoint('x', { maxOutputTokens: 1.5 }))).rejects.toMatchObject({ field: 'maxOutputTokens' });
    await expect(profiles.create(endpoint('x', { pricePer1k: { prompt: -1, completion: 0 } }))).rejects.toMatchObject({
      field: 'pricePer1k',
    });
  });

  it('keeps a saved price when an update leaves the price out, and clears it when the update says null', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('priced', { pricePer1k: { prompt: 0.5, completion: 1.5 } }));
    const kept = await profiles.update(created.id, { name: 'renamed' });
    expect(kept.pricePer1k).toEqual({ prompt: 0.5, completion: 1.5 });
    const replaced = await profiles.update(created.id, { pricePer1k: { prompt: 2, completion: 4 } });
    expect(replaced.pricePer1k).toEqual({ prompt: 2, completion: 4 });
    const cleared = await profiles.update(created.id, { pricePer1k: null });
    expect(cleared).not.toHaveProperty('pricePer1k');
    expect(profiles.get(created.id)).not.toHaveProperty('pricePer1k');
    expect(profiles.get(created.id)?.name).toBe('renamed');
  });

  it('normalises the base it stores', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('x', { baseUrl: 'https://openrouter.ai/api/v1/' }));
    expect(created.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('keeps the old base and key when a save is refused, so a typo cannot half-apply', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('x'));
    await expect(profiles.update(created.id, { baseUrl: 'https://a.example/v1/chat/completions' })).rejects.toBeInstanceOf(
      ProfileError,
    );
    expect(profiles.get(created.id)?.baseUrl).toBe('https://a.example/v1');
  });
});

describe('the key boundary', () => {
  it('never puts the key on a view, whichever way the view is read', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('x'));
    const serialised = JSON.stringify([created, profiles.get(created.id), profiles.list(), profiles.active()]);
    expect(serialised).not.toContain(KEY);
    expect(serialised).not.toContain('apiKey');
    expect(created).not.toHaveProperty('apiKey');
    expect(created.hasKey).toBe(true);
  });

  it('keeps the key in the key store, and drops it there when the profile goes', async () => {
    const { profiles, keys } = store();
    const created = await profiles.create(endpoint('x'));
    expect(await keys.reveal(created.id)).toBe(KEY);
    await profiles.remove(created.id);
    expect(await keys.has(created.id)).toBe(false);
  });

  it('refuses an origin change that brings no key, so the stored key is never sent to the new origin', async () => {
    const { profiles, keys } = store();
    const created = await profiles.create(endpoint('x'));
    const attempt = profiles.update(created.id, { baseUrl: 'https://attacker.example/v1' });
    await expect(attempt).rejects.toBeInstanceOf(ProfileError);
    await expect(attempt).rejects.toMatchObject({ code: 'invalid', field: 'apiKey' });
    await expect(attempt).rejects.toThrow('Enter the API key again for the new endpoint.');

    expect(profiles.get(created.id)?.baseUrl).toBe('https://a.example/v1');
    expect(profiles.get(created.id)?.hasKey).toBe(true);
    expect(await keys.reveal(created.id)).toBe(KEY);
  });

  it('moves to a new origin with the key entered for it, and the old key is replaced', async () => {
    const { profiles, keys } = store();
    const created = await profiles.create(endpoint('x'));
    const moved = await profiles.update(created.id, { baseUrl: 'https://b.example/v1', apiKey: 'sk-moved-key-123456' });
    expect(moved.baseUrl).toBe('https://b.example/v1');
    expect(moved.hasKey).toBe(true);
    expect(await keys.reveal(created.id)).toBe('sk-moved-key-123456');
  });

  it('keeps the key when only the path changes on the same origin', async () => {
    const { profiles, keys } = store();
    const created = await profiles.create(endpoint('x'));
    const repathed = await profiles.update(created.id, { baseUrl: 'https://a.example/v2' });
    expect(repathed.baseUrl).toBe('https://a.example/v2');
    expect(await keys.reveal(created.id)).toBe(KEY);
  });

  it('refuses a move from a loopback endpoint with no key to a remote one, which always needs a key', async () => {
    const { profiles, keys } = store();
    const local = await profiles.create(endpoint('local', { baseUrl: 'http://localhost:1234/v1', apiKey: '' }));
    await expect(profiles.update(local.id, { baseUrl: 'https://remote.example/v1' })).rejects.toMatchObject({ field: 'apiKey' });
    expect(profiles.get(local.id)?.baseUrl).toBe('http://localhost:1234/v1');
    expect(await keys.has(local.id)).toBe(false);
  });

  it('replaces the stored key on update, and clears it only for a loopback endpoint', async () => {
    const { profiles, keys } = store();
    const created = await profiles.create(endpoint('x'));
    await profiles.update(created.id, { apiKey: 'sk-replacement-123456' });
    expect(await keys.reveal(created.id)).toBe('sk-replacement-123456');
    await expect(profiles.update(created.id, { apiKey: '' })).rejects.toMatchObject({ field: 'apiKey' });

    const local = await profiles.create(endpoint('local', { baseUrl: 'http://localhost:1234/v1', apiKey: 'x' }));
    const cleared = await profiles.update(local.id, { apiKey: '' });
    expect(cleared.hasKey).toBe(false);
    expect(await keys.has(local.id)).toBe(false);
  });
});

describe('the cached response-format probe (§5)', () => {
  it('clears the probe when the endpoint or the model changes, because the answer no longer applies', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('x'));
    profiles.recordProbe(created.id, { supportsJsonObject: true, probedAt: 1 });
    expect(profiles.get(created.id)?.responseFormat?.supportsJsonObject).toBe(true);

    const renamed = await profiles.update(created.id, { name: 'still the same endpoint' });
    expect(renamed.responseFormat?.supportsJsonObject).toBe(true);

    const moved = await profiles.update(created.id, { baseUrl: 'https://b.example/v1', apiKey: 'sk-moved-key-123456' });
    expect(moved.responseFormat).toBeUndefined();
  });

  it('clears the probe when the key changes', async () => {
    const { profiles } = store();
    const created = await profiles.create(endpoint('x'));
    profiles.recordProbe(created.id, { supportsJsonObject: false, probedAt: 1 });
    const rekeyed = await profiles.update(created.id, { apiKey: 'sk-new-key-123456' });
    expect(rekeyed.responseFormat).toBeUndefined();
  });
});
