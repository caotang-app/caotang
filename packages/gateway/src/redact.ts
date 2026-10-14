/**
 * Secret scrubbing for anything the gateway writes out — error details, request-log
 * notes, excerpts quoted from a provider's body.
 *
 * Two layers, because either alone leaks. The first is the literal key: a provider that
 * echoes the caller's key in an error body (several do, and quote its prefix in their
 * "invalid key" messages) is caught by replacing every occurrence. The second is the
 * shape of a credential, for a key the gateway does not hold, such as one a provider
 * quotes from some other request. The literal match catches what we know about; the
 * pattern catches what we do not.
 */

const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SK_TOKEN = /\bsk-[A-Za-z0-9_-]{8,}/g;

export function redact(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret.length > 0) out = out.split(secret).join('[redacted]');
  }
  return out.replace(BEARER, 'Bearer [redacted]').replace(SK_TOKEN, '[redacted]');
}
