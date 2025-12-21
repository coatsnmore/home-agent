import {
  showRecording,
  addMessage,
  clickSubmitButton,
  messageInput,
  playSound,
  CHAT_NAME,
  updateVADCountdown,
  updateVADDuration
} from './ui'
import { isTTSSpeaking, speakWithPiper } from './tts'

// this is the last recognized speech text
let lastSpeech = ''

export let wakewordCounter = 0
export let exactWakewordCounter = 0

// Function to check if text contains a search term
function containsText(newText, newSearchTerm) {
  return newText.toLowerCase().includes(newSearchTerm.toLowerCase())
}

// these statements are pushed to the AI on page load
function INIT_AI_MESSAGES() {
  // addMessage('Keep your answers brief.', true, false)
  // addMessage('Dont ask questions.', true, false)
  // addMessage('Act quickly. Don\'t waste time.', true, false)
}

// ====================================================================
// EXTRA wake words
// ====================================================================
const WAKE_WORD_ALIASES = [
  'etc',
  'central',
  'zantron'
]


// ====================================================================
// PARAMETER CLASS + CURRENT INSTANCE
// ====================================================================

class STTParameters {
  constructor() {
    // ===== Backend / model =====
    // Whisper model size: 'tiny' | 'base' | 'small' | ...
    this.sttModelSize = 'tiny' // worst / fastest
    // this.sttModelSize = 'base'   // medium

    // Quantization: faster but slightly less accurate
    this.quantized = true

    // Sample rate for Whisper
    this.SAMPLE_RATE = 16000

    // ===== Command prompt / biasing =====
    // Bias whisper hard toward hearing the wake word instead of "music"
    this.commandPrompt = `
${CHAT_NAME}
${CHAT_NAME}
${CHAT_NAME}
${CHAT_NAME}
`.trim()

    // ===== VAD / segmentation =====
    this.MIN_SEG_SECONDS = 2.0 // minimum segment length (s) to send to ASR
    this.VAD_RMS = 0.010 // frame RMS threshold for "voice active"
    this.MIN_RMS = 0.003 // segment RMS threshold to keep
    this.VAD_SILENCE_MS = 1000 // ms of silence to end a segment (base)

    // ===== Pre/Post-roll padding =====
    this.PREROLL_MS = 300 // ms of audio to include before speech detection
    this.POSTROLL_MS = 450 // ms of audio to include after silence detection

    // ===== Leveling + compression =====
    this.ENABLE_LEVELING = true // master switch for post-leveling
    // this.ENABLE_LEVELING = false
    this.TARGET_RMS = 0.08
    this.MAX_GAIN = 6.0
    this.COMP_THRESHOLD = 0.6
    this.COMP_RATIO = 3.0

    // ===== Prefilter (band-pass-ish) =====
    this.ENABLE_PREFILTER = true
    this.HPF_FREQ = 100
    this.LPF_FREQ = 3500

    // ===== Spectral VAD (analyser-based) =====
    // FIX APPLIED: analyser no longer drops frames; it only qualifies *speech start*.
    this.ENABLE_ANALYSER_VAD = true
    this.ANALYSER_FFT_SIZE = 1024
    this.VAD_BAND_LOW = 120
    this.VAD_BAND_HIGH = 3200
    this.VAD_ENERGY_RATIO = 0.40
  }
}

// ====================================================================
// MODE STATE + PARAM SETS
// ====================================================================

// allows commands when in active mode...
let activeMode = false
let activeModeParams = new STTParameters()

// set params for better wake word detection
let wakeWordParams = new STTParameters()
wakeWordParams.MIN_SEG_SECONDS = 0.25 // GOOD!
wakeWordParams.VAD_SILENCE_MS /= 2
wakeWordParams.POSTROLL_MS /= 2

// start in wake word mode
let currentParameters = wakeWordParams

// SET THIS if we're testing param efficacy
let testingParams = null
// testingParams = wakeWordParams

// ====================================================================
// INTERNAL STATE
// ====================================================================

let asr = null
let rec = false
let buffers = []
let prerollBuffer = [] // circular buffer for pre-roll padding
let ctx, src, proc, stream
let hp, lp, analyser
let lastSpeechTS = 0
let processingSegment = false
let recordStartTS = 0
let speechDetected = false // track if speech has started

// Track last params applied to the *audio graph* so we can decide
// whether we can update nodes live or must rebuild the chain.
let lastGraphParams = null

// NEW: serialize mode switches so we don't overlap stop/start cycles
let modeSwitchPromise = Promise.resolve()

// ====================================================================
// HELPERS
// ====================================================================

// Resample Float32Array `data` from `from` Hz to `to` Hz (default 16kHz)
function resample(data, from, to = currentParameters.SAMPLE_RATE) {
  if (from === to) return data
  const ratio = to / from
  const out = new Float32Array(Math.floor(data.length * ratio))
  for (let i = 0; i < out.length; i++) {
    const idx = i / ratio
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, data.length - 1)
    out[i] = data[i0] + (data[i1] - data[i0]) * (idx - i0)
  }
  return out
}

const rms = a => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / (a.length || 1))
}

function isSecureContextLocal() {
  const host = (location.hostname || '').replace(/^\[|\]$/g, '')
  return (
    window.isSecureContext ||
    location.protocol === 'https:' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1'
  )
}

function ttsSpeakingNow() {
  try {
    return typeof isTTSSpeaking === 'function' ? !!isTTSSpeaking() : !!isTTSSpeaking
  } catch {
    return false
  }
}

// ===== Graph reconfiguration support =====

function snapshotGraphParams(p) {
  return {
    ENABLE_PREFILTER: !!p.ENABLE_PREFILTER,
    ENABLE_ANALYSER_VAD: !!p.ENABLE_ANALYSER_VAD,
    ANALYSER_FFT_SIZE: p.ANALYSER_FFT_SIZE,
    HPF_FREQ: p.HPF_FREQ,
    LPF_FREQ: p.LPF_FREQ
  }
}

// If these differ, the connection graph might need rewiring.
function needsGraphRebuild(prevSnap, nextSnap) {
  if (!prevSnap) return true
  // Changing enable flags requires rewiring. FFT size / freqs can be updated live.
  if (prevSnap.ENABLE_PREFILTER !== nextSnap.ENABLE_PREFILTER) return true
  if (prevSnap.ENABLE_ANALYSER_VAD !== nextSnap.ENABLE_ANALYSER_VAD) return true
  return false
}

// Apply tunables that are safe to update live (no rewiring)
function applyLiveGraphTunables(p) {
  try {
    if (hp) hp.frequency.value = p.HPF_FREQ
  } catch {}
  try {
    if (lp) lp.frequency.value = p.LPF_FREQ
  } catch {}
  try {
    if (analyser) analyser.fftSize = p.ANALYSER_FFT_SIZE
  } catch {}
}

// ====================================================================
// MODEL INITIALIZATION
// ====================================================================

export async function initializeSTT() {
  try {
    addMessage('Loading speech recognition model... (this may take a moment)', false)

    // Load transformers pipeline if missing
    if (!window.transformersPipeline) {
      try {
        const transformersModule = await import(
          'https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js'
        )
        window.transformersPipeline = transformersModule.pipeline
        window.transformersEnv = transformersModule.env
        window.transformersTensor = transformersModule.Tensor
        window.transformersReady = true
      } catch (cdnError) {
        console.error('Failed to load transformers from CDN', cdnError)
        throw cdnError
      }
    }

    let waitCount = 0
    while (!window.transformersReady && waitCount < 50) {
      await new Promise(r => setTimeout(r, 100))
      waitCount++
    }

    if (!window.transformersPipeline) throw new Error('Transformers pipeline not available')

    const pipeline = window.transformersPipeline
    const env = window.transformersEnv

    if (env) {
      env.allowLocalModels = false
      if (import.meta.env && import.meta.env.DEV) {
        env.remoteURL = '/hf'
      } else {
        env.remoteURL = 'https://huggingface.co'
      }
    }

    try {
      asr = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-' + currentParameters.sttModelSize + '.en',
        { quantized: currentParameters.quantized }
      )
    } catch (e) {
      console.warn('Quantized ASR failed, falling back:', e)
      asr = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-' + currentParameters.sttModelSize + '.en',
        { quantized: false }
      )
    }

    addMessage('Speech recognition ready! Click the microphone to start.', false)

    INIT_AI_MESSAGES()
    showRecording(false)
  } catch (error) {
    console.error('Failed to load STT model:', error)
    addMessage(`Speech recognition unavailable: ${error.message}. You can still type messages.`, false)
    showRecording(false)
  }
}

// ====================================================================
// RECORDING START
// ====================================================================

export async function start() {
  try {
    if (!isSecureContextLocal()) throw new Error('Microphone access requires a secure context (HTTPS).')

    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' })
        if (permissionStatus.state === 'denied') throw new Error('Microphone access denied')
      } catch {
        // ignore
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const getUserMedia =
        navigator.mediaDevices?.getUserMedia ||
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia
      if (!getUserMedia) throw new Error('Microphone access not available')
      stream = await new Promise((resolve, reject) =>
        getUserMedia.call(navigator, { audio: true }, resolve, reject)
      )
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      })
    }

    rec = true
    buffers = []
    prerollBuffer = []
    speechDetected = false
    lastSpeechTS = performance.now()

    ctx = new AudioContext()
    src = ctx.createMediaStreamSource(stream)
    proc = ctx.createScriptProcessor(4096, 1, 1)

    // Build the graph according to *currentParameters* and snapshot it.
    lastGraphParams = snapshotGraphParams(currentParameters)

    // set up optional prefilter and analyser (connect before processor)
    if (currentParameters.ENABLE_PREFILTER) {
      try {
        hp = ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = currentParameters.HPF_FREQ

        lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = currentParameters.LPF_FREQ

        src.connect(hp)
        hp.connect(lp)
        lp.connect(proc)

        if (currentParameters.ENABLE_ANALYSER_VAD) {
          analyser = ctx.createAnalyser()
          analyser.fftSize = currentParameters.ANALYSER_FFT_SIZE
          lp.connect(analyser)
        } else {
          analyser = null
        }
      } catch (e) {
        console.warn('prefilter setup failed, falling back to direct source->processor:', e)
        try {
          src.connect(proc)
        } catch {}
        hp = null
        lp = null
        analyser = null
      }
    } else {
      try {
        src.connect(proc)
      } catch {}
      hp = null
      lp = null
      analyser = null
    }

    proc.onaudioprocess = e => {
      if (!rec) return

      if (ttsSpeakingNow()) return

      const ch = e.inputBuffer.getChannelData(0)
      const currentFrame = new Float32Array(ch)
      const currentRMS = rms(ch)
      const sampleRate = ctx ? ctx.sampleRate : 48000

      let analyserPass = true
      if (currentParameters.ENABLE_ANALYSER_VAD && analyser) {
        try {
          const freqData = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(freqData)

          let inBand = 0
          let total = 0

          const binSize = (ctx.sampleRate || 48000) / analyser.fftSize
          const lowBin = Math.max(0, Math.floor(currentParameters.VAD_BAND_LOW / binSize))
          const highBin = Math.min(
            freqData.length - 1,
            Math.ceil(currentParameters.VAD_BAND_HIGH / binSize)
          )

          for (let i = 0; i < freqData.length; i++) {
            total += freqData[i]
            if (i >= lowBin && i <= highBin) inBand += freqData[i]
          }

          const ratio = total > 0 ? inBand / total : 0
          analyserPass = ratio >= currentParameters.VAD_ENERGY_RATIO
        } catch (err) {
          console.warn('analyser gating failed:', err)
          analyserPass = true
        }
      }

      if (!speechDetected) {
        const prerollSamples = Math.floor((currentParameters.PREROLL_MS / 1000) * sampleRate)

        prerollBuffer.push(currentFrame)

        let prerollTotalSamples = 0
        for (const b of prerollBuffer) prerollTotalSamples += b.length
        while (prerollTotalSamples > prerollSamples && prerollBuffer.length > 1) {
          const removed = prerollBuffer.shift()
          prerollTotalSamples -= removed.length
        }

        if (currentRMS >= currentParameters.VAD_RMS && analyserPass) {
          speechDetected = true
          buffers.push(...prerollBuffer)
          prerollBuffer = []
        }
      } else {
        buffers.push(currentFrame)
      }

      try {
        let totalSamples = 0
        for (const b of buffers) totalSamples += b.length
        updateVADDuration(totalSamples / sampleRate)
      } catch {
        try {
          updateVADDuration(null)
        } catch {}
      }

      if (currentRMS >= currentParameters.VAD_RMS) {
        lastSpeechTS = performance.now()
        try {
          updateVADCountdown(null)
        } catch {}
      } else {
        const silentFor = performance.now() - lastSpeechTS
        try {
          updateVADCountdown(Math.max(0, (currentParameters.VAD_SILENCE_MS - silentFor) / 1000))
        } catch {}

        if (
          speechDetected &&
          !processingSegment &&
          buffers.length &&
          silentFor > currentParameters.VAD_SILENCE_MS + currentParameters.POSTROLL_MS
        ) {
          processingSegment = true
          speechDetected = false

          try {
            updateVADCountdown(null)
          } catch {}
          try {
            updateVADDuration(null)
          } catch {}

          const localBuffers = buffers.slice()
          buffers = []
          prerollBuffer = []

          ;(async () => {
            try {
              let total = 0
              for (const b of localBuffers) total += b.length
              if (total === 0) return

              const mono = new Float32Array(total)
              let off = 0
              for (const b of localBuffers) {
                mono.set(b, off)
                off += b.length
              }

              const pcm = resample(mono, ctx.sampleRate)
              const duration = pcm.length / currentParameters.SAMPLE_RATE
              const energyOriginal = rms(pcm)

              if (duration >= currentParameters.MIN_SEG_SECONDS && energyOriginal >= currentParameters.MIN_RMS) {
                if (currentParameters.ENABLE_LEVELING) {
                  const currentRMS2 = energyOriginal
                  if (currentRMS2 > 0) {
                    let gain = currentParameters.TARGET_RMS / currentRMS2
                    if (gain > currentParameters.MAX_GAIN) gain = currentParameters.MAX_GAIN

                    for (let i = 0; i < pcm.length; i++) {
                      let v = pcm[i] * gain

                      const av = Math.abs(v)
                      if (av > currentParameters.COMP_THRESHOLD) {
                        const sign = v < 0 ? -1 : 1
                        const over = av - currentParameters.COMP_THRESHOLD
                        const compressed =
                          currentParameters.COMP_THRESHOLD + over / currentParameters.COMP_RATIO
                        v = sign * compressed
                      }

                      if (v > 1) v = 1
                      if (v < -1) v = -1
                      pcm[i] = v
                    }
                  }
                }

                const transcribeStart = performance.now()
                const result = await asr(pcm, {
                  prompt: currentParameters.commandPrompt,
                  condition_on_prev_text: false
                })
                const transcribeEnd = performance.now()
                const transcribeDuration = ((transcribeEnd - transcribeStart) / 1000).toFixed(2)

                const durationEl = document.getElementById('transcribe-duration')
                if (durationEl) durationEl.textContent = `Transcription: ${transcribeDuration}s`

                const text = (result?.text || '').trim()
                if (text) processSpeechText(text)
              }
            } catch (err) {
              console.warn('segment processing error:', err)
            } finally {
              processingSegment = false
            }
          })()
        }
      }
    }

    proc.connect(ctx.destination)
    showRecording(true)
    recordStartTS = performance.now()
  } catch (error) {
    console.error('Failed to start recording:', error)
    let errorMessage = 'Failed to access microphone. '
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      errorMessage += 'Microphone access was denied. '
    } else if (!isSecureContextLocal()) {
      errorMessage += 'Not in a secure context. '
    }
    addMessage(errorMessage, false)
    rec = false
    showRecording(false)
  }
}

// ====================================================================
// POST-ASR: PROCESS RECOGNIZED TEXT
// ====================================================================

function incWakeWordCounter() {
  wakewordCounter += 1
  const wakewordCounterEl = document.getElementById('wakeword-counter')
  if (wakewordCounterEl) wakewordCounterEl.textContent = String(wakewordCounter)
}

function incExactWakeWordCounter() {
  exactWakewordCounter += 1
  const exactWakeWordCounterEl = document.getElementById('exact-wakeword-counter')
  if (exactWakeWordCounterEl) exactWakeWordCounterEl.textContent = String(exactWakewordCounter)
}

/**
 * HARD BUG FIX:
 * - setActiveMode is async (can stop/start).
 * - We must not let mode flips overlap; serialize them via modeSwitchPromise.
 * - Callers should await it.
 */
function setActiveMode(isOn) {
  modeSwitchPromise = modeSwitchPromise.then(async () => {
    const prevSnap = lastGraphParams
    activeMode = isOn
    currentParameters = isOn ? activeModeParams : wakeWordParams

    const nextSnap = snapshotGraphParams(currentParameters)
    console.log('Active mode set to:', isOn)

    if (rec && needsGraphRebuild(prevSnap, nextSnap)) {
      try {
        await stop()
        await start()
        return
      } catch (e) {
        console.warn('Failed to rebuild audio graph on mode switch:', e)
      }
    }

    applyLiveGraphTunables(currentParameters)
    lastGraphParams = nextSnap
  })

  return modeSwitchPromise
}

// Make async so we can await mode flips safely
async function processSpeechText(newText) {
  lastSpeech = newText

  if (!newText) return

  const trimmed = newText.trim()

  const isSoundTag =
    (trimmed.startsWith('(') && trimmed.endsWith(')')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))

  if (isSoundTag) {
    console.log('~~~ IGNORE:', trimmed)
    return
  }

  console.log(newText)

  //-----------------
  // FOR TESTING:
  //-----------------
  if(testingParams){

    if(containsText(newText, CHAT_NAME)) {
      incExactWakeWordCounter()
    }
    if(containsWord(newText, CHAT_NAME)) {
      incWakeWordCounter()
    } 
    return;
  }


  // WAKE + COMMAND HANDLING
  const commandText = textAfterWord(newText, CHAT_NAME)
  if (commandText !== null && commandText.length > 0) {
    await processCommand(commandText)
    return
  }

  // WAKE WORD HANDLING (wake only)
  if (!activeMode && containsWord(trimmed, CHAT_NAME)) {
    await setActiveMode(true)

    // ✅ ONLY CHANGE YOU REQUESTED:
    // beep when switching to active mode with wake word only (no simultaneous command)
    playSound(720, 200, 0.18)

    return
  }

  // COMMAND HANDLING (only when active)
  if (!activeMode) return

  await processCommand(trimmed)
}

// process a command, and set inactive
async function processCommand(newText) {
  messageInput.value = newText
  messageInput.focus()

  clickSubmitButton()

  // IMPORTANT: await deactivation so stop/start doesn't overlap with other events
  await setActiveMode(false)
}

export function getFirstWord(text) {
  return (text.split(/\s+/)[0] || '').toUpperCase()
}



// Return substring after first approx match of wake word (Levenshtein <= 2).
export function textAfterWord(newText, newWord) {
  newText = String(newText).toLocaleLowerCase()
  newWord = String(newWord).toLocaleLowerCase()

  if (!newText || !newWord) return null

  const wordRe = /\b[0-9a-z]+\b/gi
  let m
  while ((m = wordRe.exec(newText)) !== null) {
    const token = m[0].toLowerCase()
    const dist = levenshtein(token, newWord)
    if (dist <= 2) {
      const idx = m.index + m[0].length
      let rest = newText.slice(idx).trim()
      rest = rest.replace(/^[^a-z0-9]+/i, '').trim()
      return rest.length ? rest : ''
    }
  }

  return null
}

export function containsWord(newText, newWord) {
  newText = String(newText).toLocaleLowerCase()
  newWord = String(newWord).toLocaleLowerCase()

  if (!newText || !newWord) return false

  const wordRe = /\b[0-9a-z]+\b/gi
  let m
  while ((m = wordRe.exec(newText)) !== null) {
    const token = m[0].toLowerCase()
    const dist = levenshtein(token, newWord)
    if (dist <= 2) {
      return true
    }
  }

  return false
}

// Levenshtein distance helper
function levenshtein(a, b) {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la
  const v0 = new Array(lb + 1)
  const v1 = new Array(lb + 1)
  for (let j = 0; j <= lb; j++) v0[j] = j
  for (let i = 0; i < la; i++) {
    v1[0] = i + 1
    for (let j = 0; j < lb; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= lb; j++) v0[j] = v1[j]
  }
  return v1[lb]
}

export function isRecording() {
  return rec
}

export function activateMic() {
  if (!asr) {
    addMessage('Speech recognition model not loaded yet. Please wait...', false)
    return
  }
  if (rec) stop()
  else start()
}

export async function stop() {
  if (!rec) return
  rec = false
  showRecording(false)

  try {
    proc && proc.disconnect()
  } catch {}
  try {
    src && src.disconnect()
  } catch {}
  try {
    stream && stream.getTracks().forEach(t => t.stop())
  } catch {}
  try {
    ctx && (await ctx.close())
  } catch {}

  buffers = []
  prerollBuffer = []
  speechDetected = false

  hp = null
  lp = null
  analyser = null
  proc = null
  src = null
  ctx = null
  stream = null
}

try {
  window.activateMic = activateMic
} catch {}
