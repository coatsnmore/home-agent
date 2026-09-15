import React, { useEffect, useRef } from 'react'
import { Bot, User, Wrench, Loader2 } from 'lucide-react'
import { DeviceCard } from './DeviceCard'

export function ChatStream({ messages, isStreaming, currentTool, onControlDevice }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming, currentTool])

  return (
    <div className="chat-messages">
      {messages.map((msg) => {
        const isUser = msg.role === 'user'

        return (
          <div key={msg.id} className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
            <div className={`avatar ${isUser ? 'user' : 'assistant'}`}>
              {isUser ? <User size={18} /> : <Bot size={18} />}
            </div>

            <div className="bubble-content">
              {/* Tool calls execution banner */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="tool-call-banner">
                  <Wrench size={13} />
                  <span>Executed: {msg.toolCalls.map(t => t.name).join(', ')}</span>
                </div>
              )}

              {/* Message text */}
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {msg.content || (isStreaming && !isUser ? 'Thinking...' : '')}
              </div>

              {/* Inline A2UI device cards if present */}
              {msg.a2uiDevices && msg.a2uiDevices.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px', marginTop: '12px' }}>
                  {msg.a2uiDevices.map((dev) => (
                    <DeviceCard key={dev.id} device={dev} onControl={onControlDevice} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Streaming / Active Tool indicator */}
      {isStreaming && currentTool && (
        <div className="message-bubble assistant">
          <div className="avatar assistant">
            <Bot size={18} />
          </div>
          <div className="bubble-content">
            <div className="tool-call-banner" style={{ marginBottom: 0 }}>
              <Loader2 size={13} className="spin-animation" />
              <span>Running tool: <strong>{currentTool}</strong>...</span>
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
