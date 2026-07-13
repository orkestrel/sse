import { SSEParser, createSSEParser } from '@src/core'
import { describe, expect, it } from 'vitest'
import { expectSSEError, feedAll } from '../../setup.js'

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

	it('F1 two createSSEParser() instances are fully independent (state isolation)', () => {
		const first = createSSEParser()
		const second = createSSEParser()

		expect(first.parse('event: a\ndata: buffered')).toEqual([])
		expect(second.parse('data: independent\n\n')).toEqual([{ data: 'independent' }])
		// The first instance's buffered event is untouched by the second's activity.
		expect(first.parse('\n\n')).toEqual([{ data: 'buffered', event: 'a' }])
	})

	it('F2 a factory parser behaves identically to `new SSEParser()` over a shared corpus', () => {
		const corpus =
			'event: delta\ndata: The\n\n' +
			'event: delta\ndata: quick\n\n' +
			'event: done\ndata: [DONE]\nid: 9\nretry: 100\n\n'

		const fromFactory = feedAll(createSSEParser(), [corpus])
		const fromClass = feedAll(new SSEParser(), [corpus])

		expect(fromFactory).toEqual(fromClass)
	})

	it('F2 factory options thread through — createSSEParser({ limit }) overflows like the class', () => {
		let factoryThrown: unknown
		try {
			createSSEParser({ limit: 5 }).parse('123456')
		} catch (error) {
			factoryThrown = error
		}

		let classThrown: unknown
		try {
			new SSEParser({ limit: 5 }).parse('123456')
		} catch (error) {
			classThrown = error
		}

		expect(expectSSEError(factoryThrown).code).toBe(expectSSEError(classThrown).code)
	})
})
