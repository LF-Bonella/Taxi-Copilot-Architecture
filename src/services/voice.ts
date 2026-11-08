/** Voz imperativa em pt-BR (Web Speech API) + bipes de alerta (Web Audio). */
export class Voice {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private ctx: AudioContext | null = null;
  onSpeak?: (text: string) => void;

  constructor() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice =
        voices.find((v) => v.lang === 'pt-BR' && /google|natural|online/i.test(v.name)) ??
        voices.find((v) => v.lang === 'pt-BR') ??
        voices.find((v) => v.lang.startsWith('pt')) ??
        null;
    };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  /** `interrupt`: corta a fala atual (usado em manobras iminentes e alertas). */
  speak(text: string, interrupt = false) {
    this.onSpeak?.(text);
    if (!this.enabled || !('speechSynthesis' in window)) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  beep(kind: 'alert' | 'ok' | 'danger' = 'alert') {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      const seq = kind === 'danger' ? [880, 660, 880, 660] : kind === 'ok' ? [660, 990] : [990, 990];
      seq.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        o.type = 'square';
        g.gain.value = 0.06;
        o.connect(g).connect(ctx.destination);
        const t = ctx.currentTime + i * 0.18;
        o.start(t);
        o.stop(t + 0.14);
      });
    } catch { /* áudio indisponível */ }
  }

  /** Navegadores exigem um gesto do usuário para liberar áudio. */
  unlock() {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
      if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    } catch { /* ignore */ }
  }
}
