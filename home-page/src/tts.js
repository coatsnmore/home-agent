// Piper TTS integration

// Shared AudioContext for mobile compatibility
let audioContext = null;

// Track if TTS is currently speaking
export let isTTSSpeaking = false;

function getAudioContext() {
	if (!audioContext) {
		const AudioCtx = window.AudioContext || window.webkitAudioContext;
		audioContext = new AudioCtx();
	}
	// Resume if suspended (mobile browsers may suspend it)
	if (audioContext.state === 'suspended') {
		audioContext.resume();
	}
	return audioContext;
}

// Initialize audio context on user interaction (required for mobile)
export function initializePiperTTS() {
	try {
		getAudioContext();
		console.log('Piper TTS AudioContext initialized');
	} catch (e) {
		console.warn('Piper TTS initialization failed:', e);
	}
}

export async function speakWithPiper(speechText) {
	try {
		isTTSSpeaking = true;
		
		const response = await fetch('/piper/speak', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ text: speechText })
		});
		
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		
		const audioBlob = await response.blob();
		const arrayBuffer = await audioBlob.arrayBuffer();
		
		// Use Web Audio API for better mobile compatibility
		const ctx = getAudioContext();
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		const source = ctx.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(ctx.destination);
		source.start(0);
		
		// Return a promise that resolves when playback ends
		return new Promise((resolve) => {
			source.onended = () => {
				isTTSSpeaking = false;
				resolve();
			};
		});
	} catch (error) {
		console.error('Piper TTS Error:', error);
		isTTSSpeaking = false;
		throw error;
	}
}
