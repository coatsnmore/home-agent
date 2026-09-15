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

/**
 * Continuous conversational Speech-to-Text hook with real-time VAD volume metering,
 * native Web Speech streaming preview, 16kHz local Whisper, and hands-free turn-taking.
 */
export function useSTT({ onTranscriptReady, isAssistantBusy = false } = {}) {
  // 'idle' | 'requesting' | 'listening' | 'transcribing' | 'paused' | 'denied' | 'error'
  const [micState, setMicState] = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [volumeLevel, setVolumeLevel] = useState(0) // 0 to 1
  const [errorMessage, setErrorMessage] = useState(null)

  const isContinuousRef = useRef(false)
  const isAssistantBusyRef = useRef(isAssistantBusy)
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

  // Audio analysis loop for live volume meter & silence detection
  const setupAudioMeter = (stream) => {
    try {
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
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        const normalized = Math.max(0, Math.min(1, (avg - 10) / 50))
        setVolumeLevel(normalized)

        // VAD: voice detection and auto-stop after speech finishes
        if (normalized > 0.16) {
          hasSpokenRef.current = true
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        } else if (hasSpokenRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            // Auto stop after 2.0s of silence following speech
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop()
            }
          }, 2000)
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
    setVolumeLevel(0)
  }

  const tearDownAll = () => {
    stopAudioMeterOnly()
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
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
    if (!mediaStreamRef.current) return

    setTranscript('')
    currentTranscriptRef.current = ''
    hasSpokenRef.current = false
    audioChunksRef.current = []
    setupAudioMeter(mediaStreamRef.current)
    setMicState('listening')

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

        // 1. Check if WebSpeech API already produced a valid transcript
        const existingText = currentTranscriptRef.current.trim()
        if (existingText && existingText.length > 1) {
          if (onTranscriptReady) onTranscriptReady(existingText)
          if (isContinuousRef.current) {
            setMicState('paused')
          } else {
            setMicState('idle')
          }
          return
        }

        // 2. Transcribe recorded audio with 16kHz local Whisper
        if (audioChunksRef.current.length === 0) {
          if (isContinuousRef.current) {
            // Re-arm immediately if continuous
            startRecordingTurn()
          } else {
            setMicState('idle')
          }
          return
        }

        setMicState('transcribing')
        try {
          const mime = recorder?.mimeType || 'audio/webm'
          const audioBlob = new Blob(audioChunksRef.current, { type: mime })
          const audioData = await resampleBlobTo16kHz(audioBlob)

          let sumSquares = 0
          for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i]
          }
          const rms = Math.sqrt(sumSquares / Math.max(1, audioData.length))

          // Filter out silence
          if (rms < 0.007 && !hasSpokenRef.current) {
            if (isContinuousRef.current) {
              startRecordingTurn()
            } else {
              setMicState('idle')
            }
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
            
            if (hallucinations.includes(clean) && rms < 0.02) {
              if (isContinuousRef.current) {
                startRecordingTurn()
              } else {
                setMicState('idle')
              }
              return
            }

            setTranscript(text)
            currentTranscriptRef.current = text
            if (onTranscriptReady) onTranscriptReady(text)
            
            if (isContinuousRef.current) {
              setMicState('paused')
            } else {
              setMicState('idle')
            }
          } else {
            if (isContinuousRef.current) {
              startRecordingTurn()
            } else {
              setMicState('idle')
            }
          }
        } catch (whisperErr) {
          console.error('Local Whisper transcription error:', whisperErr)
          if (isContinuousRef.current) {
            startRecordingTurn()
          } else {
            setErrorMessage('Speech processing failed.')
            setMicState('idle')
          }
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
    } catch (mediaErr) {
      console.warn('MediaRecorder error:', mediaErr)
    }

    // Start native Web Speech in parallel for streaming preview
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
          console.warn('SpeechRecognition notice:', err.error)
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

  // Initializes media stream and enters continuous conversation mode
  const startListening = useCallback(async () => {
    setErrorMessage(null)
    isContinuousRef.current = true
    setMicState('requesting')

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
      startRecordingTurn()
    } catch (err) {
      console.error('Microphone access failed:', err)
      isContinuousRef.current = false
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicState('denied')
        setErrorMessage('Microphone blocked. Click the lock/tune icon in your address bar to allow.')
      } else {
        setMicState('error')
        setErrorMessage(`Microphone error: ${err.message}`)
      }
    }
  }, [startRecordingTurn])

  // Explicit user stop (disables continuous mode and shuts off mic)
  const stopListening = useCallback(() => {
    isContinuousRef.current = false
    tearDownAll()
    setMicState('idle')
    setTranscript('')
  }, [])

  const toggleListening = useCallback(() => {
    if (isContinuousRef.current || micState === 'listening' || micState === 'paused' || micState === 'requesting' || micState === 'transcribing') {
      stopListening()
    } else {
      startListening()
    }
  }, [micState, startListening, stopListening])

  // Reactive turn-taking: when assistant finishes responding, resume listening automatically!
  useEffect(() => {
    isAssistantBusyRef.current = isAssistantBusy

    if (!isAssistantBusy && isContinuousRef.current && micState === 'paused') {
      // Small 400ms pause to let room audio clear before re-arming mic
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
    isListening: micState === 'listening' || micState === 'requesting' || micState === 'paused' || micState === 'transcribing',
    transcript,
    volumeLevel,
    errorMessage,
    startListening,
    stopListening,
    toggleListening,
  }
}
