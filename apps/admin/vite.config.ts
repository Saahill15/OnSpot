import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Consume @onspot/shared from TypeScript source so the console always matches the API's catalog and pricing.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@onspot/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
});
