// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window`: this package is core-only.
//
// SSE corpus helpers shared by this workspace's suites: the wire constants and the
// chunk-partitioning leaves.

import type { SSEError, SSEEvent, SSEParserInterface } from '@src/core'
import { isSSEError } from '@src/core'
import { afterEach, vi } from 'vitest'

class SSEChunks {
	readonly #stream: string
	readonly #size: (remaining: number) => number
	#index = 0

	constructor(stream: string, size: (remaining: number) => number) {
		this.#stream = stream
		this.#size = size
	}

	*[Symbol.iterator](): Generator<string> {
		while (this.#index < this.#stream.length) {
			const size = this.#size(this.#stream.length - this.#index)
			const chunk = this.#stream.slice(this.#index, this.#index + size)
			this.#index += size
			yield chunk
		}
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

// ── SSE line-terminator and whitespace constants (shared) ─────

// Control bytes spelled as codepoints so the raw wire content is unambiguous
// in source (a literal `'\r'` is identical, but the codepoint removes doubt).
export const LF = String.fromCharCode(10)
export const CR = String.fromCharCode(13)
export const tabulation = String.fromCharCode(9)

// ── SSEParser corpus-partitioning helpers (generic, environment-agnostic) ──

/**
 * Feeds every chunk in `chunks` to `parser.parse(...)` in order and flattens
 * the dispatched events into a single array.
 */
export function feedAll(
	parser: SSEParserInterface,
	chunks: readonly string[],
): readonly SSEEvent[] {
	return Iterator.from(chunks)
		.flatMap((chunk) => parser.parse(chunk))
		.toArray()
}

/**
 * Returns `stream` cut into consecutive slices of `size` characters, with one
 * empty slice for an empty stream so a caller always receives a chunk to feed.
 */
export function sliceStream(stream: string, size: number): readonly string[] {
	return stream.length === 0 ? [''] : Array.from(new SSEChunks(stream, () => size))
}

/**
 * Splits `stream` into a fixed set of chunk sequences for partition-invariance
 * testing: one sequence per fixed size in `sizes` (default `{1,2,3,5,7,13,len}`)
 * plus every two-way single-cut split (`stream.slice(0, cut)` /
 * `stream.slice(cut)` for every `cut` from `0` to `stream.length`).
 */
export function chunkings(
	stream: string,
	sizes: readonly number[] = [1, 2, 3, 5, 7, 13, stream.length],
): ReadonlyArray<readonly string[]> {
	return [
		...Iterator.from(sizes).map((size) => [...sliceStream(stream, size)]),
		...Array.from({ length: stream.length + 1 }, (_, cut) => [
			stream.slice(0, cut),
			stream.slice(cut),
		]),
	]
}

/**
 * Splits `stream` into a random sequence of non-empty chunks driven by `rng`
 * (for example {@link seededRandom} from `@orkestrel/contract`) — every call
 * consumes at least one character, so it always terminates.
 */
export function partition(stream: string, rng: () => number): readonly string[] {
	return Array.from(
		new SSEChunks(stream, (remaining) => Math.max(1, Math.floor(rng() * remaining) + 1)),
	)
}

/**
 * Narrows a caught value to an {@link SSEError}, throwing (not `expect`ing) when
 * it is not one — lets a caller assert on `.code` / `.context` unconditionally
 * afterward instead of nesting `expect` inside an `if` (vitest/no-conditional-expect).
 */
export function expectSSEError(value: unknown): SSEError {
	if (!isSSEError(value)) throw new Error('expected value to be an SSEError')
	return value
}
