import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	optimizeDeps: {
		exclude: ['@duckdb/duckdb-wasm']
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		server: {
			deps: {
				inline: [/svelte/]
			}
		}
	},
	resolve: {
		conditions: ['browser']
	}
});
