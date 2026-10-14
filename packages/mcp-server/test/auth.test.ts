/**
 * The bearer token: minted from randomness, read from the environment only when long
 * enough, and compared in constant time.
 */

import { describe, expect, it } from 'vitest';

import { bearerAccepted, mintToken, resolveToken, TOKEN_MIN_LENGTH } from '../src/index.js';

describe('resolveToken', () => {
  it('mints a 256-bit token when the variable is unset', () => {
    const first = resolveToken({}, 'CAOTANG_MCP_TOKEN');
    const second = resolveToken({}, 'CAOTANG_MCP_TOKEN');
    expect(first.minted).toBe(true);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).not.toBe(first.token);
  });

  it('uses the variable verbatim when it is set, and does not report it as minted', () => {
    const supplied = 'an-operator-token-0123456789';
    expect(resolveToken({ CAOTANG_MCP_TOKEN: supplied }, 'CAOTANG_MCP_TOKEN')).toEqual({ token: supplied, minted: false });
  });

  it('refuses a value too short to be a credential, and an empty one, rather than minting a different token', () => {
    expect(() => resolveToken({ CAOTANG_MCP_TOKEN: 'x'.repeat(TOKEN_MIN_LENGTH - 1) }, 'CAOTANG_MCP_TOKEN')).toThrow(/shorter than/);
    expect(() => resolveToken({ CAOTANG_MCP_TOKEN: '' }, 'CAOTANG_MCP_TOKEN')).toThrow(/shorter than/);
  });

  it('reads the variable the operator named', () => {
    expect(resolveToken({ MY_TOKEN: 'a-named-token-0123456789' }, 'MY_TOKEN').minted).toBe(false);
    expect(resolveToken({ CAOTANG_MCP_TOKEN: 'ignored-0123456789' }, 'MY_TOKEN').minted).toBe(true);
  });
});

describe('bearerAccepted', () => {
  const token = mintToken();

  it('accepts the token as a bearer credential, with the scheme in any case', () => {
    expect(bearerAccepted(`Bearer ${token}`, token)).toBe(true);
    expect(bearerAccepted(`bearer ${token}`, token)).toBe(true);
    expect(bearerAccepted(`  Bearer ${token}  `, token)).toBe(true);
  });

  it('refuses a missing header, another scheme, a different token, and a prefix of the token', () => {
    expect(bearerAccepted(undefined, token)).toBe(false);
    expect(bearerAccepted(`Basic ${token}`, token)).toBe(false);
    expect(bearerAccepted('Bearer ', token)).toBe(false);
    expect(bearerAccepted(`Bearer ${mintToken()}`, token)).toBe(false);
    expect(bearerAccepted(`Bearer ${token.slice(0, -1)}`, token)).toBe(false);
    expect(bearerAccepted(`Bearer ${token} extra`, token)).toBe(false);
  });
});
