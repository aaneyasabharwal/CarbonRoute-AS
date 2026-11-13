import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pagesBase } from './src/config/pagesBase';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under /<repository>/ (see src/config/pagesBase.ts).
  base: pagesBase(process.env),
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
