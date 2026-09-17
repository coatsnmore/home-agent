import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/agent': {
        target: process.env.VITE_AGENT_PROXY || 'http://localhost:9002',
        changeOrigin: true,
        ws: true,
      },
      '/invocations': {
        target: process.env.VITE_AGENT_PROXY || 'http://localhost:9002',
        changeOrigin: true,
        ws: true,
      },
      '/ping': {
        target: process.env.VITE_AGENT_PROXY || 'http://localhost:9002',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_AGENT_PROXY || 'http://localhost:9002',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.VITE_AGENT_PROXY || 'http://localhost:9002',
        changeOrigin: true,
      },
      '/mcp': {
        target: process.env.VITE_MCP_PROXY || 'http://localhost:8888',
        changeOrigin: true,
      },
      '/tts': {
        target: process.env.VITE_TTS_PROXY || 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tts/, ''),
      },
    },
  },
})
