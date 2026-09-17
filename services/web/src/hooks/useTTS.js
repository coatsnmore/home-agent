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

  // Drop raw JSON tool payloads if leaked into chat text
  if (/^\s*\{[\s\S]*\}\s*$/.test(text)) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') return ''
    } catch {}
  }

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
 * Hybrid Text-to-Speech hook:
 * Prioritizes containerized Piper Neural TTS for natural, high-fidelity offline voice,
 * with instantaneous automatic fallback to browser Web Speech API (SpeechSynthesis).
 */
export function useTTS(options = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isNeuralAvailable, setIsNeuralAvailable] = useState(false)
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(null)

  const utteranceRef = useRef(null)
  const audioContextRef = useRef(null)
  const activeSourceRef = useRef(null)
  const abortControllerRef = useRef(null)

  // Probe neural TTS sidecar availability
  useEffect(() => {
    let mounted = true
    const probeNeuralTts = async () => {
      try {
        const res = await fetch('/tts/health', { signal: AbortSignal.timeout(2500) })
        if (res.ok) {
          const data = await res.json()
          if (mounted) {
            setIsNeuralAvailable(data.is_ready === true || data.status === 'healthy')
          }
        } else if (mounted) {
          setIsNeuralAvailable(false)
        }
      } catch {
        if (mounted) setIsNeuralAvailable(false)
      }
    }

    probeNeuralTts()
    const interval = setInterval(probeNeuralTts, 15000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  // Load browser speech voices on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices()
      setVoices(availableVoices)
      
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

  // Instant mute / cancellation
  const cancel = useCallback(() => {
    // Abort ongoing neural fetch if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // Stop active Web Audio source
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop()
        activeSourceRef.current.disconnect()
      } catch {}
      activeSourceRef.current = null
    }

    // Cancel browser SpeechSynthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    setIsSpeaking(false)
  }, [])

  // Browser SpeechSynthesis fallback execution
  const speakBrowserFallback = useCallback((cleanSpeech, opts = {}) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return Promise.resolve()
    }

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
  }, [options, selectedVoice])

  // Primary speak method with neural pipeline + browser fallback
  const speak = useCallback(async (rawText, opts = {}) => {
    const cleanSpeech = cleanTextForSpeech(rawText)
    if (!cleanSpeech || cleanSpeech.trim().length === 0) return Promise.resolve()

    cancel()

    // 1. If Neural TTS is available, attempt neural synthesis
    if (isNeuralAvailable) {
      try {
        abortControllerRef.current = new AbortController()
        setIsSpeaking(true)

        // Set a 6-second timeout for neural synthesis to ensure instant fallback if container hangs
        let timedOut = false
        const timeoutId = setTimeout(() => {
          timedOut = true
          if (abortControllerRef.current) abortControllerRef.current.abort()
        }, 6000)

        let res
        try {
          res = await fetch('/tts/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: cleanSpeech,
              voice: opts.voice || 'en_US-lessac-medium',
            }),
            signal: abortControllerRef.current.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (!res.ok) {
          throw new Error(`Neural TTS returned HTTP ${res.status}`)
        }

        const arrayBuffer = await res.arrayBuffer()
        
        // Initialize or reuse Web AudioContext
        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new AudioContextClass()
        }

        const ctx = audioContextRef.current
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(ctx.destination)
        activeSourceRef.current = source

        return new Promise((resolve) => {
          source.onended = () => {
            setIsSpeaking(false)
            activeSourceRef.current = null
            resolve()
          }
          source.start(0)
        })
      } catch (err) {
        if (err.name === 'AbortError' && !timedOut) {
          // User deliberately cancelled or interrupted
          setIsSpeaking(false)
          return Promise.resolve()
        }
        // If container threw an error or timed out, mark unavailable and fall back immediately
        setIsNeuralAvailable(false)
        console.warn('[useTTS] Neural TTS unavailable or timed out, falling back to browser SpeechSynthesis:', err.message)
      }
    }

    // 2. Fallback to Native Browser SpeechSynthesis
    return speakBrowserFallback(cleanSpeech, opts)
  }, [cancel, isNeuralAvailable, speakBrowserFallback])

  return {
    speak,
    cancel,
    isSpeaking,
    isNeuralAvailable,
    voices,
    selectedVoice,
    setSelectedVoice,
  }
}
