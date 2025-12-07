// Minimal browser-first Text-to-Speech helper
// Exports:
// - async function textToSpeech(text, opts = {}) -> Promise that resolves when speech finishes
// - function cancelSpeech() -> cancels current speech
// Also attaches to window.textToSpeech / window.cancelSpeech for simple use from pages.

// Usage example:
// import { textToSpeech } from './tts.js'
// await textToSpeech('Hello world')

// Options:
// { voiceName, rate = 1, pitch = 1, volume = 1, cancel = true }
// - voiceName: exact voice.name string to prefer (optional)
// - rate: speech rate (0.1 .. 10)
// - pitch: pitch (0 .. 2)
// - volume: 0..1
// - cancel: whether to cancel previous queued speech (default true)

function ensureSpeechSynthesisSupported() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    throw new Error('SpeechSynthesis API not available in this environment')
  }
}

function loadVoicesOnce() {
  // returns Promise<Voice[]>
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    let voices = synth.getVoices()
    if (voices && voices.length) return resolve(voices)

    // wait for voiceschanged event
    const onVoices = () => {
      voices = synth.getVoices()
      synth.removeEventListener('voiceschanged', onVoices)
      resolve(voices)
    }
    synth.addEventListener('voiceschanged', onVoices)

    // Safety timeout: resolve with whatever we have after 1s
    setTimeout(() => {
      const v = synth.getVoices()
      synth.removeEventListener('voiceschanged', onVoices)
      resolve(v)
    }, 1000)
  })
}

let _currentUtterance = null

export function cancelSpeech() {
  try {
    if (window && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  } catch (e) {
    // ignore
  }
  _currentUtterance = null
}

export async function textToSpeech(text, opts = {}) {
  ensureSpeechSynthesisSupported()

  const {
    voiceName = undefined,
    rate = 1.0,
    pitch = 1.0,
    volume = 1.0,
    cancel = true,
  } = opts || {}

  if (!text || String(text).trim().length === 0) return Promise.resolve()

  if (cancel) cancelSpeech()

  const voices = await loadVoicesOnce()

  // prefer an english voice
  let chosen = null
  if (voiceName) {
    chosen = voices.find(v => v.name === voiceName)
  }
  if (!chosen) {
    // prefer language starting with 'en'
    chosen = voices.find(v => (v.lang || '').toLowerCase().startsWith('en')) || voices[0] || null
  }

  return new Promise((resolve, reject) => {
    try {
      const utt = new SpeechSynthesisUtterance(String(text))
      _currentUtterance = utt
      if (chosen) utt.voice = chosen
      utt.rate = Math.max(0.1, Math.min(10, Number(rate) || 1))
      utt.pitch = Math.max(0, Math.min(2, Number(pitch) || 1))
      utt.volume = Math.max(0, Math.min(1, Number(volume) || 1))

      const onEnd = (ev) => {
        utt.removeEventListener('end', onEnd)
        utt.removeEventListener('error', onErr)
        _currentUtterance = null
        resolve()
      }
      const onErr = (ev) => {
        utt.removeEventListener('end', onEnd)
        utt.removeEventListener('error', onErr)
        _currentUtterance = null
        reject(new Error('Speech synthesis error'))
      }

      utt.addEventListener('end', onEnd)
      utt.addEventListener('error', onErr)

      // speak
      try {
        window.speechSynthesis.speak(utt)
      } catch (speakErr) {
        // fallback: reject
        _currentUtterance = null
        reject(speakErr)
      }
    } catch (e) {
      _currentUtterance = null
      reject(e)
    }
  })
}

// Backwards-compat: attach to window for plain pages that include this script
try { if (typeof window !== 'undefined') { window.textToSpeech = textToSpeech; window.cancelSpeech = cancelSpeech } } catch (e) {}

export default textToSpeech
