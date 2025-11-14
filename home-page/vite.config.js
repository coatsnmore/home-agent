import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      // Proxy requests to the A2A server to avoid CORS issues
      '/api/a2a': {
        target: 'http://localhost:9002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/a2a/, ''),
      },
    },
  },
})

