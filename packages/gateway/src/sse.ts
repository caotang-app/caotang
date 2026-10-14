/**
 * Server-sent events, parsed incrementally — the wire format §3 names ("SSE parsing of
 * `data:` lines per the OpenAI wire format").
 *
 * Line endings may be `\n`, `\r\n` or a lone `\r`, and a network chunk can end between
 * the `\r` and the `\n` of one ending. A trailing `\r` is therefore held back until the
 * next chunk says whether a `\n` follows, instead of being counted as two line ends.
 *
 * Only `data:` fields are kept. Comments (lines beginning with `:`, which providers use
 * as keep-alives), `event:` and `id:` carry nothing the gateway uses. An event is the
 * `data:` lines between blank lines, joined with `\n` as the spec requires.
 */

export interface SseParser {
  /** Feeds decoded text and returns the payload of every event it completed. */
  push(text: string): string[];
  /** Ends the stream and returns any event still open. A truncated final event is kept, so the caller reports it as malformed rather than losing it silently. */
  end(): string[];
}

export function createSseParser(): SseParser {
  let pending = '';
  let dataLines: string[] = [];
  let completed: string[] = [];

  const field = (line: string): void => {
    if (line === '') {
      if (dataLines.length > 0) {
        const payload = dataLines.join('\n');
        // An event with no payload is a keep-alive in practice, not a message.
        if (payload !== '') completed.push(payload);
        dataLines = [];
      }
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'data') dataLines.push(value);
  };

  const drain = (): string[] => {
    const out = completed;
    completed = [];
    return out;
  };

  return {
    push(text) {
      pending += text;
      let start = 0;
      for (let i = 0; i < pending.length; i += 1) {
        const ch = pending[i];
        if (ch === '\n') {
          field(pending.slice(start, i));
          start = i + 1;
        } else if (ch === '\r') {
          // The last character may be half of a \r\n split across chunks: wait for more.
          if (i + 1 === pending.length) break;
          field(pending.slice(start, i));
          if (pending[i + 1] === '\n') i += 1;
          start = i + 1;
        }
      }
      pending = pending.slice(start);
      return drain();
    },
    end() {
      if (pending !== '') {
        // A held-back \r is a line ending now that no \n can follow it.
        field(pending.endsWith('\r') ? pending.slice(0, -1) : pending);
        pending = '';
      }
      if (dataLines.length > 0) {
        const payload = dataLines.join('\n');
        if (payload !== '') completed.push(payload);
        dataLines = [];
      }
      return drain();
    },
  };
}
