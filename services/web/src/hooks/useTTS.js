import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Strips markdown, skips ASCII tables, and extracts a concise spoken summary
 * so voice output remains fast, natural, and never reads out raw tables.
 */
export function cleanTextForSpeech(rawText) {
  if (!rawText) return ''
  let text = String(rawText).trim()

  // 1. Remove thinking / internal tags if any
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')

  // 2. Check if a markdown table is present and strip all table rows
  const hasTable = /^[ \t]*\|.*\|[ \t]*$/m.test(text)
  text = text.replace(/^[ \t]*\|.*\|[ \t]*$/gm, '')
  text = text.replace(/\|/g, ' ')

  // 3. Strip code blocks and urls
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/https?:\/\/\S+/g, '')

  // 4. Strip markdown formatting symbols (preserve decimals and negative numbers)
  text = text.replace(/[*_~#]/g, '')
  // Strip ordered list prefixes (e.g. "1. ") without stripping standalone numbers
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  // Strip bullet markers at line starts
  text = text.replace(/^\s*[-*+>]\s+/gm, '')

  // 5. Clean excessive spaces and newlines
  text = text.replace(/\s+/g, ' ').trim()

  // 6. If a table was removed and remaining text is short, add natural context
  if (hasTable && text.length < 40) {
    text = text ? `${text} I've displayed the full table on your screen.` : "I've displayed the details on your screen."
  }

  // 7. Limit duration: extract the first 2 concise sentences using Intl.Segmenter (never breaks decimals)
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
    const sentences = Array.from(segmenter.segment(text))
      .map((s) => s.segment.trim())
      .filter(Boolean)

    if (sentences.length > 0) {
      const summary = sentences.slice(0, 2).join(' ').trim()
      if (summary.length <= 250) {
        return summary
      }
    }
  }

  // Fallback if very long single block without sentence breaks
  if (text.length > 200) {
    const truncated = text.substring(0, 200)
    const lastSpace = truncated.lastIndexOf(' ')
    return (lastSpace > 120 ? truncated.substring(0, lastSpace) : truncated) + '.'
  }

  return text
}

/**
 * Offline-first browser Text-to-Speech hook utilizing Web Speech API
 * with automatic markdown table summarization and instant mute support.
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
      
      // Auto-select preferred natural English voice
      if (!selectedVoice && availableVoices.length > 0) {
        const preferred = availableVoices.find(v => 
          v.name.includes('Samantha') || 
          v.name.includes('Natural') || 
          v.name.includes('Siri') ||
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

  const speak = useCallback((rawText, opts = {}) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis is not supported in this browser.')
      return Promise.resolve()
    }

    // Prepare concise spoken text
    const cleanSpeech = cleanTextForSpeech(rawText)
    if (!cleanSpeech || cleanSpeech.trim().length === 0) return Promise.resolve()

    cancel()

    return new Promise((resolve, reject) => {
      try {
        const utterance = new SpeechSynthesisUtterance(cleanSpeech)
        utteranceRef.current = utterance

        if (selectedVoice) {
          utterance.voice = selectedVoice
        }

        utterance.rate = opts.rate ?? options.rate ?? 1.05
        utterance.pitch = opts.pitch ?? options.pitch ?? 1.0
        utterance.volume = opts.volume ?? options.volume ?? 1.0

        utterance.onstart = () => setIsSpeaking(true)
        utterance.onend = () => {
          setIsSpeaking(false)
          resolve()
        }
        utterance.onerror = (err) => {
          setIsSpeaking(false)
          // Don't reject on intentional cancel
          if (err.error === 'canceled' || err.error === 'interrupted') {
            resolve()
          } else {
            reject(err)
          }
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
