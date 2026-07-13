import { createSSEParser } from '@src/core'
import { describe, expect, it } from 'vitest'

// The parser factories — createNDJSONParser returns a working NDJSONParserInterface,
// createSSEParser a working SSEParserInterface, and createMarkdownParser a working
// MarkdownParserInterface. Full buffering / malformed / never-terminated behavior lives
// in NDJSONParser.test.ts and SSEParser.test.ts, the full AST + render behavior in
// MarkdownParser.test.ts; here we assert each factory hands back a usable handle.

describe('createSSEParser', () => {
	it('returns a working SSEParserInterface (data line → event on its blank line)', () => {
		const parser = createSSEParser()

		expect(parser.parse('data: a\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
	})

	it('buffers an event split across calls until its blank line', () => {
		const parser = createSSEParser()

		expect(parser.parse('data: hel')).toEqual([])
		expect(parser.parse('lo\n\n')).toEqual([{ data: 'hello' }])
	})

	it('clears the buffer on reset', () => {
		const parser = createSSEParser()

		expect(parser.parse('data: partial\n')).toEqual([])
		parser.reset()

		expect(parser.parse('data: fresh\n\n')).toEqual([{ data: 'fresh' }])
	})

	it('hands back independent handles that do not share buffer state', () => {
		const first = createSSEParser()
		const second = createSSEParser()

		// A partial buffered in `first` must not leak into `second`.
		expect(first.parse('data: a')).toEqual([])
		expect(second.parse('data: c\n\n')).toEqual([{ data: 'c' }])
		expect(first.parse('\n\n')).toEqual([{ data: 'a' }])
	})
})
