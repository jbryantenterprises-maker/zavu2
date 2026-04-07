import { defineConfig } from 'vite'

export default defineConfig({
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    port: 5173,
    host: true
  }
})
