// A2A client, proxy and messaging logic moved out of index.html
// This module is executed when imported and exports initialization
// helpers. It imports UI bindings from ./ui.js so DOM refs are shared.

import { clearUserInput, addMessage, updateStatus, clickSubmitButton, messageInput, submitButton, messagesContainer, micButton, updateAgentList, setActiveAgent } from './ui.js'
import { A2AClient } from '@a2a-js/sdk/client'

// Agent configurations
const AGENTS = {
  hubitat: {
    name: 'Hubitat',
    displayName: 'Hubitat Agent',
    cardUrl: '/hubitat/.well-known/agent-card.json',
    default: true
  },
  home: {
    name: 'Home',
    displayName: 'Home Agent',
    cardUrl: '/home/.well-known/agent-card.json',
    default: false
  }
}

// Module-local client and conversation state (exported as live bindings)
export let contextIds = {} // Separate context IDs per agent
export let isConnected = false
let a2aClients = {} // Separate clients per agent
let currentAgent = 'hubitat' // Default agent

// Use proxy in development to avoid CORS issues
const isDevelopment = import.meta.env.DEV

// Detect if we're being served over HTTPS (via nginx proxy)
const isHttps = window.location.protocol === 'https:'

// Server URLs that need to be proxied
const actualServerUrls = [
  'http://localhost:9002',
  'http://127.0.0.1:9002',
  'http://localhost:9001',
  'http://127.0.0.1:9001'
]


// Parse @mentions from message text
function parseMention(messageText) {
  // Match @agentname at the start, optionally followed by a message
  const mentionMatch = messageText.match(/^@(\w+)(?:\s+(.+))?$/)
  if (mentionMatch) {
    const agentName = mentionMatch[1].toLowerCase()
    const remainingText = mentionMatch[2] || ''
    return { agentName, messageText: remainingText }
  }
  return { agentName: null, messageText }
}

// Initialize connection to all agents
export async function initializeConnection() {
  try {
    updateStatus(false)
    isConnected = false
    addMessage('Connecting to agents...', false)

    const connectedAgents = []
    const failedAgents = []

    // Connect to all agents
    for (const [agentId, agentConfig] of Object.entries(AGENTS)) {
      try {
        addMessage(`Connecting to ${agentConfig.displayName}...`, false)
        const client = await A2AClient.fromCardUrl(agentConfig.cardUrl)
        a2aClients[agentId] = client
        contextIds[agentId] = null
        connectedAgents.push({
          id: agentId,
          name: agentConfig.name,
          displayName: agentConfig.displayName
        })
        addMessage(`✓ Connected to ${agentConfig.displayName}`, false)
      } catch (error) {
        console.error(`Failed to connect to ${agentConfig.displayName}:`, error)
        failedAgents.push(agentConfig)
        addMessage(`✗ Failed to connect to ${agentConfig.displayName}`, false)
      }
    }

    if (connectedAgents.length > 0) {
      updateStatus(true)
      isConnected = true
      updateAgentList(connectedAgents, currentAgent)
      setActiveAgent(currentAgent)
      addMessage(`Connected to ${connectedAgents.length} agent(s)! Use @agentname to switch agents.`, false)
    } else {
      updateStatus(false)
      isConnected = false
      addMessage('Failed to connect to any agents. Please check that the A2A servers are running.', false)
    }
  } catch (error) {
    console.error('Failed to initialize connections:', error)
    updateStatus(false)
    isConnected = false
    addMessage(`Failed to initialize: ${error.message}`, false)
  }
}

// Get current agent client
function getCurrentClient() {
  return a2aClients[currentAgent]
}

// Switch to a different agent
export function switchAgent(agentId) {
  if (a2aClients[agentId]) {
    currentAgent = agentId
    setActiveAgent(agentId)
    const agentConfig = AGENTS[agentId]
    addMessage(`Switched to ${agentConfig.displayName}`, false)
    return true
  }
  return false
}

// Get current agent ID
export function getCurrentAgent() {
  return currentAgent
}

// Get agent configuration
export function getAgentConfig(agentId) {
  return AGENTS[agentId]
}

// Get all agent configurations
export function getAllAgents() {
  return AGENTS
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
  let messageText = messageInput.value.trim()
  if (!messageText || !isConnected) return

  // Parse @mentions
  const { agentName, messageText: parsedText } = parseMention(messageText)
  
  // Switch agent if mentioned
  if (agentName) {
    const agentId = Object.keys(AGENTS).find(id => 
      AGENTS[id].name.toLowerCase() === agentName
    )
    if (agentId) {
      switchAgent(agentId)
      // If no message after @mention, just switch and return
      if (!parsedText.trim()) {
        clearUserInput()
        return
      }
      messageText = parsedText
    } else {
      addMessage(`Unknown agent: @${agentName}. Available: ${Object.values(AGENTS).map(a => `@${a.name.toLowerCase()}`).join(', ')}`, false)
      clearUserInput()
      return
    }
  }

  if (!messageText.trim()) {
    clearUserInput()
    return
  }

  const client = getCurrentClient()
  if (!client) {
    addMessage('No agent client available', false)
    clearUserInput()
    return
  }

  // Add agent indicator to user message
  const agentConfig = AGENTS[currentAgent]
  addMessage(`[@${agentConfig.name}] ${messageText}`, true)
  
  sendMessageToAgent(client, currentAgent, messageText, responseCallback)
  clearUserInput()
}


// -----------------------------------------------------------------------------
// Helper: sendMessageToAgent
// Sends a single message to the A2A server and invokes the provided
// responseCallback with the server response. Uses the provided client and agentId.
// -----------------------------------------------------------------------------
export async function sendMessageToAgent(client, agentId, newMSG, newResponseCallback) {
  if (!client) {
    console.warn('sendMessageToAgent: client is not initialized')
    if (typeof newResponseCallback === 'function') {
      newResponseCallback({ error: 'client not initialized' })
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
    console.warn('sendMessageToAgent: unexpected message type', typeof newMSG)
    if (typeof newResponseCallback === 'function') newResponseCallback({ error: 'invalid message' })
    return
  }

  // Preserve context if available for this agent
  if (contextIds[agentId] && !message.contextId) {
    message.contextId = contextIds[agentId]
  }

  try {
    // Use non-streaming sendMessage for a simple request/response pattern
    const response = await client.sendMessage({ message })

    // Update contextId if present in response
    try {
      const result = response.result || response
      if (result && result.contextId) {
        contextIds[agentId] = result.contextId
      }
    } catch (e) {
      // ignore parsing issues
    }

    if (typeof newResponseCallback === 'function') {
      newResponseCallback(response)
    }
  } catch (err) {
    console.error('sendMessageToAgent error:', err)
    if (typeof newResponseCallback === 'function') newResponseCallback({ error: err })
  }
}

// Legacy function for backwards compatibility
export async function sendMessageToHUB(newMSG, newResponseCallback) {
  const client = getCurrentClient()
  if (!client) {
    console.warn('sendMessageToHUB: no client available')
    if (typeof newResponseCallback === 'function') {
      newResponseCallback({ error: 'client not initialized' })
    }
    return
  }
  return sendMessageToAgent(client, currentAgent, newMSG, newResponseCallback)
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

