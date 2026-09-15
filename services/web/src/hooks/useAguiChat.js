import { useState, useRef, useCallback } from 'react'

/**
 * AG-UI protocol client hook for streaming chat, tool execution tracking, and A2UI state sync.
 */
export function useAguiChat({ endpoint = '/agent', onAssistantResponse } = {}) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hello! I'm your Hubitat Smart Home Agent. I can check temperatures, inspect lighting states, and control any of your connected devices. What would you like to do?",
      toolCalls: [],
      a2uiSurfaces: [],
    }
  ])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentTool, setCurrentTool] = useState(null)
  const [devices, setDevices] = useState([])
  const threadIdRef = useRef(`thread-${Date.now()}`)

  // Parse SSE chunks line-by-line
  const processStreamChunk = (buffer, onEvent) => {
    const lines = buffer.split(/\r?\n/)
    let remaining = ''
    let currentEvent = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('event:')) {
        currentEvent = line.replace('event:', '').trim()
      } else if (line.startsWith('data:')) {
        const rawData = line.replace('data:', '').trim()
        if (rawData) {
          try {
            const data = JSON.parse(rawData)
            onEvent(currentEvent || 'message', data)
          } catch {
            // raw string data
            onEvent(currentEvent || 'message', rawData)
          }
        }
      } else if (line === '') {
        currentEvent = null
      } else if (i === lines.length - 1) {
        remaining = line
      }
    }

    return remaining
  }

  const sendMessage = useCallback(async (text) => {
    if (!text || !text.trim() || isStreaming) return

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    }

    const assistantMessageId = `assistant-${Date.now()}`
    const assistantMessagePlaceholder = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      a2uiSurfaces: [],
    }

    setMessages((prev) => [...prev, userMessage, assistantMessagePlaceholder])
    setIsStreaming(true)
    setCurrentTool(null)

    let fullAssistantText = ''
    let fullReasoningText = ''

    try {
      // Filter previous valid messages (exclude welcome greeting and empty placeholders)
      const validHistory = messages
        .filter(m => m.id !== 'welcome' && m.id !== assistantMessageId && m.id !== userMessage.id && m.content && m.content.trim())
        .map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))

      // Build AG-UI RunAgentInput payload compliant with ag-ui schema
      const runPayload = {
        threadId: threadIdRef.current,
        runId: `run-${Date.now()}`,
        messages: [...validHistory, userMessage],
        tools: [],
        context: [],
        forwardedProps: {},
        state: {
          devices: devices,
        }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(runPayload),
      })

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let streamBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        streamBuffer += decoder.decode(value, { stream: true })
        streamBuffer = processStreamChunk(streamBuffer, (eventType, data) => {
          // 1. Model reasoning / thinking deltas
          const isReasoningEvent = eventType === 'REASONING_MESSAGE_CONTENT' || data.type === 'REASONING_MESSAGE_CONTENT'
          if (isReasoningEvent) {
            const delta = data.delta || (typeof data === 'string' ? data : '')
            if (delta) {
              fullReasoningText += delta
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, reasoning: fullReasoningText }
                    : msg
                )
              )
            }
            return
          }

          // 2. Text deltas (final content response)
          const isContentEvent = eventType === 'TEXT_MESSAGE_CONTENT' || data.type === 'TEXT_MESSAGE_CONTENT'
          if (isContentEvent) {
            const delta = data.delta || (typeof data === 'string' ? data : '')
            if (delta) {
              fullAssistantText += delta
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: fullAssistantText }
                    : msg
                )
              )
            }
          }

          // 2. Full messages snapshot handling
          if (eventType === 'MESSAGES_SNAPSHOT' || data.type === 'MESSAGES_SNAPSHOT') {
            const msgs = data.messages || []

            // Extract tool execution results to sync devices in real-time
            for (const m of msgs) {
              if (m.role === 'tool' && m.content) {
                try {
                  const parsed = typeof m.content === 'string' ? JSON.parse(m.content) : m.content
                  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && (parsed[0].label || parsed[0].name)) {
                    setDevices(parsed)
                  } else if (parsed && parsed.id && (parsed.attributes || parsed.capabilities)) {
                    setDevices((prev) => {
                      const idx = prev.findIndex(d => String(d.id) === String(parsed.id))
                      if (idx >= 0) {
                        const updated = [...prev]
                        updated[idx] = { ...updated[idx], ...parsed }
                        return updated
                      }
                      return [...prev, parsed]
                    })
                  }
                } catch {
                  // Ignore non-json
                }
              }
            }

            // Extract tool calls to show tool badges
            const toolCallMsgs = msgs.filter(m => m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0)
            if (toolCallMsgs.length > 0) {
              const badges = toolCallMsgs.flatMap(m => m.toolCalls.map(tc => ({
                name: tc.function?.name || tc.name || 'Maker API',
                status: 'done'
              })))
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, toolCalls: badges }
                    : msg
                )
              )
            }

            // Find the assistant response for this run (must be an assistant message, not welcome, with content)
            const latestAssistant = [...msgs].reverse().find(m => m.role === 'assistant' && m.id !== 'welcome' && m.content)
            if (latestAssistant && latestAssistant.content) {
              const textContent = typeof latestAssistant.content === 'string' 
                ? latestAssistant.content 
                : (latestAssistant.content[0]?.text || '')
              if (textContent && (!fullAssistantText || textContent.length > fullAssistantText.length)) {
                fullAssistantText = textContent
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: fullAssistantText }
                      : msg
                  )
                )
              }
            }
          }

          // 3. Tool calls started
          if (eventType === 'TOOL_CALL_START' || data.type === 'TOOL_CALL_START' || eventType === 'TOOL_CALL_STARTED') {
            const toolName = data.name || data.toolName || data.tool_name || 'Maker API'
            setCurrentTool(toolName)
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      toolCalls: [...(msg.toolCalls || []), { name: toolName, status: 'running' }],
                    }
                  : msg
              )
            )
          }

          // 4. Tool calls finished
          if (eventType === 'TOOL_CALL_RESULT' || data.type === 'TOOL_CALL_RESULT' || eventType === 'TOOL_CALL_FINISHED') {
            setCurrentTool(null)
            const resultData = data.content || data.result
            if (resultData) {
              try {
                let parsed = typeof resultData === 'string' ? JSON.parse(resultData) : resultData
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && (parsed[0].label || parsed[0].name)) {
                  setDevices(parsed)
                } else if (parsed && parsed.id && parsed.attributes) {
                  setDevices((prev) => {
                    const idx = prev.findIndex(d => String(d.id) === String(parsed.id))
                    if (idx >= 0) {
                      const updated = [...prev]
                      updated[idx] = { ...updated[idx], ...parsed }
                      return updated
                    }
                    return [...prev, parsed]
                  })
                }
              } catch {
                // Ignore non-json
              }
            }
          }

          // 5. Run Error
          if (eventType === 'RUN_ERROR' || data.type === 'RUN_ERROR') {
            const errMsg = data.message || 'Agent error occurred'
            fullAssistantText += `\n⚠️ ${errMsg}`
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: fullAssistantText }
                  : msg
              )
            )
          }

          // 6. A2UI State deltas & Operations
          if (eventType === 'STATE_DELTA' || eventType === 'A2UI_OPERATIONS' || data.type === 'STATE_DELTA') {
            if (data.operations || data.surfaces) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        a2uiSurfaces: [...(msg.a2uiSurfaces || []), ...(data.operations || data.surfaces || [])],
                      }
                    : msg
                )
              )
            }
          }
        })
      }

      if (onAssistantResponse && fullAssistantText.trim()) {
        onAssistantResponse(fullAssistantText.trim())
      }
    } catch (err) {
      console.error('AG-UI chat error:', err)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: msg.content
                  ? `${msg.content}\n\n⚠️ Error: ${err.message}`
                  : `⚠️ Failed to connect to Hubitat Agent: ${err.message}. Please check if the agent service is running.`,
              }
            : msg
        )
      )
    } finally {
      setIsStreaming(false)
      setCurrentTool(null)
    }
  }, [devices, endpoint, isStreaming, messages, onAssistantResponse])

  const updateDeviceOptimistic = useCallback((deviceId, updates) => {
    setDevices((prev) =>
      prev.map((d) => (String(d.id) === String(deviceId) ? { ...d, ...updates } : d))
    )
  }, [])

  return {
    messages,
    isStreaming,
    currentTool,
    devices,
    sendMessage,
    setDevices,
    updateDeviceOptimistic,
    clearMessages: () => setMessages([]),
  }
}
