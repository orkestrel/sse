import type { SSEErrorCode } from './types.js'

// .claude/rules/typescript.md, Errors and outcomes: a configured `limit` exceeded by a `parse(chunk)` call `throw`s an
// `SSEError` carrying a machine-readable `code`, so a `catch` branches on `error.code`
// instead of parsing the message. Every other malformed-input case (a bad `retry`, a
// NUL-voided `id`, an unknown field) is ignored per the WHATWG SSE algorithm and never
// throws.

/**
 * Represents an error thrown by the SSE parser.
 *
 * @remarks
 * Thrown for: a `parse(chunk)` call whose resulting buffered total (un-consumed
 * line buffer + accumulated per-event field lengths + the incoming chunk) would
 * exceed a configured {@link import('./types.js').SSEParserOptions.limit}
 * (`OVERFLOW`). The parser's state is left UNCHANGED by the throwing call - the
 * chunk is not appended - so a consumer may `clear()` and continue. `context`
 * carries at least `{ limit, size }`: the configured limit and the size the
 * buffer would have reached.
 *
 * @example
 * ```ts
 * import { isSSEError, SSEParser } from '@src/core'
 *
 * const parser = new SSEParser({ limit: 10 })
 * try {
 * 	parser.parse('x'.repeat(20))
 * } catch (error) {
 * 	if (isSSEError(error) && error.code === 'OVERFLOW') {
 * 		error.context // { limit: 10, size: 20 }
 * 		parser.clear()
 * 	}
 * }
 * ```
 */
export class SSEError extends Error {
	readonly code: SSEErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	/**
	 * Creates an SSE error carrying a machine-readable code.
	 *
	 * @param code - The machine-readable {@link import('./types.js').SSEErrorCode} a `catch` branches on
	 * @param message - The human-readable description, carried as the `Error` message
	 * @param context - Extra diagnostic detail; omitted leaves `context` `undefined`. An `'OVERFLOW'` carries at least `{ limit, size }`
	 */
	constructor(code: SSEErrorCode, message: string, context?: Readonly<Record<string, unknown>>) {
		super(message)
		this.name = 'SSEError'
		this.code = code
		if (context !== undefined) this.context = context
	}
}

/**
 * Narrows an unknown caught value to an {@link SSEError}.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns True if `value` is an {@link SSEError}; false otherwise
 *
 * @example
 * ```ts
 * import { isSSEError } from '@src/core'
 *
 * try {
 * 	parser.parse(chunk)
 * } catch (error) {
 * 	if (isSSEError(error) && error.code === 'OVERFLOW') parser.clear()
 * }
 * ```
 */
export function isSSEError(value: unknown): value is SSEError {
	return value instanceof SSEError
}
