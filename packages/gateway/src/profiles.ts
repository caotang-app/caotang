/**
 * Provider profiles — [provider-gateway.md §2](docs/architecture/provider-gateway.md).
 *
 * Owns profile CRUD, stable ids, the exactly-one-active invariant, and the validation
 * the spec assigns the gateway ("`settings` owns the UI, gateway owns validation").
 *
 * **The key boundary.** A profile record never holds a key. `create` and `update` seal
 * the key into the `KeyStore` and keep only `hasKey`. Everything this store returns is a
 * `ProfileView`, a copy with no key on it. That is the property the key-leak tests
 * check, and it holds by construction: there is no field to leak.
 *
 * **The invariant.** Once any profile exists, exactly one is active. Every mutation that
 * could break that (create, activate, remove) restores it in the same synchronous step
 * that changes the map, so no reader can observe a state with none or two active.
 *
 * **Persistence.** Profiles are held in memory. The non-secret part is small and belongs
 * to the settings workstream to persist; the secret part is already in IndexedDB via the
 * key store. That split is deliberate: the thing that must survive a reload safely is the
 * thing that is sealed.
 */

/**
 * The output cap a request is sent with when its profile sets none: provider-gateway §2's default. It is
 * the number the transport sends and the number the caller's limits report, so the two cannot disagree.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

import { isLoopbackBase, MOCK_BASE_URL, normalizeBaseUrl, originOf } from './base-url.js';
import { ProfileError } from './errors.js';
import type { KeyStore } from './keys/key-store.js';
import type { NewProfile, ProfileKind, ProfilePatch, ProfileView, ResponseFormatProbe } from './types.js';

export interface ProfileStore {
  create(input: NewProfile): Promise<ProfileView>;
  update(id: string, patch: ProfilePatch): Promise<ProfileView>;
  remove(id: string): Promise<void>;
  get(id: string): ProfileView | undefined;
  /** Creation order, oldest first. */
  list(): ProfileView[];
  active(): ProfileView | undefined;
  /** Makes `id` the only active profile. Throws `not-found` for an unknown id. */
  activate(id: string): ProfileView;
  /**
   * Caches the §5 probe result on the profile. Ignored for an unknown id, because a
   * probe can finish after its profile was removed, and that is not an error.
   */
  recordProbe(id: string, probe: ResponseFormatProbe): void;
}

export interface ProfileStoreOptions {
  keys: KeyStore;
  /** injected so tests can pin ids; defaults to `crypto.getRandomValues` */
  randomBytes?: (n: number) => Uint8Array<ArrayBuffer>;
}

/** The mock's model id, and the one a mock profile reports when no model is given. */
export const MOCK_DEFAULT_MODEL = 'mock/echo-1';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** `prv_` plus ten Crockford base32 characters: the id family `@caotang/ids` uses, with a provider prefix. */
export const PROFILE_ID_PATTERN = /^prv_[0-9A-HJKMNP-TV-Z]{10}$/;

function defaultRandomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** 256 is a multiple of 32, so `byte % 32` is unbiased over the alphabet. */
export function mintProfileId(randomBytes: (n: number) => Uint8Array<ArrayBuffer> = defaultRandomBytes): string {
  let body = '';
  for (const byte of randomBytes(10)) body += CROCKFORD.charAt(byte % 32);
  return `prv_${body}`;
}

/** What a profile record holds. Deliberately has no key field. */
interface StoredProfile {
  id: string;
  name: string;
  kind: ProfileKind;
  /** the preset the profile was created under; absent on hand-rolled openai-compatible profiles */
  preset?: string;
  baseUrl: string;
  defaultModel: string;
  temperature?: number;
  maxOutputTokens?: number;
  pricePer1k?: { prompt: number; completion: number };
  isActive: boolean;
  hasKey: boolean;
  responseFormat?: ResponseFormatProbe;
}

/** The fields a save validates and stores. `kind` is fixed at create and never updated. */
interface CheckedFields {
  name: string;
  baseUrl: string;
  defaultModel: string;
  temperature?: number;
  maxOutputTokens?: number;
  pricePer1k?: { prompt: number; completion: number };
}

interface RawFields {
  name?: string;
  baseUrl?: string;
  defaultModel?: string;
  temperature?: number;
  maxOutputTokens?: number;
  pricePer1k?: { prompt: number; completion: number };
}

function checkFields(kind: ProfileKind, raw: RawFields): CheckedFields {
  const name = (raw.name ?? '').trim();
  if (name === '') throw new ProfileError('invalid', 'Give the profile a name.', 'name');
  if (name.length > 80) throw new ProfileError('invalid', 'The profile name is longer than 80 characters.', 'name');

  let baseUrl: string;
  let defaultModel: string;
  if (kind === 'mock') {
    const given = (raw.baseUrl ?? '').trim();
    if (given !== '' && given !== MOCK_BASE_URL) {
      throw new ProfileError('invalid', `A mock profile uses ${MOCK_BASE_URL} as its base URL.`, 'baseUrl');
    }
    baseUrl = MOCK_BASE_URL;
    defaultModel = (raw.defaultModel ?? '').trim() || MOCK_DEFAULT_MODEL;
  } else {
    baseUrl = normalizeBaseUrl(raw.baseUrl ?? '');
    defaultModel = (raw.defaultModel ?? '').trim();
    if (defaultModel === '') {
      throw new ProfileError('invalid', 'Enter the model name, for example openai/gpt-4.1-mini.', 'defaultModel');
    }
  }

  const checked: CheckedFields = { name, baseUrl, defaultModel };
  if (raw.temperature !== undefined) {
    if (!Number.isFinite(raw.temperature) || raw.temperature < 0 || raw.temperature > 2) {
      throw new ProfileError('invalid', 'Temperature must be a number from 0 to 2.', 'temperature');
    }
    checked.temperature = raw.temperature;
  }
  if (raw.maxOutputTokens !== undefined) {
    if (!Number.isInteger(raw.maxOutputTokens) || raw.maxOutputTokens < 1) {
      throw new ProfileError('invalid', 'The output limit must be a whole number of tokens, at least 1.', 'maxOutputTokens');
    }
    checked.maxOutputTokens = raw.maxOutputTokens;
  }
  if (raw.pricePer1k !== undefined) {
    const { prompt, completion } = raw.pricePer1k;
    if (![prompt, completion].every((n) => Number.isFinite(n) && n >= 0)) {
      throw new ProfileError('invalid', 'Prices must be zero or more.', 'pricePer1k');
    }
    checked.pricePer1k = { prompt, completion };
  }
  return checked;
}

/**
 * Validates a key for an `openai-compatible` profile. Whitespace is refused because a key
 * pasted with a line break makes every request fail with a confusing 401.
 */
function checkKey(raw: string, baseUrl: string): string {
  const key = raw.trim();
  if (/\s/.test(key)) throw new ProfileError('invalid', 'The API key contains a space or a line break. Paste it again.', 'apiKey');
  requireKeyFor(key !== '', baseUrl);
  return key;
}

/**
 * An endpoint needs a key unless its base is loopback, where LM Studio and Ollama ignore
 * the header. Checked against the base a save will store, so no save can leave a remote
 * endpoint without one.
 */
function requireKeyFor(hasKey: boolean, baseUrl: string): void {
  if (!hasKey && !isLoopbackBase(baseUrl)) throw new ProfileError('invalid', 'Enter the API key for this endpoint.', 'apiKey');
}

function toView(rec: StoredProfile): ProfileView {
  const view: ProfileView = {
    id: rec.id,
    name: rec.name,
    kind: rec.kind,
    ...(rec.preset === undefined ? {} : { preset: rec.preset }),
    baseUrl: rec.baseUrl,
    defaultModel: rec.defaultModel,
    isActive: rec.isActive,
    hasKey: rec.hasKey,
  };
  if (rec.temperature !== undefined) view.temperature = rec.temperature;
  if (rec.maxOutputTokens !== undefined) view.maxOutputTokens = rec.maxOutputTokens;
  if (rec.pricePer1k !== undefined) view.pricePer1k = { ...rec.pricePer1k };
  if (rec.responseFormat !== undefined) view.responseFormat = { ...rec.responseFormat };
  return view;
}

export function createProfileStore(options: ProfileStoreOptions): ProfileStore {
  const { keys } = options;
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  const records = new Map<string, StoredProfile>();

  const requireRecord = (id: string): StoredProfile => {
    const rec = records.get(id);
    if (rec === undefined) throw new ProfileError('not-found', `No provider profile has the id ${id}.`);
    return rec;
  };

  const freshId = (): string => {
    let id = mintProfileId(randomBytes);
    while (records.has(id)) id = mintProfileId(randomBytes);
    return id;
  };

  return {
    async create(input) {
      const fields = checkFields(input.kind, input);
      const key = input.kind === 'openai-compatible' ? checkKey(input.apiKey ?? '', fields.baseUrl) : '';
      const id = freshId();
      // The key is sealed before the record exists, so a failed seal leaves no profile
      // that claims a key it does not have.
      if (key !== '') await keys.put(id, key);

      // Re-read the active state after the await: another create may have landed meanwhile.
      const anyActive = [...records.values()].some((r) => r.isActive);
      const activate = input.isActive === true || !anyActive;
      if (activate) for (const r of records.values()) r.isActive = false;
      records.set(id, {
        id,
        kind: input.kind,
        ...(input.preset === undefined ? {} : { preset: input.preset }),
        ...fields,
        isActive: activate,
        hasKey: key !== '',
      });
      return toView(requireRecord(id));
    },

    async update(id, patch) {
      const rec = requireRecord(id);
      // `null` clears the saved price; an absent price keeps it (ProfilePatch).
      const price = patch.pricePer1k === null ? undefined : (patch.pricePer1k ?? rec.pricePer1k);
      const fields = checkFields(rec.kind, {
        name: patch.name ?? rec.name,
        baseUrl: patch.baseUrl ?? rec.baseUrl,
        defaultModel: patch.defaultModel ?? rec.defaultModel,
        temperature: patch.temperature ?? rec.temperature,
        maxOutputTokens: patch.maxOutputTokens ?? rec.maxOutputTokens,
        pricePer1k: price,
      });

      let hasKey = rec.hasKey;
      let keyChanged = false;
      if (rec.kind === 'openai-compatible') {
        if (patch.apiKey !== undefined) {
          const key = checkKey(patch.apiKey, fields.baseUrl);
          if (key === '') await keys.remove(id);
          else await keys.put(id, key);
          hasKey = key !== '';
          keyChanged = true;
        } else {
          // A key belongs to the origin it was entered for. Keeping it across an origin change
          // would send it to an origin the user has not entered it for, so the save is refused
          // before anything is written, and the stored key stays where it was.
          const originMoved = originOf(fields.baseUrl) !== originOf(rec.baseUrl);
          if (originMoved && rec.hasKey) {
            throw new ProfileError('invalid', 'Enter the API key again for the new endpoint.', 'apiKey');
          }
          requireKeyFor(rec.hasKey, fields.baseUrl);
        }
      }

      // A profile removed during the seal is not resurrected by the update.
      if (records.get(id) !== rec) throw new ProfileError('not-found', `No provider profile has the id ${id}.`);

      const endpointChanged = fields.baseUrl !== rec.baseUrl || fields.defaultModel !== rec.defaultModel;
      Object.assign(rec, fields, { hasKey });
      // `Object.assign` cannot clear a key it was not given, so a cleared price is removed from the record here.
      if (fields.pricePer1k === undefined) delete rec.pricePer1k;
      // §5's probe is about one endpoint and one model with one key. Any of those
      // changing makes the cached answer a guess, so it goes.
      if (endpointChanged || keyChanged) rec.responseFormat = undefined;
      return toView(rec);
    },

    async remove(id) {
      const rec = requireRecord(id);
      if (rec.hasKey) await keys.remove(id);
      // Record removal and promotion happen in one synchronous step, so the invariant
      // never has a gap.
      records.delete(id);
      if (rec.isActive) {
        const next = records.values().next().value;
        if (next !== undefined) next.isActive = true;
      }
    },

    get(id) {
      const rec = records.get(id);
      return rec === undefined ? undefined : toView(rec);
    },

    list() {
      return [...records.values()].map(toView);
    },

    active() {
      for (const rec of records.values()) if (rec.isActive) return toView(rec);
      return undefined;
    },

    activate(id) {
      const target = requireRecord(id);
      for (const rec of records.values()) rec.isActive = rec === target;
      return toView(target);
    },

    recordProbe(id, probe) {
      const rec = records.get(id);
      if (rec !== undefined) rec.responseFormat = { supportsJsonObject: probe.supportsJsonObject, probedAt: probe.probedAt };
    },
  };
}
