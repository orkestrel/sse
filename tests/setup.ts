// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window`: this package is core-only.
//
// Scoped to the `sse` corpus this workspace ships today (AGENTS §16.1): generic
// recorder infrastructure, extracted the moment it could serve another test.

import { afterEach, vi } from 'vitest'

afterEach(() => {
	vi.restoreAllMocks()
})

// ── Recorders (generic, environment-agnostic) ──────────────────────────────

// A real callback that records its calls — use instead of a mock when a test
// only needs to count invocations or inspect arguments.
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

export function createRecorder<
	TArgs extends readonly unknown[] = readonly unknown[],
>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler: (...args: TArgs) => {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}
