import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Per-task text cleaning and summarization strategy for speech synthesis.
 * - Weather: Speaks the complete, full weather report (current temp, feels like, highs/lows, humidity, wind).
 * - Internet Search / Research: Speaks a concise executive summary of up to 3 complete sentences (~400 chars),
 *   stopping cleanly on a sentence boundary without ever cutting off mid-sentence or mid-word.
 * - Smart Home / General: Speaks concise status confirmations.
 */
export function cleanTextForSpeech(rawText) {
  if (!rawText) return ''
  let text = String(rawText).trim()

  // 1. Remove thinking / internal tags if any
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')

  // 2. Identify task type
  const isWeather = /\b(weather|temperature|forecast|feels like|today's high|wind speed)\b/i.test(text)

  // 3. Extract weather metrics if only provided in markdown table
  let weatherSpokenSupplement = ''
  if (isWeather) {
    const tempMatch = text.match(/\|\s*Temperature\s*\|\s*([0-9.]+\s*°?F?)/i)
    const condMatch = text.match(/\|\s*Condition\s*\|\s*([^|\n]+)\|/i)
    const feelsMatch = text.match(/\|\s*Feels Like\s*\|\s*([0-9.]+\s*°?F?)/i)
    const highMatch = text.match(/\|\s*Today's High\s*\|\s*([0-9.]+\s*°?F?)/i)
    const lowMatch = text.match(/\|\s*Today's Low\s*\|\s*([0-9.]+\s*°?F?)/i)
    const humMatch = text.match(/\|\s*Humidity\s*\|\s*([0-9.]+\s*%?)/i)
    const windMatch = text.match(/\|\s*Wind Speed\s*\|\s*([0-9.]+\s*mph?)/i)

    const textBeforeTable = text.split(/^[ \t]*\|/m)[0].trim()
    if (tempMatch && textBeforeTable.length < 50) {
      const parts = []
      if (condMatch) parts.push(`It is ${condMatch[1].trim()}`)
      if (tempMatch) parts.push(`with a temperature of ${tempMatch[1].trim()}`)
      if (feelsMatch) parts.push(`feels like ${feelsMatch[1].trim()}`)
      if (highMatch && lowMatch) parts.push(`today's high is ${highMatch[1].trim()} and low is ${lowMatch[1].trim()}`)
      if (humMatch) parts.push(`humidity is ${humMatch[1].trim()}`)
      if (windMatch) parts.push(`wind speed is ${windMatch[1].trim()}`)
      weatherSpokenSupplement = parts.join(', ') + '.'
    }
  }

  // 4. Strip markdown tables
  text = text.replace(/^[ \t]*\|.*\|[ \t]*$/gm, '')
  text = text.replace(/\|/g, ' ')

  // 5. Append weather supplement if generated
  if (weatherSpokenSupplement) {
    text = `${text} ${weatherSpokenSupplement}`.trim()
  }

  // 6. Strip code blocks, links, URLs, and ref tokens
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/\[\d+\]/g, '') // remove citation numbers like [1], [2]
  text = text.replace(/ref:\/\/\S+/g, '') // remove ref:// tokens from DDG
  text = text.replace(/https?:\/\/\S+/g, '')

  // 7. Strip markdown formatting symbols (preserve decimals and negative numbers)
  text = text.replace(/[*_~#]/g, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/^\s*[-*+>]\s+/gm, '')

  // 8. Natural spoken phonetic expansions
  text = text.replace(/°\s*F\b/gi, ' degrees')
  text = text.replace(/°\s*C\b/gi, ' degrees Celsius')
  text = text.replace(/°\b/g, ' degrees')
  text = text.replace(/\b(\d+(\.\d+)?)\s*mph\b/gi, '$1 miles per hour')
  text = text.replace(/\b(\d+(\.\d+)?)\s*%/g, '$1 percent')

  // Clean excessive spaces and newlines
  text = text.replace(/\s+/g, ' ').trim()

  // 9. Sentence Segmentation
  let sentences = []
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
    sentences = Array.from(segmenter.segment(text))
      .map((s) => s.segment.trim())
      .filter(Boolean)
  } else {
    sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text]
    sentences = sentences.map((s) => s.trim()).filter(Boolean)
  }

  if (sentences.length === 0) return ''

  // 10. Per-Task Execution
  if (isWeather) {
    // For weather: Speak the complete report without arbitrary truncation
    const weatherSentences = []
    let totalLen = 0
    for (const s of sentences) {
      if (totalLen + s.length > 700 && weatherSentences.length >= 2) break
      weatherSentences.push(s)
      totalLen += s.length + 1
    }
    let speech = weatherSentences.join(' ').trim()
    if (!/[.!?]$/.test(speech)) speech += '.'
    return speech
  }

  // For Internet Search & General Research:
  // Deliver a clear, complete executive summary (up to 3 complete sentences, ~400 chars)
  // NEVER cut off in the middle of a sentence
  const targetChars = 400
  const summarySentences = []
  let accumulated = 0

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    if (summarySentences.length === 0 || (accumulated + s.length <= targetChars && summarySentences.length < 3)) {
      summarySentences.push(s)
      accumulated += s.length + 1
    } else {
      break
    }
  }

  let speech = summarySentences.join(' ').trim()
  if (!/[.!?]$/.test(speech)) speech += '.'
  return speech
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
