/**
 * One dispatched Server-Sent Event - the value a blank line flushes from an
 * {@link SSEParserInterface}.
 *
 * @remarks
 * - `data` is the concatenation of every `data:` field in the event, joined by a
 *   single `\n` (the SSE rule: `data: a` + `data: b` → `"a\nb"`), with NO trailing
 *   newline. An event is dispatched only when its data buffer is non-empty, so `data`
 *   is always a string (possibly empty when an explicit empty `data:` line was sent).
 * - `event` is the last `event:` field seen before the blank line (the event type);
 *   absent when no `event:` field appeared.
 * - `id` is the last `id:` field seen (the last-event-id); absent when none appeared.
 *   A spec NUL inside an `id` voids it, so it is never surfaced.
 * - `retry` is the `retry:` reconnection time in milliseconds - present only when the
 *   field's value was an integer (a non-integer `retry:` is ignored).
 */
export interface SSEEvent {
	/** The event's concatenated data - each `data:` field joined by `\n`, no trailing newline. */
	readonly data: string
	/** The event type - the last `event:` field's value, if any. */
	readonly event?: string
	/** The last-event-id - the last `id:` field's value, if any. */
	readonly id?: string
	/** The reconnection time in ms - the `retry:` field, present only when it was an integer. */
	readonly retry?: number
}

/**
 * Machine-readable codes carried by an {@link import('./errors.js').SSEError}.
 *
 * @remarks
 * `'OVERFLOW'` - a `parse(chunk)` call would push the buffered total over a
 * configured {@link SSEParserOptions.limit}.
 */
export type SSEErrorCode = 'OVERFLOW'

/**
 * Options for {@link import('./factories.js').createSSEParser} / the
 * {@link import('./SSEParser.js').SSEParser} constructor.
 *
 * @remarks
 * `limit` - the maximum total buffered characters the parser will hold at once (the
 * un-consumed line buffer plus the in-progress event's accumulated field lengths -
 * data segments + event type + pending id). Unset → unbounded, the default and
 * existing behavior: the parser then never throws. When set, a `parse(chunk)` call
 * that would push the buffered total over `limit` throws an
 * {@link import('./errors.js').SSEError} with code `'OVERFLOW'` instead of appending
 * the chunk.
 */
export interface SSEParserOptions {
	readonly limit?: number
}

/**
 * A stateful Server-Sent-Events (SSE) stream parser: feed it string chunks, get
 * back the complete events dispatched so far. A trailing partial line / in-progress
 * event is buffered until the rest arrives.
 */
export interface SSEParserInterface {
	/**
	 * Append `chunk`, then return every event a blank line has DISPATCHED (its `data:`
	 * fields concatenated with `\n`, plus the last `event:` / `id:` / `retry:`); an
	 * in-progress event and a trailing partial line are retained for the next call.
	 *
	 * @throws {@link import('./errors.js').SSEError} with code `'OVERFLOW'` when a
	 * configured `limit` would be exceeded - the parser's state is left unchanged.
	 */
	parse(chunk: string): readonly SSEEvent[]
	/**
	 * Treat any remaining buffered partial line as if it had been terminated, then
	 * dispatch the in-progress event if its data buffer is non-empty. A convenience
	 * beyond the WHATWG algorithm, which discards an unterminated final event at EOF
	 * - without calling `flush()`, that spec-faithful discard is this parser's
	 * default behavior.
	 *
	 * @returns The dispatched event as a single-element array, or `[]` when there was
	 * nothing to dispatch.
	 */
	flush(): SSEEvent[]
	/** The persisted last-event-id (WHATWG last-event-id): set by each valid `id:`
	 * field and NOT cleared when an event dispatches; `undefined` until the first
	 * valid `id:` field arrives, or after `reset()`. */
	readonly id: string | undefined
	/** The last valid `retry:` reconnection time seen, in ms; `undefined` until the
	 * first valid `retry:` field arrives, or after `reset()`. */
	readonly retry: number | undefined
	/** Drop any buffered partial line, in-progress event, and persisted id/retry -
	 * reset for a fresh stream. */
	reset(): void
}
