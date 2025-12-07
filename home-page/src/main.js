import './style.css'
import { A2AClient } from '@a2a-js/sdk/client'
// Note: @xenova/transformers is imported dynamically in initializeSTT()

// Generate UUID using browser's crypto API with fallback
function uuidv4() {
  // Use native crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  
  // Fallback: Use crypto.getRandomValues if available (more secure)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    // Set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // Variant 10
    
    // Convert to UUID string format
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-')
  }
  
  // Final fallback: Use Math.random (less secure, but works everywhere)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Filter out harmless ONNX Runtime warnings about unused initializers
const originalWarn = console.warn
console.warn = function(...args) {
  const message = args.join(' ')
  // Suppress ONNX Runtime warnings about unused initializers (harmless optimization warnings)
  if (message.includes('CleanUnusedInitializersAndNodeArgs') || 
      message.includes('Removing initializer') ||
      message.includes('It is not used by any node')) {
    return // Suppress these warnings
  }
  originalWarn.apply(console, args)
}

// Initialize A2A client - connect to home agent on port 9001
let a2aClient = null

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('ServiceWorker registration successful:', registration.scope)
      })
      .catch((error) => {
        console.log('ServiceWorker registration failed:', error)
      })
  })
}

// Chat interface state
let contextId = null
let isConnected = false

// DOM elements
const app = document.querySelector('#app')
const chatContainer = document.createElement('div')
const messagesContainer = document.createElement('div')
const inputContainer = document.createElement('div')
const messageInput = document.createElement('input')
const submitButton = document.createElement('button')
const micButton = document.createElement('button')
const ttsButton = document.createElement('button')
const statusIndicator = document.createElement('div')

// Setup UI
chatContainer.className = 'chat-container'
messagesContainer.className = 'messages-container'
inputContainer.className = 'input-container'
messageInput.type = 'text'
messageInput.placeholder = 'Type your message or use microphone...'
messageInput.className = 'message-input'
submitButton.textContent = 'Send'
submitButton.className = 'submit-button'
micButton.innerHTML = '🎤'
micButton.className = 'mic-button'
micButton.title = 'Start voice input'
ttsButton.innerHTML = '🔇'
ttsButton.className = 'tts-button'
ttsButton.title = 'Enable text-to-speech (click to toggle)'
statusIndicator.className = 'status-indicator'

inputContainer.appendChild(micButton)
inputContainer.appendChild(messageInput)
inputContainer.appendChild(submitButton)
inputContainer.appendChild(ttsButton)
chatContainer.appendChild(statusIndicator)
chatContainer.appendChild(messagesContainer)
chatContainer.appendChild(inputContainer)
app.appendChild(chatContainer)

// Add welcome message
function addMessage(text, isUser = false) {
  const messageDiv = document.createElement('div')
  messageDiv.className = `message ${isUser ? 'user-message' : 'agent-message'}`
  messageDiv.textContent = text
  messagesContainer.appendChild(messageDiv)
  messagesContainer.scrollTop = messagesContainer.scrollHeight
  
  // Auto-speak agent messages if TTS is enabled
  if (!isUser && ttsEnabled && ttsInitialized && text.trim()) {
    speakText(text)
  }
}

// Update connection status
function updateStatus(connected) {
  isConnected = connected
  statusIndicator.textContent = connected ? '🟢 Connected' : '🔴 Disconnected'
  statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`
  submitButton.disabled = !connected
  messageInput.disabled = !connected
}

// Use proxy in development to avoid CORS issues
const isDevelopment = import.meta.env.DEV

// Detect if we're being served over HTTPS (via nginx proxy)
const isHttps = window.location.protocol === 'https:'
const baseUrl = isHttps 
  ? window.location.origin  // Use current origin (https://localhost)
  : window.location.origin

// Agent card URL - use nginx proxy path when served over HTTPS
const agentCardUrl = isHttps
  ? '/hubitat/.well-known/agent-card.json'  // Use nginx HTTPS proxy
  : 'http://localhost:9001/.well-known/agent-card.json'  // Direct HTTP for local development

// Server URLs that need to be proxied
const actualServerUrls = [
  'http://localhost:9002',
  'http://127.0.0.1:9002',
  'http://localhost:9001',
  'http://127.0.0.1:9001'
]


// Create a custom fetch that routes through proxy to avoid mixed content
function createProxiedFetch() {
  // Always use proxy when served over HTTPS to avoid mixed content issues
  return async (url, options = {}) => {
    let urlString = ''
    
    // Extract URL string from different input types
    if (typeof url === 'string') {
      urlString = url
    } else if (url instanceof Request) {
      urlString = url.url
    } else if (url instanceof URL) {
      urlString = url.toString()
    } else {
      urlString = String(url)
    }
    
    // If already a relative URL or HTTPS, use as-is
    if (urlString.startsWith('/') || urlString.startsWith('https://')) {
      return fetch(urlString, options)
    }
    
    // Check if URL matches any A2A server and replace with HTTPS proxy
    let proxiedUrl = urlString
    
    // Replace 0.0.0.0 with localhost first (0.0.0.0 is a binding address, not a valid URL)
    if (urlString.includes('0.0.0.0')) {
      proxiedUrl = urlString.replace(/http:\/\/0\.0\.0\.0:/g, 'http://localhost:')
      console.log(`[Proxy] Replaced 0.0.0.0 with localhost: ${urlString} → ${proxiedUrl}`)
    }
    
    // When served over HTTPS, proxy HTTP requests through nginx
    if (isHttps) {
      // Check for HTTP URLs that need to be proxied
      let wasProxied = false
      for (const serverUrl of actualServerUrls) {
        if (proxiedUrl.startsWith(serverUrl)) {
          // Replace HTTP server URL with nginx HTTPS proxy path
          proxiedUrl = proxiedUrl.replace(serverUrl, '/agent')
          wasProxied = true
          console.log(`[Proxy] Routing HTTPS: ${urlString} → ${proxiedUrl}`)
          break
        }
      }
      
      // Also handle Docker service names or other HTTP URLs that might appear
      // (e.g., from agent card that returns http://hubitat-agent:9002)
      if (!wasProxied && proxiedUrl.startsWith('http://')) {
        // Check if it's a local/internal URL that should be proxied
        const urlObj = new URL(proxiedUrl)
        // If it's localhost, 127.0.0.1, or a Docker service name, proxy it
        if (urlObj.hostname === 'localhost' || 
            urlObj.hostname === '127.0.0.1' ||
            urlObj.hostname.includes('hubitat-agent') ||
            urlObj.hostname.includes('hubitat-mcp') ||
            urlObj.port === '9002' || urlObj.port === '9001') {
          // Extract the path and proxy through nginx
          const path = urlObj.pathname + urlObj.search + urlObj.hash
          proxiedUrl = '/agent' + path
          console.log(`[Proxy] Routing HTTPS (internal): ${urlString} → ${proxiedUrl}`)
        }
      }
    } else {
      // In HTTP development, use Vite proxy if available
      for (const serverUrl of actualServerUrls) {
        if (proxiedUrl.startsWith(serverUrl)) {
          proxiedUrl = proxiedUrl.replace(serverUrl, '/api/a2a')
          console.log(`[Proxy] Routing HTTP: ${urlString} → ${proxiedUrl}`)
          break
        }
      }
    }
    
    // If we need to proxy and the original was a Request, extract all properties
    if (proxiedUrl !== urlString && url instanceof Request) {
      const clonedRequest = url.clone()
      const headers = new Headers(clonedRequest.headers)
      
      // Try to get the body
      let body = null
      try {
        if (clonedRequest.body) {
          const contentType = clonedRequest.headers.get('content-type') || ''
          if (contentType.includes('application/json') || contentType.includes('text/')) {
            body = await clonedRequest.text()
          } else {
            body = await clonedRequest.arrayBuffer()
          }
        }
      } catch (e) {
        console.warn('Could not read request body:', e)
      }
      
      return fetch(proxiedUrl, {
        method: clonedRequest.method,
        headers: headers,
        body: body,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-cache',
        redirect: clonedRequest.redirect,
        ...options
      })
    }
    
    // For string URLs or if no proxy needed
    return fetch(proxiedUrl, options)
  }
}

// Initialize connection
async function initializeConnection() {
  try {
    updateStatus(false)
    addMessage('Connecting to Hubitat Agent...', false)
    
    // Test connection (skip proxy test when using nginx HTTPS proxy)
    if (isDevelopment && !isHttps) {
      addMessage('Testing proxy connection...', false)
      try {
        const testResponse = await fetch('/api/a2a/.well-known/agent-card.json')
        if (!testResponse.ok) {
          throw new Error(`Proxy test failed: HTTP ${testResponse.status}`)
        }
        addMessage('Proxy is working!', false)
      } catch (proxyError) {
        console.error('Proxy test failed:', proxyError)
        addMessage('Warning: Proxy test failed. Make sure Vite dev server is running and vite.config.js is loaded.', false)
        throw new Error('Proxy not available. Please restart the Vite dev server.')
      }
    }
    
    // Create client from agent card URL with custom fetch for proxy support
    addMessage('Fetching agent card from: ' + agentCardUrl, false)
    const customFetch = createProxiedFetch()
    a2aClient = await A2AClient.fromCardUrl(agentCardUrl, { fetchImpl: customFetch })
    
    updateStatus(true)
    addMessage('Connected! You can now chat with the Hubitat Agent.', false)
  } catch (error) {
    console.error('Failed to connect:', error)
    updateStatus(false)
    let errorMessage = error.message
    if (error.message.includes('Failed to fetch') || error.message.includes('Proxy not available')) {
      errorMessage = 'Failed to connect:\n' +
        '1. Make sure the A2A server is running on: ' + agentCardUrl + '\n' +
        '2. If in development, restart the Vite dev server (npm run dev)\n' +
        '3. Check browser console for more details'
    }
    addMessage(`Failed to connect: ${errorMessage}`, false)
  }
}

// Send message to agent
async function sendMessage() {
  const messageText = messageInput.value.trim()
  if (!messageText || !isConnected || !a2aClient) return

  // Add user message to UI
  addMessage(messageText, true)
  messageInput.value = ''
  submitButton.disabled = true
  messageInput.disabled = true

  try {
    // Create message object
    const message = {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: messageText }],
      kind: 'message',
    }

    // Add contextId if we have one from a previous conversation
    if (contextId) {
      message.contextId = contextId
    }

    // Try streaming first
    try {
      const stream = a2aClient.sendMessageStream({ message })
      let fullResponse = ''
      let responseDiv = document.createElement('div')
      responseDiv.className = 'message agent-message streaming'
      messagesContainer.appendChild(responseDiv)

      for await (const event of stream) {
        if (event.kind === 'message') {
          // Extract text from message parts
          const textParts = event.parts.filter(p => p.kind === 'text')
          if (textParts.length > 0) {
            const newText = textParts.map(p => p.text).join('')
            fullResponse += newText
            responseDiv.textContent = fullResponse
            messagesContainer.scrollTop = messagesContainer.scrollHeight
          }
          // Store contextId for conversation continuity
          if (event.contextId) {
            contextId = event.contextId
          }
        } else if (event.kind === 'task') {
          // Handle task creation - extract text from task history
          if (event.contextId) {
            contextId = event.contextId
          }
          
          // Extract text from task history messages
          if (event.history && Array.isArray(event.history)) {
            const historyText = event.history
              .filter(msg => msg.kind === 'message' && msg.role === 'agent')
              .map(msg => {
                const parts = msg.parts || []
                return parts
                  .filter(p => p.kind === 'text')
                  .map(p => p.text)
                  .join('')
              })
              .join('\n')
            
            if (historyText) {
              fullResponse = historyText
              responseDiv.textContent = fullResponse
              messagesContainer.scrollTop = messagesContainer.scrollHeight
            }
          }
          
          // Also check for artifacts in the task
          if (event.artifacts && Array.isArray(event.artifacts)) {
            const artifactTexts = event.artifacts
              .map(artifact => {
                const parts = artifact.parts || []
                return parts
                  .filter(p => p.kind === 'text')
                  .map(p => p.text)
                  .join('')
              })
              .filter(text => text.length > 0)
              .join('\n\n')
            
            if (artifactTexts) {
              fullResponse = fullResponse ? `${fullResponse}\n\n${artifactTexts}` : artifactTexts
              responseDiv.textContent = fullResponse
              messagesContainer.scrollTop = messagesContainer.scrollHeight
            }
          }
        } else if (event.kind === 'status-update') {
          // Status updates - don't overwrite, just append if there's new info
          if (event.status && event.status.state === 'completed' && fullResponse) {
            // Keep existing response, just update status indicator
            responseDiv.className = 'message agent-message' // Remove streaming class
          }
        } else if (event.kind === 'artifact-update') {
          // Handle artifact updates - append to response
          const artifactText = event.artifact.parts
            .filter(p => p.kind === 'text')
            .map(p => p.text)
            .join('')
          
          if (artifactText) {
            fullResponse = fullResponse ? `${fullResponse}\n\n${artifactText}` : artifactText
            responseDiv.textContent = fullResponse
            messagesContainer.scrollTop = messagesContainer.scrollHeight
          }
        }
      }
      
      // Remove streaming class when done
      if (responseDiv) {
        responseDiv.className = 'message agent-message'
        // Speak the final response if TTS is enabled
        if (fullResponse && ttsEnabled && ttsInitialized) {
          speakText(fullResponse)
        }
      }
    } catch (streamError) {
      // If streaming fails, fall back to non-streaming
      console.log('Streaming not available, using non-streaming:', streamError)
      const response = await a2aClient.sendMessage({ message })
      
      if (a2aClient.isErrorResponse(response)) {
        addMessage(`Error: ${response.error.message}`, false)
        return
      }

      const result = response.result
      if (result.kind === 'message') {
        const textParts = result.parts.filter(p => p.kind === 'text')
        const responseText = textParts.map(p => p.text).join('')
        addMessage(responseText || 'No response received', false)
        if (result.contextId) {
          contextId = result.contextId
        }
      } else if (result.kind === 'task') {
        // Extract text from task history and artifacts
        let taskText = ''
        
        // Get text from task history (agent messages)
        if (result.history && Array.isArray(result.history)) {
          const historyText = result.history
            .filter(msg => msg.kind === 'message' && msg.role === 'agent')
            .map(msg => {
              const parts = msg.parts || []
              return parts
                .filter(p => p.kind === 'text')
                .map(p => p.text)
                .join('')
            })
            .filter(text => text.length > 0)
            .join('\n')
          
          if (historyText) {
            taskText = historyText
          }
        }
        
        // Get text from artifacts
        if (result.artifacts && Array.isArray(result.artifacts)) {
          const artifactTexts = result.artifacts
            .map(artifact => {
              const parts = artifact.parts || []
              return parts
                .filter(p => p.kind === 'text')
                .map(p => p.text)
                .join('')
            })
            .filter(text => text.length > 0)
            .join('\n\n')
          
          if (artifactTexts) {
            taskText = taskText ? `${taskText}\n\n${artifactTexts}` : artifactTexts
          }
        }
        
        // Display the text or fallback to status
        if (taskText) {
          addMessage(taskText, false)
        } else {
          addMessage(`Task ${result.id}: ${result.status.state}`, false)
        }
        
        if (result.contextId) {
          contextId = result.contextId
        }
      }
    }
  } catch (error) {
    console.error('Error sending message:', error)
    addMessage(`Error: ${error.message}`, false)
  } finally {
    submitButton.disabled = false
    messageInput.disabled = false
    messageInput.focus()
  }
}

// Event listeners
submitButton.addEventListener('click', sendMessage)
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

// ===== Speech-to-Text Integration using Whisper (Offline) =====
let asr = null
let rec = false
let buffers = []
let ctx, src, proc, stream
let lastSpeechTS = 0

// ===== Text-to-Speech Integration (Offline) =====
let tts = null
let ttsInitialized = false
let ttsEnabled = false
let ttsAudioContext = null
let ttsIsSpeaking = false
let ttsQueue = []

// Tunables (from original code)
const MIN_SEG_SECONDS = 1.0
const MIN_RMS = 0.001
const VAD_RMS = 0.008
const VAD_SILENCE_MS = 2000

// Helpers (from original code)
function resample(data, from, to = 16000) {
  if (from === to) return data
  const ratio = to / from
  const out = new Float32Array(Math.floor(data.length * ratio))
  for (let i = 0; i < out.length; i++) {
    const idx = i / ratio
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, data.length - 1)
    out[i] = data[i0] + (data[i1] - data[i0]) * (idx - i0)
  }
  return out
}

const rms = a => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / (a.length || 1))
}

// Initialize Whisper model
async function initializeSTT() {
  try {
    addMessage('Loading speech recognition model... (this may take a moment)', false)
    micButton.innerHTML = '⏳'
    micButton.title = 'Loading speech recognition model...'
    console.log('Starting Whisper model load...')
    console.log('Checking for transformers:', {
      transformersReady: window.transformersReady,
      transformersPipeline: typeof window.transformersPipeline
    })
    
    // Try to load from CDN dynamically if not already loaded
    if (!window.transformersPipeline) {
      console.log('Transformers not found in window, loading from CDN...')
      try {
        // https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js
        const transformersModule = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js")
        window.transformersPipeline = transformersModule.pipeline
        window.transformersEnv = transformersModule.env
        window.transformersTensor = transformersModule.Tensor
        window.transformersReady = true
        console.log('Successfully loaded transformers from CDN')
      } catch (cdnError) {
        console.error('CDN import failed:', cdnError)
        throw new Error(`Failed to load transformers from CDN: ${cdnError.message}`)
      }
    }
    
    // Wait a bit more if still not ready
    let waitCount = 0
    while (!window.transformersReady && waitCount < 50) {
      await new Promise(resolve => setTimeout(resolve, 100))
      waitCount++
    }
    
    if (!window.transformersPipeline) {
      throw new Error('Transformers pipeline not available after loading attempt')
    }
    
    const pipeline = window.transformersPipeline
    const env = window.transformersEnv
    
    // Configure transformers environment for better compatibility
    if (env) {
      // Configure to use HuggingFace through proxy in development
      env.allowLocalModels = false
      if (import.meta.env.DEV) {
        // In development, use Vite proxy to avoid CORS
        env.remoteURL = '/hf'
        console.log('Using Vite proxy for HuggingFace in development')
      } else {
        // In production, use HuggingFace directly
        env.remoteURL = 'https://huggingface.co'
      }
      console.log('Transformers environment configured:', {
        remoteURL: env.remoteURL,
        allowLocalModels: env.allowLocalModels
      })
    }
    
    console.log('Pipeline obtained, loading Whisper model...')
    console.log('This may take a moment on first load as the model downloads...')
    console.log('Model will be cached for offline use after first download')
    
    // Load the model - use quantized version for faster download and smaller size
    // The model files will be cached in IndexedDB for offline use
    try {
      asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
        quantized: true, // Use quantized model (smaller, faster)
      })
    } catch (quantizedError) {
      console.warn('Quantized model failed, trying non-quantized:', quantizedError)
      // Fallback to non-quantized if quantized fails
      asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
        quantized: false,
      })
    }
    
    console.log('Whisper model loaded successfully')
    addMessage('Speech recognition ready! Click the microphone to start.', false)
  micButton.disabled = false
  micButton.innerHTML = '🎤'
  micButton.title = 'Start voice input'
  } catch (error) {
    console.error('Failed to load STT model:', error)
    console.error('Error details:', error.stack)
    addMessage(`Speech recognition unavailable: ${error.message}. You can still type messages.`, false)
    micButton.disabled = true
    micButton.innerHTML = '🎤'
    micButton.title = 'Speech recognition unavailable'
  }
}

// Initialize TTS model using transformers.js (fully offline)
async function initializeTTS() {
  if (ttsInitialized) return
  
  try {
    addMessage('Loading text-to-speech model... (this may take a moment)', false)
    ttsButton.innerHTML = '⏳'
    ttsButton.title = 'Loading TTS model...'
    console.log('Initializing TTS model...')
    
    // Ensure transformers is loaded
    if (!window.transformersPipeline) {
      console.log('Transformers not loaded yet, waiting...')
      let waitCount = 0
      while (!window.transformersPipeline && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100))
        waitCount++
      }
      if (!window.transformersPipeline) {
        throw new Error('Transformers pipeline not available')
      }
    }
    
    const pipeline = window.transformersPipeline
    const env = window.transformersEnv
    
    // Configure transformers environment (same as STT)
    if (env) {
      env.allowLocalModels = false
      if (import.meta.env.DEV) {
        env.remoteURL = '/hf'
        console.log('Using Vite proxy for HuggingFace in development')
      } else {
        env.remoteURL = 'https://huggingface.co'
      }
    }
    
    console.log('Loading TTS model (this may take a moment on first load)...')
    console.log('Model will be cached for offline use after first download')
    
    // Load TTS model using text-to-audio pipeline - fully offline after first download
    // Using a lightweight model that works well offline
    try {
      // Use text-to-audio pipeline with a quantized model
      tts = await pipeline("text-to-audio", "Xenova/mms-tts-eng", {
        quantized: true,
      })
    } catch (quantizedError) {
      console.warn('Quantized TTS model failed, trying non-quantized:', quantizedError)
      // Fallback to non-quantized
      try {
        tts = await pipeline("text-to-audio", "Xenova/mms-tts-eng", {
          quantized: false,
        })
      } catch (fallbackError) {
        // Try alternative model if mms-tts-eng doesn't work
        console.warn('mms-tts-eng failed, trying speecht5:', fallbackError)
        tts = await pipeline("text-to-audio", "Xenova/speecht5_tts", {
          quantized: false,
        })
      }
    }
    
    // Initialize audio context for playback
    ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)()
    
    console.log('TTS model loaded successfully')
    ttsInitialized = true
    ttsButton.disabled = false
    ttsButton.innerHTML = '🔇'
    ttsButton.title = 'Text-to-speech ready (click to enable)'
    addMessage('Text-to-speech ready! Click the speaker button to enable.', false)
    
  } catch (error) {
    console.error('Failed to initialize TTS:', error)
    console.error('Error details:', error.stack)
    addMessage(`Text-to-speech unavailable: ${error.message}`, false)
    ttsButton.disabled = true
    ttsButton.innerHTML = '🔇'
    ttsButton.title = 'Text-to-speech unavailable'
  }
}

// Speak text using transformers.js TTS (fully offline)
async function speakText(text) {
  if (!ttsEnabled || !ttsInitialized || !tts) return
  
  // Clean text - remove markdown, URLs, etc. for better TTS
  const cleanText = text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove markdown links
    .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
    .replace(/\*\*([^\*]+)\*\*/g, '$1') // Remove bold markdown
    .replace(/\*([^\*]+)\*/g, '$1') // Remove italic markdown
    .replace(/#{1,6}\s+/g, '') // Remove markdown headers
    .trim()
  
  if (!cleanText) return
  
  // Limit text length to prevent very long generation times
  const maxLength = 500
  const textToSpeak = cleanText.length > maxLength 
    ? cleanText.substring(0, maxLength) + '...' 
    : cleanText
  
  // Add to queue and process
  ttsQueue.push(textToSpeak)
  processTTSQueue()
}

// Process TTS queue to prevent overlapping speech
async function processTTSQueue() {
  if (ttsIsSpeaking || ttsQueue.length === 0) return
  
  ttsIsSpeaking = true
  const text = ttsQueue.shift()
  
  try {
    // Resume audio context if suspended (required for user interaction)
    if (ttsAudioContext.state === 'suspended') {
      await ttsAudioContext.resume()
    }
    
    console.log('Generating speech for:', text.substring(0, 50) + '...')
    
    // Generate audio in chunks or with timeout to prevent blocking
    // Use setTimeout to yield to the event loop
    const audio = await Promise.race([
      tts(text),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TTS generation timeout')), 30000)
      )
    ])
    
    console.log('Audio generated, processing...')
    
    // Extract audio data - text-to-audio pipeline returns audio directly
    let audioData
    let sampleRate = 16000 // Default sample rate
    
    // The text-to-audio pipeline typically returns { audio: Float32Array, sampling_rate: number }
    if (audio && audio.audio) {
      audioData = audio.audio
      sampleRate = audio.sampling_rate || sampleRate
    } else if (audio && audio.waveform) {
      audioData = audio.waveform
      sampleRate = audio.sampling_rate || sampleRate
    } else if (audio && audio.data) {
      audioData = audio.data
      sampleRate = audio.sample_rate || audio.sampling_rate || sampleRate
    } else if (Array.isArray(audio)) {
      audioData = new Float32Array(audio)
    } else if (audio) {
      // Try to extract from tensor if it's a tensor
      let Tensor
      if (window.transformersTensor) {
        Tensor = window.transformersTensor
      } else {
        const transformersModule = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js")
        Tensor = transformersModule.Tensor
        window.transformersTensor = Tensor
      }
      if (audio instanceof Tensor) {
        audioData = audio.data
      } else {
        console.error('Unknown audio format:', audio)
        throw new Error('Unknown audio format')
      }
    } else {
      console.error('No audio data found in response:', audio)
      throw new Error('No audio data in TTS response')
    }
    
    // Ensure audioData is a Float32Array
    if (!(audioData instanceof Float32Array)) {
      audioData = new Float32Array(audioData)
    }
    
    // Efficient normalization - find max in chunks to avoid blocking
    let maxVal = 0
    const chunkSize = 10000
    for (let i = 0; i < audioData.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, audioData.length)
      let chunkMax = 0
      for (let j = i; j < end; j++) {
        const abs = Math.abs(audioData[j])
        if (abs > chunkMax) chunkMax = abs
      }
      if (chunkMax > maxVal) maxVal = chunkMax
    }
    
    // Normalize if needed (but don't over-normalize quiet audio)
    if (maxVal > 1.0) {
      for (let i = 0; i < audioData.length; i++) {
        audioData[i] = audioData[i] / maxVal
      }
    } else if (maxVal > 0 && maxVal < 0.1) {
      // Boost quiet audio slightly
      for (let i = 0; i < audioData.length; i++) {
        audioData[i] = audioData[i] * (0.5 / maxVal)
      }
    }
    
    // Ensure sample rate is reasonable
    if (sampleRate < 8000 || sampleRate > 48000) {
      console.warn('Unusual sample rate:', sampleRate, 'using 16000')
      sampleRate = 16000
    }
    
    // Convert to AudioBuffer and play
    const audioBuffer = ttsAudioContext.createBuffer(
      1, // mono
      audioData.length,
      sampleRate
    )
    const channelData = audioBuffer.getChannelData(0)
    channelData.set(audioData)
    
    const source = ttsAudioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ttsAudioContext.destination)
    
    // Handle playback completion
    source.onended = () => {
      console.log('Speech playback completed')
      ttsIsSpeaking = false
      // Process next item in queue
      if (ttsQueue.length > 0) {
        setTimeout(() => processTTSQueue(), 100)
      }
    }
    
    source.onerror = (error) => {
      console.error('Audio playback error:', error)
      ttsIsSpeaking = false
      if (ttsQueue.length > 0) {
        setTimeout(() => processTTSQueue(), 100)
      }
    }
    
    source.start(0)
    console.log('Speech playback started, length:', audioData.length, 'samples, rate:', sampleRate)
    
  } catch (error) {
    console.error('TTS error:', error)
    console.error('Error details:', error.stack)
    ttsIsSpeaking = false
    
    // Don't show error to user for every failure, just log it
    // Try to process next item in queue
    if (ttsQueue.length > 0) {
      setTimeout(() => processTTSQueue(), 1000)
    }
  }
}

// Toggle TTS on/off
ttsButton.onclick = () => {
  if (!ttsInitialized) {
    addMessage('TTS not initialized yet. Please wait...', false)
    return
  }
  
  ttsEnabled = !ttsEnabled
  if (ttsEnabled) {
    ttsButton.innerHTML = '🔊'
    ttsButton.title = 'Text-to-speech enabled (click to disable)'
    ttsButton.classList.add('enabled')
  } else {
    ttsButton.innerHTML = '🔇'
    ttsButton.title = 'Text-to-speech disabled (click to enable)'
    ttsButton.classList.remove('enabled')
    // Clear queue and stop any current audio
    ttsQueue = []
    ttsIsSpeaking = false
    if (ttsAudioContext && ttsAudioContext.state !== 'closed') {
      ttsAudioContext.suspend().then(() => ttsAudioContext.resume())
    }
  }
}

async function doStartRecording() {
  try {
    // Check secure context first
    if (!window.isSecureContext) {
      throw new Error('Microphone access requires a secure context (HTTPS). Please access via HTTPS or localhost.')
    }
    
    // Check permissions API if available
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' })
        console.log('Microphone permission status:', permissionStatus.state)
        
        if (permissionStatus.state === 'denied') {
          throw new Error('Microphone access is denied. Please allow microphone access in your browser settings (click the lock icon in the address bar).')
        }
      } catch (permError) {
        // Permissions API might not be supported, continue anyway
        console.log('Permissions API not available, continuing...', permError)
      }
    }
    
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Try legacy API as fallback
      const getUserMedia = navigator.mediaDevices?.getUserMedia ||
                          navigator.getUserMedia ||
                          navigator.webkitGetUserMedia ||
                          navigator.mozGetUserMedia ||
                          navigator.msGetUserMedia
      
      if (!getUserMedia) {
        throw new Error('Microphone access is not available. Please use HTTPS or localhost, and ensure your browser supports microphone access.')
      }
      
      // Use legacy API with Promise wrapper
      stream = await new Promise((resolve, reject) => {
        getUserMedia.call(navigator, { audio: true }, resolve, reject)
      })
    } else {
      console.log('Requesting microphone access...')
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('Microphone access granted, stream:', stream)
      
      // Verify we actually got audio tracks
      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks found in microphone stream.')
      }
      console.log('Audio tracks:', audioTracks.length, audioTracks[0].label)
    }
    
    rec = true
    buffers = []
    lastSpeechTS = performance.now()
    ctx = new AudioContext()
    src = ctx.createMediaStreamSource(stream)
    proc = ctx.createScriptProcessor(4096, 1, 1)
    
    proc.onaudioprocess = e => {
      if (!rec) return
      
      const ch = e.inputBuffer.getChannelData(0)
      buffers.push(new Float32Array(ch))
      
      // Simple energy-based VAD per frame
      if (rms(ch) >= VAD_RMS) {
        lastSpeechTS = performance.now()
      } else if (performance.now() - lastSpeechTS > VAD_SILENCE_MS) {
        // Auto-stop after silence
        doStopRecording()
      }
    }
    
    src.connect(proc)
    proc.connect(ctx.destination)
    
    micButton.classList.add('recording')
    micButton.innerHTML = '🔴'
    micButton.title = 'Recording... (auto-stops after silence)'
    micButton.disabled = false
    messageInput.disabled = true
    submitButton.disabled = true
  } catch (error) {
    console.error('Failed to start recording:', error)
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      isSecureContext: window.isSecureContext,
      protocol: window.location.protocol,
      hostname: window.location.hostname
    })
    
    let errorMessage = 'Failed to access microphone. '
    let helpMessage = ''
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      errorMessage += 'Microphone access was denied. '
      helpMessage = 'Click the lock icon (🔒) in your browser\'s address bar and allow microphone access. On Windows Chrome with self-signed certificates, you may need to click "Advanced" and "Proceed to site" first.'
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      errorMessage += 'No microphone found. '
      helpMessage = 'Please connect a microphone and ensure it\'s not disabled in Windows settings.'
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      errorMessage += 'Microphone is being used by another application. '
      helpMessage = 'Close other applications using the microphone (like Voice Recorder, Teams, etc.) and try again.'
    } else if (!window.isSecureContext) {
      errorMessage += 'Not in a secure context. '
      helpMessage = 'Microphone access requires HTTPS. You\'re accessing via: ' + window.location.protocol + '//' + window.location.hostname
    } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errorMessage += 'Microphone API not available. '
      helpMessage = 'Your browser may not support microphone access, or you need to use HTTPS/localhost.'
    } else {
      errorMessage += `Error: ${error.message || 'Unknown error'}. `
      helpMessage = 'Check the browser console (F12) for more details. On Windows Chrome with self-signed certificates, try clicking the lock icon and allowing permissions.'
    }
    
    addMessage(errorMessage + helpMessage, false)
    rec = false
    micButton.classList.remove('recording')
    micButton.innerHTML = '🎤'
    micButton.title = 'Microphone access failed - click to try again. Check browser permissions (lock icon).'
  }
}

async function doStopRecording() {
  if (!rec) return
  
  rec = false
  micButton.classList.remove('recording')
  micButton.innerHTML = '🎤'
  micButton.title = 'Start voice input'
  micButton.disabled = true
  messageInput.disabled = false
  
  try {
    proc.disconnect()
  } catch {}
  try {
    src.disconnect()
  } catch {}
  try {
    stream.getTracks().forEach(t => t.stop())
  } catch {}
  try {
    await ctx.close()
  } catch {}
  
  // Process audio
  let total = 0
  for (const b of buffers) total += b.length
  
  const mono = new Float32Array(total)
  let off = 0
  for (const b of buffers) {
    mono.set(b, off)
    off += b.length
  }
  
  // Resample and quick gating
  const pcm = resample(mono, ctx.sampleRate)
  const duration = pcm.length / 16000
  const energy = rms(pcm)
  
  // Skip blank/short/low-energy segments
  if (duration < MIN_SEG_SECONDS || energy < MIN_RMS) {
    addMessage('(No speech detected, try again)', false)
    micButton.disabled = false
    submitButton.disabled = false
    return
  }
  
  // Run Whisper
  try {
    addMessage('(Processing speech...)', false)
    const result = await asr(pcm)
    const text = (result.text || "").trim()
    
    if (text) {
      // Put transcribed text in input field
      messageInput.value = text
      messageInput.focus()
    } else {
      addMessage('(No text recognized, try again)', false)
    }
  } catch (error) {
    console.error('STT error:', error)
    addMessage('(Speech recognition error, please try again)', false)
  }
  
  micButton.disabled = false
  submitButton.disabled = false
}

// Wire microphone button
micButton.onclick = () => {
  if (!asr) {
    addMessage('Speech recognition model not loaded yet. Please wait...', false)
    return
  }
  if (rec) {
    doStopRecording()
  } else {
    doStartRecording()
  }
}

// Check if we're in a secure context for microphone access
function isSecureContext() {
  return window.isSecureContext || 
         location.protocol === 'https:' || 
         location.hostname === 'localhost' || 
         location.hostname === '127.0.0.1' ||
         location.hostname === '[::1]'
}

// Initialize on load
micButton.disabled = true
micButton.innerHTML = '⏳'
micButton.title = 'Initializing...'

// Warn if not in secure context
if (!isSecureContext()) {
  console.warn('Not in secure context - microphone access may not work. Use HTTPS or localhost.')
  addMessage('⚠️ Microphone access requires HTTPS or localhost. Accessing via IP address may not work.', false)
}

// Start initialization
initializeConnection().then(() => {
  console.log('A2A connection established, initializing STT and TTS...')
  // Initialize STT and TTS
  initializeSTT()
  initializeTTS()
}).catch(err => {
  console.error('Connection initialization error:', err)
  // Still try to initialize STT and TTS even if connection fails
  initializeSTT()
  initializeTTS()
})

// Initialize TTS button state
ttsButton.disabled = true
ttsButton.innerHTML = '⏳'
ttsButton.title = 'Initializing text-to-speech...'
