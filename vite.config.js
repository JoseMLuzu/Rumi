import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The browser calls Vite's /api URL; Vite forwards it to our local Flask server.
    proxy: {
      // Preserve the browser's host so Flask can compare it with Origin for CSRF.
      '/api': { target: 'http://127.0.0.1:5001', changeOrigin: false },
      // Keep the browser on one origin, including the WebSocket upgrade handshake.
      '/socket.io': { target: 'http://127.0.0.1:5001', ws: true, changeOrigin: false },
    },
  },
});
