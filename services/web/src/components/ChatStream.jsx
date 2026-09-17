import React, { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
                  <span>Executed: {Array.from(new Set(msg.toolCalls.map(t => t.name).filter(Boolean))).join(', ')}</span>
                  {msg.toolCalls.some(t => t.status === 'error') && (
                    <span style={{ marginLeft: '8px', color: '#f87171', fontWeight: 500 }}>
                      • {Array.from(new Set(msg.toolCalls.filter(t => t.status === 'error').map(t => `Error when calling tool ${t.name}`))).join('; ')}
                    </span>
                  )}
                </div>
              )}

              {/* Collapsible reasoning / internal thinking trace */}
              {msg.reasoning && msg.reasoning.trim() && (
                <details className="reasoning-trace" style={{ marginBottom: '8px', fontSize: '0.8rem', opacity: 0.65 }}>
                  <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Thought process</summary>
                  <div style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', marginTop: '4px', whiteSpace: 'pre-wrap', maxHeight: '160px', overflowY: 'auto' }}>
                    {msg.reasoning}
                  </div>
                </details>
              )}

              {/* Render Rich Markdown for assistant and user */}
              <div className="markdown-body">
                {msg.content ? (
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ node, ...props }) => (
                        <div className="table-wrapper">
                          <table {...props} />
                        </div>
                      ),
                      a: ({ node, ...props }) => (
                        <a target="_blank" rel="noopener noreferrer" {...props} />
                      ),
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : isStreaming && !isUser ? (
                  <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Thinking...</span>
                ) : null}
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
