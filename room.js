// The room seen through the window: either a photo of the real room, darkened
// to look like night, or a painted candle-lit room in one-point perspective.
// The static parts are painted once to an offscreen canvas.

const BACK = { l: 0.24, r: 0.76, t: 0.16, b: 0.66 }; // back wall, as fractions of the screen
export const DOOR = { l: 0.36, r: 0.5, t: 0.27 };   // doorway in the back wall (bottom = BACK.b)
const CANDLE = { x: 0.82, y: 0.7 };
// Where the ghost first appears in the painted room (x, floor y, height as fractions).
export const DEFAULT_ENTRY = { x: (DOOR.l + DOOR.r) / 2, y: BACK.b, size: 0.3 };

function quad(c, pts, fill) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

export class Room {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.photo = null;
    this.w = 0;
    this.h = 0;
  }

  // Use a photo of the real room (an image or canvas), or null for the painted one.
  setPhoto(img) {
    this.photo = img;
    this.w = 0; // repaint
  }

  // Paint the static room at the given pixel size.
  build(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const cv = this.canvas;
    cv.width = w;
    cv.height = h;
    const c = cv.getContext("2d");
    if (this.photo) return this.buildPhoto(c, w, h);
    const X = (f) => f * w, Y = (f) => f * h;
    const bl = X(BACK.l), br = X(BACK.r), bt = Y(BACK.t), bb = Y(BACK.b);

    // Ceiling, side walls, floor.
    quad(c, [[0, 0], [w, 0], [br, bt], [bl, bt]], "#16120f");
    quad(c, [[0, 0], [bl, bt], [bl, bb], [0, h]], "#2a2219");
    quad(c, [[w, 0], [br, bt], [br, bb], [w, h]], "#2a2219");
    quad(c, [[0, h], [bl, bb], [br, bb], [w, h]], "#20160e");
    quad(c, [[bl, bt], [br, bt], [br, bb], [bl, bb]], "#30271d");

    // Floorboards converging on the vanishing point.
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.lineWidth = Math.max(1, w / 900);
    for (let i = 0; i <= 14; i++) {
      const f = i / 14;
      c.beginPath();
      c.moveTo(bl + (br - bl) * f, bb);
      c.lineTo(-w * 0.6 + w * 2.2 * f, h);
      c.stroke();
    }

    // Faded striped wallpaper on every wall.
    const stripes = (x0, x1, top0, top1, bot0, bot1, n) => {
      for (let i = 0; i < n; i += 2) {
        const a = i / n, b = (i + 1) / n;
        const xa = x0 + (x1 - x0) * a, xb = x0 + (x1 - x0) * b;
        quad(c, [
          [xa, top0 + (top1 - top0) * a], [xb, top0 + (top1 - top0) * b],
          [xb, bot0 + (bot1 - bot0) * b], [xa, bot0 + (bot1 - bot0) * a],
        ], "rgba(255,230,190,0.035)");
      }
    };
    stripes(bl, br, bt, bt, bb, bb, 22);
    stripes(0, bl, 0, bt, h, bb, 14);
    stripes(w, br, 0, bt, h, bb, 14);

    // Chair rail / wainscoting.
    const rail = 0.62; // fraction of the way down each wall
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.moveTo(0, h * rail * 1.12);
    c.lineTo(bl, bt + (bb - bt) * rail);
    c.lineTo(br, bt + (bb - bt) * rail);
    c.lineTo(w, h * rail * 1.12);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    c.save();
    c.clip();
    quad(c, [[0, 0], [bl, bt], [bl, bb], [0, h]], "rgba(0,0,0,0.2)");
    quad(c, [[w, 0], [br, bt], [br, bb], [w, h]], "rgba(0,0,0,0.2)");
    quad(c, [[bl, bt], [br, bt], [br, bb], [bl, bb]], "rgba(0,0,0,0.2)");
    c.restore();

    // The doorway into the dark hall: where it comes from.
    const dl = X(DOOR.l), dr = X(DOOR.r), dt = Y(DOOR.t);
    quad(c, [[dl - w * 0.008, dt - h * 0.012], [dr + w * 0.008, dt - h * 0.012], [dr + w * 0.008, bb], [dl - w * 0.008, bb]], "#4a3c2c");
    const hall = c.createLinearGradient(0, dt, 0, bb);
    hall.addColorStop(0, "#050403");
    hall.addColorStop(1, "#0b0907");
    quad(c, [[dl, dt], [dr, dt], [dr, bb], [dl, bb]], hall);

    // A portrait on the back wall.
    const px = X(0.58), py = Y(0.26), pw = X(0.1), ph = Y(0.2);
    c.fillStyle = "#5a4526";
    c.fillRect(px - pw * 0.08, py - ph * 0.06, pw * 1.16, ph * 1.12);
    c.fillStyle = "#15110c";
    c.fillRect(px, py, pw, ph);
    c.fillStyle = "#2c241b";
    c.beginPath();
    c.ellipse(px + pw / 2, py + ph * 0.38, pw * 0.18, ph * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(px + pw / 2, py + ph * 0.95, pw * 0.38, ph * 0.35, 0, Math.PI, 0);
    c.fill();

    // Grandfather clock against the left wall.
    const gx = X(0.1), gy = Y(0.3), gw = X(0.065), gh = Y(0.55);
    c.fillStyle = "#1a120b";
    c.fillRect(gx, gy, gw, gh);
    c.fillStyle = "#2b1f14";
    c.fillRect(gx + gw * 0.12, gy + gh * 0.06, gw * 0.76, gh * 0.22);
    c.fillStyle = "#8a7b5c";
    c.beginPath();
    c.arc(gx + gw / 2, gy + gh * 0.17, gw * 0.3, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#1a120b";
    c.lineWidth = gw * 0.05;
    c.beginPath();
    c.moveTo(gx + gw / 2, gy + gh * 0.17);
    c.lineTo(gx + gw / 2, gy + gh * 0.08);
    c.moveTo(gx + gw / 2, gy + gh * 0.17);
    c.lineTo(gx + gw * 0.68, gy + gh * 0.2);
    c.stroke();

    // Side table with a candlestick on the right.
    const tx = X(CANDLE.x), ty = Y(CANDLE.y);
    c.fillStyle = "#1b130c";
    c.fillRect(tx - X(0.07), ty, X(0.14), Y(0.025));
    c.fillRect(tx - X(0.06), ty, X(0.012), Y(0.2));
    c.fillRect(tx + X(0.048), ty, X(0.012), Y(0.2));
    c.fillStyle = "#6b5a3a";
    c.fillRect(tx - X(0.006), ty - Y(0.05), X(0.012), Y(0.05));
    c.fillStyle = "#d8cfbd";
    c.fillRect(tx - X(0.004), ty - Y(0.085), X(0.008), Y(0.035));

    // Cobwebs in the corner.
    c.strokeStyle = "rgba(220,220,210,0.08)";
    c.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(w * 0.12 * Math.cos((k / 6) * Math.PI / 2), h * 0.14 * Math.sin((k / 6) * Math.PI / 2));
      c.stroke();
    }
    for (let k = 1; k < 4; k++) {
      c.beginPath();
      c.arc(0, 0, k * w * 0.03, 0, Math.PI / 2);
      c.stroke();
    }
  }

  // Fill the screen with the photo (cropping the edges if needed) and grade it
  // to look like a room lit by one dim lamp at night.
  buildPhoto(c, w, h) {
    const p = this.photo;
    const pw = p.naturalWidth || p.width, ph = p.naturalHeight || p.height;
    const k = Math.max(w / pw, h / ph);
    c.drawImage(p, (w - pw * k) / 2, (h - ph * k) / 2, pw * k, ph * k);
    c.globalCompositeOperation = "multiply";
    c.fillStyle = "rgb(120,125,150)"; // darker and colder
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "source-over";
    const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
    v.addColorStop(0, "rgba(0,0,0,0.1)");
    v.addColorStop(1, "rgba(0,0,0,0.75)");
    c.fillStyle = v;
    c.fillRect(0, 0, w, h);
  }

  // Draw the room. brightness 0..1 (the caller dims it when the ghost is near).
  draw(ctx, t, brightness) {
    const w = this.w, h = this.h;
    ctx.save();
    if (this.photo) {
      // A lamp that isn't quite steady.
      ctx.globalAlpha = brightness * (0.97 + 0.03 * Math.sin(t * 7.3) * Math.sin(t * 3.1));
      ctx.drawImage(this.canvas, 0, 0, w, h);
      ctx.restore();
      return;
    }
    ctx.globalAlpha = brightness;
    ctx.drawImage(this.canvas, 0, 0, w, h);
    ctx.restore();

    const flick = 0.85 + 0.1 * Math.sin(t * 9.1) * Math.sin(t * 5.3) + 0.05 * Math.sin(t * 23.7);
    const cx = CANDLE.x * w, cy = (CANDLE.y - 0.095) * h;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55 * flick);
    glow.addColorStop(0, `rgba(255,170,80,${0.32 * brightness * flick})`);
    glow.addColorStop(0.25, `rgba(200,110,40,${0.12 * brightness * flick})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    // The flame.
    ctx.fillStyle = `rgba(255,220,150,${0.9 * flick})`;
    ctx.beginPath();
    ctx.ellipse(cx + Math.sin(t * 7) * h * 0.002, cy, w * 0.004, h * 0.014 * flick, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Dark corners.
    const v = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.7)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
}

// Where the floor is at a given depth: 0 = where it appears (startY), 1 = against the glass.
export function floorY(depth, h, startY) {
  return (startY + (1.55 - startY) * depth) * h;
}
