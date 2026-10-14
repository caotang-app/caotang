/**
 * The bearer token — extensibility.md §9: "static bearer token minted at server
 * start, validated on every POST; loopback bind is the real boundary."
 *
 * The token is the server's only authentication, so it is minted from the operating
 * system's randomness (256 bits), compared in constant time, and never written to the
 * project folder. It reaches the operator once, on stderr, when it is minted. A
 * token the operator supplies through the environment is used as given, and is not
 * printed back, because the operator already has it.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

/** The shortest token an operator may supply. Minted tokens are 43 characters. */
export const TOKEN_MIN_LENGTH = 16;

/** The environment variable a token is read from when the operator names none. */
export const DEFAULT_TOKEN_ENV = 'CAOTANG_MCP_TOKEN';

export interface ResolvedToken {
  readonly token: string;
  /** True when this process minted the token, so the caller prints it once. */
  readonly minted: boolean;
}

export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The token for this start: the one in `env[variable]` when it is set, or a fresh one.
 * An empty or too-short value is refused, because a silent fallback to a minted token
 * would leave the operator with a token they did not choose and cannot find.
 */
export function resolveToken(env: NodeJS.ProcessEnv, variable: string): ResolvedToken {
  const supplied = env[variable];
  if (supplied === undefined) return { token: mintToken(), minted: true };
  if (supplied.length < TOKEN_MIN_LENGTH) {
    throw new Error(`${variable} is set, but its value is shorter than ${TOKEN_MIN_LENGTH} characters; set a longer token or unset the variable so one is minted`);
  }
  return { token: supplied, minted: false };
}

/** Whether an `Authorization` header carries `token`, as a bearer credential, compared in constant time. */
export function bearerAccepted(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  if (match === null) return false;
  const presented = Buffer.from(match[1] ?? '', 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
