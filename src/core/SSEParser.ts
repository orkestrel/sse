import type { SSEEvent, SSEParserInterface } from './types.js'
import { BOM, NUL } from './constants.js'

/**
 * A stateful Server-Sent-Events (SSE) stream parser - feed it string chunks, get
 * back the complete events dispatched so far.
 *
 * @remarks
 * - **The wire format.** SSE is a UTF-8 text stream of events separated by a blank
 *   line. Within an event each line is a `field: value` (one optional space after the
 *   colon is stripped; a line with no colon is a field with an empty value; a line
 *   STARTING with a colon is a comment and is ignored). The fields: `data` is appended
 *   to the event's data buffer - MULTIPLE `data:` lines concatenate with `\n` between
 *   them (`data: a` + `data: b` → `"a\nb"`), with no trailing newline; `event` sets the
 *   event type (last wins); `id` sets the last-event-id (last wins; an `id` containing a
 *   NUL is ignored per spec); `retry` sets the reconnection time in ms (integer only -
 *   a non-integer is ignored). Unknown fields are ignored.
 * - **Blank-line dispatch.** A blank line flushes the accumulated event: an
 *   {@link SSEEvent} is emitted ONLY when the data buffer is non-empty (a dispatch with
 *   an empty data buffer emits nothing - a comment-only or field-only "event" produces
 *   no event), and the data buffer + event type reset for the next event afterwards.
 *   `id` / `retry` ride on the emitted event for the consumer to track as connection
 *   state - the parser stays lean and does not itself persist a last-event-id.
 * - **Cross-chunk reassembly.** `parse(chunk)` appends `chunk` to an internal buffer,
 *   splits on the line terminator, processes every COMPLETE line, and retains the
 *   trailing partial line (and any in-progress event) for the next call - so an event
 *   split across chunk boundaries is reassembled once its blank line arrives. An
 *   un-terminated final event stays buffered and is never emitted until its blank line.
 * - **Line endings + BOM.** `\r\n`, `\r`, and `\n` are all valid terminators and are
 *   normalized; a CRLF split across two chunks is held safely (a trailing `\r` is
 *   retained, not flushed as a line, until its `\n` is known). A leading byte-order mark
 *   on the very first chunk is stripped.
 * - **Total + event-free.** A pure functional primitive - no Emitter, no events, no
 *   server / HTTP / agent coupling. It never throws on malformed input (a bad `retry`
 *   is ignored, not thrown) and is testable with plain strings. Pair it with a
 *   `TextDecoder({ stream: true })` when reading a byte stream so multi-byte UTF-8
 *   characters split across reads are handled (the decoder handles partial CHARS, this
 *   parser handles partial LINES + events).
 *
 * @example
 * ```ts
 * const parser = new SSEParser()
 * parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
 * parser.parse('event: ping\ndata: 1') // [] - the event is buffered until its blank line
 * parser.parse('\n\n')                  // [{ data: '1', event: 'ping' }]
 * ```
 */
export class SSEParser implements SSEParserInterface {
	#buffer = ''
	#started = false
	// True when the last consumed line was terminated by a `\r`: a `\n` arriving next
	// (the second half of a CRLF split across chunks) is then swallowed, not read as a
	// fresh blank line. This lets a bare-`\r` terminator flush immediately AND keeps a
	// CRLF straddling a chunk boundary as one terminator.
	#carriage = false
	// The in-progress event accumulator, reset after each blank-line dispatch.
	#data: string[] = []
	#event: string | undefined = undefined
	#id: string | undefined = undefined
	#retry: number | undefined = undefined

	parse(chunk: string): readonly SSEEvent[] {
		// Strip a leading byte-order mark on the very first chunk only.
		if (!this.#started) {
			this.#started = true
			if (chunk.startsWith(BOM)) chunk = chunk.slice(BOM.length)
		}
		this.#buffer += chunk
		const events: SSEEvent[] = []
		// Pull every COMPLETE line off the front of the buffer, leaving the trailing
		// partial line buffered for the next call.
		for (;;) {
			const line = this.#take()
			if (line === undefined) break
			this.#process(line, events)
		}
		return events
	}

	reset(): void {
		this.#buffer = ''
		this.#started = false
		this.#carriage = false
		this.#clear()
	}

	// Take the next complete line off the buffer, or `undefined` when only a partial
	// line remains. A line ends at `\n`, a `\r`, or a `\r\n`. A `\r` flushes its line
	// immediately (bare-`\r` is a valid terminator) and arms {@link #carriage}; a `\n`
	// directly following a consumed `\r` is the CRLF's second half and is swallowed.
	#take(): string | undefined {
		// Swallow a `\n` left over from a `\r\n` whose `\r` already terminated a line -
		// only when a byte is present to inspect, so the flag survives an empty buffer
		// between calls (a `\r` ends one chunk, its `\n` opens the next).
		if (this.#carriage && this.#buffer.length > 0) {
			if (this.#buffer.startsWith('\n')) this.#buffer = this.#buffer.slice(1)
			this.#carriage = false
		}
		const newline = this.#buffer.indexOf('\n')
		const carriage = this.#buffer.indexOf('\r')
		// No terminator at all → the whole buffer is a partial line.
		if (newline === -1 && carriage === -1) return undefined
		// Pick the earliest terminator; a leading `\r` flushes its line and arms the
		// carriage flag so the matching `\n` (this chunk or the next) is swallowed.
		if (carriage !== -1 && (newline === -1 || carriage < newline)) {
			this.#carriage = true
			const line = this.#buffer.slice(0, carriage)
			this.#buffer = this.#buffer.slice(carriage + 1)
			return line
		}
		const line = this.#buffer.slice(0, newline)
		this.#buffer = this.#buffer.slice(newline + 1)
		return line
	}

	// Process one complete line: a blank line dispatches the accumulated event; a
	// comment (a line starting with `:`) is ignored; otherwise it is a `field: value`.
	#process(line: string, events: SSEEvent[]): void {
		if (line.length === 0) {
			this.#dispatch(events)
			return
		}
		if (line.startsWith(':')) return // comment line - ignored
		const colon = line.indexOf(':')
		// No colon → the whole line is the field name, value is empty (per spec).
		const field = colon === -1 ? line : line.slice(0, colon)
		// One optional leading space after the colon is stripped; nothing else.
		let value = colon === -1 ? '' : line.slice(colon + 1)
		if (value.startsWith(' ')) value = value.slice(1)
		this.#field(field, value)
	}

	// Apply one parsed field to the in-progress event. Unknown fields are ignored.
	#field(field: string, value: string): void {
		if (field === 'data') this.#data.push(value)
		else if (field === 'event') this.#event = value
		else if (field === 'id') {
			// An `id` containing a NUL is voided per spec - never surfaced.
			if (!value.includes(NUL)) this.#id = value
		} else if (field === 'retry') {
			// Integer-only; a non-integer reconnection time is ignored (never throws).
			if (/^\d+$/.test(value)) this.#retry = Number(value)
		}
	}

	// Dispatch the accumulated event on a blank line: emit ONLY when data was buffered
	// (the spec's empty-data rule), then reset the accumulator for the next event.
	#dispatch(events: SSEEvent[]): void {
		if (this.#data.length > 0) {
			const event: SSEEvent = {
				data: this.#data.join('\n'),
				...(this.#event !== undefined ? { event: this.#event } : {}),
				...(this.#id !== undefined ? { id: this.#id } : {}),
				...(this.#retry !== undefined ? { retry: this.#retry } : {}),
			}
			events.push(event)
		}
		this.#clear()
	}

	// Reset the in-progress event accumulator (data buffer + last-seen fields).
	#clear(): void {
		this.#data = []
		this.#event = undefined
		this.#id = undefined
		this.#retry = undefined
	}
}
