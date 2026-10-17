// The cast. Every character is drawn in the same frame as the spectre in
// ghost.js: 1 unit = the figure's full height, centred on x = 0, head near
// y = -0.31 and feet/hem near y = +0.45, so the modes can place any of them.
//
// To look less like a drawing, the bodies are painted at low resolution on an
// offscreen canvas and scaled up (soft focus), with film grain and a soft halo.
// Small details that should stay sharp (eyes) are drawn on top afterwards.

import { drawGhost } from "./ghost.js";

export const CHARACTERS = ["spectre", "shadow", "lady", "girl"];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const shade = (c, k) => c.map((v) => Math.round(v * k));
const STONE = [120, 119, 114];

// ---------------------------------------------------------------- drawing helpers

// Closed, smoothed outline through points (in units).
function smooth(o, pts, u) {
  const p = (i) => pts[(i + pts.length) % pts.length];
  o.beginPath();
  o.moveTo(((p(0)[0] + p(1)[0]) / 2) * u, ((p(0)[1] + p(1)[1]) / 2) * u);
  for (let i = 1; i <= pts.length; i++) {
    const a = p(i), b = p(i + 1);
    o.quadraticCurveTo(a[0] * u, a[1] * u, ((a[0] + b[0]) / 2) * u, ((a[1] + b[1]) / 2) * u);
  }
  o.closePath();
}

function ellipse(o, x, y, rx, ry, u, rot = 0) {
  o.beginPath();
  o.ellipse(x * u, y * u, rx * u, ry * u, rot, 0, Math.PI * 2);
}

// A tapering limb along shoulder → elbow → hand.
function limb(o, pts, w0, w1, u) {
  o.lineCap = "round";
  o.lineJoin = "round";
  for (let i = 0; i < pts.length - 1; i++) {
    o.lineWidth = lerp(w0, w1, i / (pts.length - 1)) * u;
    o.beginPath();
    o.moveTo(pts[i][0] * u, pts[i][1] * u);
    o.lineTo(pts[i + 1][0] * u, pts[i + 1][1] * u);
    o.stroke();
  }
}

// Long thin fingers from a hand, fanned around angle `a`.
function fingers(o, [hx, hy], a, len, spread, width, u) {
  o.lineCap = "round";
  o.lineWidth = width * u;
  for (let k = 0; k < 4; k++) {
    const f = a + (k - 1.5) * spread;
    const l = len * (k === 1 || k === 2 ? 1 : 0.8);
    o.beginPath();
    o.moveTo(hx * u, hy * u);
    o.quadraticCurveTo((hx + Math.cos(f) * l * 0.6) * u, (hy + Math.sin(f) * l * 0.6) * u,
      (hx + Math.cos(f + 0.25) * l) * u, (hy + Math.sin(f + 0.25) * l) * u);
    o.stroke();
  }
}

// Fade whatever is below y0 out to nothing at y1 (legs dissolving into the floor).
function fadeBelow(o, y0, y1, u) {
  o.save();
  o.globalCompositeOperation = "destination-out";
  const gr = o.createLinearGradient(0, y0 * u, 0, y1 * u);
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(0,0,0,1)");
  o.fillStyle = gr;
  o.fillRect(-u, y0 * u, 2 * u, (y1 - y0 + 0.2) * u);
  o.restore();
}

// ---------------------------------------------------------------- soft-focus layer

const off = document.createElement("canvas");
const octx = off.getContext("2d");
let grainPattern = null;
function grain() {
  if (!grainPattern) {
    const n = document.createElement("canvas");
    n.width = n.height = 96;
    const c = n.getContext("2d");
    const img = c.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    grainPattern = octx.createPattern(n, "repeat");
  }
  return grainPattern;
}

// Paint `body` small and blurry, add grain, then scale it up onto ctx with a
// halo. `crisp` draws sharp details on top in the same frame.
function softLayer(ctx, g, body, crisp, glow, grainAmount = 0.05) {
  const u = g.size;
  const front = Math.cos(g.turn) >= 0;
  const sx = Math.max(0.06, Math.abs(Math.cos(g.turn)));
  const k = Math.min(0.24, 420 / (u * 1.3)); // offscreen resolution relative to screen
  const bw = Math.ceil(1.3 * u * k), bh = Math.ceil(1.2 * u * k);
  if (off.width < bw || off.height < bh) {
    off.width = Math.max(off.width, bw);
    off.height = Math.max(off.height, bh);
  }
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, bw, bh);
  octx.setTransform(k * sx, 0, 0, k, bw / 2, 0.62 * u * k);
  body(octx, u, front);

  // Film grain, only where the figure is.
  octx.setTransform(1, 0, 0, 1, Math.random() * 96, Math.random() * 96);
  octx.globalCompositeOperation = "source-atop";
  octx.globalAlpha = grainAmount;
  octx.fillStyle = grain();
  octx.fillRect(-96, -96, bw + 96, bh + 96);
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = g.alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (glow) {
    ctx.shadowColor = glow.color;
    ctx.shadowBlur = glow.blur * u;
  }
  ctx.drawImage(off, 0, 0, bw, bh, g.x - bw / (2 * k), g.y - 0.62 * u, bw / k, bh / k);
  ctx.restore();

  if (crisp) {
    ctx.save();
    ctx.globalAlpha = g.alpha;
    ctx.translate(g.x, g.y);
    ctx.scale(sx, 1);
    crisp(ctx, u, front);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- shadow figure
// A tall, faceless silhouette. In a lit room it's a person-shaped hole; on a
// black screen it gets a cold rim of light so it can be seen at all.

function drawShadow(ctx, g) {
  const t = g.t, m = g.menace, sw = g.sway;
  const col = mix(g.dark ? [24, 26, 34] : [6, 6, 9], STONE, g.stone);
  const jit = (y, k = 1) => 0.006 * k * sw * Math.sin(t * 2.1 + y * 23);

  const body = (o, u) => {
    o.fillStyle = rgba(col, 1);
    o.strokeStyle = rgba(col, 1);
    // Torso and legs, edges gently wavering like smoke.
    const right = [
      [0.026, -0.315], [0.1, -0.278], [0.136, -0.24], [0.128, -0.13], [0.1, -0.02],
      [0.088, 0.08], [0.074, 0.28], [0.064, 0.47], [0.028, 0.47], [0.022, 0.24], [0.004, 0.1],
    ];
    const pts = [...right, ...right.slice().reverse().map(([x, y]) => [-x, y])]
      .map(([x, y]) => [x + jit(y), y]);
    smooth(o, pts, u);
    o.fill();
    ellipse(o, jit(-0.37), -0.372, 0.052, 0.068, u);
    o.fill();

    // Long arms hanging to the knees; they come up toward you as it closes in.
    for (const d of [-1, 1]) {
      const sh = [0.128 * d, -0.245];
      const el = [lerp(0.155, 0.2, m) * d + jit(0, 2), lerp(-0.05, -0.17, m)];
      const hd = [lerp(0.14, 0.185, m) * d + jit(0.2, 3), lerp(0.18, -0.09, m)];
      limb(o, [sh, el, hd], 0.036, 0.022, u);
      fingers(o, hd, d > 0 ? lerp(1.5, 0.4, m) : Math.PI - lerp(1.5, 0.4, m), 0.045 + 0.05 * m, 0.2 + 0.15 * m, 0.008, u);
    }

    // Wisps rising off the head and shoulders.
    for (let i = 0; i < 7; i++) {
      const ph = (t * 0.25 + i / 7) % 1;
      ellipse(o, Math.sin(i * 7.3 + t * 0.7) * 0.11, -0.3 - ph * 0.22, 0.015 + ph * 0.04, 0.012 + ph * 0.03, u);
      o.fillStyle = rgba(col, (1 - ph) * 0.2);
      o.fill();
    }
    fadeBelow(o, 0.22, 0.47, u);
  };

  const crisp = (c, u, front) => {
    if (!front || m < 0.15 || g.stone > 0.5) return;
    c.shadowColor = "rgba(255,60,30,0.9)";
    c.shadowBlur = 0.02 * u;
    c.fillStyle = `rgba(255,${Math.round(lerp(200, 60, m))},40,${Math.min(1, (m - 0.15) * 1.5)})`;
    for (const d of [-1, 1]) {
      ellipse(c, d * 0.018 + g.look * 0.006, -0.378, 0.006, 0.0035, u);
      c.fill();
    }
  };

  const glow = g.dark
    ? { color: `rgba(130,160,210,${0.85 * g.brightness})`, blur: 0.035 }
    : { color: "rgba(0,0,0,0.85)", blur: 0.06 };
  softLayer(ctx, g, body, crisp, glow, 0.03);
}

// ---------------------------------------------------------------- pale lady in white

function drawLady(ctx, g) {
  const t = g.t, m = g.menace, sw = g.sway, b = g.brightness;
  const dress = mix([232, 236, 246], STONE, g.stone).map((v) => v * b);
  const dressLow = mix([168, 180, 205], STONE, g.stone).map((v) => v * b);
  const skin = mix([214, 218, 226], STONE, g.stone).map((v) => v * b);
  const hair = mix([26, 22, 24], STONE, g.stone * 0.6);
  const s = (y, k = 1) => 0.012 * k * sw * Math.sin(t * 1.2 + y * 6); // slow sway, more lower down

  const body = (o, u, front) => {
    // Hair behind the head, down past the shoulders.
    o.fillStyle = rgba(hair, 0.95);
    smooth(o, [[0, -0.405], [0.055, -0.38], [0.07, -0.3], [0.08, -0.2], [0.06, -0.15], [-0.06, -0.15], [-0.08, -0.2], [-0.07, -0.3], [-0.055, -0.38]]
      .map(([x, y]) => [x + s(y, 0.5), y]), u);
    o.fill();

    // Long dress flaring to a ragged, see-through hem.
    const right = [[0.03, -0.27], [0.088, -0.25], [0.08, -0.17], [0.06, -0.08], [0.1, 0.05], [0.18, 0.24], [0.26, 0.42]];
    const pts = right.map(([x, y]) => [x + s(y, (y + 0.3) * 2), y]);
    const tails = 11;
    for (let i = 0; i <= tails; i++) {
      const f = i / tails;
      const y = (i % 2 ? 0.43 : 0.47) + 0.02 * Math.sin(t * 1.7 + i * 1.3) * sw;
      pts.push([lerp(0.27, -0.27, f) + s(y, 1.6), y]);
    }
    for (let i = right.length - 1; i >= 0; i--) pts.push([-right[i][0] + s(right[i][1], (right[i][1] + 0.3) * 2), right[i][1]]);
    const gr = o.createLinearGradient(0, -0.27 * u, 0, 0.47 * u);
    gr.addColorStop(0, rgba(dress, 0.95));
    gr.addColorStop(0.5, rgba(mix(dress, dressLow, 0.5), 0.85));
    gr.addColorStop(1, rgba(dressLow, 0));
    smooth(o, pts, u);
    o.fillStyle = gr;
    o.fill();
    // Folds.
    o.strokeStyle = rgba(dressLow, 0.16);
    for (const [k, w] of [[-2.6, 0.012], [-1.2, 0.008], [0.4, 0.014], [1.7, 0.009], [2.9, 0.011]]) {
      o.lineWidth = w * u;
      o.beginPath();
      o.moveTo(k * 0.012 * u, -0.04 * u);
      o.quadraticCurveTo((k * 0.03 + s(0.2, 2)) * u, 0.15 * u, (k * 0.075 + s(0.4, 3)) * u, 0.44 * u);
      o.stroke();
    }

    // Thin arms at her sides, slowly lifting toward you.
    o.strokeStyle = rgba(skin, 0.95);
    for (const d of [-1, 1]) {
      const sh = [0.085 * d, -0.245];
      const el = [lerp(0.11, 0.15, m) * d + s(0, 1), lerp(-0.09, -0.16, m)];
      const hd = [lerp(0.1, 0.18, m) * d + s(0.1, 1.5), lerp(0.07, -0.14, m)];
      limb(o, [sh, el, hd], 0.022, 0.014, u);
      fingers(o, hd, d > 0 ? lerp(1.55, 0.5, m) : Math.PI - lerp(1.55, 0.5, m), 0.04 + 0.02 * m, 0.14, 0.006, u);
    }

    if (front) {
      // Long pale face: dark hollows for eyes, a shadow of a mouth.
      o.fillStyle = rgba(skin, 1);
      o.fillRect(-0.015 * u, -0.29 * u, 0.03 * u, 0.04 * u); // neck
      const fx = g.look * 0.008;
      ellipse(o, fx, -0.335, 0.041, 0.056, u);
      o.fill();
      // Shaded hollows rather than flat shapes.
      const hollow = (x, y, rx, ry, a) => {
        const gr = o.createRadialGradient(x * u, y * u, 0, x * u, y * u, Math.max(rx, ry) * u);
        gr.addColorStop(0, `rgba(15,15,24,${a})`);
        gr.addColorStop(0.55, `rgba(30,30,42,${a * 0.75})`);
        gr.addColorStop(1, rgba(skin, 0));
        o.fillStyle = gr;
        ellipse(o, x, y, rx, ry, u);
        o.fill();
      };
      for (const d of [-1, 1]) hollow(fx + d * 0.017, -0.345, 0.016, 0.013 + 0.003 * m, 0.95);
      hollow(fx, -0.335, 0.035, 0.05, 0.12); // sunken cheeks
      hollow(fx, -0.298 + g.mouth * 0.012, 0.01 + 0.014 * g.mouth, 0.005 + 0.028 * g.mouth, 0.6 + 0.4 * g.mouth);
      // Hair framing the face.
      o.fillStyle = rgba(hair, 0.95);
      for (const d of [-1, 1]) {
        smooth(o, [[d * 0.012, -0.392], [d * 0.05, -0.37], [d * 0.058, -0.3], [d * 0.07, -0.18], [d * 0.045, -0.2], [d * 0.04, -0.32]], u);
        o.fill();
      }
    }

    // A veil over head and shoulders; you can see the face through it.
    const veil = [[0, -0.42], [0.05, -0.405], [0.075, -0.33], [0.11, -0.2], [0.15, -0.06], [0.07, -0.08], [0, -0.05], [-0.07, -0.08], [-0.15, -0.06], [-0.11, -0.2], [-0.075, -0.33], [-0.05, -0.405]]
      .map(([x, y]) => [x + s(y, 1.2), y + (y > -0.1 ? 0.012 * Math.sin(t * 1.5 + x * 30) * sw : 0)]);
    smooth(o, veil, u);
    o.fillStyle = rgba(dress, front ? 0.38 : 0.62);
    o.fill();
    o.strokeStyle = rgba(dress, 0.5);
    o.lineWidth = 0.004 * u;
    o.stroke();
  };

  softLayer(ctx, g, body, null, { color: `rgba(200,220,255,${0.75 * b * (1 - g.stone)})`, blur: 0.07 });
}

// ---------------------------------------------------------------- long-haired girl
// Moves in jerks: what's shown only catches up with where she really is every
// 80-300 ms, and now and then her head twitches.

const girl = { next: 0, x: 0, y: 0, size: 0, t: 0, twitch: 0 };
export const girlShown = () => ({ x: girl.x, y: girl.y });

function drawGirl(ctx, g) {
  const now = performance.now();
  // Catch up on schedule, or at once after a big jump (new mode, new spot).
  const jumped = Math.abs(g.size - girl.size) > g.size * 0.4 || Math.hypot(g.x - girl.x, g.y - girl.y) > g.size * 0.35;
  if (now >= girl.next || jumped) {
    Object.assign(girl, {
      x: g.x, y: g.y, size: g.size, t: g.t,
      twitch: Math.random() < 0.15 ? (Math.random() - 0.5) * 0.7 : 0,
      next: now + 80 + Math.random() * 220,
    });
  }
  const gs = { ...g, x: girl.x, y: girl.y, size: girl.size, t: girl.t };
  const t = gs.t, m = g.menace, sw = g.sway, b = g.brightness;
  const gown = mix([180, 182, 184], STONE, g.stone).map((v) => v * b);
  const gownLow = mix([132, 132, 128], STONE, g.stone).map((v) => v * b);
  const skin = mix([168, 172, 176], STONE, g.stone).map((v) => v * b);
  const hairC = mix([7, 7, 9], STONE, g.stone * 0.5);
  const tilt = (0.45 * m + girl.twitch) * (g.stone > 0.5 ? 0.6 : 1);
  const reach = Math.max(m, g.mouth);

  // Head, hair and the eye share this rotated frame (tilting at the neck).
  const headFrame = (o, u) => {
    o.translate(0, -0.15 * u);
    o.rotate(tilt);
    o.translate(0, 0.15 * u);
  };

  const body = (o, u, front) => {
    // Thin legs under the nightgown.
    o.strokeStyle = rgba(skin, 0.95);
    limb(o, [[0.026, 0.27], [0.028, 0.45]], 0.024, 0.02, u);
    limb(o, [[-0.026, 0.27], [-0.03, 0.45]], 0.024, 0.02, u);

    // Grubby nightgown.
    const right = [[0.02, -0.15], [0.066, -0.135], [0.07, -0.05], [0.09, 0.12], [0.12, 0.3]];
    const pts = right.map(([x, y]) => [x, y]);
    for (let i = 0; i <= 6; i++) pts.push([lerp(0.125, -0.125, i / 6), 0.3 + (i % 2 ? 0.015 : 0) + 0.006 * Math.sin(t + i)]);
    for (let i = right.length - 1; i >= 0; i--) pts.push([-right[i][0], right[i][1]]);
    const gr = o.createLinearGradient(0, -0.15 * u, 0, 0.32 * u);
    gr.addColorStop(0, rgba(gown, 1));
    gr.addColorStop(1, rgba(gownLow, 1));
    smooth(o, pts, u);
    o.fillStyle = gr;
    o.fill();
    o.fillStyle = "rgba(60,55,45,0.09)";
    for (const [x, y, r] of [[0.03, 0.05, 0.02], [-0.05, 0.2, 0.025], [0.06, 0.24, 0.018]]) {
      ellipse(o, x, y, r, r * 0.7, u);
      o.fill();
    }

    // Arms; one comes up to reach for you.
    o.strokeStyle = rgba(skin, 0.95);
    for (const d of [-1, 1]) {
      const r = d > 0 || g.mouth > 0.5 ? reach : 0;
      const sh = [0.064 * d, -0.13];
      const el = [lerp(0.075, 0.115, r) * d, lerp(-0.02, -0.09, r)];
      const hd = [lerp(0.07, 0.16, r) * d, lerp(0.1, -0.1, r)];
      limb(o, [sh, el, hd], 0.018, 0.013, u);
      fingers(o, hd, d > 0 ? lerp(1.5, 0.2, r) : Math.PI - lerp(1.5, 0.2, r), 0.025 + 0.015 * r, 0.16, 0.005, u);
    }

    o.save();
    headFrame(o, u);
    // Face, never really seen.
    o.fillStyle = rgba(skin, 1);
    ellipse(o, 0, -0.215, 0.046, 0.056, u);
    o.fill();
    // Long black hair over everything, down to the waist.
    o.fillStyle = rgba(hairC, 1);
    smooth(o, [[0, -0.285], [0.05, -0.27], [0.062, -0.21], [0.07, -0.1], [0.078, 0.02], [0.03, 0.05], [-0.03, 0.04], [-0.078, 0.02], [-0.07, -0.1], [-0.062, -0.21], [-0.05, -0.27]], u);
    o.fill();
    o.lineCap = "round";
    for (let i = 0; i < 46; i++) {
      const f = i / 45;
      const x0 = lerp(-0.045, 0.045, f);
      const x1 = x0 * 1.6 + 0.006 * Math.sin(t * 1.4 + i * 1.7) * sw;
      const y1 = 0.0 + 0.06 * ((i * 37) % 11) / 11;
      o.strokeStyle = i % 4 === 0 ? rgba(shade([60, 60, 66], b), 0.7) : rgba(hairC, 1);
      o.lineWidth = 0.004 * u;
      o.beginPath();
      o.moveTo(x0 * 0.6 * u, -0.28 * u);
      o.quadraticCurveTo(x0 * 1.3 * u, -0.17 * u, x1 * u, y1 * u);
      o.stroke();
    }
    o.restore();
    fadeBelow(o, 0.42, 0.5, u);
  };

  // At her most menacing, one eye shows through the hair.
  const crisp = (c, u, front) => {
    if (!front || m < 0.6 || g.stone > 0.5) return;
    const a = Math.min(1, (m - 0.6) * 2.5);
    headFrame(c, u);
    c.shadowColor = `rgba(230,230,220,${a * 0.6})`;
    c.shadowBlur = 0.01 * u;
    c.fillStyle = `rgba(225,222,212,${a})`;
    ellipse(c, 0.018, -0.212, 0.014, 0.0075, u);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = `rgba(10,10,10,${a})`;
    ellipse(c, 0.018 + g.look * 0.004, -0.212, 0.0055, 0.0055, u);
    c.fill();
    c.strokeStyle = rgba(hairC, 1);
    c.lineWidth = 0.003 * u;
    for (const x of [0.009, 0.029]) {
      c.beginPath();
      c.moveTo(x * u, -0.24 * u);
      c.lineTo((x + 0.004) * u, -0.18 * u);
      c.stroke();
    }
  };

  softLayer(ctx, gs, body, crisp, g.dark ? { color: `rgba(190,200,220,${0.55 * b})`, blur: 0.035 } : null);
}

// ---------------------------------------------------------------- entry point

/**
 * Draw a character. g is the same object drawGhost takes, plus
 * dark: true when the background is black (projector with nothing else lit).
 */
export function drawCharacter(kind, ctx, g) {
  if (kind === "shadow") return drawShadow(ctx, g);
  if (kind === "lady") return drawLady(ctx, g);
  if (kind === "girl") return drawGirl(ctx, g);
  return drawGhost(ctx, g);
}
