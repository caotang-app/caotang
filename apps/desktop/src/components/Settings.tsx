/**
 * Settings (ui-modules §5): a dialog with four sections. Providers holds the profiles, the save-time probe, the usage totals
 * and the request log. Writing holds the session target and the autosave debounce. Appearance holds the theme. Data holds the
 * browser's storage answer, the checkpoint figures and their limits.
 *
 * Every field is validated where it is typed, and the store answers the rest. A probe that fails is shown beside the profile
 * it concerns, never as a toast alone (context-assembly §6).
 */

import { useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ModelInfo, ProfileView, RequestLogEntry } from '@caotang/gateway';
import { snapshotBudget, type RuntimeStore, type SnapshotBudget } from '@caotang/store';

import type { AppServices } from '../app/services.js';
import type { Durability, ProjectSession } from '../app/session.js';
import { readDurability, durabilitySentence, formatBytes, usageSentence, type StorageHost, browserStorageHost } from '../app/storage.js';
import { CHECKPOINT_DAYS_MAX, CHECKPOINT_CAP_MAX, DEBOUNCE_MAX_MS, DEBOUNCE_MIN_MS, TARGET_MAX_WORDS } from '../app/settings.js';
import { activeTheme, applyTheme, rememberTheme, type Theme } from '../app/theme.js';
import { DEMO_PROFILE_NAME, priceClearedBy, priceFromInputs } from '../app/providers.js';
import { CoherenceSection } from './CoherenceSettings.js';
import { ContextSection } from './ContextSection.js';
import { McpSection } from './McpSection.js';

/** The origin of an address, or the text itself when it does not parse (a form being typed). */
function originOf(address: string): string {
  try {
    return new URL(address).origin;
  } catch {
    return address;
  }
}

/** A message beside a form: inline, next to what it is about, and never a toast alone. */
function FormMessage({ message }: { message: { readonly text: string; readonly tone: 'info' | 'error' } | null }): ReactNode {
  if (message === null) return null;
  return (
    <p className={`form-message is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
      {message.text}
    </p>
  );
}

export type SettingsSection = 'providers' | 'context' | 'writing' | 'coherence' | 'mcp' | 'appearance' | 'data';

const SECTIONS: readonly { readonly id: SettingsSection; readonly label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'context', label: 'Context' },
  { id: 'writing', label: 'Writing' },
  { id: 'coherence', label: 'Coherence' },
  { id: 'mcp', label: 'MCP & tools' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'data', label: 'Data' },
];

export interface SettingsProps {
  readonly services: AppServices;
  /** The project in view, when there is one: its checkpoints and its storage figures belong to it. */
  readonly session: ProjectSession | null;
  readonly store: RuntimeStore | null;
  readonly initialSection?: SettingsSection;
  readonly onClose: () => void;
  /** Called after a provider changes, so a view that shows the active provider reads it again. */
  readonly onProvidersChanged?: () => void;
  /** The storage bridge; tests pass their own. Defaults to the browser's. */
  readonly storage?: StorageHost | null;
}

export function Settings({
  services,
  session,
  store,
  initialSection = 'providers',
  onClose,
  onProvidersChanged,
  storage,
}: SettingsProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  // The control that opened the dialog takes focus back when it closes, so the keyboard is where it was (Menu and ExportDialog do
  // the same). It is read on the first render, before the dialog takes focus. While the dialog is modal the rest of the page is
  // inert, so the focus call made during a development double-mount is a no-op and the dialog keeps focus.
  const [opener] = useState<Element | null>(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby="settings-title"
      data-testid="settings"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="settings-frame">
        <header className="settings-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="button is-quiet" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`settings-nav-item${section === entry.id ? ' is-current' : ''}`}
                aria-current={section === entry.id ? 'page' : undefined}
                onClick={() => setSection(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="settings-body">
            {section === 'providers' ? <ProvidersSection services={services} onChanged={onProvidersChanged} /> : null}
            {section === 'context' ? <ContextSection services={services} session={session} /> : null}
            {section === 'writing' ? <WritingSection services={services} /> : null}
            {section === 'coherence' ? <CoherenceSection services={services} /> : null}
            {section === 'mcp' ? <McpSection mcp={services.mcp} /> : null}
            {section === 'appearance' ? <AppearanceSection /> : null}
            {section === 'data' ? <DataSection services={services} session={session} store={store} storage={storage} /> : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

interface FormState {
  readonly id: string | null;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly kind: 'openai-compatible' | 'mock';
  /** The two optional price fields, as typed: dollars per 1,000 prompt tokens and per 1,000 reply tokens. Empty is no price. */
  readonly promptPrice: string;
  readonly completionPrice: string;
}

const BLANK: FormState = {
  id: null,
  name: '',
  baseUrl: '',
  model: '',
  apiKey: '',
  kind: 'openai-compatible',
  promptPrice: '',
  completionPrice: '',
};

function formFor(view: ProfileView): FormState {
  return {
    id: view.id,
    name: view.name,
    baseUrl: view.baseUrl,
    model: view.defaultModel,
    apiKey: '',
    kind: view.kind === 'mock' ? 'mock' : 'openai-compatible',
    promptPrice: view.pricePer1k === undefined ? '' : String(view.pricePer1k.prompt),
    completionPrice: view.pricePer1k === undefined ? '' : String(view.pricePer1k.completion),
  };
}

/** A listed model's context window and price in one line, for the picker. Empty when the endpoint tells neither. */
function modelDetails(model: ModelInfo): string {
  const parts: string[] = [];
  if (model.contextWindow !== undefined) parts.push(`${model.contextWindow.toLocaleString('en-US')} tokens`);
  if (model.pricePer1k !== undefined) {
    const { prompt, completion } = model.pricePer1k;
    parts.push(`$${prompt.toLocaleString('en-US', { maximumFractionDigits: 6 })} in, $${completion.toLocaleString('en-US', { maximumFractionDigits: 6 })} out per 1,000 tokens`);
  }
  return parts.join(' · ');
}

function ProvidersSection({ services, onChanged }: { services: AppServices; onChanged?: () => void }): ReactNode {
  const providers = services.providers;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [models, setModels] = useState<{ profile: string; list: ModelInfo[] } | null>(null);
  const profiles = providers.list();
  const active = providers.active();
  // A saved endpoint whose origin the form moves to needs its key again: the gateway refuses to send the old one there.
  const original = form?.id === null || form === null ? undefined : providers.get(form.id);
  const keyNeeded = original !== undefined && form !== null && originOf(form.baseUrl) !== originOf(original.baseUrl);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setBusy(false);
      refresh();
      onChanged?.();
    }
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (form === null) return;
    // A price that does not read is named before anything is saved, so the form keeps what the writer typed.
    const price = priceFromInputs(form.promptPrice, form.completionPrice);
    if (!price.ok) {
      setMessage({ text: price.message, tone: 'error' });
      return;
    }
    void run(async () => {
      if (form.id === null) {
        const outcome = await providers.addProfile({
          name: form.name,
          kind: form.kind,
          baseUrl: form.baseUrl,
          defaultModel: form.model,
          ...(form.apiKey === '' ? {} : { apiKey: form.apiKey }),
          ...(price.price === undefined ? {} : { pricePer1k: price.price }),
        });
        setForm(null);
        if (outcome.models !== undefined) setModels({ profile: outcome.view.name, list: outcome.models });
        setMessage(
          outcome.probeError === undefined
            ? { text: `Saved “${outcome.view.name}”. Use this profile to make it the one the agent calls.`, tone: 'info' }
            : { text: `Saved “${outcome.view.name}”, but ${outcome.probeError}`, tone: 'error' },
        );
        return;
      }
      // Both price inputs emptied on a priced profile clears its price; the gateway keeps a price the patch leaves out.
      const saved = providers.get(form.id);
      const priceChange =
        price.price ?? (priceClearedBy(form.promptPrice, form.completionPrice) && saved?.pricePer1k !== undefined ? null : undefined);
      const outcome = await providers.editProfile(form.id, {
        name: form.name,
        ...(form.kind === 'mock' ? {} : { baseUrl: form.baseUrl }),
        defaultModel: form.model,
        ...(form.apiKey === '' ? {} : { apiKey: form.apiKey }),
        ...(priceChange === undefined ? {} : { pricePer1k: priceChange }),
      });
      setForm(null);
      if (outcome.models !== undefined) setModels({ profile: outcome.view.name, list: outcome.models });
      setMessage(
        outcome.probeError === undefined
          ? { text: `Saved “${outcome.view.name}”.`, tone: 'info' }
          : { text: `Saved “${outcome.view.name}”, but ${outcome.probeError}`, tone: 'error' },
      );
    });
  };

  return (
    <section className="settings-section" aria-labelledby="settings-providers">
      <h3 id="settings-providers">Providers</h3>
      <p className="muted">
        The agent calls the active profile. Keys are encrypted in this browser and never written into a project. The built-in demo
        profile answers only the three demo requests.
      </p>

      <ul className="profile-list" aria-label="Provider profiles">
        {profiles.map((profile) => (
          <li key={profile.id} className={`profile-row${profile.isActive ? ' is-active' : ''}`} data-profile={profile.name}>
            <div className="profile-meta">
              <span className="profile-name">{profile.name}</span>
              {profile.isActive ? <span className="badge is-active">Active</span> : null}
              <span className="muted">
                {/* The demo profile's model id is an internal name, so the row says what the profile is and nothing more. */}
                {profile.kind === 'mock' ? 'Demo, no key' : `${profile.baseUrl} · ${profile.defaultModel}`}
              </span>
              {profile.responseFormat !== undefined ? (
                <span className="muted">
                  {profile.responseFormat.supportsJsonObject ? 'Structured output accepted' : 'Structured output not accepted'}
                </span>
              ) : null}
            </div>
            <div className="profile-actions">
              {!profile.isActive ? (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const outcome = await providers.activate(profile.id);
                      setMessage({ text: `“${profile.name}” is now the active profile. ${outcome.note ?? ''}`.trim(), tone: 'info' });
                      void services.settings.update({ provider: { activeProfileId: profile.id } });
                    })
                  }
                >
                  Use this profile
                </button>
              ) : null}
              <button type="button" className="button is-quiet" disabled={busy} onClick={() => setForm(formFor(profile))}>
                Edit
              </button>
              <button
                type="button"
                className="button is-quiet is-danger"
                disabled={busy}
                aria-label={`Remove ${profile.name}`}
                onClick={() =>
                  void run(async () => {
                    await providers.remove(profile.id);
                    setForm(null);
                    setMessage({ text: `Removed “${profile.name}”, and its key from this browser.`, tone: 'info' });
                    const now = providers.active();
                    if (now !== undefined) void services.settings.update({ provider: { activeProfileId: now.id } });
                  })
                }
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      {form === null ? (
        <button type="button" className="button" disabled={busy} onClick={() => setForm({ ...BLANK })}>
          Add a provider
        </button>
      ) : (
        <form className="profile-form" onSubmit={save} aria-label={form.id === null ? 'New provider' : 'Edit provider'}>
          <label>
            <span>Name</span>
            <input type="text" value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          {form.kind === 'openai-compatible' ? (
            <label>
              <span>Endpoint (the base URL, ending in /v1)</span>
              <input
                type="url"
                placeholder="https://openrouter.ai/api/v1"
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              />
            </label>
          ) : null}
          <label>
            <span>Model</span>
            <input type="text" list="provider-models" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
          </label>
          {models !== null && models.list.length > 0 ? (
            // The models the endpoint listed are offered to the Model field, with their context window and price when known.
            <datalist id="provider-models">
              {models.list.slice(0, 40).map((model) => (
                <option key={model.id} value={model.id} label={modelDetails(model) || model.id} />
              ))}
            </datalist>
          ) : null}
          {form.kind === 'openai-compatible' ? (
            <fieldset className="price-fields">
              <legend>
                Price per 1,000 tokens, in dollars (optional: fill both to see the cost of a step). A saved price stays until you type a new
                one, so clearing these fields does not remove it.
              </legend>
              <label>
                <span>Prompt</span>
                <input type="number" min={0} step="any" value={form.promptPrice} onChange={(event) => setForm({ ...form, promptPrice: event.target.value })} />
              </label>
              <label>
                <span>Reply</span>
                <input type="number" min={0} step="any" value={form.completionPrice} onChange={(event) => setForm({ ...form, completionPrice: event.target.value })} />
              </label>
            </fieldset>
          ) : null}
          {form.kind === 'openai-compatible' ? (
            <label>
              <span>
                API key{' '}
                {keyNeeded
                  ? '(required: the endpoint has moved to another address, so the stored key is not sent there)'
                  : form.id === null
                    ? ''
                    : '(leave empty to keep the stored key)'}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              />
            </label>
          ) : null}
          <div className="profile-form-actions">
            <button type="submit" className="button is-primary" disabled={busy}>
              Save profile
            </button>
            <button type="button" className="button is-quiet" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {models !== null ? (
        <section className="models" aria-label={`Models listed by ${models.profile}`}>
          <h4>Models listed by {models.profile}</h4>
          {models.list.length === 0 ? <p className="muted">The endpoint listed no models.</p> : null}
          <ul>
            {models.list.slice(0, 40).map((model) => (
              <li key={model.id}>
                <code>{model.id}</code>
                {modelDetails(model) === '' ? null : <span className="muted"> · {modelDetails(model)}</span>}
                {form !== null ? (
                  <button type="button" className="button is-quiet" aria-label={`Use ${model.id} as the model`} onClick={() => setForm({ ...form, model: model.id })}>
                    Use
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FormMessage message={message} />

      <UsagePanel services={services} />
      <RequestLogPanel services={services} />
      {active === undefined ? <p className="status-line is-error">No provider is active, so the agent cannot run.</p> : null}
    </section>
  );
}

function UsagePanel({ services }: { services: AppServices }): ReactNode {
  const rows = services.providers.ledger.dayRows();
  const names = new Map(services.providers.list().map((profile) => [profile.id, profile.name]));
  const totals = rows.reduce(
    (sum, row) => ({
      prompt: sum.prompt + row.promptTokens,
      completion: sum.completion + row.completionTokens,
      requests: sum.requests + row.requests,
    }),
    { prompt: 0, completion: 0, requests: 0 },
  );
  return (
    <section className="usage" aria-labelledby="settings-usage">
      <h4 id="settings-usage">Usage on this device</h4>
      {rows.length === 0 ? (
        <p className="muted">No requests yet. Usage is counted by day, per profile and model, and stays in this browser.</p>
      ) : (
        <>
          <p className="muted">
            {totals.requests} {totals.requests === 1 ? 'request' : 'requests'}, about {totals.prompt} tokens in and {totals.completion} out.
          </p>
          <table className="usage-table">
            <caption className="visually-hidden">Usage by day, profile and model</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Profile</th>
                <th scope="col">Model</th>
                <th scope="col">Requests</th>
                <th scope="col">Tokens in</th>
                <th scope="col">Tokens out</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.date}:${row.profileId}:${row.model}`}>
                  <td>{row.date}</td>
                  <td>{names.get(row.profileId) ?? 'Removed profile'}</td>
                  <td>{row.model}</td>
                  <td>{row.requests}</td>
                  <td>{row.promptTokens}</td>
                  <td>{row.completionTokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function RequestLogPanel({ services }: { services: AppServices }): ReactNode {
  const entries: RequestLogEntry[] = services.providers.requests.entries().slice().reverse();
  const names = new Map(services.providers.list().map((profile) => [profile.id, profile.name]));
  return (
    <section className="request-log" aria-labelledby="settings-requests">
      <h4 id="settings-requests">Request log</h4>
      <p className="muted">
        {entries.length === 0 ? 'Requests, retries included.' : `The last ${entries.length} requests, retries included.`} Nothing here holds a key or a message.
      </p>
      {entries.length === 0 ? (
        <p className="muted">No request has been sent yet.</p>
      ) : (
        <table className="request-table" data-testid="request-log">
          <caption className="visually-hidden">Requests, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Profile</th>
              <th scope="col">Attempt</th>
              <th scope="col">Outcome</th>
              <th scope="col">Status</th>
              <th scope="col">Address</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={`${entry.at}:${index}`} data-outcome={entry.outcome}>
                <td>{new Date(entry.at).toLocaleTimeString()}</td>
                <td>{names.get(entry.profileId) ?? entry.profileId}</td>
                <td>{entry.attempt}</td>
                <td>{entry.outcome}</td>
                <td>{entry.status ?? ''}</td>
                <td className="request-url">{entry.url.replace(/^https?:\/\//, '')}</td>
                <td>{entry.note ?? entry.errorKind ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

function WritingSection({ services }: { services: AppServices }): ReactNode {
  const current = services.settings.current();
  const [target, setTarget] = useState(String(current.session.dailyTargetWords ?? 0));
  const [debounce, setDebounce] = useState(String(current.editor.autosaveDebounceMs));
  const [hideRails, setHideRails] = useState(current.editor.focusModeHideRails);
  const [message, setMessage] = useState<string | null>(null);

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const words = Number(target);
    const ms = Number(debounce);
    if (!Number.isFinite(words) || words < 0 || words > TARGET_MAX_WORDS || !Number.isInteger(words)) {
      setMessage(`The daily target is a whole number of words from 0 to ${TARGET_MAX_WORDS.toLocaleString('en-US')}; 0 means no target.`);
      return;
    }
    if (!Number.isFinite(ms) || ms < DEBOUNCE_MIN_MS || ms > DEBOUNCE_MAX_MS || !Number.isInteger(ms)) {
      setMessage(`The save delay is a whole number of milliseconds from ${DEBOUNCE_MIN_MS} to ${DEBOUNCE_MAX_MS}.`);
      return;
    }
    void services.settings.update({ session: { dailyTargetWords: words }, editor: { autosaveDebounceMs: ms, focusModeHideRails: hideRails } }).then((error) => {
      setMessage(error ?? 'Saved. The save delay applies to the projects you open from now on.');
    });
  };

  return (
    <section className="settings-section" aria-labelledby="settings-writing">
      <h3 id="settings-writing">Writing</h3>
      <form className="settings-form" noValidate onSubmit={save}>
        <label>
          <span>Daily target, in words (0 for none)</span>
          <input type="number" min={0} max={TARGET_MAX_WORDS} step={1} value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
        <label>
          <span>Save after typing stops, in milliseconds ({DEBOUNCE_MIN_MS}–{DEBOUNCE_MAX_MS})</span>
          <input
            type="number"
            min={DEBOUNCE_MIN_MS}
            max={DEBOUNCE_MAX_MS}
            step={1}
            value={debounce}
            onChange={(event) => setDebounce(event.target.value)}
          />
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={hideRails} onChange={(event) => setHideRails(event.target.checked)} />
          <span>In focus mode, hide the binder and the inspector</span>
        </label>
        <button type="submit" className="button is-primary">
          Save writing settings
        </button>
      </form>
      <FormMessage message={message === null ? null : { text: message, tone: 'info' }} />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Appearance
 * ------------------------------------------------------------------ */

function AppearanceSection(): ReactNode {
  const [theme, setTheme] = useState<Theme>(() => activeTheme());
  const choose = (next: Theme): void => {
    applyTheme(next);
    rememberTheme(next);
    setTheme(next);
  };
  return (
    <section className="settings-section" aria-labelledby="settings-appearance">
      <h3 id="settings-appearance">Appearance</h3>
      <fieldset className="settings-radios">
        <legend>Theme</legend>
        <label className="check">
          <input type="radio" name="theme" checked={theme === 'light'} onChange={() => choose('light')} /> Light
        </label>
        <label className="check">
          <input type="radio" name="theme" checked={theme === 'dark'} onChange={() => choose('dark')} /> Dark
        </label>
      </fieldset>
      <p className="muted">The choice is kept in this browser. Until you choose, the page follows the system.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

function DataSection({
  services,
  session,
  store,
  storage,
}: {
  services: AppServices;
  session: ProjectSession | null;
  store: RuntimeStore | null;
  storage?: StorageHost | null;
}): ReactNode {
  const host = storage === undefined ? browserStorageHost() : storage;
  const [loaded, setLoaded] = useState<Durability | null>(null);
  const [budget, setBudget] = useState<SnapshotBudget | null>(null);
  // Why the count failed, if it did. Without it the section says "Counting" for ever, which is a lie about a read that has ended.
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = services.settings.current();
  const [cap, setCap] = useState(String(current.retention.checkpointCap));
  const [days, setDays] = useState(String(current.retention.checkpointDays));

  // With a project open, its session holds the browser's answer. From the projects screen the browser is asked again.
  useEffect(() => {
    if (session !== null) return;
    let alive = true;
    void readDurability(host).then((next) => {
      if (alive) setLoaded(next);
    });
    return () => {
      alive = false;
    };
  }, [session, host]);
  const durability = session === null ? loaded : session.durability();

  const [budgetVersion, bumpBudget] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let alive = true;
    if (session === null || store === null) return;
    void snapshotBudget(store, session.projectId).then(
      (next) => {
        if (!alive) return;
        setBudget(next);
        setBudgetError(null);
      },
      (error: unknown) => {
        if (!alive) return;
        setBudget(null);
        setBudgetError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [session, store, budgetVersion]);

  const trim = (): void => {
    if (session === null) return;
    setMessage(null);
    void session.trimSnapshots().then(
      () => {
        bumpBudget();
        setMessage('Trimmed to the limits. The count below is what is left.');
      },
      (error: unknown) => setMessage(`The trim did not finish: ${error instanceof Error ? error.message : String(error)}`),
    );
  };

  const saveLimits = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextCap = Number(cap);
    const nextDays = Number(days);
    if (!Number.isInteger(nextCap) || nextCap < 1 || nextCap > CHECKPOINT_CAP_MAX) {
      setMessage(`The checkpoint limit is a whole number from 1 to ${CHECKPOINT_CAP_MAX.toLocaleString('en-US')}.`);
      return;
    }
    if (!Number.isInteger(nextDays) || nextDays < 1 || nextDays > CHECKPOINT_DAYS_MAX) {
      setMessage(`The retention is a whole number of days from 1 to ${CHECKPOINT_DAYS_MAX}.`);
      return;
    }
    void services.settings.update({ retention: { checkpointCap: nextCap, checkpointDays: nextDays } }).then((error) => {
      setMessage(error ?? 'Saved. The limits apply to the projects you open from now on, and to the next trim.');
    });
  };

  return (
    <section className="settings-section" aria-labelledby="settings-data">
      <h3 id="settings-data">Data</h3>

      <section className="storage-row" aria-labelledby="settings-storage">
        <h4 id="settings-storage">Storage</h4>
        <p data-testid="storage-status">{durability === null ? 'Checking this browser’s storage…' : durabilitySentence(durability)}</p>
        {durability !== null && usageSentence(durability) !== null ? <p className="muted">{usageSentence(durability)}</p> : null}
        <p className="muted" data-testid="storage-location">
          Storage location: this browser (read-only in the browser app).
        </p>
      </section>

      <section aria-labelledby="settings-checkpoints">
        <h4 id="settings-checkpoints">Checkpoints</h4>
        {session === null ? (
          <p className="muted">Open a project to see its checkpoints.</p>
        ) : budgetError !== null ? (
          <p className="muted" role="alert">
            The checkpoints could not be counted: {budgetError}{' '}
            <button
              type="button"
              className="button is-quiet"
              onClick={() => {
                setBudgetError(null);
                bumpBudget();
              }}
            >
              Try again
            </button>
          </p>
        ) : budget === null ? (
          <p className="muted">Counting the checkpoints…</p>
        ) : (
          <dl className="budget" data-testid="snapshot-budget">
            <dt>Kept</dt>
            <dd>
              {budget.count} {budget.count === 1 ? 'checkpoint' : 'checkpoints'} across {budget.documents}{' '}
              {budget.documents === 1 ? 'document' : 'documents'}
            </dd>
            <dt>Size</dt>
            <dd>about {formatBytes(budget.estimatedBytes)}</dd>
            <dt>Limit</dt>
            <dd>
              {session.retentionLimits().checkpointCap} checkpoints, kept {session.retentionLimits().checkpointDays} days
            </dd>
          </dl>
        )}
        {session !== null ? (
          <button type="button" className="button" onClick={trim}>
            Trim to the limits now
          </button>
        ) : null}
        <form className="settings-form" onSubmit={saveLimits}>
          <label>
            <span>Checkpoints kept per project</span>
            <input type="number" min={1} max={CHECKPOINT_CAP_MAX} value={cap} onChange={(event) => setCap(event.target.value)} />
          </label>
          <label>
            <span>Days a checkpoint is kept</span>
            <input type="number" min={1} max={CHECKPOINT_DAYS_MAX} value={days} onChange={(event) => setDays(event.target.value)} />
          </label>
          <button type="submit" className="button">
            Save the limits
          </button>
        </form>
      </section>

      <FormMessage message={message === null ? null : { text: message, tone: 'info' }} />
      <p className="muted">
        The demo profile is named “{DEMO_PROFILE_NAME}”. A bundle export is the copy to keep: browser storage can be cleared.
      </p>
    </section>
  );
}
