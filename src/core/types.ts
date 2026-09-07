/**
 * Represents one dispatched Server-Sent Event — the value a blank line flushes from an
 * {@link SSEParserInterface}. Its `data` holds every `data:` field of that event joined by
 * `\n` with no trailing newline, and `event` / `id` / `retry` hold the last field of each
 * name the event carried.
 *
 * @remarks
 * - The SSE join rule is `data: a` + `data: b` → `"a\nb"`. An event is dispatched only when
 *   its data buffer is non-empty, so `data` is always a string (possibly empty when an
 *   explicit empty `data:` line was sent).
 * - `event` is read before the blank line (the event type); absent when no `event:` field
 *   appeared.
 * - `id` is the last-event-id; absent when none appeared. A spec NUL inside an `id` voids
 *   it, so it is never surfaced.
 * - `retry` is the reconnection time in milliseconds - present only when the field's value
 *   was an integer (a non-integer `retry:` is ignored).
 */
export interface SSEEvent {
	/** Holds the event's concatenated data - each `data:` field joined by `\n`, no trailing newline. */
	readonly data: string
	/** Holds the event type - the last `event:` field's value, if any. */
	readonly event?: string
	/** Holds the last-event-id - the last `id:` field's value, if any. */
	readonly id?: string
	/** Holds the reconnection time in ms - the `retry:` field, present only when it was an integer. */
	readonly retry?: number
}

/**
 * Names the machine-readable code an `SSEError` carries — `'OVERFLOW'` alone, thrown when a
 * `parse(chunk)` call would push the buffered total over a configured `limit`.
 */
export type SSEErrorCode = 'OVERFLOW'

/**
 * Configures the parser `createSSEParser` builds and the `SSEParser` constructor accepts —
 * `limit` caps the total buffered characters held at once, and leaving it unset keeps the
 * buffering unbounded.
 *
 * @remarks
 * The bounded total is the un-consumed line buffer plus the in-progress event's accumulated
 * field lengths (data segments + event type + pending id). With no `limit` the parser never
 * throws. When set, a `parse(chunk)` call that would push the buffered total over `limit`
 * throws an `SSEError` with code `'OVERFLOW'` instead of appending the chunk.
 */
export interface SSEParserOptions {
	readonly limit?: number
}

/**
 * Represents a stateful Server-Sent-Events (SSE) stream parser: feed it string chunks, get
 * back the complete events dispatched so far. A trailing partial line / in-progress event is
 * buffered until the rest arrives, and the sticky `id` / `retry` getters carry the connection
 * state a dispatch leaves in place.
 */
export interface SSEParserInterface {
	/**
	 * Appends `chunk`, then returns every event a blank line has dispatched — each event's
	 * `data:` fields concatenated with `\n`, plus the last `event:` / `id:` / `retry:` field
	 * it carried. An in-progress event and a trailing partial line are retained for the next
	 * call, and a call that would exceed a configured `limit` throws instead, leaving parser
	 * state unchanged.
	 *
	 * @param chunk - Stream text appended to the internal buffer before the line split
	 * @returns Every event a blank line dispatched during this call, in arrival order
	 * @throws {@link import('./errors.js').SSEError} with code `'OVERFLOW'` when a
	 * configured `limit` would be exceeded - the parser's state is left unchanged.
	 */
	parse(chunk: string): readonly SSEEvent[]
	/**
	 * Treats any remaining buffered partial line as if it had been terminated, then dispatches
	 * the in-progress event when its data buffer is non-empty.
	 *
	 * @remarks
	 * A convenience beyond the WHATWG algorithm, which discards an unterminated final event at
	 * EOF - without calling `flush()`, that spec-faithful discard is this parser's default
	 * behavior.
	 *
	 * @returns The dispatched event as a single-element array, or `[]` when there was
	 * nothing to dispatch.
	 */
	flush(): readonly SSEEvent[]
	/** Holds the persisted last-event-id (WHATWG last-event-id): set by each valid `id:`
	 * field and NOT cleared when an event dispatches; `undefined` until the first
	 * valid `id:` field arrives, or after `clear()`. */
	readonly id: string | undefined
	/** Holds the last valid `retry:` reconnection time seen, in ms; `undefined` until the
	 * first valid `retry:` field arrives, or after `clear()`. */
	readonly retry: number | undefined
	/**
	 * Drops any buffered partial line, in-progress event, and persisted `id` / `retry`, leaving
	 * the parser ready for a fresh stream.
	 */
	clear(): void
}
