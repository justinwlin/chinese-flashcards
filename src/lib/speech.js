export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function warmVoices() {
  if (!canSpeak()) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices();
  });
}

export function speakChinese(text) {
  if (!canSpeak() || !text) return false;
  try {
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 0.82;
    const voices = synth.getVoices();
    const voice = voices.find((item) => item.lang.replace('_', '-').toLowerCase() === 'zh-cn')
      || voices.find((item) => item.lang.toLowerCase().startsWith('zh'));
    if (voice) utter.voice = voice;
    synth.cancel();
    window.setTimeout(() => {
      try { synth.speak(utter); } catch { /* iOS can reject a speak call after cancel. */ }
    }, 40);
    return true;
  } catch {
    return false;
  }
}
