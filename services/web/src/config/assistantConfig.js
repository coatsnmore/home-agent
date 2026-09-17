/**
 * Centralized Voice Assistant & Wake-Word Configuration
 */

const defaultWakeWord = (import.meta.env.VITE_WAKE_WORD || 'Skeletron').trim()

function getPhoneticAliases(word) {
  const lower = word.toLowerCase().trim()
  const aliases = new Set([lower])

  if (lower === 'skeletron') {
    aliases.add('skeleton')
    aliases.add('skeletor')
    aliases.add('skeltron')
    aliases.add('skelton')
    aliases.add('skellington')
    aliases.add('skeletons')
  } else if (lower === 'amelia') {
    aliases.add('emilia')
    aliases.add('emelia')
    aliases.add('amelio')
    aliases.add('a media')
  }

  return Array.from(aliases)
}

export const ASSISTANT_CONFIG = {
  // Primary assistant name and wake word
  name: defaultWakeWord,
  wakeWord: defaultWakeWord,

  // Supported variations for natural matching
  getWakeWords() {
    const baseWord = defaultWakeWord
    const lower = baseWord.toLowerCase()
    const aliases = getPhoneticAliases(lower)
    const list = []

    for (const a of aliases) {
      list.push(`hey ${a}`)
      list.push(`ok ${a}`)
      list.push(`okay ${a}`)
      list.push(a)
    }

    return list
  },

  // Returns display name for UI pills and banners
  getPrimaryWakeWord() {
    return defaultWakeWord
  },

  // Update wake word in local storage
  setWakeWord(word) {
    if (word && word.trim()) {
      localStorage.setItem('home_agent_wake_word', word.trim())
    }
  },
}

