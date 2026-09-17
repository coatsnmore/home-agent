import React from 'react'
import { Home, Cpu, Sparkles, Volume2, VolumeX, Mic, MapPin, Radio, Activity } from 'lucide-react'
import { ASSISTANT_CONFIG } from '../config/assistantConfig'

export function Header({ 
  isOnline, 
  isTtsEnabled, 
  onToggleTts, 
  isNeuralTts,
  micState, 
  onToggleMic, 
  location, 
  isWakeWordMode, 
  onToggleWakeWord,
  onOpenTelemetry,
}) {
  const wakeWordName = ASSISTANT_CONFIG.getPrimaryWakeWord()

  return (
    <header className="app-header">
      <div className="brand-section">
        <div className="brand-icon-wrapper">
          <Home size={22} />
        </div>
        <div>
          <h1 className="brand-title">
            Home Agent
            <span className="brand-badge">AG-UI</span>
          </h1>
        </div>
      </div>

      <div className="header-status-group">
        {location && (
          <div className="status-pill" title={`Detected client location: ${location.displayName} (${location.latitude}, ${location.longitude})`}>
            <MapPin size={14} color="var(--accent-cyan)" />
            <span>{location.displayName}</span>
          </div>
        )}

        {/* Passive Wake-Word Mode Toggle */}
        <div 
          className="status-pill"
          onClick={onToggleWakeWord}
          style={{ 
            cursor: 'pointer',
            borderColor: isWakeWordMode ? 'var(--accent-cyan)' : undefined,
            backgroundColor: isWakeWordMode ? 'rgba(6, 182, 212, 0.12)' : undefined,
            transition: 'all 0.2s ease-in-out'
          }}
          title={isWakeWordMode ? `Passive Wake Word active: Say "${wakeWordName}" anytime to control devices` : `Click to enable passive wake-word mode ("${wakeWordName}")`}
        >
          {isWakeWordMode ? (
            <>
              <span className="status-indicator-dot" style={{ backgroundColor: 'var(--accent-cyan)', boxShadow: '0 0 8px var(--accent-cyan)' }} />
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>Wake Word: "{wakeWordName}"</span>
            </>
          ) : (
            <>
              <Radio size={14} color="var(--text-dim)" />
              <span style={{ color: 'var(--text-muted)' }}>Wake Word: Off</span>
            </>
          )}
        </div>

        {/* Microphone Status Indicator */}
        <div 
          className="status-pill" 
          onClick={onToggleMic} 
          style={{ cursor: 'pointer' }}
          title={isWakeWordMode ? `Microphone running in passive wake-word mode. Click to toggle active voice mode.` : `Click to toggle microphone`}
        >
          {micState === 'passive' ? (
            <>
              <span className="status-indicator-dot" style={{ backgroundColor: 'var(--accent-cyan)', boxShadow: '0 0 8px var(--accent-cyan)' }} />
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>Standby: "{wakeWordName}"</span>
            </>
          ) : micState === 'listening' ? (
            <>
              <span className="status-indicator-dot" style={{ backgroundColor: 'var(--accent-red)', boxShadow: '0 0 8px var(--accent-red)' }} />
              <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>Mic: Listening...</span>
            </>
          ) : micState === 'paused' ? (
            <>
              <span className="status-indicator-dot online" />
              <span style={{ color: 'var(--primary)' }}>Mic: Answering...</span>
            </>
          ) : micState === 'transcribing' ? (
            <>
              <span className="status-indicator-dot" style={{ backgroundColor: 'var(--accent-cyan)', boxShadow: '0 0 8px var(--accent-cyan)' }} />
              <span style={{ color: 'var(--accent-cyan)' }}>Mic: Transcribing...</span>
            </>
          ) : micState === 'denied' ? (
            <>
              <span className="status-indicator-dot offline" />
              <span style={{ color: 'var(--accent-red)' }}>Mic: Blocked</span>
            </>
          ) : (
            <>
              <Mic size={14} color="var(--text-dim)" />
              <span>Mic: Push to Talk</span>
            </>
          )}
        </div>

        <div className="status-pill">
          <Cpu size={14} color="var(--primary)" />
          <span>LiteLLM: gpt-oss:20b</span>
        </div>

        <div className="status-pill" title="Ecosystem: Hubitat Elevation, Weather, Search, Code Sandbox">
          <Sparkles size={14} color="var(--accent-cyan)" />
          <span>Ecosystem: Active</span>
        </div>

        <button 
          className="btn-icon" 
          onClick={onToggleTts} 
          title={isTtsEnabled ? (isNeuralTts ? 'Neural TTS Active (Piper)' : 'Browser Speech Active') : 'Text-to-Speech Muted'}
          style={{ width: '36px', height: '36px', position: 'relative' }}
        >
          {isTtsEnabled ? (
            <>
              <Volume2 size={16} color={isNeuralTts ? 'var(--accent-cyan)' : 'var(--primary)'} />
              {isNeuralTts && (
                <span 
                  style={{
                    position: 'absolute',
                    top: '5px',
                    right: '5px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--accent-cyan)',
                    boxShadow: '0 0 6px var(--accent-cyan)'
                  }} 
                />
              )}
            </>
          ) : (
            <VolumeX size={16} color="var(--text-dim)" />
          )}
        </button>

        <button 
          className="btn-icon" 
          onClick={onOpenTelemetry} 
          title="System Telemetry & Observability"
          style={{ width: '36px', height: '36px' }}
        >
          <Activity size={16} color="var(--accent-cyan)" />
        </button>

        <div className="status-pill">
          <span className={`status-indicator-dot ${isOnline ? 'online' : 'offline'}`} />
          <span>{isOnline ? 'Connected' : 'Connecting...'}</span>
        </div>
      </div>
    </header>
  )
}
