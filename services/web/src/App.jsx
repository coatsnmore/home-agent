import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Send, RefreshCw } from 'lucide-react'
import { Header } from './components/Header'
import { DeviceCard } from './components/DeviceCard'
import { ChatStream } from './components/ChatStream'
import { VoiceHUD } from './components/VoiceHUD'
import { TelemetryHUD } from './components/TelemetryHUD'
import { useAguiChat } from './hooks/useAguiChat'
import { useSTT } from './hooks/useSTT'
import { useTTS } from './hooks/useTTS'
import { useLocation } from './hooks/useLocation'
import { useRespondingTone } from './hooks/useRespondingTone'

export default function App() {
  const [inputText, setInputText] = useState('')
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false)
  const [isTtsEnabled, setIsTtsEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('home_agent_tts_enabled') === 'true'
    }
    return false
  })
  const [isOnline, setIsOnline] = useState(false)
  const inputRef = useRef(null)

  const { location: clientLocation } = useLocation()
  const { isSpeaking, speak, cancel: cancelTts, isNeuralAvailable } = useTTS()

  // Instant mute button toggle
  const handleToggleTts = useCallback(() => {
    setIsTtsEnabled((prev) => {
      const next = !prev
      if (!next) {
        cancelTts()
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('home_agent_tts_enabled', String(next))
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
    clientLocation,
  })

  // Subtle acoustic processing tone while responding if speaker is active
  useRespondingTone({
    isStreaming,
    isTtsEnabled,
    isSpeaking,
  })

  // Speech to text hook
  const handleTranscriptReady = useCallback((transcript) => {
    if (transcript.trim()) {
      cancelTts() // Stop speaker immediately on audio submission
      sendMessage(transcript)
      setInputText('')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [sendMessage, cancelTts])

  const {
    micState,
    isListening,
    isWakeWordMode,
    transcript,
    volumeLevel,
    errorMessage,
    toggleListening,
    toggleWakeWordMode,
  } = useSTT({
    onTranscriptReady: handleTranscriptReady,
    onSpeechStart: cancelTts, // Immediate barge-in: stop speaker as soon as user starts speaking
    isAssistantBusy: isStreaming || isSpeaking,
  })

  // Live mirror speech transcript into input bar
  useEffect(() => {
    if (transcript) {
      setInputText(transcript)
    }
  }, [transcript])

  // Retain focus in the input box when streaming finishes or on load
  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus()
    }
  }, [isStreaming])

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
    cancelTts()
    sendMessage("List all my smart home devices.")
  }, [sendMessage, cancelTts])

  const handleDeviceControl = useCallback((deviceId, command) => {
    cancelTts()
    updateDeviceOptimistic(deviceId, {
      attributes: [{ name: 'switch', currentValue: command.includes('on') ? 'on' : 'off' }]
    })
    sendMessage(`control device ${deviceId} ${command}`)
  }, [sendMessage, updateDeviceOptimistic, cancelTts])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!inputText.trim() || isStreaming) return
    cancelTts()
    const textToSend = inputText.trim()
    setInputText('')
    sendMessage(textToSend)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  return (
    <div className="app-container">
      <Header 
        isOnline={isOnline}
        isTtsEnabled={isTtsEnabled}
        onToggleTts={handleToggleTts}
        isNeuralTts={isNeuralAvailable}
        micState={micState}
        onToggleMic={toggleListening}
        location={clientLocation}
        isWakeWordMode={isWakeWordMode}
        onToggleWakeWord={toggleWakeWordMode}
        onOpenTelemetry={() => setIsTelemetryOpen(true)}
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
                ref={inputRef}
                type="text"
                placeholder={isListening ? 'Listening to speech...' : isStreaming ? 'Agent is responding...' : 'Ask Home Agent or type a command (e.g. "Turn off living room light")...'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="text-input"
                autoFocus
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

      {/* Telemetry & Observability HUD Modal */}
      <TelemetryHUD 
        isOpen={isTelemetryOpen} 
        onClose={() => setIsTelemetryOpen(false)} 
      />
    </div>
  )
}
