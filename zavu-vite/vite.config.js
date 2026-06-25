import { defineConfig } from 'vite'

export default defineConfig({
  css: {
    postcss: './postcss.config.js',
    devSourcemap: true,
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('@trystero-p2p/firebase') || id.includes('firebase') || id.includes('trystero')) {
            return 'vendor';
          }
        }
      }
    }
  }
})
