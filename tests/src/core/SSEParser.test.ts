import { BOM, NUL, SSEParser, createSSEParser, isSSEError } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	CR,
	LF,
	TAB,
	buildRepeated,
	chunkings,
	expectDefined,
	expectSSEError,
	feedAll,
	mulberry32,
	partition,
} from '../../setup.js'

// The Server-Sent-Events stream parser — the load-bearing behavior is blank-line
// dispatch over a buffered, cross-chunk-reassembled wire: within an event each line
// is a `field: value`, MULTIPLE `data:` lines concatenate with `\n`, a comment line
// (starting `:`) is ignored, and a BLANK line dispatches the accumulated event
// (emitting only when data was buffered). `\r\n` / `\r` / `\n` all terminate lines; a
// leading BOM is stripped from the first chunk; an in-progress event split across
// chunks buffers until its blank line. Total (never throws on malformed input) and
// event-free. Driven entirely with plain strings — no network, no fakes (AGENTS §16).

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

// ═══════════════════════════════════════════════════════════════════════════
// Battle-test catalog (sections A–G) — see scratchpad/sse-test-catalog.md.
// ═══════════════════════════════════════════════════════════════════════════

describe('SSEParser — (A) spec conformance', () => {
	it('A1 a bare `id` (no colon) sets id to the empty string', () => {
		const parser = new SSEParser()

		expect(parser.parse('data:second event\nid\n\n')).toEqual([{ data: 'second event', id: '' }])
	})

	it('A2 sticky last-event-id getter persists across dispatches, updates, and reset', () => {
		const parser = new SSEParser()

		expect(parser.parse('id: 1\ndata: a\n\ndata: b\n\n')).toEqual([
			{ data: 'a', id: '1' },
			{ data: 'b' },
		])
		expect(parser.id).toBe('1')

		// Persists across many further dispatches with no id field.
		expect(parser.parse('data: c\n\n')).toEqual([{ data: 'c' }])
		expect(parser.id).toBe('1')

		// A later id: overwrites.
		expect(parser.parse('id: 2\ndata: d\n\n')).toEqual([{ data: 'd', id: '2' }])
		expect(parser.id).toBe('2')

		parser.reset()
		expect(parser.id).toBeUndefined()
	})

	it('A2b a NUL-voided id does not alter the persisted last-event-id', () => {
		const parser = new SSEParser()

		expect(parser.parse('id: 1\ndata: a\n\n')).toEqual([{ data: 'a', id: '1' }])
		expect(parser.parse('id: x' + NUL + 'y\ndata: b\n\n')).toEqual([{ data: 'b' }])
		expect(parser.id).toBe('1')
	})

	it('A2c sticky retry getter persists, ignores invalid retry, and clears on reset', () => {
		const parser = new SSEParser()

		expect(parser.parse('retry: 100\ndata: a\n\ndata: b\n\n')).toEqual([
			{ data: 'a', retry: 100 },
			{ data: 'b' },
		])
		expect(parser.retry).toBe(100)

		expect(parser.parse('retry: x\ndata: c\n\n')).toEqual([{ data: 'c' }])
		expect(parser.retry).toBe(100)

		parser.reset()
		expect(parser.retry).toBeUndefined()
	})

	it('A3 spec empty-data variants: only complete blank-line-terminated blocks dispatch', () => {
		const parser = new SSEParser()

		// 'data\n\ndata\ndata\n\ndata:' — the trailing 'data:' has no terminator yet.
		expect(parser.parse('data\n\ndata\ndata\n\ndata:')).toEqual([{ data: '' }, { data: '\n' }])
		expect(parser.flush()).toEqual([{ data: '' }])
	})

	it('A4 field names are case-sensitive — uppercase variants are unknown fields', () => {
		expect(new SSEParser().parse('DATA: x\ndata: real\n\n')).toEqual([{ data: 'real' }])
		expect(new SSEParser().parse('EVENT: x\ndata: y\n\n')).toEqual([{ data: 'y' }])
		expect(new SSEParser().parse('ID: x\ndata: y\n\n')).toEqual([{ data: 'y' }])
		expect(new SSEParser().parse('RETRY: 5\ndata: y\n\n')).toEqual([{ data: 'y' }])
	})

	it('A5 prefix/superstring field names are ignored, not matched loosely', () => {
		const parser = new SSEParser()

		expect(parser.parse('dat: x\ndata2: x\ndatas: x\nretryx: 1\ndata: y\n\n')).toEqual([
			{ data: 'y' },
		])
	})

	it('A6 only the first colon splits field from value', () => {
		expect(new SSEParser().parse('data: a:b:c\n\n')).toEqual([{ data: 'a:b:c' }])
	})

	it('A7 a tab after the colon is not stripped — only one leading U+0020 is', () => {
		expect(new SSEParser().parse('data:' + TAB + 'x\n\n')).toEqual([{ data: TAB + 'x' }])
	})

	it('A8 a line of only a colon is a comment', () => {
		expect(new SSEParser().parse(':\n\n')).toEqual([])
	})

	it('A9 a space before the colon makes the line an unknown field', () => {
		expect(new SSEParser().parse('data : x\ndata: y\n\n')).toEqual([{ data: 'y' }])
	})

	it('A10 retry: 0 survives as the number 0', () => {
		expect(new SSEParser().parse('retry: 0\ndata: x\n\n')).toEqual([{ data: 'x', retry: 0 }])
	})

	it('A11 bogus retry forms are ignored; leading zeros parse fine', () => {
		for (const bogus of ['+5', '-5', '5.0', '5e3', '0x10', '1_000']) {
			const parser = new SSEParser()
			expect(parser.parse(`retry: ${bogus}\ndata: x\n\n`)).toEqual([{ data: 'x' }])
		}

		expect(new SSEParser().parse('retry: 007\ndata: x\n\n')).toEqual([{ data: 'x', retry: 7 }])
	})

	it('A12 an empty retry: value is ignored without throwing', () => {
		expect(() => new SSEParser().parse('retry:\ndata: x\n\n')).not.toThrow()
		expect(new SSEParser().parse('retry:\ndata: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('A13 a keep-alive comment mid-event does not interrupt data concatenation', () => {
		expect(new SSEParser().parse('data: a\n: keep-alive\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
	})
})

describe('SSEParser — (B) cross-chunk / incremental', () => {
	it('B1 a bare CR then a non-LF next chunk terminates the line', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: x\r')).toEqual([])
		expect(parser.parse('y\n\n')).toEqual([{ data: 'x' }])
	})

	it('B2 a CRLF split across three chunks with an empty middle chunk reassembles', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: x\r')).toEqual([])
		expect(parser.parse('')).toEqual([])
		expect(parser.parse('\n\n')).toEqual([{ data: 'x' }])
	})

	it("B3 parse('') interleaved at every position of a corpus is a state-preserving no-op", () => {
		const corpus = 'event: a\ndata: 1\n\ndata: 2\nid: 9\n\n'
		const expected = new SSEParser().parse(corpus)

		const interleaved: string[] = []
		for (const character of corpus) {
			interleaved.push('')
			interleaved.push(character)
		}
		interleaved.push('')

		expect(feedAll(new SSEParser(), interleaved)).toEqual(expected)
	})

	it('B4 an empty first chunk does not disarm the BOM strip on the next non-empty chunk', () => {
		const parser = new SSEParser()

		expect(parser.parse('')).toEqual([])
		expect(parser.parse(BOM + 'data: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('B5 alternating 1-char/large chunks over a realistic corpus equals the whole-string parse', () => {
		const corpus =
			'event: delta\ndata: The\n\n' +
			'event: delta\ndata: quick\n\n' +
			'event: delta\ndata: fox\n\n' +
			'event: done\ndata: [DONE]\nid: 9\n\n'
		const expected = new SSEParser().parse(corpus)

		const chunks: string[] = []
		let index = 0
		let large = true
		while (index < corpus.length) {
			const size = large ? 7 : 1
			chunks.push(corpus.slice(index, index + size))
			index += size
			large = !large
		}

		expect(feedAll(new SSEParser(), chunks)).toEqual(expected)
	})
})

describe('SSEParser — (C) unicode & encoding', () => {
	it('C1 a surrogate pair split across chunks rejoins into one character', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: \uD83D')).toEqual([])
		expect(parser.parse('\uDE00\n\n')).toEqual([{ data: '😀' }])
	})

	it('C2 a combining sequence split across chunks rejoins', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: e')).toEqual([])
		expect(parser.parse('́\n\n')).toEqual([{ data: 'é' }])
	})

	it('C3 a CJK payload survives being fed one character at a time', () => {
		const parser = new SSEParser()
		const stream = 'data: 日本語\n\n'
		const events = []
		for (const character of stream) events.push(...parser.parse(character))

		expect(events).toEqual([{ data: '日本語' }])
	})

	it('C4 a lone high surrogate at stream end stays buffered, then flush() emits it verbatim', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: x\uD800')).toEqual([])
		expect(parser.flush()).toEqual([{ data: 'x\uD800' }])
	})

	it('C5 a NUL is legal inside data and event values — only id is NUL-voided', () => {
		expect(new SSEParser().parse('data: a' + NUL + 'b\n\n')).toEqual([{ data: 'a' + NUL + 'b' }])
		expect(new SSEParser().parse('event: p' + NUL + '\ndata: x\n\n')).toEqual([
			{ data: 'x', event: 'p' + NUL },
		])
	})

	it('C6 a NUL anywhere in an id (start, end, or whole) voids it', () => {
		for (const value of [NUL, 'x' + NUL, NUL + 'x']) {
			const parser = new SSEParser()
			expect(parser.parse(`id: ${value}\ndata: y\n\n`)).toEqual([{ data: 'y' }])
		}
	})
})

describe('SSEParser — (D) adversarial & malformed', () => {
	it('D1 prototype pollution is inert — __proto__ is just an ignored/valued field', () => {
		const first = new SSEParser().parse('__proto__: x\ndata: y\n\n')
		expect(first).toEqual([{ data: 'y' }])
		const probe: Record<string, unknown> = {}
		expect(probe.polluted).toBeUndefined()

		const second = new SSEParser().parse('id: __proto__\ndata: z\n\n')
		expect(second).toEqual([{ data: 'z', id: '__proto__' }])
		const event = expectDefined(second[0])
		expect(Object.getPrototypeOf(event)).toBe(Object.prototype)
	})

	it('D2 multiple leading BOMs: only the first strips, the second corrupts the field name', () => {
		expect(new SSEParser().parse(BOM + BOM + 'data: x\n\n')).toEqual([])
	})

	it('D3 a BOM in a second (non-first) chunk is literal content, not stripped', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: a\n\n')).toEqual([{ data: 'a' }])
		expect(parser.parse(BOM + 'data: b\n\n')).toEqual([])
	})

	it('D4 runs of blank lines and comment-only lines dispatch nothing', () => {
		expect(new SSEParser().parse('\n\n\n:\n:\n\n')).toEqual([])
	})

	it('D5 a line of only spaces is an ignored unknown field', () => {
		expect(new SSEParser().parse('   \n\n')).toEqual([])
	})

	it('D6 an ANSI/control-garbage line is ignored; an adjacent data: line still emits', () => {
		expect(new SSEParser().parse('\x1b[31mred\x1b[0m\ndata: x\n\n')).toEqual([{ data: 'x' }])
	})

	it('D7 CRLF-terminated fields carry no stray \\r in their surfaced values', () => {
		const parser = new SSEParser()

		const events = parser.parse(
			'event: x' +
				CR +
				LF +
				'data: d' +
				CR +
				LF +
				'id: 1' +
				CR +
				LF +
				'retry: 5' +
				CR +
				LF +
				CR +
				LF,
		)

		expect(events).toEqual([{ data: 'd', event: 'x', id: '1', retry: 5 }])
		const [event] = events
		expect(event?.event?.includes('\r')).toBe(false)
		expect(event?.id?.includes('\r')).toBe(false)
	})
})

describe('SSEParser — (E) limits & volume (CI-fast, deterministic)', () => {
	it('E1 10,000 events in one chunk dispatch as exactly 10,000 events', () => {
		const events = new SSEParser().parse(buildRepeated('data: x\n\n', 10000))
		expect(events).toHaveLength(10000)
	})

	it('E2 a 1 MB single data line parses whole', () => {
		const payload = 'x'.repeat(1_000_000)
		const [event] = new SSEParser().parse(`data: ${payload}\n\n`)
		expect(event?.data.length).toBe(1_000_000)
	})

	it('E3 one event built from 10,000 data: lines dispatches as a single, correctly-joined event', () => {
		const lines = Array.from({ length: 10000 }, () => 'data: x').join('\n')
		const [event] = new SSEParser().parse(`${lines}\n\n`)

		expect(event).toBeDefined()
		// 10,000 one-character segments joined by '\n': 10,000 + 9,999 separators.
		expect(event?.data.length).toBe(19999)
		expect(event?.data).toBe(Array.from({ length: 10000 }, () => 'x').join('\n'))
	})

	it('E4 a 100k-character unknown field name is ignored without hanging', () => {
		const hugeField = 'x'.repeat(100000)
		const events = new SSEParser().parse(`${hugeField}: val\ndata: y\n\n`)
		expect(events).toEqual([{ data: 'y' }])
	})

	it('E5 an oversized retry value parses to the precision-lossy Number() result', () => {
		const raw = '99999999999999999999'
		const [event] = new SSEParser().parse(`retry: ${raw}\ndata: x\n\n`)
		expect(event?.retry).toBe(Number(raw))
	})

	describe('E6 limit / overflow battery', () => {
		it('(a) unbounded (default) parser buffers a multi-MB partial line without throwing', () => {
			const parser = new SSEParser()
			expect(() => parser.parse('data: ' + 'x'.repeat(3_000_000))).not.toThrow()
		})

		it('(b) a configured limit throws SSEError(OVERFLOW) once the buffered total would exceed it', () => {
			const parser = createSSEParser({ limit: 10 })

			let thrown: unknown
			try {
				parser.parse('x'.repeat(20))
			} catch (error) {
				thrown = error
			}

			expect(expectSSEError(thrown).code).toBe('OVERFLOW')
		})

		it('(c) exactly-at-limit does not throw; one character over does', () => {
			const atLimit = new SSEParser({ limit: 5 })
			expect(() => atLimit.parse('12345')).not.toThrow()

			const overLimit = new SSEParser({ limit: 5 })
			expect(() => overLimit.parse('123456')).toThrow(/exceed the configured limit/)
		})

		it('(d) the throwing call leaves prior state intact and reset() makes the parser reusable', () => {
			const parser = createSSEParser({ limit: 20 })

			expect(parser.parse('data: ab\n')).toEqual([])

			let thrown: unknown
			try {
				parser.parse('x'.repeat(20))
			} catch (error) {
				thrown = error
			}
			const sseError = expectSSEError(thrown)
			expect(sseError.code).toBe('OVERFLOW')
			expect(sseError.context?.limit).toBe(20)

			// The offending chunk was not appended — the prior 'ab' data is intact.
			expect(parser.parse('\n\n')).toEqual([{ data: 'ab' }])

			parser.reset()
			expect(parser.parse('data: fresh\n\n')).toEqual([{ data: 'fresh' }])
		})

		it('(e) accumulated event fields count toward the total — many small data: lines eventually overflow', () => {
			const parser = createSSEParser({ limit: 50 })

			let thrown: unknown
			let iterations = 0
			for (; iterations < 100; iterations += 1) {
				try {
					parser.parse('data: x\n')
				} catch (error) {
					thrown = error
					break
				}
			}

			expect(isSSEError(thrown)).toBe(true)
			expect(iterations).toBeGreaterThan(0)
			expect(iterations).toBeLessThan(100)
		})
	})

	describe('E7 flush() battery', () => {
		it('flushes an unterminated trailing line', () => {
			const parser = new SSEParser()
			expect(parser.parse('data: x')).toEqual([])
			expect(parser.flush()).toEqual([{ data: 'x' }])
		})

		it('flush on empty state returns []', () => {
			expect(new SSEParser().flush()).toEqual([])
		})

		it('flush after a completed (dispatched) event returns []', () => {
			const parser = new SSEParser()
			expect(parser.parse('data: x\n\n')).toEqual([{ data: 'x' }])
			expect(parser.flush()).toEqual([])
		})

		it('flush when only a comment/partial comment is buffered returns []', () => {
			const parser = new SSEParser()
			expect(parser.parse(': partial comment')).toEqual([])
			expect(parser.flush()).toEqual([])
		})

		it('flush does not clear the sticky id/retry', () => {
			const parser = new SSEParser()
			expect(parser.parse('id: 1\nretry: 100\ndata: x')).toEqual([])
			expect(parser.flush()).toEqual([{ data: 'x', id: '1', retry: 100 }])
			expect(parser.id).toBe('1')
			expect(parser.retry).toBe(100)
		})

		it('flush then continued parsing still works', () => {
			const parser = new SSEParser()
			expect(parser.parse('data: x')).toEqual([])
			expect(parser.flush()).toEqual([{ data: 'x' }])
			expect(parser.parse('data: y\n\n')).toEqual([{ data: 'y' }])
		})

		it('double flush — the second call returns []', () => {
			const parser = new SSEParser()
			expect(parser.parse('data: x')).toEqual([])
			expect(parser.flush()).toEqual([{ data: 'x' }])
			expect(parser.flush()).toEqual([])
		})

		it('flush clears a field-only trailing block — nothing leaks into the next event', () => {
			const parser = new SSEParser()
			expect(parser.parse('event: ping\n')).toEqual([])
			expect(parser.flush()).toEqual([])
			// The flushed (empty-data) block's event type must not ride on the next event.
			expect(parser.parse('data: hi\n\n')).toEqual([{ data: 'hi' }])
		})
	})
})

describe('SSEParser — (F) API contract', () => {
	it('F3 reset() mid-CRLF clears the carriage hold — a following \\n is a fresh blank line', () => {
		const parser = new SSEParser()

		expect(parser.parse('data: x\r')).toEqual([])
		parser.reset()

		// After reset, the leading '\n' is NOT swallowed as the second half of the
		// pre-reset CRLF — it is read as a fresh (no-op) blank line, then normal
		// parsing resumes.
		expect(parser.parse('\ndata: y\n\n')).toEqual([{ data: 'y' }])
	})

	it('F4 returned arrays are never aliased across calls — mutating a copy does not leak', () => {
		const parser = new SSEParser()

		const first = parser.parse('data: 1\n\n')
		const second = parser.parse('data: 2\n\n')

		expect(first).not.toBe(second)
		expect(first[0]).not.toBe(second[0])

		// The return type is `readonly SSEEvent[]` — mutating a shallow copy of it
		// (the only mutation a consumer can perform) must not affect later parses.
		const mutable = [...first]
		mutable.push({ data: 'injected' })

		const third = parser.parse('data: 3\n\n')
		expect(third).toEqual([{ data: '3' }])
	})
})

describe('SSEParser — (G) property / invariant suites', () => {
	// A corpus exercising multi-line data, comments, every field, a CRLF/CR/LF mix,
	// and unicode — the fixed target for partition-invariance testing.
	const CORPUS =
		'event: greeting' +
		LF +
		'data: hello' +
		LF +
		'data: world' +
		LF +
		': a comment line' +
		LF +
		'id: 1' +
		CR +
		LF +
		'retry: 250' +
		CR +
		LF +
		CR +
		LF +
		'data: 日本語' +
		LF +
		'data: 😀 end' +
		LF +
		CR +
		'event: done' +
		LF +
		'id: 2' +
		LF +
		'data: bye' +
		LF +
		LF

	const EXPECTED = new SSEParser().parse(CORPUS)

	it('G0 sanity: the corpus actually dispatches events', () => {
		expect(EXPECTED.length).toBeGreaterThan(0)
	})

	it('G1 every fixed-size and two-way-split chunking of the corpus matches the whole-string parse', () => {
		for (const chunks of chunkings(CORPUS)) {
			const parser = new SSEParser()
			expect(feedAll(parser, chunks)).toEqual(EXPECTED)
		}
	})

	it('G2 parse(a+b) === parse(a) then parse(b), for boundary pairs landing on CRLF/colon/BOM/blank-line', () => {
		const pairs: readonly [string, string][] = [
			['data: x\r', '\ndata: y\n\n'],
			['data', ': x\n\n'],
			[BOM, 'data: z\n\n'],
			['data: p\n', '\ndata: q\n\n'],
		]

		for (const [a, b] of pairs) {
			const combined = new SSEParser().parse(a + b)
			const split = feedAll(new SSEParser(), [a, b])
			expect(split).toEqual(combined)
		}
	})

	it('G3 25 seeded-fuzz random partitions of the corpus all match the whole-string parse', () => {
		const rng = mulberry32(0xc0ffee)

		for (let trial = 0; trial < 25; trial += 1) {
			const chunks = partition(CORPUS, rng)
			const parser = new SSEParser()
			expect(feedAll(parser, chunks)).toEqual(EXPECTED)
		}
	})
})
