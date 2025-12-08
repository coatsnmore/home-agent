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
let lastSpeech = "";

var sttModelSize = "tiny"; // worst / fastest
// var sttModelSize = "base";
// var sttModelSize = "small";  // best / slowest

// do we want to quantize the STT?
// (faster / less accurate)
let quantized = true;

//////////////////
// COMMAND PROMPT (bias Whisper toward short device commands)
//////////////////
let COMMAND_PROMPT = `
${CHAT_NAME}, light on
${CHAT_NAME}, light off
${CHAT_NAME}, austin fan on
${CHAT_NAME}, austin fan off
`.trim()

//////////////////
// TUNABLES
//////////////////
let MIN_SEG_SECONDS = 2.0 // MAYBE 1.5
let VAD_RMS = 0.010
let MIN_RMS = 0.003
let VAD_SILENCE_MS = 2000 // MAYBE 1200-1500

// -------- Post-leveling  --------
// Master switch for volume leveling + simple peak compression.
// Turn off if you suspect it's hurting more than helping.
let ENABLE_LEVELING = true

// Target RMS loudness for segments before sending to ASR.
// Higher = louder (0–1 range). Try 0.05–0.1.
// Too high can emphasize background noise or clip peaks.
let TARGET_RMS = 0.08

// Maximum gain multiplier allowed when boosting quiet segments.
// Limits how much we can "turn up" distant/quiet speech so we don't
// massively amplify pure noise. Try 4–8. Lower = safer.
let MAX_GAIN = 6.0

// -------- compression tunables --------
// Amplitude threshold where compression of peaks starts (0–1).
// Samples above this get squashed using COMP_RATIO.
// Lower = more aggressive compression.
let COMP_THRESHOLD = 0.6

// Compression ratio applied to samples above COMP_THRESHOLD.
// 1.0 = no compression; 2–4 = gentle to moderate.
// Higher = stronger peak reduction.
let COMP_RATIO = 3.0
// ------------------------------------------------------

// When a silence-triggered segment is emitted, keep this many seconds from the
// end of the previous buffer and prepend it to the next active buffer so
// short words at the boundary aren't lost.
const BUFFER_TAIL_SECONDS = MIN_SEG_SECONDS / 2

// filter out sounds above / below human vocal range
const ENABLE_PREFILTER = true
const HPF_FREQ = 100          // high-pass cutoff Hz (remove rumble)
const LPF_FREQ = 3500         // low-pass cutoff Hz (limit high-frequency noise)

// filter out sounds whose % frequency is outside of human vocal range
const ENABLE_ANALYSER_VAD = true
const ANALYSER_FFT_SIZE = 1024  // sample size for analyser node...larger = better / slower
const VAD_BAND_LOW = 120        // low Hz for band energy check
const VAD_BAND_HIGH = 3200      // high Hz for band energy check
const VAD_ENERGY_RATIO = 0.40   // fraction of input between VAD_BAND_LOW/HIGH to consider voice

// Internal state
let asr = null
let rec = false
let buffers = []
let ctx, src, proc, stream
let hp, lp, analyser
let tailBuffer = null
let lastSpeechTS = 0
let processingSegment = false
let recordStartTS = 0

// Resample Float32Array `data` from `from` Hz to `to` Hz (default 16kHz)
let SAMPLE_RATE = 16000

function resample(data, from, to = SAMPLE_RATE) {
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
  return window.isSecureContext ||
    location.protocol === 'https:' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1'
}

// ---- NEW: tail helper ----
function computeTailBuffer(localBuffers, seconds, sampleRate) {
  let totalLen = 0
  for (const b of localBuffers) totalLen += b.length
  if (!totalLen) return null

  const tailSamples = Math.min(totalLen, Math.floor(seconds * sampleRate))
  if (!tailSamples) return null

  const startIndex = totalLen - tailSamples
  const tail = new Float32Array(tailSamples)

  let readPos = 0
  let destOff = 0

  for (const b of localBuffers) {
    const bLen = b.length
    const segStart = Math.max(0, startIndex - readPos)
    const segEnd = Math.min(
      bLen,
      startIndex - readPos + tailSamples - destOff
    )
    const segLen = segEnd - segStart

    if (segLen > 0) {
      tail.set(b.subarray(segStart, segEnd), destOff)
      destOff += segLen
      if (destOff >= tailSamples) break
    }
    readPos += bLen
  }

  return tail
}

export async function initializeSTT() {
  try {
    addMessage('Loading speech recognition model... (this may take a moment)', false)

    // Load transformers pipeline if missing
    if (!window.transformersPipeline) {
      try {
        const transformersModule = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js')
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
      asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-' + sttModelSize + '.en', { quantized: quantized })
    } catch (e) {
      console.warn('Quantized ASR failed, falling back:', e)
      asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-' + sttModelSize + '.en', { quantized: false })
    }

    addMessage('Speech recognition ready! Click the microphone to start.', false)
    showRecording(false)
  } catch (error) {
    console.error('Failed to load STT model:', error)
    addMessage(`Speech recognition unavailable: ${error.message}. You can still type messages.`, false)
    showRecording(false)
  }
}

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
      const getUserMedia = navigator.mediaDevices?.getUserMedia ||
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
    if (ENABLE_PREFILTER) {
      try {
        hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = HPF_FREQ
        lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = LPF_FREQ
        src.connect(hp)
        hp.connect(lp)
        lp.connect(proc)
        if (ENABLE_ANALYSER_VAD) {
          analyser = ctx.createAnalyser()
          analyser.fftSize = ANALYSER_FFT_SIZE
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
      if (ENABLE_ANALYSER_VAD && analyser) {
        try {
          const freqData = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(freqData)
          let inBand = 0, total = 0
          const binSize = (ctx.sampleRate || 48000) / analyser.fftSize
          const lowBin = Math.max(0, Math.floor(VAD_BAND_LOW / binSize))
          const highBin = Math.min(freqData.length - 1, Math.ceil(VAD_BAND_HIGH / binSize))
          for (let i = 0; i < freqData.length; i++) {
            total += freqData[i]
            if (i >= lowBin && i <= highBin) inBand += freqData[i]
          }
          const ratio = total > 0 ? (inBand / total) : 0
          if (ratio < VAD_ENERGY_RATIO) {
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
      if (rms(ch) >= VAD_RMS) {
        lastSpeechTS = performance.now()
        // clear countdown while voice is active
        try { updateVADCountdown(null) } catch (e) {}
      } else {
        // if we've been silent for longer than the configured threshold,
        // capture the current buffers as a segment and process them
        const silentFor = performance.now() - lastSpeechTS
        // update countdown display (seconds, one decimal)
        try {
          updateVADCountdown(Math.max(0, (VAD_SILENCE_MS - silentFor) / 1000))
        } catch (e) {}

        if (silentFor > VAD_SILENCE_MS && buffers.length && !processingSegment) {
          processingSegment = true

          // hide countdown and duration while processing
          try { updateVADCountdown(null) } catch (e) {}
          try { updateVADDuration(null) } catch (e) {}

          const localBuffers = buffers.slice()

          // compute tail before clearing buffers
          try {
            const sampleRate = ctx ? ctx.sampleRate : 48000
            tailBuffer = computeTailBuffer(
              localBuffers,
              BUFFER_TAIL_SECONDS,
              sampleRate
            )
          } catch (e) {
            console.warn('tail computation failed:', e)
            tailBuffer = null
          }

          // clear live buffers and prepend tailBuffer so recording continues
          try {
            let _totalSamplesBeforeReset = 0
            for (const b of localBuffers) _totalSamplesBeforeReset += b.length
            const _sampleRateBeforeReset = ctx ? ctx.sampleRate : 48000
            console.log(
              'Reset buffers — previous buffer length:',
              (_totalSamplesBeforeReset / _sampleRateBeforeReset).toFixed(1) + 's'
            )
          } catch (e) {}

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
              for (const b of localBuffers) { mono.set(b, off); off += b.length }

              const pcm = resample(mono, ctx.sampleRate)
              const duration = pcm.length / SAMPLE_RATE
              const energyOriginal = rms(pcm)

              // Gate on original energy (before leveling/compression)
              if (duration >= MIN_SEG_SECONDS && energyOriginal >= MIN_RMS) {

                // --- Volume leveling + simple peak compression ---
                if (ENABLE_LEVELING) {
                  const currentRMS = energyOriginal
                  if (currentRMS > 0) {
                    // Compute desired gain and clamp to MAX_GAIN
                    let gain = TARGET_RMS / currentRMS
                    if (gain > MAX_GAIN) gain = MAX_GAIN

                    for (let i = 0; i < pcm.length; i++) {
                      let v = pcm[i] * gain

                      // Soft compression on peaks above COMP_THRESHOLD
                      const av = Math.abs(v)
                      if (av > COMP_THRESHOLD) {
                        const sign = v < 0 ? -1 : 1
                        const over = av - COMP_THRESHOLD
                        // Reduce "over" portion by COMP_RATIO
                        const compressed = COMP_THRESHOLD + over / COMP_RATIO
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
                  prompt: COMMAND_PROMPT,
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

//----------------------------------------------------------------------------
// Process recognized speech text
function processSpeechText(newText) {
  lastSpeech = newText;

  if (newText) {
    messageInput.value = newText
    messageInput.focus()

    // if the first word contains (in any case) CHAT_NAME, submit to the HUB
    try {
      let textCommand = textAfterWord(newText, CHAT_NAME)

      if (textCommand !== null) {
        // TEST:
        // textCommand = "FORCE " + textCommand

        messageInput.value = textCommand
        messageInput.focus()

        // play "success" sound
        playSound(480, 200, 0.12)
        // trigger the same submit action as the UI
        clickSubmitButton()
      }

    } catch (e) {
      console.warn('tester-check error', e)
    }

    console.log(newText)
  } else {
    addMessage('(No text recognized, try again)', false)
  }
}

export function getFirstWord(text) {
  return (text.split(/\s+/)[0] || '').toUpperCase();
}

// Return the substring of `newText` that occurs after the first occurrence of
// `newWord` (case-insensitive, word-boundary match). If `newWord` is not
// present, return null.
export function textAfterWord(newText, newWord) {
  // make lower-case for comparison
  newText = String(newText).toLocaleLowerCase();
  newWord = String(newWord).toLocaleLowerCase();

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
  const la = a.length, lb = b.length
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

export function isRecording() { return rec }

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
    console.log(
      'Reset buffers (stop) — previous buffer length:',
      (_total / _sr).toFixed(1) + 's'
    )
  } catch (e) {}
  buffers = []
  tailBuffer = null
}

// Backwards-compat: expose on window so older code calling global activateMic still works
try { window.activateMic = activateMic } catch (e) {}
