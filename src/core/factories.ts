import type { SSEParserInterface } from './types.js'
import { SSEParser } from './SSEParser.js'

/**
 * Create a Server-Sent-Events (SSE) stream parser - a stateful handle that turns
 * string chunks into the complete events dispatched so far.
 *
 * @remarks
 * Feed chunks to `parse(chunk)` as they arrive; each blank line DISPATCHES an event
 * whose `data` is its `data:` fields joined by `\n` (plus the last `event:` / `id:` /
 * `retry:`), and an in-progress event split across chunk boundaries is buffered until
 * its blank line arrives. `reset()` drops any buffered partial event for a fresh
 * stream. Generic and event-free - no server / agent coupling, never throws on
 * malformed input; pair it with a `TextDecoder({ stream: true })` to also handle
 * multi-byte UTF-8 characters split across byte reads.
 *
 * @returns A working {@link SSEParserInterface}
 *
 * @example
 * ```ts
 * import { createSSEParser } from '@src/core'
 *
 * const parser = createSSEParser()
 * parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
 * parser.parse('event: ping\ndata: 1') // [] - buffered until its blank line
 * parser.parse('\n\n')                  // [{ data: '1', event: 'ping' }]
 * ```
 */
export function createSSEParser(): SSEParserInterface {
	return new SSEParser()
}
