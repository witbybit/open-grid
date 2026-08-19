import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: [
			{
				find: '@eregister/open-grid-core/experimental',
				replacement: resolve(__dirname, '../packages/core/src/experimental.ts'),
			},
			{
				find: '@eregister/open-grid-core/internal',
				replacement: resolve(__dirname, '../packages/core/src/internal.ts'),
			},
			{
				find: '@eregister/open-grid-core',
				replacement: resolve(__dirname, '../packages/core/src/index.ts'),
			},
			{
				find: '@eregister/open-grid-react/experimental',
				replacement: resolve(__dirname, '../packages/react/src/experimental.ts'),
			},
			{
				find: '@eregister/open-grid-react',
				replacement: resolve(__dirname, '../packages/react/src/index.ts'),
			},
		],
		dedupe: ['react', 'react-dom'],
	},
	server: {
		port: 5173,
	},
});
