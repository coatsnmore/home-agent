// UI module extracted from index.html
// Exports DOM bindings and UI helpers as named exports (live bindings where appropriate)

import { sendMessage } from './a2a.js'
import { speakWithPiper, initializePiperTTS } from './tts.js'


//export const CHAT_NAME = 'Dexter'
export const CHAT_NAME = 'Zentra'
// export const CHAT_NAME = 'Rexstar'


// Chat interface state (exported as live bindings)
export let contextId = null
export let isConnected = false


// DOM elements — assume static markup in `index.html` provides these
// Export them so the main module can import and use them.
export const app = document.querySelector('#app')
export const chatContainer = document.querySelector('.chat-container')
export const messagesContainer = document.querySelector('.messages-container')
export const inputContainer = document.querySelector('.input-container')
export const messageInput = document.querySelector('#messageInput')
export const submitButton = document.querySelector('#submitButton')
export const micButton = document.querySelector('#micButton')
export const statusIndicator = document.querySelector('.status-indicator')

// VAD countdown element (created lazily)
let vadCountdownEl = null
let vadDurationEl = null
let vadContainerEl = null

// Update the visual VAD countdown. Pass a number (seconds) to show, or
// null/undefined/0 to hide.
export function updateVADCountdown(seconds) {
  try {
    if (!vadCountdownEl) {
      // create container if needed
      if (!vadContainerEl) {
        vadContainerEl = document.createElement('div')
        vadContainerEl.id = 'vad-container'
        vadContainerEl.style.display = 'flex'
        vadContainerEl.style.flexDirection = 'column'
        vadContainerEl.style.alignItems = 'flex-start'
        vadContainerEl.style.marginLeft = '8px'
        if (micButton && micButton.parentNode) micButton.parentNode.insertBefore(vadContainerEl, micButton.nextSibling)
        else if (statusIndicator && statusIndicator.parentNode) statusIndicator.parentNode.appendChild(vadContainerEl)
      }

      vadCountdownEl = document.createElement('span')
      vadCountdownEl.id = 'vad-countdown'
      vadCountdownEl.className = 'vad-countdown'
      vadCountdownEl.style.fontSize = '0.9em'
      vadCountdownEl.style.opacity = '0.9'
      vadCountdownEl.style.color = 'red'
      vadContainerEl.appendChild(vadCountdownEl)
    }

    // Always show the element; display 0.0 when no positive value is provided
    const val = (seconds && Number(seconds) > 0) ? Number(seconds).toFixed(1) : '0.0'
    vadCountdownEl.textContent = val
    vadCountdownEl.style.display = 'inline-block'
  } catch (e) {
    console.warn('updateVADCountdown failed:', e)
  }
}

// Update the total recording duration display. Pass seconds (number) to
// show duration with one decimal, or null/0 to hide.
export function updateVADDuration(seconds) {
  try {
    if (!vadDurationEl) {
      // ensure container exists
      if (!vadContainerEl) {
        vadContainerEl = document.createElement('div')
        vadContainerEl.id = 'vad-container'
        vadContainerEl.style.display = 'flex'
        vadContainerEl.style.flexDirection = 'column'
        vadContainerEl.style.alignItems = 'flex-start'
        vadContainerEl.style.marginLeft = '8px'
        if (micButton && micButton.parentNode) micButton.parentNode.insertBefore(vadContainerEl, micButton.nextSibling)
        else if (statusIndicator && statusIndicator.parentNode) statusIndicator.parentNode.appendChild(vadContainerEl)
      }

      vadDurationEl = document.createElement('span')
      vadDurationEl.id = 'vad-duration'
      vadDurationEl.className = 'vad-duration'
      vadDurationEl.style.fontSize = '0.9em'
      vadDurationEl.style.opacity = '0.9'
      vadDurationEl.style.color = 'green'
      vadDurationEl.style.marginTop = '2px'
      // append below the countdown
      vadContainerEl.appendChild(vadDurationEl)
    }

    const val = (seconds && Number(seconds) > 0) ? Number(seconds).toFixed(1) : '0.0'
    vadDurationEl.textContent = val
    vadDurationEl.style.display = 'inline-block'
  } catch (e) {
    console.warn('updateVADDuration failed:', e)
  }
}

// Helper to check first word and optionally log before clicking send
export function clickSubmitButton() {
  try {
    sendMessage();
  } catch (e) {
    console.log('clickSubmitButton: error parsing input')
  }
  submitButton.click()
}
export function clearUserInput(){
  messageInput.value = '';
}

// Add welcome message
export function addMessage(text, isUser = false) {
  const messageDiv = document.createElement('div')
  messageDiv.className = `message ${isUser ? 'user-message' : 'agent-message'}`
  messageDiv.textContent = text
  messagesContainer.appendChild(messageDiv)
  messagesContainer.scrollTop = messagesContainer.scrollHeight
  // (TTS removed) — agent messages are shown only as text in the UI

  // play sound
  if(!isUser)
      playSound(240, 200, 0.12)
  // TTS removed - using Piper TTS instead
  else{
    speakWithPiper(text);
  }



  clearUserInput();
}

// Update connection status
export function updateStatus(connected) {
  isConnected = connected
  // keep exported live binding in sync by also assigning to exported variable
  // (consumers that import the binding will see the updated value)
  // Note: because `isConnected` is a top-level exported let, reassigning updates the live binding.
  statusIndicator.textContent = connected ? '🟢 Connected' : '🔴 Disconnected'
  statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`
  submitButton.disabled = !connected
  messageInput.disabled = !connected
}

//----------------------------------------------------------------------------
export function showRecording(isRecording){

  if(isRecording){
      micButton.classList.add('recording')
      micButton.innerHTML = '🔴'
      micButton.title = 'Recording... (auto-stops after silence)'
      micButton.disabled = false
      messageInput.disabled = true
      submitButton.disabled = true
  }
  else{
      micButton.classList.remove('recording')
      micButton.innerHTML = '🎤'
      micButton.title = 'Start voice input'
      micButton.disabled = false
      messageInput.disabled = false
      submitButton.disabled = false
  }

}


// Play a short sine tone. volume should be 0.0 - 1.0. duration in ms.
export function playSound(frequency = 480, durationMs = 200, volume = 0.12) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    const ac = new AudioCtx()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.value = 0
    osc.connect(gain)
    gain.connect(ac.destination)

    // Smooth ramp to avoid clicks
    const now = ac.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(volume, now + 0.01)

    osc.start(now)

    // Stop after duration with a short ramp down
    setTimeout(() => {
      const stopAt = ac.currentTime + 0.02
      gain.gain.linearRampToValueAtTime(0, stopAt)
      try { osc.stop(stopAt) } catch (e) {}
      // Close audio context shortly after stop to free resources
      setTimeout(() => { try { ac.close() } catch (e) {} }, 50)
    }, durationMs)
  } catch (e) {
    console.warn('playSound failed:', e)
  }
}

//----------------------------------------------------------------------------
// INIT STUFF:
//
// Event listeners (wire up UI)
submitButton.addEventListener('click', sendMessage)
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

micButton.onclick = () => {
  initializePiperTTS();
  activateMic();

  requestWakeLock();

}


// Initialize on load
micButton.disabled = true
micButton.innerHTML = '⏳'
micButton.title = 'Initializing...'










//----------------------------------------------------------------------------
// prevent the screen from going to sleep while the app is running
let wakeLock = null;

async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake lock is active');

        wakeLock.addEventListener('release', () => {
            console.log('Wake lock was released');
        });
    } catch (err) {
        console.error(`Wake lock error: ${err.name}, ${err.message}`);
    }
}


