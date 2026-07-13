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
 * A stateful Server-Sent-Events (SSE) stream parser: feed it string chunks, get
 * back the complete events dispatched so far. A trailing partial line / in-progress
 * event is buffered until the rest arrives.
 */
export interface SSEParserInterface {
	/**
	 * Append `chunk`, then return every event a blank line has DISPATCHED (its `data:`
	 * fields concatenated with `\n`, plus the last `event:` / `id:` / `retry:`); an
	 * in-progress event and a trailing partial line are retained for the next call.
	 */
	parse(chunk: string): readonly SSEEvent[]
	/** Drop any buffered partial line and in-progress event - reset for a fresh stream. */
	reset(): void
}
