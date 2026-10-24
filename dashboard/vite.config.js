import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, /api is proxied to a locally running `python -m konu_crawlers serve`.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.KONU_API_URL || 'http://127.0.0.1:8000' } },
  preview: { proxy: { '/api': process.env.KONU_API_URL || 'http://127.0.0.1:8000' } },
})
