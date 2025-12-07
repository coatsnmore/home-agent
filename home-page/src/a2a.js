// A2A client, proxy and messaging logic moved out of index.html
// This module is executed when imported and exports initialization
// helpers. It imports UI bindings from ./ui.js so DOM refs are shared.

import { clearUserInput, addMessage, updateStatus, clickSubmitButton, messageInput, submitButton, messagesContainer, micButton } from './ui.js'
import { A2AClient } from '@a2a-js/sdk/client'

// Module-local client and conversation state (exported as live bindings)
export let contextId = null
export let isConnected = false
let a2aClient = null

// Use proxy in development to avoid CORS issues
const isDevelopment = import.meta.env.DEV

// Detect if we're being served over HTTPS (via nginx proxy)
const isHttps = window.location.protocol === 'https:'

// Agent card URL - use nginx proxy path when served over HTTPS
const agentCardUrl = isHttps
  ? '/agent/.well-known/agent-card.json'
  : 'http://localhost:9002/.well-known/agent-card.json'

// Server URLs that need to be proxied
const actualServerUrls = [
  'http://localhost:9002',
  'http://127.0.0.1:9002',
  'http://localhost:9001',
  'http://127.0.0.1:9001'
]

// Create a custom fetch that routes through proxy to avoid mixed content
function createProxiedFetch() {
  return async (url, options = {}) => {
    let urlString = ''
    if (typeof url === 'string') {
      urlString = url
    } else if (url instanceof Request) {
      urlString = url.url
    } else if (url instanceof URL) {
      urlString = url.toString()
    } else {
      urlString = String(url)
    }

    if (urlString.startsWith('/') || urlString.startsWith('https://')) {
      return fetch(urlString, options)
    }

    let proxiedUrl = urlString

    if (urlString.includes('0.0.0.0')) {
      proxiedUrl = urlString.replace(/http:\/\/0\.0\.0\.0:/g, 'http://localhost:')
    }

    if (isHttps) {
      let wasProxied = false
      for (const serverUrl of actualServerUrls) {
        if (proxiedUrl.startsWith(serverUrl)) {
          proxiedUrl = proxiedUrl.replace(serverUrl, '/agent')
          wasProxied = true
          console.log(`[Proxy] Routing HTTPS: ${urlString} → ${proxiedUrl}`)
          break
        }
      }

      if (!wasProxied && proxiedUrl.startsWith('http://')) {
        const urlObj = new URL(proxiedUrl)
        if (
          urlObj.hostname === 'localhost' ||
          urlObj.hostname === '127.0.0.1' ||
          urlObj.hostname.includes('hubitat-agent') ||
          urlObj.hostname.includes('hubitat-mcp') ||
          urlObj.port === '9002' || urlObj.port === '9001'
        ) {
          const path = urlObj.pathname + urlObj.search + urlObj.hash
          proxiedUrl = '/agent' + path
          console.log(`[Proxy] Routing HTTPS (internal): ${urlString} → ${proxiedUrl}`)
        }
      }
    } else {
      for (const serverUrl of actualServerUrls) {
        if (proxiedUrl.startsWith(serverUrl)) {
          proxiedUrl = proxiedUrl.replace(serverUrl, '/api/a2a')
          console.log(`[Proxy] Routing HTTP: ${urlString} → ${proxiedUrl}`)
          break
        }
      }
    }

    if (proxiedUrl !== urlString && url instanceof Request) {
      const clonedRequest = url.clone()
      const headers = new Headers(clonedRequest.headers)
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

    return fetch(proxiedUrl, options)
  }
}

// Initialize connection
export async function initializeConnection() {
  try {
    updateStatus(false)
    isConnected = false
    addMessage('Connecting to Hubitat Agent...', false)

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

    addMessage('Fetching agent card from: ' + agentCardUrl, false)
    const customFetch = createProxiedFetch()
    a2aClient = await A2AClient.fromCardUrl(agentCardUrl, { fetchImpl: customFetch })

    updateStatus(true)
    isConnected = true
    addMessage('Connected! You can now chat with the Hubitat Agent.', false)
  } catch (error) {
    console.error('Failed to connect:', error)
    updateStatus(false)
    isConnected = false
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

// Generate UUID
export function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Send message to agent
export async function sendMessage() {
  const messageText = messageInput.value.trim()
  if (!messageText || !isConnected || !a2aClient) return

    sendMessageToHUB(messageText, responseCallback);
    addMessage(messageText, true);
    clearUserInput();
    
}


// -----------------------------------------------------------------------------
// Helper: sendMessageToHUB
// Sends a single message to the A2A server and invokes the provided
// responseCallback with the server response. This intentionally does not
// replace any existing logic and uses the module-scoped `a2aClient`.
// -----------------------------------------------------------------------------
export async function sendMessageToHUB(newMSG, newResponseCallback) {
  if (!a2aClient) {
    console.warn('sendMessageToHUB: a2aClient is not initialized')
    if (typeof newResponseCallback === 'function') {
      newResponseCallback({ error: 'a2aClient not initialized' })
    }
    return
  }

  // Build a minimal message object if caller passed a string
  let message = null
  if (typeof newMSG === 'string') {
    message = {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: newMSG }],
      kind: 'message'
    }
  } else if (typeof newMSG === 'object' && newMSG !== null) {
    // Assume caller provided a valid message shape
    message = { ...newMSG }
  } else {
    console.warn('sendMessageToHUB: unexpected message type', typeof newMSG)
    if (typeof newResponseCallback === 'function') newResponseCallback({ error: 'invalid message' })
    return
  }

  // Preserve context if available
  if (contextId && !message.contextId) message.contextId = contextId

  try {
    // Use non-streaming sendMessage for a simple request/response pattern
    const response = await a2aClient.sendMessage({ message })

    // Update contextId if present in response
    try {
      const result = response.result || response
      if (result && result.contextId) contextId = result.contextId
    } catch (e) {
      // ignore parsing issues
    }

    if (typeof newResponseCallback === 'function') {
      newResponseCallback(response)
    }
  } catch (err) {
    console.error('sendMessageToHUB error:', err)
    if (typeof newResponseCallback === 'function') newResponseCallback({ error: err })
  }
}

// -----------------------------------------------------------------------------
// Default responseCallback implementation – logs the A2A server response.
export function responseCallback(a2aResponse) {

    // right now, we only process basic text as a response
    printResponseToChat(a2aResponse);

    // TODO: process different types of responses

}


// -----------------------------------------------------------------------------
// Helper: printResponseToChat
// Formats a generic a2aResponse into a readable text string and appends it
// to the chat UI using `addMessage(..., false)`. This complements
// `responseCallback` by writing the same human-friendly output into the
// chat window so users can see the agent's reply.
// -----------------------------------------------------------------------------
export function printResponseToChat(a2aResponse) {
  try {
    if (!a2aResponse) {
      addMessage('<empty response>', false)
      return
    }

    if (a2aResponse.error) {
      const errText = typeof a2aResponse.error === 'string' ? a2aResponse.error : JSON.stringify(a2aResponse.error)
      addMessage(`Error: ${errText}`, false)
      return
    }

    const resp = a2aResponse.result ?? a2aResponse
    let output = ''

    if (resp.kind === 'message') {
      const textParts = (resp.parts || []).filter(p => p.kind === 'text')
      output = textParts.map(p => p.text).join('') || 'No response received'

    } else if (resp.kind === 'task') {
      if (resp.history && Array.isArray(resp.history)) {
        const historyText = resp.history
          .filter(msg => msg.kind === 'message' && msg.role === 'agent')
          .map(msg => {
            const parts = msg.parts || []
            return parts.filter(p => p.kind === 'text').map(p => p.text).join('')
          })
          .filter(t => t && t.length > 0)
          .join('\n')
        if (historyText) output = historyText
      }

      if (!output && resp.artifacts && Array.isArray(resp.artifacts)) {
        const artifactTexts = resp.artifacts
          .map(artifact => {
            const parts = artifact.parts || []
            return parts.filter(p => p.kind === 'text').map(p => p.text).join('')
          })
          .filter(t => t && t.length > 0)
          .join('\n\n')
        if (artifactTexts) output = artifactTexts
      }

      if (!output) output = `Task ${resp.id}: ${resp.status?.state ?? 'unknown'}`

    } else {
      const textParts = (resp.parts || []).filter(p => p.kind === 'text')
      if (textParts.length > 0) {
        output = textParts.map(p => p.text).join('')
      } else if (typeof resp === 'string') {
        output = resp
      } else {
        try {
          output = JSON.stringify(resp)
        } catch (e) {
          output = String(resp)
        }
      }
    }

    // Update contextId if present
    try {
      if (resp && resp.contextId) contextId = resp.contextId
    } catch (e) {
      // ignore
    }

    addMessage(output, false)
  } catch (err) {
    console.error('printResponseToChat error:', err)
    try { addMessage(JSON.stringify(a2aResponse), false) } catch (e) { addMessage(String(a2aResponse), false) }
  }
}

