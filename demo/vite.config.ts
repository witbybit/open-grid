import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@eregister/open-grid-react': resolve(__dirname, '../packages/react/src/index.ts'),
		},
		dedupe: ['react', 'react-dom'],
	},
	server: {
		port: 5173,
	},
});
