/**
 * Key storage — [provider-gateway.md §7](docs/architecture/provider-gateway.md).
 *
 * Each API key is sealed with AES-GCM under one wrapping key that is generated
 * non-extractable, so script cannot export it: `crypto.subtle.exportKey` throws. The
 * sealed bytes live in a `KeyVaultPort`, which is outside any project data (§7: keys
 * "never written to any file in the project artifact").
 *
 * Two details carry weight. The IV is fresh per seal, so sealing the same key twice
 * produces different bytes. And the profile id is bound in as additional authenticated
 * data, so an entry copied from one profile to another fails to open. Without that
 * binding, anything that can write to the vault could move a key to a profile that
 * points at an endpoint the user did not intend it for.
 *
 * What this does not do is in §7's threat model: it protects against dumped storage,
 * not against script in the app origin, which can call `decrypt` while the app is open.
 */

import type { KeyVaultPort } from './vault.js';

export interface KeyStore {
  /** Seals and stores the key for `profileId`, replacing any earlier one. */
  put(profileId: string, apiKey: string): Promise<void>;
  /**
   * Opens the stored key. Only the transport calls this, and only for a request it is
   * about to send. Returns undefined when nothing is stored, or when the entry or the
   * wrapping key cannot be read (a cleared site-data store, say). The caller decides
   * what to tell the user.
   */
  reveal(profileId: string): Promise<string | undefined>;
  has(profileId: string): Promise<boolean>;
  remove(profileId: string): Promise<void>;
}

export interface KeyStoreOptions {
  subtle?: SubtleCrypto;
  randomBytes?: (n: number) => Uint8Array<ArrayBuffer>;
}

const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Domain separation: the same profile id under another purpose cannot produce a valid tag. */
function additionalData(profileId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`caotang:provider-key:${profileId}`);
}

function defaultRandomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function createKeyStore(port: KeyVaultPort, options: KeyStoreOptions = {}): KeyStore {
  const subtle = options.subtle ?? globalThis.crypto.subtle;
  const randomBytes = options.randomBytes ?? defaultRandomBytes;

  // Resolved at most once per store, so two concurrent first saves in one tab share one key.
  // Across tabs the vault arbitrates: a candidate is generated, and `putWrappingKeyIfAbsent`
  // returns whichever key is stored, so every tab converges on the same one.
  let ensuring: Promise<CryptoKey> | undefined;
  const ensureWrappingKey = (): Promise<CryptoKey> => {
    ensuring ??= (async () => {
      const existing = await port.getWrappingKey();
      if (existing !== undefined) return existing;
      const candidate = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return port.putWrappingKeyIfAbsent(candidate);
    })();
    return ensuring;
  };

  return {
    async put(profileId, apiKey) {
      const key = await ensureWrappingKey();
      const iv = randomBytes(IV_BYTES);
      const sealed = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: additionalData(profileId) },
        key,
        encoder.encode(apiKey),
      );
      await port.putEntry(profileId, { iv, ciphertext: new Uint8Array(sealed) });
    },

    async reveal(profileId) {
      const entry = await port.getEntry(profileId);
      if (entry === undefined) return undefined;
      const key = await port.getWrappingKey();
      if (key === undefined) return undefined;
      try {
        const opened = await subtle.decrypt(
          { name: 'AES-GCM', iv: entry.iv, additionalData: additionalData(profileId) },
          key,
          entry.ciphertext,
        );
        return decoder.decode(opened);
      } catch {
        // A failed tag check means the entry is corrupt or was moved between profiles.
        // Either way the honest answer is "no usable key", not a partial one.
        return undefined;
      }
    },

    async has(profileId) {
      return (await port.getEntry(profileId)) !== undefined;
    },

    async remove(profileId) {
      await port.deleteEntry(profileId);
    },
  };
}
