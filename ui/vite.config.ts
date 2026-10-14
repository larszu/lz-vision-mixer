import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ENGINE=http://127.0.0.1:4295 points the dev server at a mock on another port.
const engine = process.env.ENGINE ?? 'http://127.0.0.1:4195'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 4196,
    strictPort: true,
    proxy: {
      '/ws': { target: engine, ws: true },
      '/api': engine,
      '/mjpeg': engine,
    },
  },
})
