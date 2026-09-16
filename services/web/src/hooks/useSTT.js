import { useState, useEffect, useRef, useCallback } from 'react'
import { ASSISTANT_CONFIG } from '../config/assistantConfig'

let whisperInstance = null
let whisperLoadingPromise = null

async function getWhisperPipeline() {
  if (whisperInstance) return whisperInstance
  if (!whisperLoadingPromise) {
    whisperLoadingPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers')
      env.allowLocalModels = false
      env.useBrowserCache = true
      const p = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')
      whisperInstance = p
      return p
    })().catch((err) => {
      whisperLoadingPromise = null
      throw err
    })
  }
  return whisperLoadingPromise
}

/**
 * Accurately resamples decoded audio from hardware rate (44.1k/48k on Mac) to 16kHz for Whisper
 */
async function resampleBlobTo16kHz(blob) {
  const arrayBuffer = await blob.arrayBuffer()
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const tempCtx = new AudioCtx()
  const decoded = await tempCtx.decodeAudioData(arrayBuffer)
  await tempCtx.close().catch(() => {})

  if (decoded.sampleRate === 16000) {
    return decoded.getChannelData(0)
  }

  const targetLength = Math.max(1, Math.ceil(decoded.duration * 16000))
  const offlineCtx = new OfflineAudioContext(1, targetLength, 16000)
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start(0)
  const rendered = await offlineCtx.startRendering()
  return rendered.getChannelData(0)
}

const HALLUCINATIONS = new Set([
  'you', 'thank you', 'thanks', 'bye', 'goodbye', 'so', 'watching',
  'subtitles', 'thank you for watching', 'thanks for watching',
  'please subscribe', 'subscribe', 'the end', 'amara.org',
  'closed captions', 'captions by', 'music', 'background music',
  'applause', 'silence', 'beep', 'cough', 'sigh', 'throat clearing',
  'humming', 'yeah', 'yep', 'ok', 'okay', 'no', 'yes', 'um', 'uh', 'ah', 'oh'
])

const SINGLE_WORD_COMMANDS = new Set([
  'weather', 'lights', 'stop', 'mute', 'cancel', 'status', 'help',
  'temperature', 'off', 'on', 'dim'
])

/**
 * Validates whether transcript is genuine human language/command
 * rather than background noise, music, or ASR hallucinations.
 */
export function isValidHumanSpeech(rawText) {
  if (!rawText) return false
  let text = String(rawText).trim()

  // Strip music notations and bracketed artifacts (e.g. [music], (applause), ♪♪)
  text = text.replace(/[\u2669-\u266f]/g, '').replace(/\[.*?\]|\(.*?\)/g, '').trim()
  if (!text) return false

  const clean = text.toLowerCase().replace(/^[^\w\s]+|[^\w\s]+$/g, '').trim()
  if (clean.length < 2) return false
  if (HALLUCINATIONS.has(clean)) return false

  // Reject filler sound chains like "uh uh", "um mm", "ah"
  if (/^(uh|um|ah|oh|er|hmm|mm|huh|shh)(\s+(uh|um|ah|oh|er|hmm|mm|huh|shh))*$/i.test(clean)) {
    return false
  }

  const words = clean.split(/\s+/).filter(Boolean)
  return words.length >= 1
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1] 
        ? d[i - 1][j - 1] 
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1])
    }
  }
  return d[m][n]
}

export const DEFAULT_WAKE_WORDS = ASSISTANT_CONFIG.getWakeWords()

/**
 * Checks whether text contains a wake word, returning the matched wake word
 * and any command that followed or preceded it.
 * Supports exact variants ("Hey Skeletron") and phonetic fuzzy matching ("Hey skeleton").
 */
export function extractWakeWordCommand(text, wakeWords = ASSISTANT_CONFIG.getWakeWords()) {
  if (!text) return null
  const lower = String(text).toLowerCase()
  const primary = (ASSISTANT_CONFIG.getPrimaryWakeWord() || 'Skeletron').toLowerCase()

  // 1. Direct match with configured wake words and phonetic aliases
  const sorted = [...wakeWords].sort((a, b) => b.length - a.length)
  for (const ww of sorted) {
    const wwLower = ww.toLowerCase()
    const idx = lower.indexOf(wwLower)
    if (idx !== -1) {
      // Check word boundaries before and after to avoid partial matches
      const charBefore = idx > 0 ? lower[idx - 1] : ' '
      const charAfter = idx + wwLower.length < lower.length ? lower[idx + wwLower.length] : ' '
      if (/[a-z0-9]/i.test(charBefore) || /[a-z0-9]/i.test(charAfter)) {
        continue
      }

      const after = text.substring(idx + wwLower.length).replace(/^[,\s.!?:;-]+/, '').trim()
      const before = text.substring(0, idx).replace(/[,\s.!?:;-]+$/, '').trim()

      console.log(`[STT] Exact/alias wake-word match: "${ww}" in "${text}"`)
      return {
        matchedWakeWord: ww,
        command: after || before || '',
      }
    }
  }

  // 2. Fuzzy phonetic word matching (handles ASR transcribing "Skeletron" as "skeleton" / "skeletor")
  const wordsWithOffsets = []
  const regex = /[a-z0-9]+/gi
  let match
  while ((match = regex.exec(text)) !== null) {
    wordsWithOffsets.push({
      word: match[0].toLowerCase(),
      index: match.index,
      length: match[0].length,
    })
  }

  for (let i = 0; i < wordsWithOffsets.length; i++) {
    const item = wordsWithOffsets[i]
    const dist = levenshtein(item.word, primary)
    const maxAllowedDist = primary.length >= 6 ? 2 : (primary.length >= 4 ? 1 : 0)
    const hasPrefix = i > 0 && ['hey', 'ok', 'okay', 'hi'].includes(wordsWithOffsets[i - 1].word)

    if (dist <= maxAllowedDist || (hasPrefix && dist <= maxAllowedDist + 1)) {
      const matchStart = hasPrefix ? wordsWithOffsets[i - 1].index : item.index
      const matchEnd = item.index + item.length

      const after = text.substring(matchEnd).replace(/^[,\s.!?:;-]+/, '').trim()
      const before = text.substring(0, matchStart).replace(/[,\s.!?:;-]+$/, '').trim()

      console.log(`[STT] Fuzzy wake-word match: "${item.word}" matched primary "${primary}" (distance: ${dist})`)
      return {
        matchedWakeWord: primary,
        command: after || before || '',
      }
    }
  }

  return null
}

/**
 * Checks if the given text is solely a wake word (with no substantive command attached).
 */
export function isWakeWordOnly(text, wakeWords = ASSISTANT_CONFIG.getWakeWords()) {
  if (!text) return false
  const trimmed = String(text).trim().toLowerCase()
  for (const ww of wakeWords) {
    if (trimmed === ww.toLowerCase()) return true
  }
  const match = extractWakeWordCommand(text, wakeWords)
  if (!match) return false
  return !match.command || !isValidHumanSpeech(match.command)
}

/**
 * Synthesizes a futuristic two-tone chime via Web Audio API when wake word triggers.
 */
export function playWakeChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime

    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(587.33, now)
    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(0.18, now + 0.03)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.2)

    // Tone 2: 880 Hz (A5)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(880, now + 0.12)
    gain2.gain.setValueAtTime(0, now + 0.12)
    gain2.gain.linearRampToValueAtTime(0.22, now + 0.15)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.4)

    setTimeout(() => {
      ctx.close().catch(() => {})
    }, 500)
  } catch (e) {
    console.warn('Wake chime playback notice:', e)
  }
}

/**
 * Continuous conversational Speech-to-Text hook with real-time VAD volume metering,
 * frequency-selective human voice filtering, passive wake-word mode, 16kHz local Whisper,
 * and hands-free turn-taking.
 */
export function useSTT({
  onTranscriptReady,
  onSpeechStart,
  isAssistantBusy = false,
  initialWakeWordMode = false,
  wakeWords = DEFAULT_WAKE_WORDS,
} = {}) {
  // 'idle' | 'passive' | 'listening' | 'transcribing' | 'paused' | 'denied' | 'error'
  const [micState, setMicState] = useState('idle')
  const [isWakeWordMode, setIsWakeWordMode] = useState(initialWakeWordMode)
  const [transcript, setTranscript] = useState('')
  const [volumeLevel, setVolumeLevel] = useState(0) // 0 to 1
  const [errorMessage, setErrorMessage] = useState(null)

  const isContinuousRef = useRef(false)
  const isWakeWordModeRef = useRef(initialWakeWordMode)
  const wakeWordsRef = useRef(wakeWords)
  const wakeWordActiveRef = useRef(false)
  const wakeWordTimeoutRef = useRef(null)
  const isAssistantBusyRef = useRef(isAssistantBusy)
  const mediaStreamRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recordingStartTimeRef = useRef(0)
  const recognitionRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const hasSpokenRef = useRef(false)
  const consecutiveVoiceFramesRef = useRef(0)
  const noiseFloorRef = useRef(15)
  const currentTranscriptRef = useRef('')
  const pendingCommandRef = useRef('')
  const speechPauseTimerRef = useRef(null)
  const turnSubmittedRef = useRef(false)
  const micStateRef = useRef('idle')
  const hasPermanentSpeechErrorRef = useRef(false)
  const useWhisperFallbackRef = useRef(false)

  // Pre-warm Whisper model quietly in background
  useEffect(() => {
    getWhisperPipeline().catch((e) => {
      console.warn('Whisper pre-warm notice:', e.message)
    })
  }, [])

  // Audio analysis loop for frequency-selective voice detection
  const setupAudioMeter = (stream) => {
    try {
      if (!stream) return
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        return
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return

      const audioCtx = new AudioCtx()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.4
      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)

      audioContextRef.current = audioCtx
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateMeter = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)

        // Bins 1..16 cover ~180Hz to 3000Hz (human vocal tract fundamentals)
        let vocalSum = 0
        const maxVocalBin = Math.min(16, dataArray.length)
        for (let i = 1; i < maxVocalBin; i++) {
          vocalSum += dataArray[i]
        }
        const vocalAvg = vocalSum / Math.max(1, maxVocalBin - 1)

        let totalSum = 0
        for (let i = 0; i < dataArray.length; i++) {
          totalSum += dataArray[i]
        }
        const totalAvg = totalSum / dataArray.length

        // Track ambient noise floor adaptively
        noiseFloorRef.current = noiseFloorRef.current * 0.97 + totalAvg * 0.03

        // Normalized UI meter level
        const normalized = Math.max(0, Math.min(1, (vocalAvg - Math.max(8, noiseFloorRef.current)) / 45))
        setVolumeLevel(normalized)

        // Sensible Voice Detection above noise floor
        const isVoiceActive = normalized > 0.12 || (vocalAvg > noiseFloorRef.current + 8)

        // Instant barge-in: stop speaker output when user starts speaking
        if (normalized > 0.15 || vocalAvg > noiseFloorRef.current + 10) {
          if (!hasSpokenRef.current) {
            hasSpokenRef.current = true
            if (onSpeechStart) {
              onSpeechStart() // Immediate barge-in: stop speaker output!
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(updateMeter)
      }

      updateMeter()
    } catch (e) {
      console.warn('Audio meter initialization warning:', e)
    }
  }

  const stopAudioMeterOnly = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    consecutiveVoiceFramesRef.current = 0
    setVolumeLevel(0)
  }

  const tearDownAll = () => {
    stopAudioMeterOnly()
    if (speechPauseTimerRef.current) {
      clearTimeout(speechPauseTimerRef.current)
      speechPauseTimerRef.current = null
    }
    pendingCommandRef.current = ''
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null
        recognitionRef.current.onerror = null
        recognitionRef.current.onend = null
        recognitionRef.current.abort()
      } catch {}
      recognitionRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop() } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }

  // Starts a recording turn using the existing (or new) media stream
  const startRecordingTurn = useCallback(() => {
    const hasWebSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    if (!mediaStreamRef.current && !hasWebSpeech) {
      console.warn('[STT] Cannot start turn: no media stream and no WebSpeech API available.')
      return
    }

    // Clean up any previously running recognition before starting fresh
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null
        recognitionRef.current.onerror = null
        recognitionRef.current.onend = null
        recognitionRef.current.abort()
      } catch {}
      recognitionRef.current = null
    }

    turnSubmittedRef.current = false
    setTranscript('')
    currentTranscriptRef.current = ''
    pendingCommandRef.current = ''
    if (speechPauseTimerRef.current) {
      clearTimeout(speechPauseTimerRef.current)
      speechPauseTimerRef.current = null
    }
    hasSpokenRef.current = false
    consecutiveVoiceFramesRef.current = 0
    audioChunksRef.current = []
    recordingStartTimeRef.current = Date.now()
    if (mediaStreamRef.current) {
      setupAudioMeter(mediaStreamRef.current)
    }

    // In wake-word mode, we stay in 'passive' standby until wake word is heard
    const targetState = isWakeWordModeRef.current && !wakeWordActiveRef.current ? 'passive' : 'listening'
    micStateRef.current = targetState
    setMicState(targetState)
    console.log('[STT] startRecordingTurn - targetState:', targetState, 'wakeWordMode:', isWakeWordModeRef.current)

    // Commits a prompt submission after speech silence/pause or final utterance
    const commitSubmission = (commandText) => {
      if (turnSubmittedRef.current) return
      const trimmed = String(commandText || '').trim()
      if (!trimmed || isWakeWordOnly(trimmed, wakeWordsRef.current) || !isValidHumanSpeech(trimmed)) {
        return
      }

      if (speechPauseTimerRef.current) {
        clearTimeout(speechPauseTimerRef.current)
        speechPauseTimerRef.current = null
      }

      turnSubmittedRef.current = true
      wakeWordActiveRef.current = false
      if (wakeWordTimeoutRef.current) {
        clearTimeout(wakeWordTimeoutRef.current)
        wakeWordTimeoutRef.current = null
      }

      console.log('[STT] Committing speech command after natural break:', trimmed)
      setTranscript(trimmed)
      currentTranscriptRef.current = trimmed
      if (onTranscriptReady) onTranscriptReady(trimmed)

      micStateRef.current = 'paused'
      setMicState('paused')

      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
      }

      setTimeout(() => {
        setTranscript('')
        currentTranscriptRef.current = ''
        pendingCommandRef.current = ''
      }, 300)
    }

    // Schedules debounced submission waiting for a natural speech pause (1300ms)
    const scheduleSubmission = (commandText, delayMs = 1300) => {
      if (turnSubmittedRef.current) return
      const trimmed = String(commandText || '').trim()
      if (!trimmed || isWakeWordOnly(trimmed, wakeWordsRef.current) || !isValidHumanSpeech(trimmed)) {
        return
      }

      pendingCommandRef.current = trimmed

      if (speechPauseTimerRef.current) {
        clearTimeout(speechPauseTimerRef.current)
      }

      speechPauseTimerRef.current = setTimeout(() => {
        commitSubmission(pendingCommandRef.current)
      }, delayMs)
    }

    // Evaluates a candidate speech transcript against wake-word or direct command rules
    const handleCandidate = (rawCandidateText, isFinalChunk = false) => {
      if (turnSubmittedRef.current) return true
      if (!rawCandidateText) return false
      const trimmed = String(rawCandidateText).trim()
      if (!trimmed) return false

      console.log('[STT] handleCandidate:', trimmed, '(wakeWordMode:', isWakeWordModeRef.current, 'active:', wakeWordActiveRef.current, 'isFinal:', isFinalChunk, ')')

      if (isWakeWordModeRef.current) {
        // Case 1: In active window following wake word
        if (wakeWordActiveRef.current) {
          // Strip wake word prefix if user repeats it (e.g. "Skeletron turn on lights" -> "turn on lights")
          let commandToSubmit = trimmed
          const stripMatch = extractWakeWordCommand(trimmed, wakeWordsRef.current)
          if (stripMatch && stripMatch.command) {
            commandToSubmit = stripMatch.command
          }

          if (isWakeWordOnly(commandToSubmit, wakeWordsRef.current)) {
            console.log('[STT] Wake word repeated in active window, waiting for command...')
            return false
          }

          if (isValidHumanSpeech(commandToSubmit)) {
            setTranscript(commandToSubmit)
            currentTranscriptRef.current = commandToSubmit
            scheduleSubmission(commandToSubmit, 1300)
            return true
          }
          return false
        }

        // Case 2: In passive standby, check for wake word
        const match = extractWakeWordCommand(trimmed, wakeWordsRef.current)
        if (match) {
          console.log('[STT] Wake word matched in passive standby:', match)
          playWakeChime()
          if (onSpeechStart) onSpeechStart()

          wakeWordActiveRef.current = true
          micStateRef.current = 'listening'
          setMicState('listening')

          if (wakeWordTimeoutRef.current) clearTimeout(wakeWordTimeoutRef.current)
          wakeWordTimeoutRef.current = setTimeout(() => {
            console.log('[STT] Wake word listening window timed out after 8s')
            wakeWordActiveRef.current = false
            if (isContinuousRef.current && isWakeWordModeRef.current) {
              startRecordingTurn()
            }
          }, 8000)

          if (match.command && isValidHumanSpeech(match.command) && !isWakeWordOnly(match.command, wakeWordsRef.current)) {
            // Wake word + command in same utterance: e.g. "Skeletron, turn on the lights"
            console.log('[STT] Command found with wake word, scheduling after natural pause:', match.command)
            setTranscript(match.command)
            currentTranscriptRef.current = match.command
            scheduleSubmission(match.command, 1300)
            return true
          } else {
            // Standalone wake word: e.g. "Skeletron" -> enter active listening window without stopping
            console.log('[STT] Standalone wake word detected, listening for command...')
            setTranscript('')
            currentTranscriptRef.current = ''
            pendingCommandRef.current = ''
            return true
          }
        } else {
          return false
        }
      } else {
        // Direct speech mode (wake word disabled)
        if (isValidHumanSpeech(trimmed)) {
          setTranscript(trimmed)
          currentTranscriptRef.current = trimmed
          scheduleSubmission(trimmed, 1300)
          return true
        }
        return false
      }
    }

    // Native Web Speech Recognition (Chrome, Safari, Edge)
    const SpeechRecognition = !useWhisperFallbackRef.current && (window.SpeechRecognition || window.webkitSpeechRecognition)
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition()
        recognition.continuous = false
        recognition.interimResults = true
        recognition.maxAlternatives = 1
        recognition.lang = 'en-US'
        recognitionRef.current = recognition

        let localTranscript = ''

        recognition.onresult = (event) => {
          let fullTranscript = ''
          let isFinal = false
          for (let i = 0; i < event.results.length; ++i) {
            fullTranscript += event.results[i][0].transcript + ' '
            if (event.results[i].isFinal) {
              isFinal = true
            }
          }
          fullTranscript = fullTranscript.trim()
          if (!fullTranscript) return

          hasSpokenRef.current = true

          // Case A: In passive standby waiting for wake word:
          if (isWakeWordModeRef.current && !wakeWordActiveRef.current) {
            // Check if wake word has been spoken
            const match = extractWakeWordCommand(fullTranscript, wakeWordsRef.current)
            if (match) {
              localTranscript = fullTranscript
              handleCandidate(fullTranscript, isFinal)
            }
            // If no wake word was spoken, ignore completely (do not mirror to UI or save as command)
            return
          }

          // Case B: In active window or direct mode:
          localTranscript = fullTranscript

          // Instant barge-in: in direct speech mode, stop speaker immediately when user starts speaking
          if (!isWakeWordModeRef.current && onSpeechStart) {
            onSpeechStart()
          }

          // Evaluate candidate transcript (debounces submission until natural pause)
          handleCandidate(fullTranscript, isFinal)
        }

        recognition.onerror = (err) => {
          console.warn('[STT] SpeechRecognition notice:', err.error)
          if (err.error === 'not-allowed' || err.error === 'service-not-allowed' || err.error === 'audio-capture') {
            // If we have an active hardware audio track from getUserMedia, fall back to offline Whisper
            if (mediaStreamRef.current && mediaStreamRef.current.getAudioTracks().some((t) => t.readyState === 'live')) {
              console.warn(`[STT] SpeechRecognition unavailable (${err.error}), falling back to local Whisper pipeline.`)
              useWhisperFallbackRef.current = true
              if (recognitionRef.current) {
                try {
                  recognitionRef.current.onresult = null
                  recognitionRef.current.onerror = null
                  recognitionRef.current.onend = null
                  recognitionRef.current.abort()
                } catch {}
                recognitionRef.current = null
              }
              startRecordingTurn()
              return
            }

            // Stop continuous restart loop immediately
            isContinuousRef.current = false
            hasPermanentSpeechErrorRef.current = true
            micStateRef.current = 'denied'
            setMicState('denied')
            setErrorMessage('Microphone blocked or device unavailable. Check browser permissions and macOS System Settings > Sound > Input.')
          }
        }

        recognition.onend = () => {
          console.log('[STT] SpeechRecognition onend (submitted:', turnSubmittedRef.current, 'text:', localTranscript, 'pending:', pendingCommandRef.current, 'mode:', isWakeWordModeRef.current ? (wakeWordActiveRef.current ? 'active' : 'passive') : 'direct', ')')
          
          if (!isContinuousRef.current || turnSubmittedRef.current || hasPermanentSpeechErrorRef.current) {
            return
          }

          // 1. In passive standby: we are ONLY listening for the wake word. NEVER commit any speech as a command!
          if (isWakeWordModeRef.current && !wakeWordActiveRef.current) {
            const match = extractWakeWordCommand(localTranscript, wakeWordsRef.current)
            if (match) {
              handleCandidate(localTranscript, true)
              return
            }

            // No wake word heard: cleanly reset and continue waiting in passive standby
            localTranscript = ''
            pendingCommandRef.current = ''
            setTimeout(() => {
              if (isContinuousRef.current && isWakeWordModeRef.current && !wakeWordActiveRef.current && !turnSubmittedRef.current && !hasPermanentSpeechErrorRef.current) {
                startRecordingTurn()
              }
            }, 100)
            return
          }

          // 2. In active wake-word window or direct mode: commit pending command if present
          const candidate = pendingCommandRef.current || (localTranscript && !isWakeWordOnly(localTranscript, wakeWordsRef.current) ? localTranscript : '')
          if (candidate && !isWakeWordOnly(candidate, wakeWordsRef.current) && isValidHumanSpeech(candidate)) {
            commitSubmission(candidate)
            return
          }

          // In active wake-word window, restart listening for the upcoming command
          if (isContinuousRef.current && isWakeWordModeRef.current && wakeWordActiveRef.current) {
            setTimeout(() => {
              if (isContinuousRef.current && isWakeWordModeRef.current && wakeWordActiveRef.current && !turnSubmittedRef.current && !hasPermanentSpeechErrorRef.current) {
                startRecordingTurn()
              }
            }, 100)
            return
          }

          // In direct mode continuous conversation, restart listening for next command
          if (isContinuousRef.current && !isWakeWordModeRef.current) {
            setTimeout(() => {
              if (isContinuousRef.current && !isWakeWordModeRef.current && !turnSubmittedRef.current && !hasPermanentSpeechErrorRef.current) {
                startRecordingTurn()
              }
            }, 100)
          }
        }

        recognition.start()
      } catch (recErr) {
        console.warn('[STT] SpeechRecognition start error:', recErr)
      }
    } else {
      // Fallback: Local Whisper transcription for non-WebSpeech browsers (e.g. Firefox)
      if (!mediaStreamRef.current) {
        setErrorMessage('Speech processing unavailable without microphone access.')
        micStateRef.current = 'error'
        setMicState('error')
        return
      }
      let recorder = null
      try {
        const mimeTypes = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        const supportedMime = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || ''
        recorder = supportedMime 
          ? new MediaRecorder(mediaStreamRef.current, { mimeType: supportedMime }) 
          : new MediaRecorder(mediaStreamRef.current)

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data)
          }
        }

        recorder.onstop = async () => {
          stopAudioMeterOnly()
          if (turnSubmittedRef.current) return

          const recordedDuration = Date.now() - recordingStartTimeRef.current
          if (audioChunksRef.current.length === 0 || recordedDuration < 500) {
            setTranscript('')
            currentTranscriptRef.current = ''
            if (isContinuousRef.current) {
              startRecordingTurn()
            } else {
              micStateRef.current = 'idle'
              setMicState('idle')
            }
            return
          }

          micStateRef.current = 'transcribing'
          setMicState('transcribing')
          try {
            const mime = recorder?.mimeType || 'audio/webm'
            const audioBlob = new Blob(audioChunksRef.current, { type: mime })
            const audioData = await resampleBlobTo16kHz(audioBlob)

            const asr = await getWhisperPipeline()
            const result = await asr(audioData, { chunk_length_s: 30, stride_length_s: 5 })
            const text = result?.text?.trim()
            const handled = handleCandidate(text)
            if (!handled) {
              setTranscript('')
              currentTranscriptRef.current = ''
              if (isContinuousRef.current) {
                startRecordingTurn()
              } else {
                micStateRef.current = 'idle'
                setMicState('idle')
              }
            }
          } catch (whisperErr) {
            console.error('Whisper fallback error:', whisperErr)
            if (isContinuousRef.current) {
              startRecordingTurn()
            } else {
              setErrorMessage('Speech processing failed.')
              micStateRef.current = 'idle'
              setMicState('idle')
            }
          }
        }

        mediaRecorderRef.current = recorder
        recorder.start(250)
      } catch (mediaErr) {
        console.warn('MediaRecorder error:', mediaErr)
      }
    }
  }, [onSpeechStart, onTranscriptReady])

  // Progressive audio stream acquisition across constraints and available audio devices
  const acquireAudioStream = async () => {
    // 0. Reuse active stream if available
    if (mediaStreamRef.current && mediaStreamRef.current.getAudioTracks().some((t) => t.readyState === 'live')) {
      return mediaStreamRef.current
    }

    // 1. Try with advanced DSP audio constraints
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (e1) {
      console.warn('[STT] Advanced audio constraints rejected, trying basic audio constraints:', e1.name, e1.message)
    }

    // 2. Try basic audio: true (avoids CoreAudio VoiceProcessingIO constraints on Bluetooth / external devices)
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e2) {
      console.warn('[STT] Basic audio: true rejected, attempting device enumeration fallback:', e2.name, e2.message)
    }

    // 3. Try enumerating devices to find any working non-default audioinput (e.g. built-in MacBook Pro mic)
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')
        for (const dev of audioInputs) {
          try {
            console.log('[STT] Attempting non-default device fallback:', dev.label || dev.deviceId)
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
              audio: { deviceId: { exact: dev.deviceId } },
            })
            if (fallbackStream) return fallbackStream
          } catch (devErr) {
            console.warn('[STT] Device fallback rejected for', dev.label || dev.deviceId, devErr.name)
          }
        }
      }
    } catch (enumErr) {
      console.warn('[STT] Device enumeration error:', enumErr)
    }

    return null
  }

  // Initializes media stream and enters listening mode
  const startListening = useCallback(async (isWakeWord = isWakeWordModeRef.current) => {
    tearDownAll()
    hasPermanentSpeechErrorRef.current = false
    wakeWordActiveRef.current = false
    pendingCommandRef.current = ''
    currentTranscriptRef.current = ''
    setTranscript('')
    setErrorMessage(null)
    isContinuousRef.current = true
    isWakeWordModeRef.current = isWakeWord
    setIsWakeWordMode(isWakeWord)
    setMicState('requesting')
    micStateRef.current = 'requesting'

    let stream = null
    try {
      stream = await acquireAudioStream()
    } catch (err) {
      console.warn('[STT] Error during acquireAudioStream:', err)
    }

    const hasWebSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

    if (stream) {
      mediaStreamRef.current = stream
      startRecordingTurn()
    } else if (hasWebSpeech) {
      // Chrome/Safari WebSpeech API operates natively without needing getUserMedia
      console.warn('[STT] getUserMedia did not provide a stream, but Web Speech Recognition is natively available. Proceeding with WebSpeech.')
      mediaStreamRef.current = null
      startRecordingTurn()
    } else {
      console.error('[STT] Microphone access failed: No audio stream and no Web Speech Recognition.')
      isContinuousRef.current = false
      hasPermanentSpeechErrorRef.current = true
      micStateRef.current = 'error'
      setMicState('error')
      setErrorMessage('Microphone access failed: Requested device not found. Please check your sound input settings.')
    }
  }, [startRecordingTurn])

  // Explicit user stop (shuts off mic)
  const stopListening = useCallback(() => {
    isContinuousRef.current = false
    hasPermanentSpeechErrorRef.current = false
    useWhisperFallbackRef.current = false
    wakeWordActiveRef.current = false
    if (wakeWordTimeoutRef.current) {
      clearTimeout(wakeWordTimeoutRef.current)
      wakeWordTimeoutRef.current = null
    }
    tearDownAll()
    micStateRef.current = 'idle'
    setMicState('idle')
    setTranscript('')
  }, [])

  const toggleListening = useCallback(() => {
    if (isContinuousRef.current || micState === 'listening' || micState === 'paused' || micState === 'requesting' || micState === 'transcribing' || micState === 'passive') {
      stopListening()
    } else {
      startListening(false)
    }
  }, [micState, startListening, stopListening])

  const toggleWakeWordMode = useCallback(() => {
    const next = !isWakeWordModeRef.current
    console.log('[STT] toggleWakeWordMode ->', next)
    setIsWakeWordMode(next)
    isWakeWordModeRef.current = next
    if (next) {
      startListening(true)
    } else {
      stopListening()
    }
  }, [startListening, stopListening])

  // Reactive turn-taking: when assistant finishes responding, resume listening automatically!
  useEffect(() => {
    isAssistantBusyRef.current = isAssistantBusy

    if (!isAssistantBusy && isContinuousRef.current && micState === 'paused') {
      const timer = setTimeout(() => {
        if (isContinuousRef.current && !isAssistantBusyRef.current && micState === 'paused') {
          startRecordingTurn()
        }
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isAssistantBusy, micState, startRecordingTurn])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      tearDownAll()
    }
  }, [])

  return {
    micState,
    isListening: micState === 'listening' || micState === 'requesting' || micState === 'paused' || micState === 'transcribing' || micState === 'passive',
    isWakeWordMode,
    transcript,
    volumeLevel,
    errorMessage,
    startListening,
    stopListening,
    toggleListening,
    toggleWakeWordMode,
  }
}
