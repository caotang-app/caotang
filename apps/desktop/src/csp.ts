/**
 * Runs before any other module (it is main.tsx's first import), so the settings below are in place before a library reads them.
 *
 * The app's Content-Security-Policy (index.html) has no `'unsafe-eval'`. zod, which the MCP client's SDK validates with,
 * probes once for `new Function` to decide whether to compile its object parsers; the probe's throw is caught, but a strict
 * policy still reports it as a `securitypolicyviolation`. zod reads its global configuration from
 * `globalThis.__zod_globalConfig` and skips the probe under `jitless`, so it is set here and zod parses without compiling.
 */
const holder = globalThis as { __zod_globalConfig?: Record<string, unknown> };
holder.__zod_globalConfig = Object.assign(holder.__zod_globalConfig ?? {}, { jitless: true });

export {};
