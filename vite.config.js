import { defineConfig } from 'vite';

// base relativa: el build funciona en GitHub Pages (/CITY-LIFE/) y en cualquier carpeta.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
