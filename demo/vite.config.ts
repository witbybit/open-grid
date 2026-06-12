import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@open-grid/react': resolve(__dirname, '../packages/react/src/index.ts'),
			'@open-grid/core/internal': resolve(__dirname, '../packages/core/src/internal.ts'),
			'@open-grid/core': resolve(__dirname, '../packages/core/src/index.ts'),
		},
		dedupe: ['react', 'react-dom'],
	},
	server: {
		port: 5173,
	},
});
