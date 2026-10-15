import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // In development the backend runs on port 3000; in production nginx forwards /api to it.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
