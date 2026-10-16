import { defineConfig } from 'vite';
export default defineConfig({ build: { chunkSizeWarningLimit: 1500, target: 'es2022' }, worker: { format: 'es' } });
