/**
 * The two codecs under the transport: SSE framing (§3) and the OpenAI wire format (§3,
 * §5). Each is tested without a network, against the byte-level cases a real provider
 * produces and the ones that break naive parsers.
 */

import { describe, expect, it } from 'vitest';
import { createSseParser } from '../src/sse.js';
import { chatBody, mapFinishReason, parseChunk, parseModels, wireMessages } from '../src/wire.js';

/** Feeds `text` through a parser in pieces and returns every payload it produced. */
function parseIn(pieces: readonly string[]): string[] {
  const parser = createSseParser();
  const out: string[] = [];
  for (const piece of pieces) out.push(...parser.push(piece));
  out.push(...parser.end());
  return out;
}

describe('SSE parser', () => {
  it('yields one payload per event and ignores comments and other fields', () => {
    const text = ': keep-alive\n\nevent: message\nid: 7\ndata: {"a":1}\n\ndata: {"b":2}\n\n';
    expect(parseIn([text])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins multi-line data with newlines, as the spec requires', () => {
    expect(parseIn(['data: line one\ndata: line two\n\n'])).toEqual(['line one\nline two']);
  });

  it('accepts CRLF, lone CR, and LF endings alike', () => {
    expect(parseIn(['data: a\r\n\r\n'])).toEqual(['a']);
    expect(parseIn(['data: b\r\r'])).toEqual(['b']);
    expect(parseIn(['data: c\n\n'])).toEqual(['c']);
  });

  it('gives the same payloads however the bytes are split across network chunks', () => {
    const text = 'data: {"x":"héllo"}\r\n\r\ndata: [DONE]\n\n';
    const whole = parseIn([text]);
    expect(whole).toEqual(['{"x":"héllo"}', '[DONE]']);
    // Every split point, including the one between a \r and its \n.
    for (let cut = 0; cut <= text.length; cut += 1) {
      expect(parseIn([text.slice(0, cut), text.slice(cut)])).toEqual(whole);
    }
  });

  it('holds a trailing carriage return until the next chunk says whether a line feed follows', () => {
    const parser = createSseParser();
    expect(parser.push('data: a\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual(['a']);
  });

  it('strips exactly one space after the colon and keeps the rest of the value', () => {
    expect(parseIn(['data:  two spaces\n\n'])).toEqual([' two spaces']);
    expect(parseIn(['data:no-space\n\n'])).toEqual(['no-space']);
  });

  it('skips events whose payload is empty', () => {
    expect(parseIn(['data:\n\n\n\ndata: real\n\n'])).toEqual(['real']);
  });

  it('keeps an event that a truncated stream left open, so the caller can call it malformed', () => {
    expect(parseIn(['data: {"partial": tru'])).toEqual(['{"partial": tru']);
  });
});

describe('finish reason mapping (§3)', () => {
  it.each([
    ['stop', 'stop'],
    ['tool_calls', 'stop'],
    ['function_call', 'stop'],
    ['length', 'length'],
    ['error', 'error'],
    ['content_filter', 'error'],
    ['something_new', 'error'],
  ])('maps %s to %s', (raw, expected) => {
    expect(mapFinishReason(raw)).toBe(expected);
  });

  it('leaves a null or absent reason unmapped, because the answer is not finished yet', () => {
    expect(mapFinishReason(null)).toBeUndefined();
    expect(mapFinishReason(undefined)).toBeUndefined();
  });
});

describe('parseChunk', () => {
  it('reads a content delta, ignoring an empty one', () => {
    expect(parseChunk({ choices: [{ delta: { content: 'hi' }, finish_reason: null }] })?.deltas).toEqual(['hi']);
    expect(parseChunk({ choices: [{ delta: { content: '' }, finish_reason: null }] })?.deltas).toEqual([]);
    expect(parseChunk({ choices: [{ delta: { role: 'assistant' } }] })?.deltas).toEqual([]);
  });

  it('reads usage from a chunk, and a finish reason from its choice', () => {
    const parsed = parseChunk({
      choices: [{ delta: {}, finish_reason: 'length' }],
      usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
    });
    expect(parsed?.finish).toBe('length');
    expect(parsed?.usage).toEqual({ promptTokens: 11, completionTokens: 4 });
  });

  it('reads the usage-only chunk that arrives after the finish reason, with no choices', () => {
    const parsed = parseChunk({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    expect(parsed?.deltas).toEqual([]);
    expect(parsed?.usage).toEqual({ promptTokens: 3, completionTokens: 1 });
  });

  it('surfaces an in-stream error object, which some providers send with a 200', () => {
    expect(parseChunk({ error: { message: 'upstream timed out', code: 504 } })?.error).toBe('upstream timed out');
  });

  it('returns undefined for something that is not an object, so the caller raises a protocol error', () => {
    expect(parseChunk('just text')).toBeUndefined();
    expect(parseChunk([1, 2])).toBeUndefined();
    expect(parseChunk(null)).toBeUndefined();
  });
});

describe('request body and structured output (§5)', () => {
  it('appends the schema as the last system message, and only then', () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    const wire = wireMessages({ messages: [{ role: 'user', content: 'draft' }], responseFormat: { jsonSchemaHint: schema } });
    expect(wire.at(-1)).toEqual({ role: 'system', content: `Respond with JSON matching: ${JSON.stringify(schema)}` });
    expect(wire).toHaveLength(2);

    expect(wireMessages({ messages: [{ role: 'user', content: 'x' }], responseFormat: 'text' })).toHaveLength(1);
    expect(wireMessages({ messages: [{ role: 'user', content: 'x' }] })).toHaveLength(1);
  });

  it('streams with usage requested, and omits response_format unless the probe allowed it', () => {
    const base = { model: 'm', messages: [], temperature: 0.7, maxTokens: 4096, jsonObject: false };
    const body = chatBody(base);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty('response_format');
    expect(chatBody({ ...base, jsonObject: true }).response_format).toEqual({ type: 'json_object' });
  });

  it('sends stop sequences only when there are some', () => {
    const base = { model: 'm', messages: [], temperature: 0, maxTokens: 1, jsonObject: false };
    expect(chatBody(base)).not.toHaveProperty('stop');
    expect(chatBody({ ...base, stop: [] })).not.toHaveProperty('stop');
    expect(chatBody({ ...base, stop: ['END'] }).stop).toEqual(['END']);
  });
});

describe('parseModels', () => {
  it('reads the id and whichever context-window field the provider uses', () => {
    expect(
      parseModels({
        data: [
          { id: 'a', context_length: 8192 },
          { id: 'b', max_model_len: 32000 },
          { id: 'c' },
          { id: '' },
          'not-an-object',
        ],
      }),
    ).toEqual([{ id: 'a', contextWindow: 8192 }, { id: 'b', contextWindow: 32000 }, { id: 'c' }]);
  });

  it('accepts a models envelope and rejects a body with no list', () => {
    expect(parseModels({ models: [{ id: 'x' }] })).toEqual([{ id: 'x' }]);
    expect(parseModels({ error: 'nope' })).toBeUndefined();
    expect(parseModels('text')).toBeUndefined();
  });
});
