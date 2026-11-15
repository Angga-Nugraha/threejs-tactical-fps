// Synthesised sound effects. No audio files, no network: every sound is built from
// oscillators and filtered noise in a WebAudio context created on the first user
// gesture. Calls before unlock are silent no-ops.
export function createAudio() {
  let ctx = null;
  let noiseBuffer = null;

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const length = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (error) {
      ctx = null;
    }
  }

  function burst(duration, filterFreq, gain, type = 'lowpass') {
    if (!ctx || !noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t, Math.random() * 0.3, duration);
  }

  function tone(freq, duration, gain, type = 'sine', slideTo = null) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock,
    shot(kind) {
      if (kind === 'scatter') burst(0.22, 900, 0.5);
      else if (kind === 'longshot') { burst(0.3, 1400, 0.55); tone(140, 0.12, 0.25, 'sawtooth', 60); }
      else if (kind === 'p9') burst(0.1, 1800, 0.32);
      else burst(0.12, 1500, 0.4);
    },
    dryFire() {
      tone(1400, 0.03, 0.12, 'square');
    },
    hit(kill) {
      tone(kill ? 880 : 660, kill ? 0.16 : 0.07, 0.22, 'sine');
      if (kill) tone(1320, 0.12, 0.15, 'sine');
    },
    reload() {
      tone(500, 0.05, 0.12, 'square');
      setTimeout(() => tone(700, 0.05, 0.12, 'square'), 260);
    },
    buy() {
      tone(520, 0.08, 0.18, 'sine');
      setTimeout(() => tone(780, 0.1, 0.18, 'sine'), 90);
    },
    plantTick() {
      tone(980, 0.06, 0.16, 'square');
    },
    plantDone() {
      tone(660, 0.12, 0.2, 'sine');
      setTimeout(() => tone(990, 0.18, 0.2, 'sine'), 120);
    },
    explosion() {
      burst(0.9, 320, 0.9);
      tone(70, 0.7, 0.5, 'sine', 32);
    },
    roundEnd(win) {
      tone(win ? 523 : 392, 0.18, 0.2, 'triangle');
      setTimeout(() => tone(win ? 784 : 330, 0.24, 0.2, 'triangle'), 170);
    },
    click() {
      tone(900, 0.04, 0.1, 'square');
    },
  };
}
