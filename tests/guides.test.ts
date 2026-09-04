// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest, then executes this package's flagship
// fences. The following constants, the `@src/core` and `./setup.js` imports the
// executed cases use, and the `flagship fences` block are this package's own, and are
// the parts a sibling package changes.

import { describe, expect, it } from 'vitest'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { readFileSync } from 'node:fs'
import { captureError, requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import { BOM, NUL, SSEError, SSEParser, createSSEParser, isSSEError } from '@src/core'
import { expectSSEError } from './setup.js'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({ '@orkestrel/sse': 'src/core', '@src/core': 'src/core' })
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the twin assertion fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md'])

/** The guide whose flagship fences the executed cases at the end of this file transcribe. */
const CORE_GUIDE = 'guides/sse.md'

const root = new URL('../', import.meta.url)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sources = createSourceManager({ files, modules: MODULES })

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
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

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.keyword === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			for (const fence of fences) {
				for (const { specifier, names } of extractFenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					const surface = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, surface)).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
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
	const guideText = requireValue(files[CORE_GUIDE], `Missing file: ${CORE_GUIDE}`)
	const readmeText = readFileSync(new URL('README.md', root), 'utf8')

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
