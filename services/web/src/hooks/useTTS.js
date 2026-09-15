import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Offline-first browser Text-to-Speech hook utilizing Web Speech API
 */
export function useTTS(options = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(null)
  const utteranceRef = useRef(null)

  // Load available voices on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices()
      setVoices(availableVoices)
      
      // Auto-select preferred English voice
      if (!selectedVoice && availableVoices.length > 0) {
        const preferred = availableVoices.find(v => 
          v.name.includes('Samantha') || 
          v.name.includes('Natural') || 
          (v.lang && v.lang.startsWith('en'))
        ) || availableVoices[0]
        setSelectedVoice(preferred)
      }
    }

    updateVoices()
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices)

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', updateVoices)
    }
  }, [selectedVoice])

  const cancel = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
    }
  }, [])

  const speak = useCallback((text, opts = {}) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis is not supported in this browser.')
      return Promise.resolve()
    }

    if (!text || String(text).trim().length === 0) return Promise.resolve()

    cancel()

    return new Promise((resolve, reject) => {
      try {
        const utterance = new SpeechSynthesisUtterance(String(text))
        utteranceRef.current = utterance

        if (selectedVoice) {
          utterance.voice = selectedVoice
        }

        utterance.rate = opts.rate ?? options.rate ?? 1.0
        utterance.pitch = opts.pitch ?? options.pitch ?? 1.0
        utterance.volume = opts.volume ?? options.volume ?? 1.0

        utterance.onstart = () => setIsSpeaking(true)
        utterance.onend = () => {
          setIsSpeaking(false)
          resolve()
        }
        utterance.onerror = (err) => {
          setIsSpeaking(false)
          reject(err)
        }

        window.speechSynthesis.speak(utterance)
      } catch (e) {
        setIsSpeaking(false)
        reject(e)
      }
    })
  }, [cancel, options, selectedVoice])

  return {
    speak,
    cancel,
    isSpeaking,
    voices,
    selectedVoice,
    setSelectedVoice,
  }
}
