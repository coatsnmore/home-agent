import { useState, useEffect, useRef, useCallback } from 'react'

let whisperInstance = null
let whisperLoadingPromise = null

async function getWhisperPipeline() {
  if (whisperInstance) return whisperInstance
  if (!whisperLoadingPromise) {
    whisperLoadingPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers')
      env.allowLocalModels = false
      env.useBrowserCache = true
      // Load whisper model
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

  // Use OfflineAudioContext for clean, hardware-accelerated 16kHz polyphase resampling
  const targetLength = Math.max(1, Math.ceil(decoded.duration * 16000))
  const offlineCtx = new OfflineAudioContext(1, targetLength, 16000)
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start(0)
  const rendered = await offlineCtx.startRendering()
  return rendered.getChannelData(0)
}

/**
 * Offline & Mac-optimized Speech-to-Text hook with real-time VAD volume metering,
 * native Web Speech streaming preview, and 16kHz resampled local Whisper.
 */
export function useSTT({ onTranscriptReady } = {}) {
  // 'idle' | 'requesting' | 'listening' | 'transcribing' | 'denied' | 'error'
  const [micState, setMicState] = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [volumeLevel, setVolumeLevel] = useState(0) // 0 to 1
  const [errorMessage, setErrorMessage] = useState(null)

  const mediaStreamRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recognitionRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const hasSpokenRef = useRef(false)
  const currentTranscriptRef = useRef('')

  // Pre-warm Whisper model quietly in background
  useEffect(() => {
    getWhisperPipeline().catch((e) => {
      console.warn('Whisper pre-warm notice:', e.message)
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening()
    }
  }, [])

  // Audio analysis loop for VAD & live volume meter
  const setupAudioMeter = (stream) => {
    try {
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
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        // Normalized 0 to 1 with noise gate
        const normalized = Math.max(0, Math.min(1, (avg - 10) / 50))
        setVolumeLevel(normalized)

        // VAD: voice detection and silence auto-stop
        if (normalized > 0.16) {
          hasSpokenRef.current = true
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        } else if (hasSpokenRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            // Auto stop after 2.2s of silence following speech
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop()
            }
          }, 2200)
        }

        animFrameRef.current = requestAnimationFrame(updateMeter)
      }

      updateMeter()
    } catch (e) {
      console.warn('Audio meter initialization warning:', e)
    }
  }

  const stopAudioMeter = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    setVolumeLevel(0)
  }

  const startListening = useCallback(async () => {
    setErrorMessage(null)
    setTranscript('')
    currentTranscriptRef.current = ''
    hasSpokenRef.current = false
    setMicState('requesting')

    // 1. Request microphone permission and access
    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      mediaStreamRef.current = stream
      setupAudioMeter(stream)
    } catch (err) {
      console.error('Microphone access failed:', err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicState('denied')
        setErrorMessage('Microphone blocked. Click the lock/tune icon in your address bar to allow.')
      } else {
        setMicState('error')
        setErrorMessage(`Microphone error: ${err.message}`)
      }
      return
    }

    setMicState('listening')

    // 2. Setup MediaRecorder for universal capture
    audioChunksRef.current = []
    let recorder = null
    try {
      const mimeTypes = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      const supportedMime = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || ''
      recorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream)

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = async () => {
        stopAudioMeter()

        // Check if WebSpeech API already produced a valid transcript
        const existingText = currentTranscriptRef.current.trim()
        if (existingText && existingText.length > 1) {
          setMicState('idle')
          if (onTranscriptReady) onTranscriptReady(existingText)
          return
        }

        // Run local Whisper STT with proper 16kHz resampling
        if (audioChunksRef.current.length === 0) {
          setMicState('idle')
          return
        }

        setMicState('transcribing')
        try {
          const mime = recorder?.mimeType || 'audio/webm'
          const audioBlob = new Blob(audioChunksRef.current, { type: mime })

          // Resample to 16kHz mono Float32Array
          const audioData = await resampleBlobTo16kHz(audioBlob)

          // Measure RMS loudness to prevent silence hallucinations
          let sumSquares = 0
          for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i]
          }
          const rms = Math.sqrt(sumSquares / Math.max(1, audioData.length))

          // If barely audible sound and no speech detected by VAD, don't hallucinate
          if (rms < 0.007 && !hasSpokenRef.current) {
            console.log('Audio level below voice threshold, ignoring silence')
            setMicState('idle')
            return
          }

          const asr = await getWhisperPipeline()
          const result = await asr(audioData, {
            chunk_length_s: 30,
            stride_length_s: 5,
          })

          const text = result?.text?.trim()
          if (text) {
            const clean = text.replace(/^[.\s,!?]+|[.\s,!?]+$/g, '').toLowerCase()
            const hallucinations = ['you', 'thank you', 'thanks', 'bye', 'so', 'watching', 'subtitles', 'thank you for watching', 'thanks for watching']
            
            // Discard known Whisper hallucinations when energy was low
            if (hallucinations.includes(clean) && rms < 0.02) {
              console.log('Discarded silence hallucination:', text)
              setMicState('idle')
              return
            }

            setTranscript(text)
            currentTranscriptRef.current = text
            if (onTranscriptReady) onTranscriptReady(text)
          }
        } catch (whisperErr) {
          console.error('Local Whisper transcription error:', whisperErr)
          setErrorMessage('Speech processing failed. Please type your message.')
        } finally {
          setMicState('idle')
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
    } catch (mediaErr) {
      console.warn('MediaRecorder error:', mediaErr)
    }

    // 3. Start native Web Speech in parallel for real-time streaming preview
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition()
        recognition.continuous = false
        recognition.interimResults = true
        recognition.maxAlternatives = 1
        recognition.lang = 'en-US'
        recognitionRef.current = recognition

        recognition.onresult = (event) => {
          let text = ''
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            text += event.results[i][0].transcript
          }
          if (text) {
            setTranscript(text)
            currentTranscriptRef.current = text
          }
        }

        recognition.onerror = (err) => {
          console.warn('SpeechRecognition notice (using Whisper fallback):', err.error)
        }

        recognition.onend = () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
        }

        recognition.start()
      } catch (recErr) {
        console.warn('SpeechRecognition failed to start:', recErr)
      }
    }
  }, [onTranscriptReady])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
      recognitionRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop()
      } catch {}
    } else {
      stopAudioMeter()
      setMicState('idle')
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (micState === 'listening' || micState === 'requesting') {
      stopListening()
    } else {
      startListening()
    }
  }, [micState, startListening, stopListening])

  return {
    micState,
    isListening: micState === 'listening' || micState === 'requesting',
    transcript,
    volumeLevel,
    errorMessage,
    startListening,
    stopListening,
    toggleListening,
  }
}
