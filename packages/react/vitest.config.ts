import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			'@open-grid/core/internal': resolve(__dirname, '../core/src/internal.ts'),
			'@open-grid/core': resolve(__dirname, '../core/src/index.ts'),
		},
	},
	test: {
		environment: 'jsdom',
	},
});
