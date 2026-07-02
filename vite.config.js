import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Build do front (React) -> pasta dist/, servida pelo Express em produção.
// Em dev, o Vite roda na 5173 e faz proxy de /api para o Express (3000).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['thb-logo.png'],
      manifest: {
        name: 'Credenciamento THB',
        short_name: 'Credenciamento',
        description: 'Credenciamento de eventos — Time Holding Brasil',
        theme_color: '#ef7c00',
        background_color: '#f4f5f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/thb-logo.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/thb-logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/thb-logo.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
        navigateFallback: '/index.html',
        // /qr e /qrimg são páginas do servidor (QR público) — o SW não pode
        // respondê-las com o index.html do app.
        navigateFallbackDenylist: [/^\/api/, /^\/qr\//, /^\/qrimg\//, /^\/health/],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Fontes do Google cacheadas no aparelho: abre rápido e funciona offline.
        runtimeCaching: [{
          urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'google-fonts',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }],
      },
    }),
  ],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
