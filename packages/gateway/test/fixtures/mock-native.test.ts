/**
 * Mock provider — the native-mode contract. `MockResponse.toolCalls`/`reasoning` and
 * the `nativeCall` script let the harness exercise tool-call turns and verbatim
 * reasoning replay without a network, and `modelCaps` reports whether the mock's model
 * row claims tools.
 */

import { describe, expect, it } from 'vitest';
import { createMockProvider, echo, estimateTokens, nativeCall, type MockScript } from '../../src/mock/index.js';
import type { ChatChunk, ChatRequest } from '../../src/types.js';
import { collect } from '../helpers.js';

const req = (content: string, extra: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [{ role: 'user', content }],
  ...extra,
});

const TOOLS = [{ name: 'binder.create', description: 'Make a document', parameters: { type: 'object' } }];

const withTools = (content: string): ChatRequest => req(content, { tools: TOOLS });

describe('mock provider — native tool calls', () => {
  it('nativeCall answers a tools request with a tool_calls terminal chunk', async () => {
    const p = createMockProvider({ scripts: [nativeCall('binder.create', { title: 'Scene One' })] });
    const { chunks, error } = await collect(p.complete(withTools('make a scene')));
    expect(error).toBeUndefined();
    expect(chunks).toEqual([
      {
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_mock_1', name: 'binder.create', argumentsJson: '{"title":"Scene One"}' }],
        usage: { promptTokens: estimateTokens('make a scene'), completionTokens: 0 },
      },
    ]);
  });

  it('numbers call ids per complete() call in one provider instance', async () => {
    const p = createMockProvider({ scripts: [nativeCall('binder.create', {})] });
    const first = await p.completeOnce(withTools('one'));
    const second = await p.completeOnce(withTools('two'));
    expect(first.toolCalls?.[0]?.id).toBe('call_mock_1');
    expect(second.toolCalls?.[0]?.id).toBe('call_mock_2');
  });

  it('completeOnce returns the calls on the assistant message', async () => {
    const p = createMockProvider({ scripts: [nativeCall('binder.read', { docId: 'd1' })] });
    const res = await p.completeOnce(withTools('read it'));
    expect(res).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_mock_1', name: 'binder.read', argumentsJson: '{"docId":"d1"}' }],
    });
  });

  it('ignores a request that carries no tools — another script answers', async () => {
    const p = createMockProvider({ scripts: [nativeCall('binder.create', {}), echo] });
    expect(nativeCall('f', {}).match(req('plain'))).toBe(false);
    const res = await p.completeOnce(req('plain'));
    expect(res).toEqual({ role: 'assistant', content: 'plain' });
  });

  it('a tools request with empty tools array does not match nativeCall', () => {
    expect(nativeCall('f', {}).match(req('x', { tools: [] }))).toBe(false);
  });
});

describe('mock provider — scripted reasoning', () => {
  it('rides the terminal chunk as a replayable block when toolCalls are present', async () => {
    const script: MockScript = {
      match: () => true,
      respond: () => ({
        content: '',
        toolCalls: [{ id: 'call_1', name: 'f', argumentsJson: '{}' }],
        reasoning: 'let me think',
      }),
    };
    const p = createMockProvider({ scripts: [script] });
    const { chunks } = await collect(p.complete(withTools('go')));
    expect(chunks).toEqual([
      {
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'f', argumentsJson: '{}' }],
        reasoning: [{ text: 'let me think', raw: { type: 'mock-reasoning', text: 'let me think' } }],
        usage: { promptTokens: estimateTokens('go'), completionTokens: 0 },
      },
    ]);
    expect((await p.completeOnce(withTools('go'))).reasoning).toEqual([
      { text: 'let me think', raw: { type: 'mock-reasoning', text: 'let me think' } },
    ]);
  });

  it('streams as one reasoningDelta before the terminal chunk when there are no calls', async () => {
    const script: MockScript = { match: () => true, respond: () => ({ content: 'answer', reasoning: 'why' }) };
    const p = createMockProvider({ scripts: [script] });
    const chunks: ChatChunk[] = [];
    for await (const chunk of p.complete(req('go'))) chunks.push(chunk);
    expect(chunks).toEqual([
      { delta: 'answer' },
      { reasoningDelta: 'why' },
      { finishReason: 'stop', usage: { promptTokens: estimateTokens('go'), completionTokens: estimateTokens('answer') } },
    ]);
  });
});

describe('mock provider — modelCaps', () => {
  it('reports the conservative empty row by default and {tools:true} under capsTools', () => {
    expect(createMockProvider().modelCaps('mock', 'mock/echo-1')).toEqual({});
    expect(createMockProvider({ capsTools: true }).modelCaps()).toEqual({ tools: true });
  });
});
