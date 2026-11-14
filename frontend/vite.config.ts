import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { pagesBase } from './src/config/pagesBase';
import { validateBuildApiUrl } from './src/config/apiUrl';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // P8 (B7): fail the build instead of shipping a bundle that calls a missing or retired backend.
  // Vite also reads VITE_* values from frontend/.env* files (git-ignored, so invisible in review);
  // they are checked too. Shell variables take precedence over the files, as in Vite itself.
  validateBuildApiUrl({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env });

  return {
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
  };
});
