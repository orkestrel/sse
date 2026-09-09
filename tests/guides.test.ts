// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow are this
// package's own, as is the executed section that closes the file.

import type { GuideModule } from '@orkestrel/guide'
import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** Each import specifier this package's own guides may resolve against. */
const MODULES: Readonly<Record<string, GuideModule>> = Object.freeze({
	'@orkestrel/sse': 'src/core',
	'@src/core': 'src/core',
})
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows it fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

/**
 * The one guide this package sources: its tagline the README pitch equals, and its flagship
 * fences the executed cases at the end of this file transcribe.
 */
const GUIDE_SPEC = 'guides/sse.md'

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md'],
	modules: MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, root, rows }) => {
	const { computeSymbolKey, findMissingSymbols } = await import('@orkestrel/guide')
	const { captureError, requireValue } = await import('@orkestrel/test')
	const { BOM, NUL, SSEError, SSEParser, createSSEParser, isSSEError } = await import('@src/core')
	const { expectSSEError } = await import('./setup.js')
	const { describe, expect, it } = await import('vitest')
	const own = requireValue(
		rows.find((row) => row.entry.spec === GUIDE_SPEC),
		`Missing manifest row: ${GUIDE_SPEC}`,
	)

	it('loads every indexed guide input', () => {
		expect(root.length).toBeGreaterThan(0)
		expect(Object.keys(files).length).toBeGreaterThan(0)
		expect(report.input).toEqual([])
	})

	it('manifest lists at least one guide', () => {
		expect(rows.length).toBeGreaterThan(0)
		expect(own.entry.spec).toBe(GUIDE_SPEC)
	})

	// The example half of the equality case is silent over an empty population: with no
	// title on both sides `findDrift` compares no pair and the case passes on the summaries
	// alone. This pins the population this repository's own guide contributes, so removing
	// every `@example` title reddens the suite instead of quietly retiring half the gate.
	// The failure names both title sets, because a pin reporting only its own emptiness
	// leaves the reader to work out which side dropped the title.
	it('pairs at least one example title across the guide and the source', () => {
		expect(report.examples.titles.filter((finding) => finding.spec === GUIDE_SPEC)).toEqual([])
	})

	// The README's pitch and the guide's tagline are one text, each read as the blockquote
	// under its file's H1. `README.md` is outside the concept index, so the reader is
	// applied to it directly rather than through a manifest row. Each side is guarded
	// against `undefined` first, so a file that lost its blockquote reports that rather
	// than reporting two absences as agreement.
	it('opens the README with the guide tagline', () => {
		expect(report.pitch).toEqual([])
	})

	for (const { entry, guide, source } of rows) {
		describe(`${entry.concept}`, () => {
			it('uses only listed fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('extracts a non-empty documented surface', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
			})
			it('re-exports every direct declaration that is not named internal', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
			})
			it('names no symbol internal that the barrel already exports', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
			})
			it('re-exports only direct declarations', () => {
				expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			})
			it('documents every barrel export', () => {
				expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
			})
			it('documents only barrel exports', () => {
				expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
			})

			it('exposes no hidden module-scope declarations', () => {
				expect(source.hidden().map(computeSymbolKey)).toEqual([])
			})

			it('documents a populated method group', () => {
				expect(guide.methods().filter((group) => group.methods.length === 0)).toEqual([])
			})

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			// The equality gate: a `Summary` cell against its export's description paragraph, a
			// titled fence against the `@example` of that title. `findDrift` owns the comparison
			// and names both sides; converge the two sides through the native entry, never by
			// weakening this assertion. `findDrift` pairs an example only where a title is
			// present on both sides, so an untitled `@example` block is outside this case. Each
			// collected line is the spec, the key, and each side's text or `absent` — the same
			// worklist the native entry prints, so a failure here is read the way that command's
			// output is. Select source authority with `npm run test:guides -- --to guide`, or guide
			// authority with `npm run test:guides -- --to source`.
			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(report.examples.functions.filter((finding) => finding.spec === entry.spec)).toEqual(
					[],
				)
			})

			it('documents an example for every method', () => {
				expect(report.examples.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				expect(report.imports.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('resolves every relative link', () => {
				expect(report.links.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
			it('links only to test files that exist', () => {
				expect(report.tests.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
		})
	}

	// The EXECUTED half of this file. Every check up to here reads a name — from the
	// guide text or from the barrel — and a name that resolves proves nothing about the
	// sentence beside it, so a fence whose comment claims a value the code contradicts
	// passes all of them. The cases here run each flagship fence and assert the values
	// its comments claim, each paired with a presence guard binding that fence's whole
	// body, so a line one fence shares with another cannot stand in for it. Change a
	// fence, change the transcription beside it.
	describe('flagship fences', () => {
		const guideText = requireValue(files[GUIDE_SPEC], `Missing file: ${GUIDE_SPEC}`)
		const readmeText = requireValue(files['README.md'], 'Missing file: README.md')

		it('returns the Surface fence values and clears back to a fresh stream', () => {
			const parser = createSSEParser()

			expect(parser.parse('data: a\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
			expect(parser.parse('event: ping\ndata: 1')).toEqual([])
			expect(parser.parse('\n\n')).toEqual([{ data: '1', event: 'ping' }])
			parser.clear()

			expect(parser.parse('data: fresh\n\n')).toEqual([{ data: 'fresh' }])
		})

		it('carries the Surface fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const parser = createSSEParser()\nparser.parse('data: a\\ndata: b\\n\\n') // [{ data: 'a\\nb' }] - the two data lines joined\nparser.parse('event: ping\\ndata: 1') // [] - the event is buffered until its blank line\nparser.parse('\\n\\n') // [{ data: '1', event: 'ping' }]\nparser.clear() // drop any buffered partial line / event - ready for a fresh stream",
			)
		})

		it('reads the codepoints the Constants fence claims', () => {
			expect(NUL.charCodeAt(0)).toBe(0)
			expect(BOM.charCodeAt(0)).toBe(0xfeff)
		})

		it('carries the Constants fence lines the transcription copies', () => {
			expect(guideText).toContain('NUL.charCodeAt(0) // 0\nBOM.charCodeAt(0) // 0xfeff')
		})

		it('narrows the Errors fence throw to its OVERFLOW code', () => {
			const thrown = captureError(() => {
				throw new SSEError('OVERFLOW', 'SSE parser buffer would exceed the configured limit', {
					limit: 100,
					size: 150,
				})
			})

			expect(isSSEError(thrown)).toBe(true)
			expect(expectSSEError(thrown).code).toBe('OVERFLOW')
		})

		it('carries the Errors fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"try {\n\tthrow new SSEError('OVERFLOW', 'SSE parser buffer would exceed the configured limit', {\n\t\tlimit: 100,\n\t\tsize: 150,\n\t})\n} catch (error) {\n\tif (isSSEError(error)) error.code // 'OVERFLOW'\n}",
			)
		})

		it('returns the Factories fence values from a parser built with a limit', () => {
			const parser = createSSEParser({ limit: 1_000_000 })

			expect(parser.parse('data: a\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
			expect(parser.parse('event: ping\ndata: 1')).toEqual([])
			expect(parser.parse('\n\n')).toEqual([{ data: '1', event: 'ping' }])
		})

		it('carries the Factories fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const parser = createSSEParser({ limit: 1_000_000 })\nparser.parse('data: a\\ndata: b\\n\\n') // [{ data: 'a\\nb' }] - the two data lines joined\nparser.parse('event: ping\\ndata: 1') // [] - buffered until its blank line\nparser.parse('\\n\\n') // [{ data: '1', event: 'ping' }]",
			)
		})

		it('returns the Methods fence values from the class the guide constructs', () => {
			const parser = new SSEParser()

			expect(parser.parse('data: a\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
			expect(parser.parse('event: ping\ndata: 1')).toEqual([])
			expect(parser.parse('\n\n')).toEqual([{ data: '1', event: 'ping' }])
			// The fence's `clear()` comment claims the persisted id/retry go with the buffer,
			// so the sticky state is in place before the call that claims to drop it.
			expect(parser.parse('id: 9\ndata: q\n\n')).toEqual([{ data: 'q', id: '9' }])
			parser.clear()

			expect(parser.id).toBeUndefined()
			expect(parser.parse('data: fresh\n\n')).toEqual([{ data: 'fresh' }])
		})

		it('carries the Methods fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const parser = new SSEParser()\nparser.parse('data: a\\ndata: b\\n\\n') // [{ data: 'a\\nb' }] - the two data lines joined\nparser.parse('event: ping\\ndata: 1') // [] - the event is buffered until its blank line\nparser.parse('\\n\\n') // [{ data: '1', event: 'ping' }]\nparser.clear() // drop any buffered partial line / event / persisted id/retry - ready for a fresh stream\nparser.parse('data: fresh\\n\\n') // [{ data: 'fresh' }]",
			)
		})

		it('buffers the flush fence line, then forces it out at end-of-stream', () => {
			const parser = new SSEParser()

			expect(parser.parse('data: incomplete')).toEqual([])
			expect(parser.flush()).toEqual([{ data: 'incomplete' }])
		})

		it('carries the flush fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const parser = new SSEParser()\nparser.parse('data: incomplete') // [] - no blank line yet, buffered\nparser.flush() // [{ data: 'incomplete' }] - forced out at end-of-stream",
			)
		})

		it('persists the sticky fence id and retry across dispatch, until clear drops them', () => {
			const parser = new SSEParser()

			expect(parser.id).toBeUndefined()
			expect(parser.parse('id: 42\nretry: 3000\ndata: x\n\n')).toEqual([
				{ data: 'x', id: '42', retry: 3000 },
			])
			expect(parser.id).toBe('42')
			expect(parser.retry).toBe(3000)
			parser.clear()

			expect(parser.id).toBeUndefined()
		})

		it('carries the sticky fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const parser = new SSEParser()\nparser.id // undefined - no id: field seen yet\nparser.parse('id: 42\\nretry: 3000\\ndata: x\\n\\n') // [{ data: 'x', id: '42', retry: 3000 }]\nparser.id // '42' - persisted, survives dispatch\nparser.retry // 3000 - persisted, survives dispatch\nparser.clear()\nparser.id // undefined - clear() drops sticky state",
			)
		})

		it('throws the limit fence OVERFLOW for a chunk past the configured limit', () => {
			const parser = new SSEParser({ limit: 10 })

			const thrown = captureError(() => parser.parse('x'.repeat(20)))

			expect(isSSEError(thrown)).toBe(true)
			expect(expectSSEError(thrown).code).toBe('OVERFLOW')
		})

		it('carries the limit fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const parser = new SSEParser({ limit: 10 })\ntry {\n\tparser.parse('x'.repeat(20))\n} catch (error) {\n\tif (isSSEError(error) && error.code === 'OVERFLOW') parser.clear()\n}",
			)
		})

		it('returns the README usage fence values, its sticky id included', () => {
			const parser = createSSEParser({ limit: 1_000_000 })

			expect(parser.parse('data: a\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
			expect(parser.parse('event: ping\nid: 7\ndata: 1')).toEqual([])
			expect(parser.parse('\n\n')).toEqual([{ data: '1', event: 'ping', id: '7' }])
			expect(parser.id).toBe('7')
			expect(parser.retry).toBeUndefined()

			const thrown = captureError(() => parser.parse('x'.repeat(2_000_000)))

			expect(expectSSEError(thrown).code).toBe('OVERFLOW')
			parser.clear()

			expect(parser.flush()).toEqual([])
		})

		it('carries the README usage fence lines the transcription copies', () => {
			expect(readmeText).toContain(
				"const parser = createSSEParser({ limit: 1_000_000 })\nparser.parse('data: a\\ndata: b\\n\\n') // [{ data: 'a\\nb' }] - the two data lines joined\nparser.parse('event: ping\\nid: 7\\ndata: 1') // [] - buffered until its blank line\nparser.parse('\\n\\n') // [{ data: '1', event: 'ping', id: '7' }]\n\nparser.id // '7' - sticky last-event-id, survives dispatch\nparser.retry // undefined - sticky reconnection time, until a retry: field arrives\n\ntry {\n\tparser.parse('x'.repeat(2_000_000))\n} catch (error) {\n\tif (isSSEError(error) && error.code === 'OVERFLOW') parser.clear()\n}\n\nparser.flush() // force out a trailing unterminated event at end-of-stream\nparser.clear() // drops buffered state and sticky id/retry",
			)
		})
	})
})
