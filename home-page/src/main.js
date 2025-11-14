import './style.css'
import { A2AClient } from '@a2a-js/sdk/client'
// Note: @xenova/transformers is imported dynamically in initializeSTT()

// Generate UUID using browser's crypto API
function uuidv4() {
  return crypto.randomUUID()
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
statusIndicator.className = 'status-indicator'

inputContainer.appendChild(micButton)
inputContainer.appendChild(messageInput)
inputContainer.appendChild(submitButton)
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
const actualServerUrls = [
  'http://localhost:9002',
  'http://127.0.0.1:9002',
  'http://localhost:9001',
  'http://127.0.0.1:9001'
]
const agentCardUrl = isDevelopment 
  ? '/api/a2a/.well-known/agent-card.json'  // Use Vite proxy in development
  : 'http://localhost:9002/.well-known/agent-card.json'  // Direct connection in production

// Create a custom fetch that routes through proxy in development
function createProxiedFetch() {
  if (!isDevelopment) {
    return fetch  // Use default fetch in production
  }
  
  // In development, proxy requests to A2A servers
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
    
    // Check if URL matches any A2A server and replace with proxy
    let proxiedUrl = urlString
    let wasProxied = false
    for (const serverUrl of actualServerUrls) {
      if (urlString.startsWith(serverUrl)) {
        proxiedUrl = urlString.replace(serverUrl, '/api/a2a')
        wasProxied = true
        console.log(`[Proxy] Routing ${urlString} → ${proxiedUrl}`)
        break
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
    
    // First, test if the proxy is working
    if (isDevelopment) {
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
    addMessage('Fetching agent card...', false)
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
        '1. Make sure the A2A server is running on http://localhost:9002\n' +
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

async function doStartRecording() {
  try {
    rec = true
    buffers = []
    lastSpeechTS = performance.now()
    
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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
    addMessage('Failed to access microphone. Please check permissions.', false)
    rec = false
    micButton.classList.remove('recording')
    micButton.innerHTML = '🎤'
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

// Initialize on load
micButton.disabled = true
micButton.innerHTML = '⏳'
micButton.title = 'Initializing...'

// Start initialization
initializeConnection().then(() => {
  console.log('A2A connection established, initializing STT...')
  // Initialize STT immediately (Web Speech API doesn't need async loading)
  initializeSTT()
}).catch(err => {
  console.error('Connection initialization error:', err)
  // Still try to initialize STT even if connection fails
  initializeSTT()
})
