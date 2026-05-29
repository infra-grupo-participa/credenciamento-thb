import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build do front (React) -> pasta dist/, que o Express serve em produção.
// Em desenvolvimento, o Vite roda na 5173 e faz proxy de /api para o Express (3000).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
