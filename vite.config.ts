import type { UserConfig } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import tsconfig from './tsconfig.json' with { type: 'json' }
import { fileURLToPath, URL } from 'node:url'

export function resolveWorkspacePath(relativePath: string): string {
	return fileURLToPath(new URL(relativePath, import.meta.url))
}

const resolve = {
	alias: Object.entries(tsconfig.compilerOptions.paths).reduce(
		(a, [k, v]) => Object.assign(a, { [k]: resolveWorkspacePath(v[0]) }),
		// Node's package self-reference resolves `@orkestrel/workflow` only from modules
		// INSIDE this package — the installed `@orkestrel/agent` dist imports it back
		// (the two packages are mutually dependent), and from node_modules that name has
		// nothing to resolve to inside this repo. Alias it to the local core entry so
		// test runs exercise the mutual dependency against THIS checkout's source.
		{ '@orkestrel/workflow': resolveWorkspacePath('src/core/index.ts') },
	),
}

// Base: shared resolve + build defaults + src:core tests.
export const srcCore = (config?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			build: {
				emptyOutDir: true,
				sourcemap: true,
				minify: false,
			},
			test: {
				name: { label: 'src:core', color: 'magenta' },
				include: ['tests/src/core/**/*.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
				// Vitest externalizes node_modules to plain Node resolution, which cannot
				// self-reference `@orkestrel/workflow` from inside `@orkestrel/agent` (see the
				// alias above) — inline agent so its imports resolve through Vite instead.
				server: { deps: { inline: ['@orkestrel/agent'] } },
			},
		},
		config ?? {},
	)

// Extends srcCore: the guides-parity suite. Node env — it reads the real
// guides/*.md and the documented source modules off disk — but resolves like core tests.
export const guides = (config?: UserConfig): UserConfig =>
	srcCore(
		mergeConfig(
			{
				test: {
					name: { label: 'guides', color: 'green' },
					include: ['tests/guides/**/*.test.ts'],
					exclude: ['tests/src/**/*.test.ts', 'tests/setup.test.ts'],
				},
			},
			config ?? {},
		),
	)


export default defineConfig({
	resolve,
	test: {
		projects: [srcCore, guides],
	},
})
