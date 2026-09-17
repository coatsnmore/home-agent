import { useEffect, useRef } from 'react'

/**
 * Plays a very subtle, soft ambient tone while the agent is actively responding
 * if the speaker (TTS) is enabled. Provides gentle acoustic feedback that the agent
 * is working on the request, and stops cleanly when speech begins or streaming finishes.
 */
export function useRespondingTone({ isStreaming, isTtsEnabled, isSpeaking }) {
  const audioCtxRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    // Only active when agent is responding (streaming), speaker is turned on, and not currently speaking
    const shouldPlay = isStreaming && isTtsEnabled && !isSpeaking

    if (!shouldPlay) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
      }
      return
    }

    let isCancelled = false

    const playPulse = () => {
      if (isCancelled) return

      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if (!AudioCtx) return

        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioCtx()
        }

        const ctx = audioCtxRef.current
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {})
        }

        const now = ctx.currentTime

        // Dual harmonic sine tones: soft E5 (659.25 Hz) with gentle harmonic B5 (987.77 Hz)
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gainNode = ctx.createGain()

        osc1.type = 'sine'
        osc1.frequency.setValueAtTime(659.25, now)

        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(987.77, now)

        // Very subtle volume (gain 0.025 to 0.03 max) with a smooth bell curve envelope
        gainNode.gain.setValueAtTime(0, now)
        gainNode.gain.linearRampToValueAtTime(0.028, now + 0.07)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)

        osc1.connect(gainNode)
        osc2.connect(gainNode)
        gainNode.connect(ctx.destination)

        osc1.start(now)
        osc2.start(now)
        osc1.stop(now + 0.55)
        osc2.stop(now + 0.55)
      } catch (err) {
        console.warn('[RespondingTone] Tone notice:', err)
      }

      // Schedule next gentle pulse every 1.8 seconds while actively responding
      if (!isCancelled) {
        timerRef.current = setTimeout(playPulse, 1800)
      }
    }

    // 250ms initial breathing room so instantaneous answers don't emit an unnecessary click
    timerRef.current = setTimeout(playPulse, 250)

    return () => {
      isCancelled = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
      }
    }
  }, [isStreaming, isTtsEnabled, isSpeaking])
}
