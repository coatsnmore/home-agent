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
      // Proxy HuggingFace requests to avoid CORS issues
      '/hf': {
        target: 'https://huggingface.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hf/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Add CORS headers
            proxyReq.setHeader('Origin', 'https://huggingface.co')
          })
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
})

