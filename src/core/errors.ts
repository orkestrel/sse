import type { SSEErrorCode } from './types.js'

// AGENTS §12: a configured `limit` exceeded by a `parse(chunk)` call `throw`s an
// `SSEError` carrying a machine-readable `code`, so a `catch` branches on `error.code`
// instead of parsing the message. Every other malformed-input case (a bad `retry`, a
// NUL-voided `id`, an unknown field) is ignored per the WHATWG SSE algorithm and never
// throws.

/**
 * An error thrown by the SSE parser.
 *
 * @remarks
 * Thrown for: a `parse(chunk)` call whose resulting buffered total (un-consumed
 * line buffer + accumulated per-event field lengths + the incoming chunk) would
 * exceed a configured {@link import('./types.js').SSEParserOptions.limit}
 * (`OVERFLOW`). The parser's state is left UNCHANGED by the throwing call - the
 * chunk is not appended - so a consumer may `reset()` and continue. `context`
 * carries at least `{ limit, size }`: the configured limit and the size the
 * buffer would have reached.
 */
export class SSEError extends Error {
	readonly code: SSEErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	constructor(code: SSEErrorCode, message: string, context?: Readonly<Record<string, unknown>>) {
		super(message)
		this.name = 'SSEError'
		this.code = code
		this.context = context
	}
}

/**
 * Narrow an unknown caught value to an {@link SSEError}.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns `true` when `value` is an {@link SSEError}
 *
 * @example
 * ```ts
 * import { isSSEError } from '@src/core'
 *
 * try {
 * 	parser.parse(chunk)
 * } catch (error) {
 * 	if (isSSEError(error) && error.code === 'OVERFLOW') parser.reset()
 * }
 * ```
 */
export function isSSEError(value: unknown): value is SSEError {
	return value instanceof SSEError
}
