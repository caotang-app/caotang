/**
 * Base URL validation and normalisation — provider-gateway.md §2. Every case here is a
 * shape a person can type into the settings form, so each one is a decision the form
 * relies on.
 */

import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from '../src/base-url.js';
import { isLoopbackBase, normalizeBaseUrl, ProfileError } from '../src/index.js';

const rejects = (input: string): ProfileError => {
  try {
    normalizeBaseUrl(input);
  } catch (error) {
    if (error instanceof ProfileError) return error;
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(input)} to be rejected`);
};

describe('normalizeBaseUrl — accepted shapes', () => {
  it.each([
    ['https://openrouter.ai/api/v1/', 'https://openrouter.ai/api/v1'],
    ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['  https://api.openai.com/v1//  ', 'https://api.openai.com/v1'],
    ['https://api.openai.com/', 'https://api.openai.com'],
    ['https://api.openai.com', 'https://api.openai.com'],
    ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
    ['http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434/v1'],
    ['http://[::1]:1234/v1', 'http://[::1]:1234/v1'],
    ['https://API.OpenAI.com:443/v1', 'https://api.openai.com/v1'],
    // Google's documented OpenAI-compatible base carries a version but does not end in one.
    ['https://generativelanguage.googleapis.com/v1beta/openai/', 'https://generativelanguage.googleapis.com/v1beta/openai'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });
});

describe('normalizeBaseUrl — refused shapes', () => {
  it('refuses a full endpoint path, since the gateway appends the endpoint itself', () => {
    const error = rejects('https://api.openai.com/v1/chat/completions');
    expect(error.field).toBe('baseUrl');
    expect(error.message).toMatch(/full endpoint path/);
  });

  it.each(['https://x.io/v1/models', 'https://x.io/v1/completions', 'https://x.io/v1/responses', 'https://x.io/v1/embeddings'])(
    'refuses the endpoint path in %s',
    (input) => {
      expect(() => normalizeBaseUrl(input)).toThrow(ProfileError);
    },
  );

  it('refuses a path that carries no version', () => {
    expect(rejects('https://api.example.com/api').message).toMatch(/pathless or carry a version/);
  });

  it('refuses plain http to a remote host, so a key is never sent in clear text', () => {
    expect(rejects('http://example.com/v1').message).toMatch(/https/);
  });

  it('refuses plain http to a public host whose name merely starts with 127., since only a 127.x.x.x address is loopback', () => {
    expect(() => normalizeBaseUrl('http://127.evil.example/v1')).toThrow(ProfileError);
    expect(rejects('http://127.evil.example/v1').message).toMatch(/https/);
    expect(() => normalizeBaseUrl('http://127.0.0.1.evil.example/v1')).toThrow(ProfileError);
  });

  it('refuses a query string or fragment, which would break the appended path', () => {
    expect(() => normalizeBaseUrl('https://x.io/v1?api-version=2')).toThrow(ProfileError);
    expect(() => normalizeBaseUrl('https://x.io/v1#frag')).toThrow(ProfileError);
  });

  it('refuses credentials embedded in the URL', () => {
    expect(() => normalizeBaseUrl('https://user:pass@x.io/v1')).toThrow(ProfileError);
  });

  it.each(['ftp://x.io/v1', 'mock://caotang', 'file:///etc/passwd'])('refuses the scheme in %s', (input) => {
    expect(() => normalizeBaseUrl(input)).toThrow(ProfileError);
  });

  it('refuses an empty value and a value that is not a URL', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow(/is empty/);
    expect(() => normalizeBaseUrl('not a url')).toThrow(/not a URL/);
  });
});

describe('isLoopbackBase', () => {
  it('is true only for the user’s own machine', () => {
    expect(isLoopbackBase('http://localhost:1234/v1')).toBe(true);
    expect(isLoopbackBase('http://app.localhost:3000')).toBe(true);
    expect(isLoopbackBase('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLoopbackBase('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackBase('not a url')).toBe(false);
  });

  it('is false for a public host whose name starts with 127., so a key saved there must be entered', () => {
    expect(isLoopbackBase('http://127.attacker.test')).toBe(false);
    expect(isLoopbackBase('https://127.attacker.test/v1')).toBe(false);
    expect(isLoopbackBase('http://127.0.0.1.attacker.test:11434/v1')).toBe(false);
  });

  it('is true for every address in 127.0.0.0/8, and the URL parser writes short forms out in full', () => {
    expect(isLoopbackBase('http://127.0.0.2:1234/v1')).toBe(true);
    expect(isLoopbackBase('http://127.255.255.254:1234/v1')).toBe(true);
    expect(isLoopbackBase('http://127.1:1234/v1')).toBe(true);
  });
});

describe('isLoopbackHost', () => {
  it('needs four octets, each at most 255, after 127', () => {
    expect(isLoopbackHost('127.300.0.1')).toBe(false);
    expect(isLoopbackHost('127.0.0')).toBe(false);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('128.0.0.1')).toBe(false);
  });
});
