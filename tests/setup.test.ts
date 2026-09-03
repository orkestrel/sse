// The `setup` project's proof of `tests/setup.ts` — the environment-agnostic SSE corpus
// helpers every Vitest project of this workspace loads first.
//
// The subject is each helper's own contract: what it returns, in what order, and
// what it refuses. `SSEParser` appears here as a real instrument, never as a
// subject — `tests/src/core/SSEParser.test.ts` proves the parser, and the
// following cases assert only what `feedAll` does with what a parser hands back.
// Every expectation is a literal or a value rebuilt by a route `tests/setup.ts`
// does not use: percent-encoding for the control constants and `join('')` for
// the chunkings the module builds by slicing.
//
// `tests/setup.ts` is host-independent, so every contract it exports is reachable
// in the Node environment this project runs in. The module's `afterEach` mock
// restoration is a Vitest lifecycle registration rather than an export, so it has
// no assertable return; the consuming suites drive it on every run.

import { seededRandom } from '@orkestrel/contract'
import { SSEError, SSEParser } from '@src/core'
import { describe, expect, it } from 'vitest'
import { chunkings, CR, expectSSEError, feedAll, LF, partition, sliceStream, TAB } from './setup.js'

/** A seed any case may re-draw to prove a seeded source repeats. */
const SEED = 0x5eed

describe('wire constants', () => {
	it('carries one control character each, matching its name', () => {
		// Percent-encoding reads the UTF-8 byte, which `String.fromCharCode` never
		// touches: LINE FEED is 0x0A, CARRIAGE RETURN 0x0D, CHARACTER TABULATION 0x09.
		expect([LF, CR, TAB].map((value) => encodeURIComponent(value))).toEqual(['%0A', '%0D', '%09'])
		expect([LF.length, CR.length, TAB.length]).toEqual([1, 1, 1])
	})
})

describe('feedAll', () => {
	it('flattens the events of every chunk, in chunk order', () => {
		const chunks = ['data: one' + LF + LF, 'data: two' + LF + LF + 'data: three' + LF + LF]

		expect(feedAll(new SSEParser(), chunks)).toEqual([
			{ data: 'one' },
			{ data: 'two' },
			{ data: 'three' },
		])
	})

	it('feeds one parser in order, so an event cut across a boundary dispatches once', () => {
		expect(feedAll(new SSEParser(), ['data: sp', 'lit' + LF, LF])).toEqual([{ data: 'split' }])
	})

	it('returns no events for an empty chunk list', () => {
		expect(feedAll(new SSEParser(), [])).toEqual([])
	})
})

describe('chunkings', () => {
	it('rejoins every chunking to the stream it partitioned', () => {
		const stream = 'event: greet' + LF + 'data: alpha' + LF + 'data: beta' + LF + LF

		for (const chunks of chunkings(stream)) expect(chunks.join('')).toBe(stream)
	})

	it('yields one chunking per requested size, then every two-way cut', () => {
		expect(chunkings('abcdef', [2, 4])).toEqual([
			['ab', 'cd', 'ef'],
			['abcd', 'ef'],
			['', 'abcdef'],
			['a', 'bcdef'],
			['ab', 'cdef'],
			['abc', 'def'],
			['abcd', 'ef'],
			['abcde', 'f'],
			['abcdef', ''],
		])
	})

	it('reaches both extremes of chunk size under its default sizes', () => {
		const stream = 'data: x' + LF + LF
		const result = chunkings(stream)

		expect(result).toContainEqual(Array.from(stream))
		expect(result).toContainEqual([stream])
	})

	it('yields one empty chunk rather than no chunks for an empty stream', () => {
		expect(chunkings('', [1, 2])).toEqual([[''], [''], ['', '']])
	})
})

describe('partition', () => {
	it('rejoins to the stream with no empty chunk, across the whole range of the source', () => {
		const stream = 'data: alpha' + LF + LF + 'data: beta' + LF + LF
		const sources: ReadonlyArray<() => number> = [() => 0, () => 0.5, () => 1, seededRandom(SEED)]

		for (const rng of sources) {
			const chunks = partition(stream, rng)

			expect(chunks.join('')).toBe(stream)
			expect(chunks.filter((chunk) => chunk.length === 0)).toEqual([])
		}
	})

	it('consumes one character per step at the bottom of the range, so it terminates', () => {
		expect(partition('abc', () => 0)).toEqual(['a', 'b', 'c'])
	})

	it('repeats exactly for a re-drawn seed', () => {
		const stream = 'data: alpha' + LF + LF + 'data: beta' + LF + LF

		const first = partition(stream, seededRandom(SEED))

		expect(partition(stream, seededRandom(SEED))).toEqual(first)
		expect(first.length).toBeGreaterThan(1)
	})

	it('returns no chunks for an empty stream', () => {
		expect(partition('', () => 0)).toEqual([])
	})
})

describe('sliceStream', () => {
	it('rejoins its slices to the stream it cut, at the fixed size it was given', () => {
		const stream = 'event: greet' + LF + 'data: alpha' + LF + LF

		const chunks = sliceStream(stream, 4)

		expect(chunks.join('')).toBe(stream)
		expect(chunks[0]).toBe('even')
	})

	it('yields one whole chunk for a size larger than the stream', () => {
		expect(sliceStream('abcdef', 100)).toEqual(['abcdef'])
	})

	it('yields one empty chunk rather than no chunks for an empty stream', () => {
		expect(sliceStream('', 3)).toEqual([''])
	})
})

describe('expectSSEError', () => {
	it('returns the same error, so a caller reads its code and context', () => {
		const error = new SSEError('OVERFLOW', 'buffer would exceed the limit', { limit: 4, size: 9 })

		const narrowed = expectSSEError(error)

		expect(narrowed).toBe(error)
		expect(narrowed.code).toBe('OVERFLOW')
		expect(narrowed.context).toEqual({ limit: 4, size: 9 })
	})

	it('throws for a value that is not an SSEError, message alike or absent', () => {
		expect(() => expectSSEError(new Error('buffer would exceed the limit'))).toThrow(
			'expected value to be an SSEError',
		)
		expect(() => expectSSEError(undefined)).toThrow('expected value to be an SSEError')
	})
})
