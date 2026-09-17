import React, { useState, useEffect, useCallback } from 'react'
import { Activity, X, RefreshCw, AlertTriangle, CheckCircle, Clock, Zap } from 'lucide-react'

export function TelemetryHUD({ isOpen, onClose }) {
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  const fetchTelemetry = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, recentRes] = await Promise.all([
        fetch('/api/telemetry/stats?hours=24'),
        fetch('/api/telemetry/recent?limit=30'),
      ])
      if (statsRes.ok) {
        const statsData = await statsRes.json()
        setStats(statsData)
      }
      if (recentRes.ok) {
        const recentData = await recentRes.json()
        setRecent(recentData)
      }
    } catch (err) {
      console.warn('[TelemetryHUD] Failed to load telemetry:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchTelemetry()
      const interval = setInterval(fetchTelemetry, 8000)
      return () => clearInterval(interval)
    }
  }, [isOpen, fetchTelemetry])

  if (!isOpen) return null

  const tools = stats?.tools || {}
  const totalCalls = stats?.total_executions || 0
  const avgMs = stats?.avg_duration_ms || 0
  const p95Ms = stats?.p95_duration_ms || 0
  const errorRate = stats?.error_rate_pct || 0

  return (
    <div className="telemetry-overlay" onClick={onClose}>
      <div className="telemetry-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="telemetry-header">
          <div className="telemetry-title-group">
            <Activity size={20} color="var(--accent-cyan)" />
            <h3>System Telemetry & Observability</h3>
            <span className="telemetry-badge">Past 24h</span>
          </div>
          <div className="telemetry-actions">
            <button 
              className="btn-icon" 
              onClick={fetchTelemetry} 
              title="Refresh Metrics"
              disabled={loading}
              style={{ width: '32px', height: '32px' }}
            >
              <RefreshCw size={15} className={loading ? 'spin-animation' : ''} />
            </button>
            <button 
              className="btn-icon" 
              onClick={onClose} 
              title="Close"
              style={{ width: '32px', height: '32px' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="telemetry-metrics-grid">
          <div className="telemetry-stat-card">
            <div className="stat-label">
              <Zap size={14} color="var(--accent-cyan)" />
              <span>Total Tool Calls</span>
            </div>
            <div className="stat-value">{totalCalls}</div>
          </div>

          <div className="telemetry-stat-card">
            <div className="stat-label">
              <Clock size={14} color="var(--accent-amber)" />
              <span>Avg Latency</span>
            </div>
            <div className="stat-value">{avgMs} <span className="stat-unit">ms</span></div>
          </div>

          <div className="telemetry-stat-card">
            <div className="stat-label">
              <Clock size={14} color="var(--text-muted)" />
              <span>p95 Latency</span>
            </div>
            <div className="stat-value">{p95Ms} <span className="stat-unit">ms</span></div>
          </div>

          <div className="telemetry-stat-card">
            <div className="stat-label">
              <AlertTriangle size={14} color={errorRate > 5 ? 'var(--accent-red)' : 'var(--accent-green)'} />
              <span>Error Rate</span>
            </div>
            <div className="stat-value" style={{ color: errorRate > 5 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
              {errorRate}%
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="telemetry-tabs">
          <button 
            className={`telemetry-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Tools Breakdown
          </button>
          <button 
            className={`telemetry-tab ${activeTab === 'executions' ? 'active' : ''}`}
            onClick={() => setActiveTab('executions')}
          >
            Execution Waterfall ({recent.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="telemetry-content-scroll">
          {activeTab === 'overview' && (
            <div className="telemetry-table-wrapper">
              <table className="telemetry-table">
                <thead>
                  <tr>
                    <th>Tool Name</th>
                    <th>Calls</th>
                    <th>Failures</th>
                    <th>Error Rate</th>
                    <th>Avg Latency</th>
                    <th>p50 Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(tools).length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>
                        No tool calls recorded yet in the past 24 hours.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(tools).map(([name, data]) => (
                      <tr key={name}>
                        <td><code>{name}</code></td>
                        <td>{data.count}</td>
                        <td style={{ color: data.failures > 0 ? 'var(--accent-red)' : 'inherit' }}>
                          {data.failures}
                        </td>
                        <td style={{ color: data.error_rate_pct > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                          {data.error_rate_pct}%
                        </td>
                        <td>{data.avg_duration_ms} ms</td>
                        <td>{data.p50_duration_ms} ms</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'executions' && (
            <div className="telemetry-execution-list">
              {recent.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '30px' }}>
                  No execution logs recorded yet.
                </div>
              ) : (
                recent.map((exec) => (
                  <div key={exec.id} className={`telemetry-execution-item ${exec.success ? 'success' : 'failure'}`}>
                    <div className="exec-status-col">
                      {exec.success ? (
                        <CheckCircle size={16} color="var(--accent-green)" />
                      ) : (
                        <AlertTriangle size={16} color="var(--accent-red)" />
                      )}
                    </div>
                    <div className="exec-main-col">
                      <div className="exec-header-line">
                        <span className="exec-tool-name">{exec.tool_name}</span>
                        <span className="exec-latency">{exec.duration_ms} ms</span>
                        <span className="exec-time">{new Date(exec.timestamp).toLocaleTimeString()}</span>
                      </div>
                      {exec.args_summary && (
                        <div className="exec-args-preview">{exec.args_summary}</div>
                      )}
                      {exec.error_message && (
                        <div className="exec-error-msg">⚠️ {exec.error_message}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
