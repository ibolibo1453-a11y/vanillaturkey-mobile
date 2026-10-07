import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const launcher = path.resolve(here, '../../launcher')
// VT_PLATFORM=ios builds into the Amethyst-iOS resources (copied into the .app by its Makefile as /vtui); default = Android assets
const ios = process.env.VT_PLATFORM === 'ios'
const version = JSON.parse(fs.readFileSync(path.resolve(here, 'app-version.json'), 'utf8')).version

export default defineConfig({
  base: './',
  plugins: [
    {
      // the cinematic mp4 background is far too heavy for phones: still-image background instead
      name: 'vt-mobile-bg', enforce: 'pre',
      async resolveId(source, importer, opts) {
        if (/(^|\/)LoginBg$/.test(source) && importer && importer.replace(/\\/g, '/').includes('/launcher/src/')) return path.resolve(here, 'src/LoginBgMobile.tsx')
        return null
      }
    },
    react()
  ],
  define: { __VT_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@launcher': path.resolve(launcher, 'src'),
    },
    dedupe: ['react', 'react-dom', 'lucide-react', 'livekit-client', 'three']
  },
  server: { port: 5190, fs: { allow: [path.resolve(here, '..', '..')] } },
  build: { target: ios ? ['safari15'] : ['chrome100'], cssTarget: ios ? ['safari15'] : ['chrome100'], outDir: ios ? path.resolve(here, '../../ios/amethyst/Natives/resources/vtui') : path.resolve(here, '../launcher-src/ZalithLauncher/src/main/assets/vtui'), emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 4000, modulePreload: { polyfill: false } }
})
