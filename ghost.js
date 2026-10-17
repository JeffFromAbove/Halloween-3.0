// Procedural spectre renderer. Everything is drawn in "units" where 1 = the
// ghost's full height, centred horizontally on x = 0 with the head near the top.

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Precomputed crack lines for the stone statue look.
const CRACKS = Array.from({ length: 7 }, (_, i) => {
  let x = (i / 6 - 0.5) * 0.4, y = -0.35 + (i % 3) * 0.18;
  const pts = [[x, y]];
  for (let k = 0; k < 5; k++) {
    x += (Math.sin(i * 12.9 + k * 7.1) * 0.5) * 0.05;
    y += 0.03 + Math.abs(Math.cos(i * 3.3 + k)) * 0.03;
    pts.push([x, y]);
  }
  return pts;
});

const TAILS = 9;

// Outline of the robe, as an array of [x, y] points (clockwise from hood top).
function robeOutline(t, sway, widen) {
  const pts = [];
  const s = (y) => sway * Math.sin(t * 1.3 + y * 4.0) * (y + 0.5) * 0.09;
  const side = [
    [0.00, -0.47], [0.09, -0.455], [0.145, -0.40], [0.165, -0.32],
    [0.17, -0.24], [0.21, -0.16], [0.245, -0.05], [0.27, 0.08],
    [0.30, 0.22], [0.33, 0.36],
  ];
  for (const [x, y] of side) pts.push([x * widen + s(y), y]);
  // Tattered hem, right to left.
  for (let i = 0; i <= TAILS; i++) {
    const f = i / TAILS;
    const x = lerp(0.34, -0.34, f) * widen;
    const tail = i % 2 === 0 ? 0.47 : 0.40;
    const y = tail + 0.035 * Math.sin(t * 2.2 + i * 1.7);
    pts.push([x + s(y) * 1.4, y]);
  }
  for (let i = side.length - 1; i >= 0; i--) {
    const [x, y] = side[i];
    pts.push([-x * widen + s(y), y]);
  }
  return pts;
}

function smoothPath(ctx, pts, u) {
  ctx.beginPath();
  const p = (i) => pts[(i + pts.length) % pts.length];
  ctx.moveTo(((p(0)[0] + p(1)[0]) / 2) * u, ((p(0)[1] + p(1)[1]) / 2) * u);
  for (let i = 1; i <= pts.length; i++) {
    const a = p(i), b = p(i + 1);
    ctx.quadraticCurveTo(a[0] * u, a[1] * u, ((a[0] + b[0]) / 2) * u, ((a[1] + b[1]) / 2) * u);
  }
  ctx.closePath();
}

function sleeve(ctx, u, dir, t, reach, sway, color, alpha) {
  // dir = 1 right arm, -1 left arm (in the ghost's own frame).
  const sx = 0.15 * dir, sy = -0.19;
  // Reaching = arms raised toward the viewer, wrists drooping.
  const ex = lerp(0.27, 0.25, reach) * dir + sway * 0.02 * Math.sin(t * 1.7 + dir);
  const ey = lerp(0.12, -0.07, reach) + 0.015 * Math.sin(t * 2 + dir);
  const mx = lerp(0.27, 0.34, reach) * dir, my = lerp(-0.10, -0.15, reach);
  const at = (f) => [
    (1 - f) * (1 - f) * sx + 2 * (1 - f) * f * mx + f * f * ex,
    (1 - f) * (1 - f) * sy + 2 * (1 - f) * f * my + f * f * ey,
  ];
  // A bell sleeve: narrow at the shoulder, wide and ragged at the cuff.
  const n = 14, left = [], right = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, [x, y] = at(f), [x2, y2] = at(Math.min(1, f + 0.01) - (f === 1 ? 0.01 : 0));
    let nx = -(y2 - y), ny = x2 - x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const w = lerp(0.03, 0.065, f * f) + 0.004 * Math.sin(t * 2.5 + f * 9 + dir);
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }
  const [cx, cy] = at(1), [px, py] = at(0.93);
  const fx = cx - px, fy = cy - py, fl = Math.hypot(fx, fy) || 1;
  const cuff = [];
  for (let k = 1; k < 6; k++) {
    const f = k / 6;
    const bx = lerp(left[n][0], right[n][0], f), by = lerp(left[n][1], right[n][1], f);
    const rag = (k % 2 ? 0.035 : 0.012) + 0.008 * Math.sin(t * 3 + k * 2 + dir);
    cuff.push([bx + (fx / fl) * rag, by + (fy / fl) * rag]);
  }
  ctx.beginPath();
  [...left, ...cuff, ...right.reverse()].forEach(([x, y], i) => (i ? ctx.lineTo(x * u, y * u) : ctx.moveTo(x * u, y * u)));
  ctx.closePath();
  const g = ctx.createLinearGradient(sx * u, sy * u, cx * u, cy * u);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, alpha * 0.55));
  ctx.fillStyle = g;
  ctx.fill();

  // Long bony fingers creep out of the sleeve as it reaches.
  if (reach > 0.2) {
    const a0 = Math.PI / 2 - dir * 0.25; // fingers dangle downward
    const show = Math.min(1, (reach - 0.2) * 2);
    ctx.strokeStyle = rgba([205, 212, 220], alpha * show * 0.85);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let k = 0; k < 4; k++) {
      const spread = (k - 1.5) * 0.18 * dir;
      const len = (0.05 + (k === 1 || k === 2 ? 0.02 : 0)) * show;
      const curl = 0.5 + 0.25 * Math.sin(t * 2.2 + k) * sway;
      const bx = lerp(left[n][0], right[n][0], 0.25 + k * 0.17), by = lerp(left[n][1], right[n][1], 0.25 + k * 0.17);
      const a1 = a0 + spread, a2 = a1 + curl * dir * 0.6;
      const jx = bx + Math.cos(a1) * len, jy = by + Math.sin(a1) * len;
      ctx.lineWidth = 0.009 * u;
      ctx.beginPath();
      ctx.moveTo(bx * u, by * u);
      ctx.lineTo(jx * u, jy * u);
      ctx.lineTo((jx + Math.cos(a2) * len * 0.8) * u, (jy + Math.sin(a2) * len * 0.8) * u);
      ctx.stroke();
    }
  }
}

/**
 * Draw the spectre.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} g
 *   x, y       centre in px          size   height in px
 *   t          animation time (s)    turn   0 = facing viewer, PI = back turned
 *   stone      0..1 statue-ness      alpha  opacity
 *   look       -1..1 pupil offset    menace 0..1 (eyes go red, arms reach)
 *   mouth      0..1 mouth open       sway   0..1 cloth movement amount
 *   brightness 0..1
 */
export function drawGhost(ctx, g) {
  const u = g.size;
  const front = Math.cos(g.turn) >= 0;
  const sx = Math.max(0.06, Math.abs(Math.cos(g.turn)));
  const stone = g.stone;
  const b = g.brightness;

  const spirit = [225, 238, 255];
  const spiritDeep = [120, 160, 215];
  const stoneLight = [150, 148, 140];
  const stoneDark = [70, 69, 66];
  const top = mix(spirit, stoneLight, stone).map((v) => v * b);
  const deep = mix(spiritDeep, stoneDark, stone).map((v) => v * b);

  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(sx, 1);
  ctx.globalAlpha = g.alpha;

  const widen = 1 + g.mouth * 0.15;
  const pts = robeOutline(g.t, g.sway, widen);

  // Arms behind the body when the back is turned.
  if (!front) {
    sleeve(ctx, u, 1, g.t, 0, g.sway, mix(top, deep, 0.5), 0.8);
    sleeve(ctx, u, -1, g.t, 0, g.sway, mix(top, deep, 0.5), 0.8);
  }

  // Robe body with an ethereal glow (or matte stone).
  const grad = ctx.createLinearGradient(0, -0.47 * u, 0, 0.47 * u);
  const bodyA = lerp(0.92, 1, stone);
  grad.addColorStop(0, rgba(top, bodyA));
  grad.addColorStop(0.45, rgba(mix(top, deep, 0.5), lerp(0.75, 1, stone)));
  grad.addColorStop(1, rgba(deep, lerp(0.0, 0.85, stone)));
  ctx.shadowColor = rgba([140, 200, 255], 0.8 * (1 - stone) * b);
  ctx.shadowBlur = 0.09 * u * (1 - stone);
  smoothPath(ctx, pts, u);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Inner shading for depth.
  const shade = ctx.createRadialGradient(0, -0.1 * u, 0.05 * u, 0, 0, 0.5 * u);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, `rgba(0,0,10,${lerp(0.35, 0.25, stone)})`);
  ctx.fillStyle = shade;
  ctx.fill();

  // Robe folds.
  ctx.strokeStyle = rgba(deep, 0.18);
  ctx.lineWidth = 0.012 * u;
  for (let k = -2; k <= 2; k++) {
    if (k === 0 && front) continue;
    ctx.beginPath();
    const x0 = k * 0.04, x1 = k * 0.1 + g.sway * 0.025 * Math.sin(g.t * 1.3 + k);
    ctx.moveTo(x0 * u, -0.12 * u);
    ctx.bezierCurveTo((x0 + 0.02 * Math.sin(k * 3)) * u, 0.05 * u, (x1 - 0.02 * Math.cos(k)) * u, 0.2 * u, x1 * u, 0.4 * u);
    ctx.stroke();
  }

  if (front) {
    // Hood opening: a void with eyes.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, -0.305 * u, 0.098 * u, 0.125 * u, 0, 0, Math.PI * 2);
    const hole = ctx.createRadialGradient(0, -0.30 * u, 0.01 * u, 0, -0.30 * u, 0.13 * u);
    hole.addColorStop(0, "#000");
    hole.addColorStop(0.75, "#02040a");
    hole.addColorStop(1, rgba(deep, 0.9));
    ctx.fillStyle = hole;
    ctx.fill();
    ctx.clip();

    // Eyes.
    const eyeCol = mix([200, 240, 255], [255, 40, 20], g.menace);
    const glow = (1 - stone) * b;
    const ex = 0.042, ey = -0.315;
    const lx = g.look * 0.018;
    for (const d of [-1, 1]) {
      const cx = (d * ex + lx) * u, cy = ey * u;
      if (glow > 0.05) {
        ctx.shadowColor = rgba(eyeCol, glow);
        ctx.shadowBlur = 0.05 * u;
        ctx.fillStyle = rgba(eyeCol, glow);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 0.019 * u, (0.011 + g.menace * 0.004) * u, d * -0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = rgba([255, 255, 255], glow * 0.9);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 0.007 * u, 0.005 * u, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (stone > 0.05) {
        ctx.fillStyle = rgba([25, 25, 25], stone);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 0.02 * u, 0.012 * u, d * -0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Mouth.
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(lx * u * 0.6, -0.235 * u, (0.016 + g.mouth * 0.03) * u, (0.006 + g.mouth * 0.05) * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Hood rim.
    ctx.strokeStyle = rgba(top, 0.5);
    ctx.lineWidth = 0.012 * u;
    ctx.beginPath();
    ctx.ellipse(0, -0.305 * u, 0.1 * u, 0.127 * u, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    // Arms in front.
    sleeve(ctx, u, 1, g.t, g.menace, g.sway, mix(top, deep, 0.3), 0.85);
    sleeve(ctx, u, -1, g.t, g.menace, g.sway, mix(top, deep, 0.3), 0.85);
  } else {
    // Back of the hood: a central seam.
    ctx.strokeStyle = rgba(deep, 0.5);
    ctx.lineWidth = 0.01 * u;
    ctx.beginPath();
    ctx.moveTo(0, -0.46 * u);
    ctx.quadraticCurveTo(0.01 * u, -0.3 * u, 0, -0.17 * u);
    ctx.stroke();
  }

  // Cracks when turned to stone.
  if (stone > 0.3) {
    ctx.save();
    smoothPath(ctx, pts, u);
    ctx.clip();
    ctx.strokeStyle = rgba([30, 30, 28], (stone - 0.3) * 0.9);
    ctx.lineWidth = 0.004 * u;
    for (const c of CRACKS) {
      ctx.beginPath();
      ctx.moveTo(c[0][0] * u, c[0][1] * u);
      for (const p of c) ctx.lineTo(p[0] * u, p[1] * u);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

// Slow drifting ground fog.
export class Fog {
  constructor(n = 26) {
    this.p = Array.from({ length: n }, () => ({
      x: Math.random(), y: 0.9 + Math.random() * 0.2,
      r: 0.08 + Math.random() * 0.12, v: (Math.random() - 0.5) * 0.02,
      ph: Math.random() * 10,
    }));
  }
  draw(ctx, w, h, dt, strength) {
    if (strength <= 0.01) return;
    for (const q of this.p) {
      q.x += q.v * dt;
      if (q.x < -0.3) q.x = 1.3;
      if (q.x > 1.3) q.x = -0.3;
      const r = q.r * Math.max(w, h);
      const a = (0.025 + 0.015 * Math.sin(performance.now() / 2000 + q.ph)) * strength;
      const gr = ctx.createRadialGradient(q.x * w, q.y * h, 0, q.x * w, q.y * h, r);
      gr.addColorStop(0, `rgba(150,170,200,${a})`);
      gr.addColorStop(1, "rgba(150,170,200,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(q.x * w - r, q.y * h - r, r * 2, r * 2);
    }
  }
}
