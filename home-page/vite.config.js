import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Get HTTPS options with certificate files
function getHttpsOptions() {
  const certPath = path.join(__dirname, 'localhost.pem')
  const keyPath = path.join(__dirname, 'localhost-key.pem')
  
  // Check if certificate files exist
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      return {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      }
    } catch (error) {
      console.warn('Error reading certificate files:', error.message)
    }
  }
  
  // If certificates don't exist, return true to use Vite's auto-generated cert
  // Or you can run: ./generate-cert.sh to create proper certificates
  console.warn('Certificate files not found. Using Vite auto-generated certificate.')
  console.warn('For better compatibility, run: ./generate-cert.sh')
  return true
}

export default defineConfig({
  server: {
    host: true, // Allow access from network IP (0.0.0.0)
    // Or use specific host: '0.0.0.0' to bind to all interfaces
    port: 5173, // Default Vite port (optional, for clarity)
    // https: getHttpsOptions(), // Enable HTTPS for secure context (required for microphone access)
    allowedHosts: [
      'localhost',
      'home-page', // Docker service name
      '.local', // Allow all .local domains
    ],
    proxy: {
      // Proxy requests to the A2A server to avoid CORS issues
      // '/api/a2a': {
      //   target: 'http://localhost:9002',
      //   changeOrigin: true,
      //   rewrite: (path) => path.replace(/^\/api\/a2a/, ''),
      // },
      // Proxy HuggingFace requests to avoid CORS issues
      // '/hf': {
      //   target: 'https://huggingface.co',
      //   changeOrigin: true,
      //   rewrite: (path) => path.replace(/^\/hf/, ''),
      //   configure: (proxy, _options) => {
      //     proxy.on('proxyReq', (proxyReq, req, _res) => {
      //       // Add CORS headers
      //       proxyReq.setHeader('Origin', 'https://huggingface.co')
      //     })
      //   },
      // },
    },
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
})

