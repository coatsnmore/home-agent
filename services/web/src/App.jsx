import React, { useState, useEffect, useCallback } from 'react'
import { Send, RefreshCw } from 'lucide-react'
import { Header } from './components/Header'
import { DeviceCard } from './components/DeviceCard'
import { ChatStream } from './components/ChatStream'
import { VoiceHUD } from './components/VoiceHUD'
import { useAguiChat } from './hooks/useAguiChat'
import { useSTT } from './hooks/useSTT'
import { useTTS } from './hooks/useTTS'

export default function App() {
  const [inputText, setInputText] = useState('')
  const [isTtsEnabled, setIsTtsEnabled] = useState(false)
  const [isOnline, setIsOnline] = useState(false)

  const { isSpeaking, speak, cancel: cancelTts } = useTTS()

  // Instant mute button toggle
  const handleToggleTts = useCallback(() => {
    setIsTtsEnabled((prev) => {
      const next = !prev
      if (!next) {
        cancelTts()
      }
      return next
    })
  }, [cancelTts])

  // On assistant response callback to speak text
  const handleAssistantResponse = useCallback((text) => {
    if (isTtsEnabled) {
      speak(text)
    }
  }, [isTtsEnabled, speak])

  const {
    messages,
    isStreaming,
    currentTool,
    devices,
    sendMessage,
    setDevices,
    updateDeviceOptimistic,
  } = useAguiChat({
    endpoint: '/agent',
    onAssistantResponse: handleAssistantResponse,
  })

  // Speech to text hook
  const handleTranscriptReady = useCallback((transcript) => {
    if (transcript.trim()) {
      sendMessage(transcript)
    }
  }, [sendMessage])

  const {
    micState,
    isListening,
    transcript,
    volumeLevel,
    errorMessage,
    toggleListening,
  } = useSTT({
    onTranscriptReady: handleTranscriptReady,
    isAssistantBusy: isStreaming || isSpeaking,
  })

  // Live mirror speech transcript into input bar
  useEffect(() => {
    if (transcript) {
      setInputText(transcript)
    }
  }, [transcript])

  // Periodic health check
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health')
        if (res.ok) setIsOnline(true)
        else setIsOnline(false)
      } catch {
        setIsOnline(false)
      }
    }

    checkHealth()
    const interval = setInterval(checkHealth, 10000)
    return () => clearInterval(interval)
  }, [])

  // Initial fetch of devices on load
  const refreshDevices = useCallback(() => {
    sendMessage("List all my smart home devices.")
  }, [sendMessage])

  const handleDeviceControl = useCallback((deviceId, command) => {
    updateDeviceOptimistic(deviceId, {
      attributes: [{ name: 'switch', currentValue: command.includes('on') ? 'on' : 'off' }]
    })
    sendMessage(`control device ${deviceId} ${command}`)
  }, [sendMessage, updateDeviceOptimistic])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!inputText.trim() || isStreaming) return
    cancelTts()
    sendMessage(inputText)
    setInputText('')
  }

  return (
    <div className="app-container">
      <Header 
        isOnline={isOnline}
        isTtsEnabled={isTtsEnabled}
        onToggleTts={handleToggleTts}
        micState={micState}
        onToggleMic={toggleListening}
      />

      <main className="dashboard-grid">
        {/* Sidebar Devices Panel */}
        <aside className="sidebar-panel">
          <div className="panel-header">
            <span className="panel-title">Devices ({devices.length})</span>
            <button 
              className="btn-icon" 
              onClick={refreshDevices}
              title="Refresh Devices List"
              style={{ width: '30px', height: '30px' }}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="devices-list">
            {devices.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                No devices synced yet.<br />
                Ask the agent <br />
                <em>"List my devices"</em> to load them.
              </div>
            ) : (
              devices.map((device) => (
                <DeviceCard 
                  key={device.id} 
                  device={device} 
                  onControl={handleDeviceControl}
                />
              ))
            )}
          </div>
        </aside>

        {/* Center Chat Panel */}
        <section className="chat-panel">
          <ChatStream 
            messages={messages}
            isStreaming={isStreaming}
            currentTool={currentTool}
            onControlDevice={handleDeviceControl}
          />

          <form onSubmit={handleSubmit} className="chat-input-bar">
            <VoiceHUD 
              micState={micState}
              onToggle={toggleListening}
              volumeLevel={volumeLevel}
              transcript={transcript}
              errorMessage={errorMessage}
            />

            <div className="input-field-wrapper">
              <input 
                type="text"
                placeholder={isListening ? 'Listening to speech...' : 'Ask Hubitat Agent or type a command (e.g. "Turn off living room light")...'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="text-input"
                disabled={isStreaming}
              />
            </div>

            <button 
              type="submit" 
              className="btn-icon btn-primary"
              disabled={!inputText.trim() || isStreaming}
              title="Send Command"
            >
              <Send size={18} />
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
