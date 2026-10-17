// All sounds are synthesised with WebAudio, so there are no audio files.

export class Spooky {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.enabled = true;
  }

  // Must be called from a user gesture (tap / click).
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);

    // Noise buffer shared by whispers, whooshes and the scream.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Low drone: two detuned saws through a low-pass.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    lp.Q.value = 6;
    this.droneFilter = lp;
    for (const f of [49, 49.6, 73.4]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    lp.connect(this.droneGain).connect(this.master);

    // Whisper bed: band-passed noise, gain modulated in update().
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    this.whisperFilter = ctx.createBiquadFilter();
    this.whisperFilter.type = "bandpass";
    this.whisperFilter.frequency.value = 2200;
    this.whisperFilter.Q.value = 3;
    this.whisperGain = ctx.createGain();
    this.whisperGain.gain.value = 0;
    ns.connect(this.whisperFilter).connect(this.whisperGain).connect(this.master);
    ns.start();
  }

  setVolume(v) {
    this.volume = v;
    this.applyMaster();
  }

  setEnabled(on) {
    this.enabled = on;
    this.applyMaster();
  }

  applyMaster() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.1);
  }

  resume() {
    if (this.ctx && this.ctx.state !== "running") this.ctx.resume();
  }

  // Called every frame. visible 0..1, creeping bool, closeness 0..1.
  update(visible, creeping, closeness) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const drone = visible * (creeping ? 0.10 + 0.25 * closeness : 0.015);
    // Abrupt cut when it's being watched: the silence is the scary part.
    this.droneGain.gain.setTargetAtTime(drone, now, creeping ? 0.4 : 0.05);
    this.droneFilter.frequency.setTargetAtTime(150 + closeness * 250, now, 0.3);

    const w = creeping ? visible * closeness * (0.5 + 0.5 * Math.sin(now * 2.7) * Math.sin(now * 1.3)) * 0.35 : 0;
    this.whisperGain.gain.setTargetAtTime(Math.max(0, w), now, 0.08);
    this.whisperFilter.frequency.setTargetAtTime(1600 + 1200 * Math.sin(now * 0.9), now, 0.2);
  }

  noiseBurst({ dur, from, to, type = "bandpass", q = 1, gain = 0.4 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, now);
    f.frequency.exponentialRampToValueAtTime(to, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.05, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  // Ghost spins around.
  whoosh() {
    this.noiseBurst({ dur: 0.6, from: 400, to: 2500, q: 0.8, gain: 0.25 });
  }

  // Statue grinds to a halt.
  grind() {
    this.noiseBurst({ dur: 0.35, from: 300, to: 90, type: "lowpass", q: 4, gain: 0.5 });
  }

  // It appears.
  appear() {
    this.noiseBurst({ dur: 2.5, from: 3000, to: 300, q: 2, gain: 0.12 });
  }

  scream() {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.7, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    g.connect(this.master);
    for (const [f0, f1] of [[700, 1900], [740, 2100], [1100, 2600]]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(f1, now + 0.25);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.8, now + 1.4);
      const vib = ctx.createOscillator();
      const vg = ctx.createGain();
      vib.frequency.value = 23;
      vg.gain.value = 60;
      vib.connect(vg).connect(o.frequency);
      o.connect(g);
      o.start(now);
      vib.start(now);
      o.stop(now + 1.5);
      vib.stop(now + 1.5);
    }
    this.noiseBurst({ dur: 1.2, from: 5000, to: 800, q: 0.7, gain: 0.5 });
  }
}
