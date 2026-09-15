import React from 'react'
import { Mic, AlertCircle } from 'lucide-react'

export function VoiceHUD({ micState = 'idle', onToggle, volumeLevel = 0, transcript, errorMessage }) {
  const isListening = micState === 'listening'
  const isPaused = micState === 'paused'
  const isTranscribing = micState === 'transcribing'
  const isDenied = micState === 'denied' || micState === 'error'

  // Dynamic scale based on energy level
  const pulseScale = 1 + (isListening ? volumeLevel * 0.35 : 0)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative' }}>
      <button
        type="button"
        className={`btn-icon btn-mic ${isListening ? 'recording' : ''}`}
        onClick={onToggle}
        title={
          isListening 
            ? 'Listening... Click to turn off voice mode' 
            : isPaused
            ? 'Answering... Continuous voice mode active (click to turn off)'
            : isTranscribing 
            ? 'Transcribing audio...' 
            : isDenied 
            ? 'Microphone blocked - click to retry' 
            : 'Click to start hands-free voice conversation'
        }
        style={{
          transform: `scale(${pulseScale})`,
          transition: 'transform 0.08s ease-out',
          backgroundColor: isListening 
            ? 'rgba(239, 68, 68, 0.25)' 
            : isPaused 
            ? 'rgba(16, 185, 129, 0.2)' 
            : undefined,
          borderColor: isListening 
            ? 'var(--accent-red)' 
            : isPaused 
            ? 'var(--primary)' 
            : isDenied 
            ? 'var(--accent-red)' 
            : undefined,
          color: isListening 
            ? 'var(--accent-red)' 
            : isPaused 
            ? 'var(--primary)' 
            : isDenied 
            ? 'var(--accent-red)' 
            : undefined,
        }}
      >
        <span className="mic-wave-indicator" />
        {isListening ? (
          <Mic size={20} color="var(--accent-red)" />
        ) : isPaused ? (
          <Mic size={20} color="var(--primary)" />
        ) : isDenied ? (
          <AlertCircle size={20} color="var(--accent-red)" />
        ) : (
          <Mic size={20} />
        )}
      </button>

      {/* Live Audio Equalizer / Visualizer Bar */}
      {isListening && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '20px' }}>
          {[0.6, 1.0, 0.8, 0.4].map((multiplier, i) => (
            <div
              key={i}
              style={{
                width: '3px',
                height: `${Math.max(4, Math.min(20, 4 + volumeLevel * 20 * multiplier))}px`,
                backgroundColor: 'var(--primary)',
                borderRadius: '2px',
                transition: 'height 0.06s ease',
              }}
            />
          ))}
          <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, marginLeft: '6px' }}>
            {transcript ? `"${transcript}"` : 'Listening...'}
          </span>
        </div>
      )}

      {isPaused && (
        <span style={{ fontSize: '0.8rem', color: 'var(--primary)', animation: 'pulse 1.5s infinite', fontWeight: 500 }}>
          Answering... (listening resumes shortly)
        </span>
      )}

      {isTranscribing && (
        <span style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', animation: 'pulse 1s infinite' }}>
          Transcribing voice...
        </span>
      )}

      {errorMessage && !isListening && !isPaused && (
        <span style={{ fontSize: '0.78rem', color: 'var(--accent-red)', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {errorMessage}
        </span>
      )}
    </div>
  )
}
