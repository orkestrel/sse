// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window`: this package is core-only.
//
// SSE corpus helpers shared by this workspace's suites: the wire constants and the chunk-partitioning leaves.

import type { SSEError, SSEEvent, SSEParserInterface } from '@src/core'
import { isSSEError } from '@src/core'
import { afterEach, vi } from 'vitest'

afterEach(() => {
	vi.restoreAllMocks()
})

// ── SSE line-terminator and whitespace constants (shared) ─────

// Control bytes spelled as codepoints so the raw wire content is unambiguous
// in source (a literal `'\r'` is identical, but the codepoint removes doubt).
export const LF = String.fromCharCode(10)
export const CR = String.fromCharCode(13)
export const TAB = String.fromCharCode(9)

// ── SSEParser corpus-partitioning helpers (generic, environment-agnostic) ──

/**
 * Feed every chunk in `chunks` to `parser.parse(...)` in order and flatten the
 * dispatched events into a single array.
 */
export function feedAll(parser: SSEParserInterface, chunks: readonly string[]): SSEEvent[] {
	const events: SSEEvent[] = []
	for (const chunk of chunks) events.push(...parser.parse(chunk))
	return events
}

/**
 * Returns `stream` cut into consecutive slices of `size` characters, with one
 * empty slice for an empty stream so a caller always receives a chunk to feed.
 */
export function sliceStream(stream: string, size: number): readonly string[] {
	const chunks: string[] = []
	for (let index = 0; index < stream.length; index += size) {
		chunks.push(stream.slice(index, index + size))
	}
	if (chunks.length === 0) chunks.push('')
	return chunks
}

/**
 * Partition `stream` into a fixed set of chunkings for partition-invariance
 * testing: one chunking per fixed size in `sizes` (default `{1,2,3,5,7,13,len}`)
 * plus every two-way single-cut split (`stream.slice(0, cut)` /
 * `stream.slice(cut)` for every `cut` from `0` to `stream.length`).
 */
export function chunkings(
	stream: string,
	sizes: readonly number[] = [1, 2, 3, 5, 7, 13, stream.length],
): ReadonlyArray<readonly string[]> {
	const result: string[][] = []
	for (const size of sizes) {
		result.push([...sliceStream(stream, size)])
	}
	for (let cut = 0; cut <= stream.length; cut += 1) {
		result.push([stream.slice(0, cut), stream.slice(cut)])
	}
	return result
}

/**
 * Split `stream` into a random sequence of non-empty chunks driven by `rng`
 * (for example {@link seededRandom} from `@orkestrel/contract`) — every call
 * consumes at least one character, so it always terminates.
 */
export function partition(stream: string, rng: () => number): readonly string[] {
	const chunks: string[] = []
	let index = 0
	while (index < stream.length) {
		const remaining = stream.length - index
		const size = Math.max(1, Math.floor(rng() * remaining) + 1)
		chunks.push(stream.slice(index, index + size))
		index += size
	}
	return chunks
}

/**
 * Narrow a caught value to an {@link SSEError}, throwing (not `expect`ing) when
 * it is not one — lets a caller assert on `.code` / `.context` unconditionally
 * afterward instead of nesting `expect` inside an `if` (vitest/no-conditional-expect).
 */
export function expectSSEError(value: unknown): SSEError {
	if (!isSSEError(value)) throw new Error('expected value to be an SSEError')
	return value
}
