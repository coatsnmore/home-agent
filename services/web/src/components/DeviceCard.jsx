import React, { useState } from 'react'
import { 
  Lightbulb, 
  Power, 
  Thermometer, 
  Droplets, 
  Activity, 
  Sun, 
  Battery, 
  Lock, 
  Sliders
} from 'lucide-react'

export function DeviceCard({ device, onControl }) {
  const [level, setLevel] = useState(() => {
    const attr = device.attributes?.find(a => a.name === 'level')
    return attr ? Number(attr.currentValue) : 50
  })

  // Extract attributes
  const switchAttr = device.attributes?.find(a => a.name === 'switch')
  const isOn = switchAttr?.currentValue === 'on'

  const tempAttr = device.attributes?.find(a => a.name === 'temperature')
  const humAttr = device.attributes?.find(a => a.name === 'humidity')
  const motionAttr = device.attributes?.find(a => a.name === 'motion')
  const luxAttr = device.attributes?.find(a => a.name === 'illuminance')
  const batteryAttr = device.attributes?.find(a => a.name === 'battery')

  const hasDimmer = device.capabilities?.includes('SwitchLevel') || !!device.attributes?.find(a => a.name === 'level')
  const isLock = device.capabilities?.includes('Lock')

  const handleToggle = (e) => {
    const nextState = e.target.checked ? 'on' : 'off'
    if (onControl) {
      onControl(device.id, nextState)
    }
  }

  const handleSliderChange = (e) => {
    const newLevel = Number(e.target.value)
    setLevel(newLevel)
  }

  const handleSliderCommit = () => {
    if (onControl) {
      onControl(device.id, `setLevel/${level}`)
    }
  }

  // Choose icon
  const renderIcon = () => {
    if (isLock) return <Lock size={18} />
    if (tempAttr && !switchAttr) return <Thermometer size={18} />
    if (hasDimmer || device.label?.toLowerCase().includes('light')) return <Lightbulb size={18} />
    return <Power size={18} />
  }

  return (
    <div className={`device-card ${isOn ? 'active' : ''}`}>
      <div className="device-card-header">
        <div className="device-info">
          <div className="device-icon-box">
            {renderIcon()}
          </div>
          <div>
            <div className="device-name">{device.label || device.name}</div>
            <div className="device-meta">ID: {device.id} • {device.type || 'Hubitat Device'}</div>
          </div>
        </div>

        {switchAttr && (
          <label className="toggle-switch">
            <input 
              type="checkbox" 
              checked={isOn} 
              onChange={handleToggle}
            />
            <span className="toggle-slider"></span>
          </label>
        )}
      </div>

      {/* Dimmer Slider */}
      {hasDimmer && isOn && (
        <div className="slider-container">
          <Sliders size={14} color="var(--text-dim)" />
          <input 
            type="range" 
            min="1" 
            max="100" 
            value={level} 
            onChange={handleSliderChange}
            onMouseUp={handleSliderCommit}
            onTouchEnd={handleSliderCommit}
            className="slider-input"
          />
          <span className="slider-value">{level}%</span>
        </div>
      )}

      {/* Sensor Badges */}
      {(tempAttr || humAttr || motionAttr || luxAttr || batteryAttr) && (
        <div className="telemetry-row">
          {tempAttr && (
            <span className="badge">
              <Thermometer size={12} color="var(--accent-amber)" />
              {tempAttr.currentValue}°
            </span>
          )}
          {humAttr && (
            <span className="badge">
              <Droplets size={12} color="var(--accent-cyan)" />
              {humAttr.currentValue}%
            </span>
          )}
          {luxAttr && (
            <span className="badge">
              <Sun size={12} color="var(--accent-amber)" />
              {luxAttr.currentValue} lx
            </span>
          )}
          {motionAttr && (
            <span className="badge">
              <Activity size={12} color={motionAttr.currentValue === 'active' ? 'var(--primary)' : 'var(--text-dim)'} />
              {motionAttr.currentValue}
            </span>
          )}
          {batteryAttr && (
            <span className="badge">
              <Battery size={12} />
              {batteryAttr.currentValue}%
            </span>
          )}
        </div>
      )}
    </div>
  )
}
