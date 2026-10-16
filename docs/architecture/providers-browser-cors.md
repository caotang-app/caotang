# Providers in the browser — CORS and the real-key round

> Status: built. The companion to [provider-gateway.md](provider-gateway.md): what the browser can reach, what it cannot, and how the real-key round is run. Caotang calls providers straight from the page, so a preset is only as useful as its CORS answer.

## 1. The constraint

A `fetch` from `caotang.app` (or a self-hosted origin) is a cross-origin browser request: the provider's response must carry `Access-Control-Allow-Origin` covering the app's origin, and request headers beyond the CORS-safelisted set (`Authorization`, `x-api-key`, `anthropic-version`, …) trigger a **preflight** that the provider must also answer. A provider that never answers the preflight cannot be reached from a web page at all — no app code can change that.

## 2. The support sweep

`e2e/providers-cors.spec.ts` is the sweep. It runs in the Playwright browser (a real page, a real preflight) and, for every registered preset, tries:

1. `OPTIONS` preflight equivalent — a `fetch` with the preset's auth/protocol headers against `{baseUrl}/models`, observing whether the browser exposes the response;
2. the same for the complete path the preset's adapter uses.

It writes a JSON report of `ok` / `blocked` / `preflight-fails` / `error` per preset. Run it with:

```sh
pnpm exec playwright test e2e/providers-cors.spec.ts
```

The sweep needs no keys — a preflight that fails fails before auth is consulted, and one that succeeds yields a 401/200 the sweep can read either way.

The registry's `cors` field records the swept answer; presets that cannot answer a browser request are shown disabled in Settings as **"Desktop app or hosted only"** rather than pretending to work.

## 3. The real-key round

Preflights prove reachability, not that a provider actually answers a real account. `e2e/provider-smoke.spec.ts` is the credential check — env-gated, never run in CI, and skipped silently without its variables.

```sh
CAOTANG_SMOKE_ANTHROPIC=sk-ant-... \
CAOTANG_SMOKE_OPENAI=sk-... \
pnpm exec playwright test e2e/provider-smoke.spec.ts
```

One `CAOTANG_SMOKE_<PRESET>` variable per provider, named by preset id uppercased (`CAOTANG_SMOKE_OPENROUTER`, `CAOTANG_SMOKE_DEEPSEEK`, …). For each variable present, the round checks, in order:

1. **Listing** — `GET {baseUrl}/models` answers with the key in the preset's auth header; the parsed list is non-empty.
2. **Plain completion** — a one-line prompt streams to `stop` on the preset's default model.
3. **Native tool call** — on models whose capability row claims `tools`: a forced tool call (`toolChoice` equivalent) returns a `tool_calls` finish with a well-formed call; its result is sent back and the follow-up completes.
4. **Thinking** — on models whose row lists effort levels: the lowest and highest offered levels are sent and accepted (a 400 naming the effort field is a row bug, not a provider quirk — fix the table).
5. **Reasoning replay** — on rows with a replay style: a tool-call turn's reasoning blocks are resent verbatim and the provider accepts the multi-turn body.
6. **JSON mode** — a structured `responseFormat` request returns parseable JSON where the row claims `jsonObject`/`jsonSchema`.
7. **Vision** — rows claiming `vision` get a one-pixel PNG and must not error on format grounds.
8. **Privacy** — the request log shows the call; the key appears nowhere in log entries, error details, or the page's accessible storage beyond the sealed vault.

Keys live only in `caotang.env` (gitignored) or the shell. The spec never prints them; failures print the provider and the stage, never the credential.

## 4. What the round does not cover

- Local/loopback servers (Ollama, LM Studio) are out of scope for this release — provider profiles are https-only.
- Rate limits, quota exhaustion, and regional endpoint variants are live-account checks, not the sweep's.
- A provider that passes the sweep can still fail a real account — the row's `cors` field says what the sweep found, not a guarantee.
