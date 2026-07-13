import { createSSEParser } from '@src/core'
import { describe, expect, it } from 'vitest'

// The parser factory — createSSEParser returns a working SSEParserInterface. Full
// buffering / malformed / cross-chunk behavior lives in SSEParser.test.ts; here we
// assert the factory hands back a usable, independent handle.

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
