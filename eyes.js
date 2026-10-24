// "Eyes in the dark": cartoon eyes (Scooby-Doo style) that open one pair at a
// time in the blackness while nobody is looking, and all snap shut the moment
// someone does.

const MAX = 30;
const COLOURS = [[255, 236, 140], [255, 244, 190], [255, 236, 140], [235, 245, 255]];
const RED = [255, 70, 50];
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

export class Eyes {
  constructor() {
    this.pairs = [];
    this.spawnT = 0;
    this.unseenFor = 0;
    this.absentFor = 99;
    this.big = null; // the jump-scare pair
    this.coolT = 0;
  }

  get count() {
    return this.pairs.length;
  }

  reset() {
    this.pairs = [];
    this.big = null;
    this.spawnT = 0;
  }

  // Find a spot in the dark not too close to the others.
  spawn() {
    let best = null;
    for (let i = 0; i < 40; i++) {
      const p = { x: 0.08 + Math.random() * 0.84, y: 0.1 + Math.random() * 0.72 };
      const gap = Math.min(1, ...this.pairs.map((q) => Math.hypot(q.x - p.x, (q.y - p.y) * 0.6)));
      if (!best || gap > best.gap) best = { ...p, gap };
      if (gap > 0.14) break;
    }
    const depth = Math.random(); // 0 far, 1 near
    this.pairs.push({
      x: best.x, y: best.y,
      size: 0.018 + depth * 0.035,
      dim: 0.45 + depth * 0.55,
      colour: this.pairs.length % 6 === 5 ? RED : COLOURS[Math.floor(Math.random() * COLOURS.length)],
      slant: (Math.random() - 0.3) * 0.5, // mostly angry, some droopy
      round: Math.random() < 0.3,
      open: 0,
      delay: 0,
      blinkAt: performance.now() / 1000 + 2 + Math.random() * 6,
    });
  }

  // Returns "scream" when the jump scare should fire.
  update(dt, { present, observed, targetX, creep, jumpscare }) {
    let event = null;
    this.targetX = targetX;
    this.absentFor = present ? 0 : this.absentFor + dt;
    this.unseenFor = observed ? 0 : this.unseenFor + dt;
    if (this.absentFor > 4 && !this.big) this.reset();

    if (this.big) {
      // Jump scare in progress, then a pause before starting over.
      this.big.t += dt;
      this.big.open = approach(this.big.open, this.big.t < 1.2 ? 1 : 0, 10, dt);
      if (this.big.t > 7) this.reset();
    } else if (present && !observed && this.unseenFor > 0.5) {
      this.spawnT += dt;
      if (this.pairs.length < MAX && this.spawnT > creep / MAX) {
        this.spawnT = 0;
        this.spawn();
      }
      if (this.pairs.length >= MAX && jumpscare && this.pairs.every((p) => p.open > 0.9)) {
        this.big = { t: 0, open: 0 };
        event = "scream";
      }
    }

    const now = performance.now() / 1000;
    this.pairs.forEach((p, i) => {
      let target;
      if (observed || this.big || !present) {
        target = 0;
        p.delay = i * 0.06; // reopen one after another when they look away
      } else if (this.unseenFor > 0.5 + p.delay) {
        target = 1;
        if (now > p.blinkAt) { // an occasional blink
          target = 0;
          if (now > p.blinkAt + 0.12) p.blinkAt = now + 3 + Math.random() * 7;
        }
      } else {
        target = 0;
      }
      // Shut fast (staggered a little), open more slowly.
      p.open = target ? approach(p.open, 1, 6, dt) : approach(p.open, 0, 30 - (i % 5) * 3, dt);
    });
    return event;
  }

  // How spooky things are right now, 0..1, for the sound.
  get level() {
    const open = this.pairs.reduce((a, p) => a + p.open, 0);
    return Math.min(1, open / MAX);
  }

  draw(ctx, W, H, brightness = 1) {
    this.W = W;
    const s = Math.min(W, H);
    for (const p of this.pairs) {
      if (p.open < 0.02) continue;
      this.drawPair(ctx, p.x * W, p.y * H, p.size * s, p, p.open, p.dim * brightness);
    }
    if (this.big && this.big.open > 0.02) {
      this.drawPair(ctx, W / 2, H * 0.45, s * 0.2, { colour: [255, 50, 30], slant: 0.35, round: false }, this.big.open, brightness);
    }
  }

  drawPair(ctx, cx, cy, r, p, open, dim) {
    const c = p.colour;
    const look = Math.max(-1, Math.min(1, ((this.targetX ?? 0.5) * this.W - cx) / (r * 12)));
    ctx.save();
    ctx.globalAlpha = dim;
    for (const d of [-1, 1]) {
      const ex = cx + d * r * 1.25;
      const rx = r * (p.round ? 0.9 : 1.05), ry = r * (p.round ? 0.9 : 0.62) * open;
      ctx.save();
      ctx.translate(ex, cy);
      ctx.rotate(d * p.slant);
      // Glowing white of the eye.
      ctx.shadowColor = `rgba(${c[0]},${c[1]},${c[2]},0.8)`;
      ctx.shadowBlur = r * 0.9;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Pupil, kept inside the eye, looking at the person.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(look * rx * 0.45, ry * 0.15, r * 0.36, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
    ctx.restore();
  }
}
