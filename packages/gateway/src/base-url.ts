/**
 * Base URL validation and normalisation — [provider-gateway.md §2](docs/architecture/provider-gateway.md).
 *
 * The gateway always POSTs `{baseUrl}/chat/completions`, so the base must be the part
 * of the URL that precedes the endpoint: pathless (`https://api.openai.com`) or carrying
 * a version (`https://openrouter.ai/api/v1`). A base that already names an endpoint is
 * rejected, because appending another one produces a URL that cannot work.
 *
 * Where the spec's wording is narrower than the providers it has to serve, this file
 * follows the intent and not the literal words. The spec says a base must *end* in a
 * version or be pathless. Google's documented OpenAI-compatible base is
 * `…/v1beta/openai`, which ends in neither, and it is a real endpoint. So a base is
 * accepted when it is pathless or carries a version segment, and only the endpoint
 * suffixes are refused.
 */

import { ProfileError } from './errors.js';

/** The only baseUrl a MOCK profile carries. Nothing reads it as an address. */
export const MOCK_BASE_URL = 'mock://caotang';

/** Endpoint paths a base must not end in: the gateway appends the endpoint itself. */
const ENDPOINT_SUFFIX = /\/(chat\/completions|completions|responses|embeddings|models)$/i;

/** A path segment that is an API version: `v1`, `v1beta`, `v2alpha`. */
const VERSION_SEGMENT = /^v\d+[a-z0-9.]*$/i;

/** A dotted-quad IPv4 address in 127.0.0.0/8. The octets are range-checked by `isLoopbackHost`. */
const LOOPBACK_IPV4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Hosts where plain http is acceptable: the user's own machine (LM Studio, Ollama). A name
 * that merely starts with `127.`, such as `127.evil.example`, is a public host and is not
 * loopback, so a key cannot be sent to it in clear text or saved to it without one.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]') return true;
  const octets = LOOPBACK_IPV4.exec(host);
  return octets !== null && octets.slice(1).every((octet) => Number(octet) <= 255);
}

/** True when a normalised base points at this machine. */
export function isLoopbackBase(baseUrl: string): boolean {
  try {
    return isLoopbackHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

function invalid(reason: string): ProfileError {
  return new ProfileError('invalid', `The base URL ${reason}. For example https://api.openai.com/v1.`, 'baseUrl');
}

/**
 * Validates and normalises a base URL for an `openai-compatible` profile.
 *
 * Returns the origin plus the path with trailing slashes removed, so `https://x.io/v1/`
 * and `https://x.io/v1` store the same string. Throws a `ProfileError` naming the
 * problem; the message is written for the settings form to show as-is.
 */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim();
  if (raw.length === 0) throw invalid('is empty');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('is not a URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('must start with https://');
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw invalid('must use https:// unless it points at localhost, so the key is not sent in plain text');
  }
  if (url.username !== '' || url.password !== '') throw invalid('must not contain a username or password');
  if (url.search !== '' || url.hash !== '') throw invalid('must not contain a query string or fragment');

  const path = url.pathname.replace(/\/+$/, '');
  if (ENDPOINT_SUFFIX.test(path)) {
    throw invalid('is a full endpoint path. Enter the base only, usually ending in /v1');
  }
  if (path !== '' && !path.split('/').some((segment) => VERSION_SEGMENT.test(segment))) {
    throw invalid('must be pathless or carry a version, such as /v1');
  }

  return `${url.origin}${path}`;
}

/** The origin the egress guard compares request URLs against. */
export function originOf(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

/** The host a user recognises, for messages. Never includes credentials. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
