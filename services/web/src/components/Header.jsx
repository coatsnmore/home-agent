import React from 'react'
import { Home, Cpu, Sparkles, Volume2, VolumeX, Mic } from 'lucide-react'

export function Header({ isOnline, isTtsEnabled, onToggleTts, micState, onToggleMic }) {
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
        <div className="status-pill">
          <Cpu size={14} color="var(--primary)" />
          <span>LiteLLM: gpt-oss:20b</span>
        </div>

        <div className="status-pill">
          <Sparkles size={14} color="var(--accent-cyan)" />
          <span>Skill: Hubitat</span>
        </div>

        {/* Microphone Status Indicator */}
        <div 
          className="status-pill" 
          onClick={onToggleMic} 
          style={{ cursor: 'pointer' }}
          title="Click to toggle microphone"
        >
          {micState === 'listening' ? (
            <>
              <span className="status-indicator-dot" style={{ backgroundColor: 'var(--accent-red)', boxShadow: '0 0 8px var(--accent-red)' }} />
              <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>Mic: Listening...</span>
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
              <span>Mic: Ready</span>
            </>
          )}
        </div>

        <button 
          className="btn-icon" 
          onClick={onToggleTts} 
          title={isTtsEnabled ? 'Text-to-Speech Enabled' : 'Text-to-Speech Muted'}
          style={{ width: '36px', height: '36px' }}
        >
          {isTtsEnabled ? <Volume2 size={16} color="var(--primary)" /> : <VolumeX size={16} color="var(--text-dim)" />}
        </button>

        <div className="status-pill">
          <span className={`status-indicator-dot ${isOnline ? 'online' : 'offline'}`} />
          <span>{isOnline ? 'Connected' : 'Connecting...'}</span>
        </div>
      </div>
    </header>
  )
}
