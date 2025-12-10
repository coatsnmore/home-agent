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

// this is the last recognized speech text
let lastSpeech = ""

// ====================================================================
// PARAMETER CLASS + CURRENT INSTANCE
// ====================================================================

class STTParameters {
  constructor() {
    // ===== Backend / model =====
    // Whisper model size: 'tiny' | 'base' | 'small' | ...
    this.sttModelSize = 'tiny'  // worst / fastest; you can swap later

    // Quantization: faster but slightly less accurate
    this.quantized = true

    // Sample rate for Whisper
    this.SAMPLE_RATE = 16000

    // ===== Command prompt / biasing =====
    // This can be swapped later for different wake-words / command sets
    this.commandPrompt = `
${CHAT_NAME}, light on
${CHAT_NAME}, light off
${CHAT_NAME}, austin fan on
${CHAT_NAME}, austin fan off
`.trim()

    // ===== VAD / segmentation =====
    this.MIN_SEG_SECONDS = 2.0     // minimum segment length (s) to send to ASR
    this.VAD_RMS = 0.010           // frame RMS threshold for "voice active"
    this.MIN_RMS = 0.003           // segment RMS threshold to keep
    this.VAD_SILENCE_MS = 2000     // ms of silence to end a segment

    // ===== Leveling + compression =====
    this.ENABLE_LEVELING = true    // master switch for post-leveling

    // Target RMS loudness for segments before sending to ASR.
    // Higher = louder (0–1 range). Try 0.05–0.1.
    this.TARGET_RMS = 0.08

    // Maximum gain multiplier when boosting quiet segments.
    // Limits how much we "turn up" distant/quiet speech.
    this.MAX_GAIN = 6.0

    // Compression threshold and ratio
    this.COMP_THRESHOLD = 0.6      // where compression of peaks starts
    this.COMP_RATIO = 3.0          // how hard to squash peaks above threshold

    // ===== Tail carry-over =====
    // Seconds of tail from previous segment to prepend to next buffer
    this.BUFFER_TAIL_SECONDS = this.MIN_SEG_SECONDS / 2

    // ===== Prefilter (band-pass-ish) =====
    this.ENABLE_PREFILTER = true
    this.HPF_FREQ = 100            // high-pass cutoff Hz (remove rumble)
    this.LPF_FREQ = 3500           // low-pass cutoff Hz (limit high-frequency noise)

    // ===== Spectral VAD (analyser-based) =====
    this.ENABLE_ANALYSER_VAD = true
    this.ANALYSER_FFT_SIZE = 1024  // sample size for analyser node
    this.VAD_BAND_LOW = 120        // low Hz for band energy check
    this.VAD_BAND_HIGH = 3200      // high Hz for band energy check
    this.VAD_ENERGY_RATIO = 0.40   // fraction of input energy in band to count as voice
  }
}

// Single global parameter set used by the rest of the code.
// Later you can swap this out with another instance/preset.
let currentParameters = new STTParameters()

// ====================================================================
// INTERNAL STATE
// ====================================================================

let asr = null
let rec = false
let buffers = []
let ctx, src, proc, stream
let hp, lp, analyser
let tailBuffer = null
let lastSpeechTS = 0
let processingSegment = false
let recordStartTS = 0

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
      } catch (permError) {
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
    lastSpeechTS = performance.now()
    ctx = new AudioContext()
    src = ctx.createMediaStreamSource(stream)
    proc = ctx.createScriptProcessor(4096, 1, 1)

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
        }
      } catch (e) {
        console.warn('prefilter setup failed, falling back to direct source->processor:', e)
        try { src.connect(proc) } catch (e) {}
      }
    } else {
      src.connect(proc)
    }

    proc.onaudioprocess = e => {
      if (!rec) return
      const ch = e.inputBuffer.getChannelData(0)

      // Optional analyser-based gating: skip frames whose spectral energy is
      // mostly outside the configured human vocal band.
      if (currentParameters.ENABLE_ANALYSER_VAD && analyser) {
        try {
          const freqData = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(freqData)
          let inBand = 0, total = 0

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
          if (ratio < currentParameters.VAD_ENERGY_RATIO) {
            // treat as non-vocal frame; do not append
            return
          }
        } catch (err) {
          console.warn('analyser gating failed:', err)
        }
      }

      buffers.push(new Float32Array(ch))
      // compute total buffered duration (seconds) from current buffers
      try {
        let totalSamples = 0
        for (const b of buffers) totalSamples += b.length
        const sampleRate = ctx ? ctx.sampleRate : 48000
        updateVADDuration(totalSamples / sampleRate)
      } catch (e) {
        try { updateVADDuration(null) } catch (e) {}
      }

      // update last speech timestamp when energy is above VAD threshold
      if (rms(ch) >= currentParameters.VAD_RMS) {
        lastSpeechTS = performance.now()
        // clear countdown while voice is active
        try { updateVADCountdown(null) } catch (e) {}
      } else {
        // if we've been silent for longer than the configured threshold,
        // capture the current buffers as a segment and process them
        const silentFor = performance.now() - lastSpeechTS
        // update countdown display (seconds, one decimal)
        try {
          updateVADCountdown(
            Math.max(0, (currentParameters.VAD_SILENCE_MS - silentFor) / 1000)
          )
        } catch (e) {}

        if (silentFor > currentParameters.VAD_SILENCE_MS && buffers.length && !processingSegment) {
          processingSegment = true

          // hide countdown and duration while processing
          try { updateVADCountdown(null) } catch (e) {}
          try { updateVADDuration(null) } catch (e) {}

          // copy buffers for processing and synchronously compute a short
          // tail slice to preserve at the head of the next buffer batch.
          const localBuffers = buffers.slice()

          try {
            let totalLen = 0
            for (const b of localBuffers) totalLen += b.length
            if (totalLen > 0) {
              const sampleRate = ctx ? ctx.sampleRate : 48000
              const tailSamples = Math.min(
                totalLen,
                Math.floor(currentParameters.BUFFER_TAIL_SECONDS * sampleRate)
              )
              if (tailSamples > 0) {
                const tail = new Float32Array(tailSamples)
                // copy last `tailSamples` from localBuffers into tail
                let destOff = 0
                const startIndex = totalLen - tailSamples
                let readPos = 0
                for (const b of localBuffers) {
                  const bLen = b.length
                  const bCopyFrom = Math.max(0, startIndex - readPos)
                  const bCopyLen = Math.max(
                    0,
                    Math.min(bLen - bCopyFrom, tailSamples - destOff)
                  )
                  if (bCopyLen > 0) {
                    tail.set(b.subarray(bCopyFrom, bCopyFrom + bCopyLen), destOff)
                    destOff += bCopyLen
                    if (destOff >= tailSamples) break
                  }
                  readPos += bLen
                }
                tailBuffer = tail
              } else {
                tailBuffer = null
              }
            } else {
              tailBuffer = null
            }
          } catch (err) {
            console.warn('tail computation failed:', err)
            tailBuffer = null
          }

          // clear live buffers and prepend tailBuffer so recording continues
          try {
            let _totalSamplesBeforeReset = 0
            for (const b of localBuffers) _totalSamplesBeforeReset += b.length
            const _sampleRateBeforeReset = ctx ? ctx.sampleRate : 48000
            /*
            console.log(
              'Reset buffers — previous buffer length:',
              (_totalSamplesBeforeReset / _sampleRateBeforeReset).toFixed(1) + 's'
            )
              */
          } catch (err) {}

          buffers = []
          if (tailBuffer && tailBuffer.length) buffers.push(tailBuffer)

          ;(async () => {
            try {
              // assemble mono
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

              // Gate on original energy (before leveling/compression)
              if (
                duration >= currentParameters.MIN_SEG_SECONDS &&
                energyOriginal >= currentParameters.MIN_RMS
              ) {
                // --- Volume leveling + simple peak compression ---
                if (currentParameters.ENABLE_LEVELING) {
                  const currentRMS = energyOriginal
                  if (currentRMS > 0) {
                    // Compute desired gain and clamp to MAX_GAIN
                    let gain = currentParameters.TARGET_RMS / currentRMS
                    if (gain > currentParameters.MAX_GAIN) gain = currentParameters.MAX_GAIN

                    for (let i = 0; i < pcm.length; i++) {
                      let v = pcm[i] * gain

                      // Soft compression on peaks above COMP_THRESHOLD
                      const av = Math.abs(v)
                      if (av > currentParameters.COMP_THRESHOLD) {
                        const sign = v < 0 ? -1 : 1
                        const over = av - currentParameters.COMP_THRESHOLD
                        // Reduce "over" portion by COMP_RATIO
                        const compressed =
                          currentParameters.COMP_THRESHOLD + over / currentParameters.COMP_RATIO
                        v = sign * compressed
                      }

                      // Final hard clamp to avoid numeric clipping
                      if (v > 1) v = 1
                      if (v < -1) v = -1
                      pcm[i] = v
                    }
                  }
                }
                // -------------------------------------------------

                const result = await asr(pcm, {
                  prompt: currentParameters.commandPrompt,
                  condition_on_prev_text: false
                })
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

    // processor must be connected to destination for ScriptProcessor to run
    proc.connect(ctx.destination)
    showRecording(true)

    // start duration tracking
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

function processSpeechText(newText) {
  lastSpeech = newText

  if (newText) {
    messageInput.value = newText
    messageInput.focus()

    // if the first word contains (in any case) CHAT_NAME, submit to the HUB
    try {
      let textCommand = textAfterWord(newText, CHAT_NAME)

      if (textCommand !== null) {
        // If you want to force a prefix, uncomment:
        // textCommand = "FORCE " + textCommand;

        messageInput.value = textCommand
        messageInput.focus()

        // play "success" sound
        playSound(480, 200, 0.12)
        // trigger the same submit action as the UI
        clickSubmitButton()
      }
    } catch (e) {
      console.warn('wakeword-check error', e)
    }

    console.log(newText)
  } else {
    addMessage('(No text recognized, try again)', false)
  }
}

export function getFirstWord(text) {
  return (text.split(/\s+/)[0] || '').toUpperCase()
}

// Return the substring of `newText` that occurs after the first occurrence of
// `newWord` (case-insensitive, word-boundary match). If `newWord` is not
// present, return null.
export function textAfterWord(newText, newWord) {
  // make lower-case for comparison
  newText = String(newText).toLocaleLowerCase()
  newWord = String(newWord).toLocaleLowerCase()

  if (!newText || !newWord) return null

  // Find first word in the text whose Levenshtein distance to newWord is <= 2
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
      v1[j + 1] = Math.min(
        v1[j] + 1,
        v0[j + 1] + 1,
        v0[j] + cost
      )
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

  try { proc.disconnect() } catch {}
  try { src.disconnect() } catch {}
  try { stream && stream.getTracks().forEach(t => t.stop()) } catch {}
  try { ctx && await ctx.close() } catch {}

  try {
    let _total = 0
    for (const b of buffers) _total += b.length
    const _sr = ctx ? ctx.sampleRate : 48000
    /*
    console.log(
      'Reset buffers (stop) — previous buffer length:',
      (_total / _sr).toFixed(1) + 's'
    )
      */
  } catch (e) {}
  buffers = []
  tailBuffer = null
}

// Backwards-compat: expose on window so older code calling global activateMic still works
try { window.activateMic = activateMic } catch (e) {}
