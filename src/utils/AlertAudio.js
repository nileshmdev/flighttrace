// Synthesized alert tones via Web Audio API — no audio files required.
// resume() is async; every public method awaits it before scheduling tones.

class AlertAudio {
  _getCtx() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._audioCtx;
  }

  async _ready() {
    const ctx = this._getCtx();
    if (ctx.state !== "running") await ctx.resume();
    return ctx;
  }

  _tone(ctx, freq, startOffset, duration, vol = 0.35) {
    const t = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.setValueAtTime(vol, t + duration - 0.01);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // 2 short beeps — low battery warning
  async lowVoltage() {
    const ctx = await this._ready();
    this._tone(ctx, 880, 0,    0.12);
    this._tone(ctx, 880, 0.22, 0.12);
  }

  // 4 rapid high beeps — critical battery
  async criticalVoltage() {
    const ctx = await this._ready();
    for (let i = 0; i < 4; i++) this._tone(ctx, 1200, i * 0.14, 0.1, 0.5);
  }

  // 3 descending tones — signal degraded
  async signalLoss() {
    const ctx = await this._ready();
    this._tone(ctx, 880, 0,    0.12);
    this._tone(ctx, 660, 0.22, 0.12);
    this._tone(ctx, 440, 0.44, 0.15);
  }

  // Alternating high-low alarm — failsafe
  async failsafe() {
    const ctx = await this._ready();
    for (let i = 0; i < 6; i++) {
      this._tone(ctx, i % 2 === 0 ? 1400 : 800, i * 0.14, 0.1, 0.55);
    }
  }

  // Rising double chirp — drone armed
  async arm() {
    const ctx = await this._ready();
    this._tone(ctx, 600, 0,    0.08, 0.4);
    this._tone(ctx, 960, 0.12, 0.12, 0.4);
  }

  // Single soft chime — home point set / updated
  async homeSet() {
    const ctx = await this._ready();
    this._tone(ctx, 1050, 0, 0.25, 0.3);
  }
}

export const alertAudio = new AlertAudio();
