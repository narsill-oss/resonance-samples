import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dir = path.dirname(fileURLToPath(import.meta.url));

// The apps are copied unchanged from the Resonance site; `@shared` points at the two small
// helpers they use there (page title, site links).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(dir, 'src/site') } },
  server: { port: 5173 },
});
