import type { SSEParserInterface, SSEParserOptions } from './types.js'
import { SSEParser } from './SSEParser.js'

/**
 * Create a Server-Sent-Events (SSE) stream parser - a stateful handle that turns
 * string chunks into the complete events dispatched so far.
 *
 * @param options - See {@link SSEParserOptions}.
 * @remarks
 * `options.limit` caps the total buffered characters (un-consumed line buffer plus
 * the in-progress event's field lengths); unset → unbounded, the default. Feed
 * chunks to `parse(chunk)` as they arrive; each blank line DISPATCHES an event whose
 * `data` is its `data:` fields joined by `\n` (plus the last `event:` / `id:` /
 * `retry:`), and an in-progress event split across chunk boundaries is buffered until
 * its blank line arrives (or `flush()` forces it out at end-of-stream). The `id` /
 * `retry` getters expose the persisted last-event-id / reconnection time, which
 * survive dispatch and only clear on `reset()`. Generic and event-free - no
 * server / agent coupling; never throws on malformed input, only on a configured
 * `limit` being exceeded (an {@link import('./errors.js').SSEError} with code
 * `'OVERFLOW'`). Pair it with a `TextDecoder({ stream: true })` to also handle
 * multi-byte UTF-8 characters split across byte reads.
 *
 * @returns A working {@link SSEParserInterface}
 *
 * @example
 * ```ts
 * import { createSSEParser, isSSEError } from '@src/core'
 *
 * const parser = createSSEParser({ limit: 1_000_000 })
 * parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
 * parser.parse('event: ping\ndata: 1') // [] - buffered until its blank line
 * parser.parse('\n\n')                  // [{ data: '1', event: 'ping' }]
 * try {
 * 	parser.parse('x'.repeat(2_000_000))
 * } catch (error) {
 * 	if (isSSEError(error) && error.code === 'OVERFLOW') parser.reset()
 * }
 * ```
 */
export function createSSEParser(options?: SSEParserOptions): SSEParserInterface {
	return new SSEParser(options)
}
