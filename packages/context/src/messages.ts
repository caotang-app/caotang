/**
 * The execution payload — [context-assembly.md §5](../../../docs/architecture/context-assembly.md).
 *
 * `toChatMessages` is the one way the agent loop turns an assembly into the gateway's
 * `ChatMessage[]`. It returns fresh objects, so a caller that edits what it sent cannot
 * change the assembly, and the preview, which reads the same messages, is unaffected.
 */

import type { ChatMessage } from '@caotang/gateway';

import type { AssembledPrompt } from './types.js';

export function toChatMessages(assembled: AssembledPrompt): ChatMessage[] {
  return assembled.messages.map((message) => ({ role: message.role, content: message.content }));
}
