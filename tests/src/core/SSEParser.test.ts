import { SSEParser } from '@src/core'
import { describe, expect, it } from 'vitest'

// The Server-Sent-Events stream parser — the load-bearing behavior is blank-line
// dispatch over a buffered, cross-chunk-reassembled wire: within an event each line
// is a `field: value`, MULTIPLE `data:` lines concatenate with `\n`, a comment line
// (starting `:`) is ignored, and a BLANK line dispatches the accumulated event
// (emitting only when data was buffered). `\r\n` / `\r` / `\n` all terminate lines; a
// leading BOM is stripped from the first chunk; an in-progress event split across
// chunks buffers until its blank line. Total (never throws on malformed input) and
// event-free. Driven entirely with plain strings — no network, no fakes (AGENTS §16).

// Control bytes spelled as codepoints so the raw wire content is unambiguous in
// source (a literal `'\r'` is identical, but the codepoint removes all doubt).
const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)
const NUL = String.fromCharCode(0)
const BOM = String.fromCharCode(0xfeff)

describe('SSEParser — a single event', () => {
	it('dispatches a single data line on its blank line', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: hello\n\n')).toEqual([{ data: 'hello' }])
	})

	it('strips exactly one space after the colon (data: with-space)', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: with-space\n\n')).toEqual([{ data: 'with-space' }])
	})

	it('strips only ONE leading space — a second space survives in the value', () => {
		const parser = new SSEParser()

		// `data:  x` (two spaces) → one stripped, the value is ` x`.
		expect(parser.parse('data:  x\n\n')).toEqual([{ data: ' x' }])
	})

	it('requires no space after the colon (data:no-space)', () => {
		const parser = new SSEParser()

		expect(parser.parse('data:no-space\n\n')).toEqual([{ data: 'no-space' }])
	})
})

describe('SSEParser — multi-line data concatenation (the crux)', () => {
	it('joins two data lines with a single \\n (data: a / data: b → "a\\nb")', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: a\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
	})

	it('joins three data lines with \\n and adds no trailing newline', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: a\ndata: b\ndata: c\n\n')).toEqual([{ data: 'a\nb\nc' }])
	})

	it('treats an empty data line as an empty segment in the join', () => {
		const parser = new SSEParser()

		// `data:` (empty) then `data: x` → segments ['', 'x'] → '\nx'.
		expect(parser.parse('data:\ndata: x\n\n')).toEqual([{ data: '\nx' }])
	})

	it('preserves interior whitespace in a data value (only the first space is stripped)', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: a  b\n\n')).toEqual([{ data: 'a  b' }])
	})
})

describe('SSEParser — all fields', () => {
	it('surfaces event / data / id / retry together', () => {
		const parser = new SSEParser()

		expect(parser.parse('event: foo\ndata: x\nid: 42\nretry: 3000\n\n')).toEqual([
			{ data: 'x', event: 'foo', id: '42', retry: 3000 },
		])
	})

	it('omits absent optional fields (data-only event has no event/id/retry keys)', () => {
		const parser = new SSEParser()

		const [event] = parser.parse('data: x\n\n')

		expect(event).toEqual({ data: 'x' })
		expect(Object.keys(event ?? {})).toEqual(['data'])
	})

	it('applies last-wins for repeated event and id fields', () => {
		const parser = new SSEParser()

		expect(parser.parse('event: a\nevent: b\nid: 1\nid: 2\ndata: x\n\n')).toEqual([
			{ data: 'x', event: 'b', id: '2' },
		])
	})

	it('keeps an empty event-type value (event: with nothing after the space)', () => {
		const parser = new SSEParser()

		// `event:` sets the type to the empty string — present, distinct from absent.
		expect(parser.parse('event:\ndata: x\n\n')).toEqual([{ data: 'x', event: '' }])
	})
})

describe('SSEParser — colon parsing and comments', () => {
	it('treats a line with no colon as a field with an empty value', () => {
		const parser = new SSEParser()

		// A bare `data` line (no colon) is the `data` field with value '' → one segment.
		expect(parser.parse('data\n\n')).toEqual([{ data: '' }])
	})

	it('concatenates a no-colon data line as an empty segment with a valued one', () => {
		const parser = new SSEParser()

		// `data` (→ '') then `data: x` (→ 'x') → join → '\nx'.
		expect(parser.parse('data\ndata: x\n\n')).toEqual([{ data: '\nx' }])
	})

	it('ignores a comment line (one starting with a colon)', () => {
		const parser = new SSEParser()

		expect(parser.parse(': this is a comment\ndata: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('ignores an unknown field entirely', () => {
		const parser = new SSEParser()

		expect(parser.parse('unknown: whatever\ndata: x\n\n')).toEqual([{ data: 'x' }])
	})
})

describe('SSEParser — blank-line dispatch and multiple events', () => {
	it('dispatches two events from two blank-line-separated blocks in one chunk', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: 1\n\ndata: 2\n\n')).toEqual([{ data: '1' }, { data: '2' }])
	})

	it('resets the accumulator between events (event type does not bleed across)', () => {
		const parser = new SSEParser()

		// The first event carries `event: a`; the second, with no event field, must not
		// inherit it.
		expect(parser.parse('event: a\ndata: 1\n\ndata: 2\n\n')).toEqual([
			{ data: '1', event: 'a' },
			{ data: '2' },
		])
	})

	it('dispatches several events across a run of blank lines', () => {
		const parser = new SSEParser()

		// Extra blank lines between events are empty-data dispatches → no spurious event.
		expect(parser.parse('data: 1\n\n\ndata: 2\n\n\n\ndata: 3\n\n')).toEqual([
			{ data: '1' },
			{ data: '2' },
			{ data: '3' },
		])
	})
})

describe('SSEParser — empty-data dispatch (no spurious events)', () => {
	it('does not emit on a blank line with no accumulated data', () => {
		const parser = new SSEParser()

		expect(parser.parse('\n')).toEqual([])
	})

	it('does not emit a comment-only "event"', () => {
		const parser = new SSEParser()

		expect(parser.parse(': just a comment\n\n')).toEqual([])
	})

	it('does not emit a field-only "event" carrying no data', () => {
		const parser = new SSEParser()

		// `event` / `id` / `retry` with no `data` → the dispatch emits nothing.
		expect(parser.parse('event: ping\nid: 7\nretry: 100\n\n')).toEqual([])
	})

	it('emits an explicit empty-data event (data: present but empty → data "")', () => {
		const parser = new SSEParser()

		// An explicit `data:` line buffers an empty segment, so the data buffer IS
		// non-empty → the event dispatches with `data: ''`.
		expect(parser.parse('data:\n\n')).toEqual([{ data: '' }])
	})
})

describe('SSEParser — cross-chunk reassembly', () => {
	it('buffers an event split mid-line and emits it once the blank line arrives', () => {
		const parser = new SSEParser()

		// The first chunk is a partial data line — nothing complete yet.
		expect(parser.parse('data: hel')).toEqual([])
		// The rest of the line + the blank line arrive — the event dispatches.
		expect(parser.parse('lo\n\n')).toEqual([{ data: 'hello' }])
	})

	it('reassembles a field split across the colon boundary', () => {
		const parser = new SSEParser()

		expect(parser.parse('eve')).toEqual([])
		expect(parser.parse('nt: foo\ndata: x\n\n')).toEqual([{ data: 'x', event: 'foo' }])
	})

	it('dispatches when the terminating blank line arrives in a later chunk', () => {
		const parser = new SSEParser()

		// A complete data line, but no blank line yet — the event stays buffered.
		expect(parser.parse('data: queued\n')).toEqual([])
		// The blank line arrives separately — now it dispatches.
		expect(parser.parse('\n')).toEqual([{ data: 'queued' }])
	})

	it('reassembles multi-line data fed one character at a time', () => {
		const parser = new SSEParser()

		const stream = 'data: a\ndata: b\n\n'
		const events = []
		for (const character of stream) events.push(...parser.parse(character))

		expect(events).toEqual([{ data: 'a\nb' }])
	})

	it('reassembles a two-event stream across every possible two-chunk split point', () => {
		const stream = 'event: x\ndata: 1\n\ndata: 2\nid: 9\n\n'
		const expected = [
			{ data: '1', event: 'x' },
			{ data: '2', id: '9' },
		]

		for (let cut = 0; cut <= stream.length; cut += 1) {
			const parser = new SSEParser()
			const events = [...parser.parse(stream.slice(0, cut)), ...parser.parse(stream.slice(cut))]
			expect(events).toEqual(expected)
		}
	})
})

describe('SSEParser — line endings (CRLF / CR / LF)', () => {
	it('dispatches a CRLF-terminated event', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: x' + CR + LF + CR + LF)).toEqual([{ data: 'x' }])
	})

	it('dispatches a bare-CR-terminated event (old-Mac line endings)', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: x' + CR + CR)).toEqual([{ data: 'x' }])
	})

	it('joins multi-line data across CRLF terminators', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: a' + CR + LF + 'data: b' + CR + LF + CR + LF)).toEqual([
			{ data: 'a\nb' },
		])
	})

	it('handles a CRLF split BETWEEN the \\r and the \\n across two chunks', () => {
		const parser = new SSEParser()

		// The first chunk ends on a lone `\r` — held back, not flushed as a line, since
		// it may be the `\r` of a CRLF whose `\n` is in the next chunk.
		expect(parser.parse('data: x' + CR)).toEqual([])
		// The `\n` (then the blank line) arrives — exactly one line, then dispatch.
		expect(parser.parse(LF + CR + LF)).toEqual([{ data: 'x' }])
	})

	it('parses a stream mixing LF, CRLF, and bare CR terminators', () => {
		const parser = new SSEParser()

		// `event: a` (LF) `data: 1` (CRLF) blank (CR) → one event.
		expect(parser.parse('event: a' + LF + 'data: 1' + CR + LF + CR)).toEqual([
			{ data: '1', event: 'a' },
		])
	})
})

describe('SSEParser — BOM stripping', () => {
	it('strips a leading BOM on the first chunk', () => {
		const parser = new SSEParser()

		expect(parser.parse(BOM + 'data: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('strips a BOM that precedes the first field name only', () => {
		const parser = new SSEParser()

		// Without stripping, the field would be `﻿event` (unknown) and the event
		// type would be lost; with stripping, `event: a` is recognized.
		expect(parser.parse(BOM + 'event: a\ndata: x\n\n')).toEqual([{ data: 'x', event: 'a' }])
	})

	it('does NOT strip a BOM appearing in a later chunk (first-chunk only)', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: x\n\n')).toEqual([{ data: 'x' }])
		// A BOM at the head of a SECOND chunk is ordinary content — a no-colon line
		// `﻿data` is an unknown field, not a stripped marker, so this event has no
		// recognized data and does not emit.
		expect(parser.parse(BOM + 'data\n\n')).toEqual([])
	})

	it('treats a BOM-only first chunk as stripped, leaving an empty buffer', () => {
		const parser = new SSEParser()

		expect(parser.parse(BOM)).toEqual([])
		// The marker is consumed; a following complete event parses normally.
		expect(parser.parse('data: x\n\n')).toEqual([{ data: 'x' }])
	})
})

describe('SSEParser — retry parsing', () => {
	it('parses an integer retry to a number', () => {
		const parser = new SSEParser()

		expect(parser.parse('retry: 5000\ndata: x\n\n')).toEqual([{ data: 'x', retry: 5000 }])
	})

	it('ignores a non-integer retry without throwing (no retry on the event)', () => {
		const parser = new SSEParser()

		expect(parser.parse('retry: abc\ndata: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('ignores a decimal retry (integer-only per spec)', () => {
		const parser = new SSEParser()

		expect(parser.parse('retry: 12.5\ndata: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('keeps the last integer retry when repeated', () => {
		const parser = new SSEParser()

		expect(parser.parse('retry: 100\nretry: 200\ndata: x\n\n')).toEqual([{ data: 'x', retry: 200 }])
	})
})

describe('SSEParser — id edge cases', () => {
	it('surfaces a normal id on the event', () => {
		const parser = new SSEParser()

		expect(parser.parse('id: abc\ndata: x\n\n')).toEqual([{ data: 'x', id: 'abc' }])
	})

	it('ignores an id containing a NUL (voided per spec), no throw', () => {
		const parser = new SSEParser()

		// An `id` with a NUL byte is not surfaced — the event carries no id.
		expect(parser.parse('id: a' + NUL + 'b\ndata: x\n\n')).toEqual([{ data: 'x' }])
	})
})

describe('SSEParser — buffered final event (no trailing blank line)', () => {
	it('does not emit a complete-but-undispatched event (no blank line yet)', () => {
		const parser = new SSEParser()

		// A full `data:` line with no terminating blank line stays buffered.
		expect(parser.parse('data: pending\n')).toEqual([])
		// Still no blank line across more calls — nothing emits.
		expect(parser.parse('')).toEqual([])
	})

	it('emits a buffered event only once its blank line finally arrives', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: a\ndata: b\n')).toEqual([])
		expect(parser.parse('\n')).toEqual([{ data: 'a\nb' }])
	})

	it('returns nothing for an empty chunk', () => {
		const parser = new SSEParser()

		expect(parser.parse('')).toEqual([])
	})
})

describe('SSEParser — reset', () => {
	it('drops a buffered partial event so a later parse starts fresh', () => {
		const parser = new SSEParser()

		// Accumulate a data line (no blank line yet), then reset before it dispatches.
		expect(parser.parse('data: gone\n')).toEqual([])
		parser.reset()

		// The old data is discarded — a fresh event dispatches without it.
		expect(parser.parse('data: fresh\n\n')).toEqual([{ data: 'fresh' }])
	})

	it('clears a buffered partial LINE as well as the accumulator', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: par')).toEqual([])
		parser.reset()

		// The partial `data: par` line is gone; the tail is now its own fresh stream.
		expect(parser.parse('data: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('re-arms BOM stripping after reset (next parse is a fresh first chunk)', () => {
		const parser = new SSEParser()

		expect(parser.parse(BOM + 'data: a\n\n')).toEqual([{ data: 'a' }])
		parser.reset()
		// After reset the next chunk is again a "first chunk" — its leading BOM strips.
		expect(parser.parse(BOM + 'data: b\n\n')).toEqual([{ data: 'b' }])
	})

	it('is a safe no-op on an empty buffer', () => {
		const parser = new SSEParser()

		parser.reset()
		parser.reset()

		expect(parser.parse('data: x\n\n')).toEqual([{ data: 'x' }])
	})
})

describe('SSEParser — realistic streamed completion at arbitrary chunk boundaries', () => {
	// A realistic SSE completion stream: a run of content deltas (each its own event),
	// then a terminal done event. Reassembly must be independent of WHERE the bytes
	// were chunked — so the exact same stream is fed split several ways and the same
	// events must come back.
	const stream =
		'event: delta\ndata: The\n\n' +
		'event: delta\ndata: quick\n\n' +
		'event: delta\ndata: fox\n\n' +
		'event: done\ndata: [DONE]\nid: 9\n\n'

	const expected = [
		{ data: 'The', event: 'delta' },
		{ data: 'quick', event: 'delta' },
		{ data: 'fox', event: 'delta' },
		{ data: '[DONE]', event: 'done', id: '9' },
	]

	const drain = (size: number): readonly { readonly data: string }[] => {
		const parser = new SSEParser()
		const events = []
		for (let index = 0; index < stream.length; index += size) {
			events.push(...parser.parse(stream.slice(index, index + size)))
		}
		return events
	}

	it('reassembles when fed as one whole chunk', () => {
		expect(drain(stream.length)).toEqual(expected)
	})

	it('reassembles when split mid-field / mid-data (3-char slices)', () => {
		expect(drain(3)).toEqual(expected)
	})

	it('reassembles when split one character at a time', () => {
		expect(drain(1)).toEqual(expected)
	})

	it('streams the data deltas in order regardless of chunking', () => {
		expect(drain(2).map((event) => event.data)).toEqual(['The', 'quick', 'fox', '[DONE]'])
	})
})

describe('SSEParser — output array integrity', () => {
	it('returns a fresh array each call — no shared accumulator across parses', () => {
		const parser = new SSEParser()

		const first = parser.parse('data: 1\n\n')
		const second = parser.parse('data: 2\n\n')

		expect(first).not.toBe(second)
		expect(first).toEqual([{ data: '1' }])
		expect(second).toEqual([{ data: '2' }])
	})

	it('returns distinct empty arrays for empty chunks', () => {
		const parser = new SSEParser()

		const first = parser.parse('')
		const second = parser.parse('')

		expect(first).toEqual([])
		expect(second).toEqual([])
		expect(first).not.toBe(second)
	})
})
