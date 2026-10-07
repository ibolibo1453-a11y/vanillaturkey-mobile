import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'app-renderer', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173 }
})
