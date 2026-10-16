/**
 * `completeOnce` — §3's convenience, which consumes `complete` and returns one message.
 *
 * The rule that matters is in the last branch. A stream that ends with `finishReason:
 * 'error'` did not produce an answer, so this throws. Returning the partial text as a
 * normal assistant message would hand the harness a truncated answer it would accept
 * as complete. A caller abort throws the standard `AbortError` instead, which is what a
 * caller that aborted expects to see.
 *
 * The message carries the terminal chunk's `toolCalls` and `reasoning` with it, so a
 * native-mode caller gets the same reply a streaming caller assembled.
 */

import { abortError, ProviderError } from './errors.js';
import type { ChatChunk, ChatMessage } from './types.js';

export async function collectOnce(source: AsyncIterable<ChatChunk>, signal?: AbortSignal): Promise<ChatMessage> {
  let content = '';
  let finish: ChatChunk['finishReason'];
  let collected: Pick<ChatMessage, 'toolCalls' | 'reasoning'> = {};
  for await (const chunk of source) {
    if (chunk.delta) content += chunk.delta;
    if (chunk.finishReason !== undefined) finish = chunk.finishReason;
    if (chunk.toolCalls !== undefined) collected = { ...collected, toolCalls: chunk.toolCalls };
    if (chunk.reasoning !== undefined) collected = { ...collected, reasoning: chunk.reasoning };
  }

  if (finish === 'error') {
    if (signal?.aborted) throw abortError();
    throw new ProviderError(
      'provider',
      'The response ended with an error before it completed. Try again, or check the profile in Settings.',
      { detail: content.slice(0, 300) },
    );
  }
  return { role: 'assistant', content, ...collected };
}
