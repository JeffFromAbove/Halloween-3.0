import { PoseLandmarker, FaceDetector } from "./vendor/mediapipe/vision_bundle.mjs";
import { Fog } from "./ghost.js";
import { drawCharacter, CHARACTERS } from "./characters.js";
import { Spooky } from "./audio.js";
import { Room, DEFAULT_ENTRY, floorY } from "./room.js";
import { Eyes } from "./eyes.js";

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  character: "spectre", // "spectre" | "shadow" | "lady" | "girl"
  mode: "turn",        // "turn" = ghost turns its back, "stone" = freezes into a statue, "mirror" = haunted mirror
  mirrorFeed: true,    // mirror mode: show the camera image (off for a screen behind two-way glass)
  windowWatched: "vanish", // window mode, when someone looks: "vanish" | "freeze" | "turn"
  windowFlip: true,    // window mode: flip the picture for rear projection (viewers outside)
  windowCreep: 8,      // window mode: seconds to come from the doorway to the glass
  roomBright: 0.8,
  photoEntry: { x: 0.5, y: 0.7, size: 0.3 }, // where the ghost appears in your room photo
  mirror: true,
  jumpscare: true,
  sound: true,
  poseFallback: false,
  debug: false,
  creep: 25,           // seconds of not being watched before it reaches you
  sens: 0.5,           // minimum face-detector score that counts as a face
  facing: 0.5,         // how far the head may be turned and still count as looking
  vol: 0.6,
  bright: 0.9,
  cameraId: "",
};
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem("watcher-settings") || "{}")); } catch {}
const save = () => { try { localStorage.setItem("watcher-settings", JSON.stringify(settings)); } catch {} };

// ---------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const stage = $("stage"), ctx = stage.getContext("2d");
const video = $("cam");
const dbgCanvas = $("debugCanvas"), dbg = dbgCanvas.getContext("2d");
const crop = document.createElement("canvas");
crop.width = crop.height = 192;
const cropCtx = crop.getContext("2d", { willReadFrequently: false });
// Mirror mode: where people are (from the body tracker's segmentation), used to
// hide the ghost behind them, and the layer the ghost is drawn on.
const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d");
let maskImage = null, hasMask = false;
const ghostCanvas = document.createElement("canvas");
const gctx = ghostCanvas.getContext("2d");

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
const ease = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- models
const WASM = {
  wasmLoaderPath: new URL("vendor/mediapipe/wasm/vision_wasm_internal.js", location.href).href,
  wasmBinaryPath: new URL("vendor/mediapipe/wasm/vision_wasm_internal.wasm", location.href).href,
};
let pose = null, faces = null;

async function loadModels(status) {
  const make = async (delegate) => {
    status(`Loading body tracker (${delegate})…`);
    pose = await PoseLandmarker.createFromOptions(WASM, {
      baseOptions: { modelAssetPath: "models/pose_landmarker_lite.task", delegate },
      runningMode: "VIDEO",
      numPoses: 3,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  };
  try { await make("GPU"); } catch (e) { console.warn("GPU delegate failed, using CPU", e); await make("CPU"); }
  await syncMasks();
  status("Loading face detector…");
  faces = await FaceDetector.createFromOptions(WASM, {
    baseOptions: { modelAssetPath: "models/blaze_face_short_range.tflite", delegate: "CPU" },
    runningMode: "IMAGE",
    minDetectionConfidence: 0.2,
  });
}

// Person segmentation costs time, so only ask for it in mirror mode.
let masksOn = false, switchingMasks = false;
async function syncMasks() {
  const want = settings.mode === "mirror";
  if (!pose || want === masksOn) return;
  switchingMasks = true;
  try {
    await pose.setOptions({ outputSegmentationMasks: want });
    masksOn = want;
  } catch (e) {
    console.warn("Could not toggle segmentation", e);
  }
  hasMask = false;
  switchingMasks = false;
}

// Combine every person's mask into one alpha image at half resolution.
function updateMask(masks) {
  const m0 = masks[0], w = m0.width, h = m0.height;
  const mw = Math.ceil(w / 2), mh = Math.ceil(h / 2);
  if (maskCanvas.width !== mw || maskCanvas.height !== mh || !maskImage) {
    maskCanvas.width = mw;
    maskCanvas.height = mh;
    maskImage = maskCtx.createImageData(mw, mh);
  }
  const out = maskImage.data;
  out.fill(0);
  for (const m of masks) {
    const a = m.getAsFloat32Array();
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const v = a[(y * 2) * w + x * 2] * 255;
        const o = (y * mw + x) * 4 + 3;
        if (v > out[o]) out[o] = v;
      }
    }
  }
  maskCtx.putImageData(maskImage, 0, 0);
  hasMask = true;
}

// ---------------------------------------------------------------- camera
let stream = null;
async function startCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const video_ = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (settings.cameraId) video_.deviceId = { exact: settings.cameraId };
  else video_.facingMode = "user";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
  } catch (e) {
    if (!settings.cameraId) throw e;
    settings.cameraId = ""; // saved camera vanished; fall back to default
    return startCamera();
  }
  video.srcObject = stream;
  await video.play();
  await fillCameraList();
}

async function fillCameraList() {
  const sel = $("set-camera");
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.innerHTML = "";
  devices.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || `Camera ${i + 1}`;
    if (d.deviceId === current) o.selected = true;
    sel.appendChild(o);
  });
}

// ---------------------------------------------------------------- detection
// people: [{ x (0..1 screen space), size, looking, head:{x,y,s} (video px), source }]
let people = [];
let lastDetect = 0, lastTs = 0, detectMs = 0;
let lastPoses = [], lastFaces = [];

function poseFacing(lm) {
  // Raw (unmirrored) camera image: a person facing the camera has their left
  // shoulder/ear (11/7) on the image's right.
  const v = (i) => lm[i].visibility ?? 0;
  const sh = lm[11].x - lm[12].x;
  const ear = lm[7].x - lm[8].x;
  const yaw = (lm[0].x - (lm[7].x + lm[8].x) / 2) / Math.max(1e-3, Math.abs(ear));
  const faceVis = Math.min(v(0), v(2), v(5));
  return faceVis > 0.8 && sh > 0 && ear > 0 && ear / Math.max(1e-3, sh) > 0.25 && Math.abs(yaw) < 0.4;
}

// A face counts as looking at the screen when the nose sits between the eyes.
// Keypoints: 0 right eye, 1 left eye, 2 nose tip, 3 mouth, 4/5 ears.
// Frontal faces measure ~0, a profile ~1.2.
function faceInfo(d) {
  const k = d.keypoints;
  const eyeD = Math.abs(k[1].x - k[0].x) || 1e-3;
  const yaw = (k[2].x - (k[0].x + k[1].x) / 2) / eyeD;
  return {
    box: d.boundingBox,
    facing: Math.abs(yaw) < settings.facing,
  };
}
const goodFace = (d) => (d.categories?.[0]?.score ?? 0) >= settings.sens && d.keypoints?.length >= 3;

function detect(now) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const t0 = performance.now();
  const ts = Math.max(now, lastTs + 1);
  lastTs = ts;

  const res = pose.detectForVideo(video, ts);
  const poses = res.landmarks || [];
  if (res.segmentationMasks?.length) {
    if (masksOn) updateMask(res.segmentationMasks);
    res.segmentationMasks.forEach((m) => m.close());
  } else if (masksOn) {
    hasMask = false;
  }
  const frameFaces = (faces.detect(video).detections || []).filter(goodFace).map(faceInfo);

  // Mirror and window modes are seen from the camera's side, so always flip.
  const toScreenX = (x) => (settings.mirror || settings.mode === "mirror" || settings.mode === "window" ? 1 - x : x);
  const used = new Set();
  const found = [];

  for (const lm of poses) {
    const nose = lm[0];
    const hx = nose.x * vw, hy = nose.y * vh;
    const shW = Math.hypot((lm[11].x - lm[12].x) * vw, (lm[11].y - lm[12].y) * vh);
    const earW = Math.hypot((lm[7].x - lm[8].x) * vw, (lm[7].y - lm[8].y) * vh);
    const s = clamp(Math.max(shW * 0.95, earW * 2.6, 40), 40, Math.min(vw, vh));

    // The tracker sometimes reports the same person twice.
    if (found.some((p) => Math.hypot(p.head.x - hx, p.head.y - hy) < p.head.s * 0.5)) continue;

    // Face in the full frame overlapping this head?
    let looking = false, sawFace = false;
    frameFaces.forEach((f, i) => {
      const b = f.box, cx = b.originX + b.width / 2, cy = b.originY + b.height / 2;
      if (Math.abs(cx - hx) < s * 0.6 && Math.abs(cy - hy) < s * 0.6) {
        sawFace = true;
        looking ||= f.facing;
        used.add(i);
      }
    });

    // Otherwise zoom in on the head and look again (finds far-away faces).
    if (!sawFace) {
      const side = s * 1.5, ox = hx - side / 2, oy = hy - side * 0.55;
      cropCtx.fillStyle = "#000";
      cropCtx.fillRect(0, 0, crop.width, crop.height);
      cropCtx.drawImage(video, ox, oy, side, side, 0, 0, crop.width, crop.height);
      looking = (faces.detect(crop).detections || []).filter(goodFace).some((d) => faceInfo(d).facing);
    }
    if (!looking && settings.poseFallback) looking = poseFacing(lm);

    const xs = [lm[0].x, lm[11].x, lm[12].x];
    found.push({
      x: toScreenX(xs.reduce((a, b) => a + b) / xs.length),
      size: shW / vw,
      looking,
      head: { x: hx, y: hy, s },
      source: "pose",
    });
  }

  // Faces with no matching body (very close to the camera, e.g. phone testing).
  frameFaces.forEach((f, i) => {
    if (used.has(i)) return;
    const b = f.box;
    found.push({
      x: toScreenX((b.originX + b.width / 2) / vw),
      size: (b.width * 2.5) / vw,
      looking: f.facing,
      head: { x: b.originX + b.width / 2, y: b.originY + b.height / 2, s: b.width * 1.3 },
      source: "face",
    });
  });

  people = found;
  lastPoses = poses;
  lastFaces = frameFaces;
  detectMs = performance.now() - t0;
}

// ---------------------------------------------------------------- ghost state
const G = {
  phase: "hidden", // hidden | active | lunge | cooldown
  x: 0.5, dist: 0, alpha: 0, turn: 0, stone: 0, animT: 0,
  menace: 0, mouth: 0, look: 0, lungeT: 0, coolT: 0, flash: 0,
  // mirror mode: where the ghost stands (screen px), which shoulder, how long you've looked
  mx: 0, my: 0, msize: 0, side: 1, lookFor: 0, delay: 3,
  unseenFor: 0, // window mode: how long since anyone looked
};
let presentFor = 0, absentFor = 99, watched = 0, observed = false, targetX = 0.5;
const fog = new Fog();
const audio = new Spooky();

function resetGhost() {
  G.phase = "hidden";
  G.alpha = 0; G.dist = 0; G.menace = 0; G.mouth = 0;
}

// Who's here, whether anyone is looking, and where the main person is.
// Being watched snaps on quickly and lets go slowly (so a blink doesn't free it).
function trackWatching(dt) {
  const present = people.length > 0;
  if (present) { presentFor += dt; absentFor = 0; } else { absentFor += dt; presentFor = 0; }
  const anyLooking = people.some((p) => p.looking);
  watched = anyLooking ? approach(watched, 1, 14, dt) : approach(watched, 0, 3, dt);
  const wasObserved = observed;
  observed = observed ? watched > 0.35 : watched > 0.6;
  if (present) {
    const main = people.reduce((a, b) => (b.size > a.size ? b : a));
    targetX = approach(targetX, main.x, 6, dt);
  }
  return { present, wasObserved };
}

function update(dt) {
  if (settings.mode === "mirror") return updateMirror(dt);
  if (settings.mode === "window") return updateWindow(dt);
  if (settings.mode === "eyes") return updateEyes(dt);
  const { present, wasObserved } = trackWatching(dt);
  const here = presentFor > 0.4 || (absentFor < 2.5 && G.phase !== "hidden");

  const stoneMode = settings.mode === "stone";

  if (G.phase === "hidden") {
    G.alpha = approach(G.alpha, 0, 3, dt);
    if (here && presentFor > 0.4) {
      G.phase = "active";
      G.dist = 0;
      G.x = targetX < 0.5 ? 0.8 : 0.2; // appear on the far side from them
      G.turn = !stoneMode && observed ? Math.PI : 0;
      G.stone = stoneMode && observed ? 1 : 0;
      audio.appear();
    }
  } else if (G.phase === "active") {
    G.alpha = here ? approach(G.alpha, 1, 1.2, dt) : approach(G.alpha, 0, 1.5, dt);
    if (!here && G.alpha < 0.02) resetGhost();

    if (stoneMode) {
      G.turn = approach(G.turn, 0, 6, dt);
      G.stone = observed ? approach(G.stone, 1, 18, dt) : approach(G.stone, 0, 2, dt);
      if (observed && !wasObserved) audio.grind();
    } else {
      G.stone = approach(G.stone, 0, 4, dt);
      const tgt = observed ? Math.PI : 0;
      const step = 7 * dt;
      G.turn += clamp(tgt - G.turn, -step, step);
      if (observed !== wasObserved) audio.whoosh();
    }

    const frozen = stoneMode ? G.stone > 0.4 : observed || G.turn > 0.25;
    if (!frozen && present) {
      G.dist = clamp(G.dist + dt / settings.creep);
      const maxV = (0.1 + 0.4 * G.dist) * dt;
      G.x += clamp(targetX - G.x, -maxV, maxV);
    }
    G.menace = approach(G.menace, frozen ? G.menace : ease(G.dist), 2, dt);
    G.mouth = approach(G.mouth, frozen ? G.mouth : G.dist > 0.8 ? (G.dist - 0.8) * 2 : 0, 3, dt);

    if (G.dist >= 1 && !frozen && settings.jumpscare) {
      G.phase = "lunge";
      G.lungeT = 0;
      audio.scream();
    }
  } else if (G.phase === "lunge") {
    G.lungeT += dt;
    G.mouth = approach(G.mouth, 1, 12, dt);
    G.menace = 1;
    G.turn = 0;
    G.stone = 0;
    if (G.lungeT > 1.1) {
      G.phase = "cooldown";
      G.coolT = 0;
      G.flash = 1;
      G.alpha = 0;
    }
  } else if (G.phase === "cooldown") {
    G.coolT += dt;
    if (G.coolT > 6) resetGhost();
  }

  // Statues don't move — freeze the animation clock while stone.
  const motion = G.phase === "lunge" ? 3 : 1 - G.stone;
  G.animT += dt * motion;

  // Pupils follow the person.
  G.look = approach(G.look, clamp((targetX - G.x) * 5, -1, 1), 4, dt * (1 - G.stone));
  G.flash = approach(G.flash, 0, 5, dt);

  audio.update(G.phase === "hidden" || G.phase === "cooldown" ? 0 : G.alpha, G.phase === "lunge" || (G.phase === "active" && !observed), G.dist);
}

// ---------------------------------------------------------------- haunted mirror
// The screen is a mirror. While you look into it, something appears over your
// shoulder. Turn around to check and it's gone. Look back and it's closer.

// Where the camera image lands on screen (scaled to cover, flipped like a mirror).
function cover() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const k = Math.max(W / vw, H / vh);
  return { k, vw, vh, ox: (W - vw * k) / 2, oy: (H - vh * k) / 2 };
}
const toMirror = (c, x, y) => [W - (c.ox + x * c.k), c.oy + y * c.k];

function updateMirror(dt) {
  const present = people.length > 0;
  if (present) { presentFor += dt; absentFor = 0; } else { absentFor += dt; presentFor = 0; }

  const anyLooking = people.some((p) => p.looking);
  watched = anyLooking ? approach(watched, 1, 10, dt) : approach(watched, 0, 6, dt);
  observed = observed ? watched > 0.35 : watched > 0.6;
  G.turn = 0;
  G.stone = 0;

  // Gone for a while: forget them.
  if (absentFor > 4 && G.phase !== "cooldown") { resetGhost(); G.lookFor = 0; }

  if (present) {
    const main = people.reduce((a, b) => (b.size > a.size ? b : a));
    const c = cover();
    const [hx, hy] = toMirror(c, main.head.x, main.head.y);
    const s = main.head.s * c.k;
    const d = ease(G.dist);
    let tx = hx + G.side * s * lerp(1.05, 0.55, d);
    let ty = hy - s * lerp(0.25, 0.05, d);
    // Standing a little behind you, so its head is about the size of yours.
    let size = Math.min(s * lerp(1.8, 2.4, d), H * 1.2);
    ty = Math.max(ty, size * 0.2); // keep its face on screen
    if (G.phase === "lunge") {
      const k = ease(clamp(G.lungeT / 0.4));
      tx = lerp(tx, hx, k);
      ty = lerp(ty, hy, k);
      size *= lerp(1, 1.8, k);
    }
    const snap = G.msize === 0;
    G.mx = snap ? tx : approach(G.mx, tx, 8, dt);
    G.my = snap ? ty : approach(G.my, ty, 8, dt);
    G.msize = snap ? size : approach(G.msize, size, 6, dt);
  }

  if (G.phase === "hidden") {
    G.alpha = approach(G.alpha, 0, 14, dt);
    G.lookFor = observed && present ? G.lookFor + dt : 0;
    if (G.lookFor > G.delay) {
      G.phase = "active";
      if (G.dist === 0) G.side = Math.random() < 0.5 ? -1 : 1;
      audio.appear();
    }
  } else if (G.phase === "active") {
    if (!observed || !present) {
      // You turned around. Nothing there. It remembers how close it got.
      G.phase = "hidden";
      G.lookFor = 0;
      G.delay = 1 + Math.random() * 2;
    } else {
      G.alpha = approach(G.alpha, 1, 1.5, dt);
      G.dist = clamp(G.dist + dt / settings.creep);
      G.menace = approach(G.menace, ease(G.dist), 2, dt);
      G.mouth = approach(G.mouth, G.dist > 0.8 ? (G.dist - 0.8) * 2 : 0, 3, dt);
      if (G.dist >= 1 && settings.jumpscare) {
        G.phase = "lunge";
        G.lungeT = 0;
        audio.scream();
      }
    }
  } else if (G.phase === "lunge") {
    G.lungeT += dt;
    G.alpha = 1;
    G.mouth = approach(G.mouth, 1, 12, dt);
    G.menace = 1;
    if (G.lungeT > 1.0) {
      G.phase = "cooldown";
      G.coolT = 0;
      G.flash = 1;
      G.alpha = 0;
    }
  } else if (G.phase === "cooldown") {
    G.coolT += dt;
    if (G.coolT > 6) { resetGhost(); G.lookFor = 0; G.delay = 3 + Math.random() * 2; }
  }

  if (G.phase === "hidden" && G.alpha < 0.01 && G.dist === 0) G.msize = 0;
  G.animT += dt * (G.phase === "lunge" ? 3 : 1);
  G.look = approach(G.look, -G.side * 0.8, 4, dt);
  G.flash = approach(G.flash, 0, 5, dt);

  audio.update(G.phase === "active" || G.phase === "lunge" ? G.alpha : 0, true, G.dist);
}

function renderMirror() {
  const c = cover();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  if (settings.mirrorFeed && video.readyState >= 2) {
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, c.ox, c.oy, c.vw * c.k, c.vh * c.k);
    ctx.restore();
    // Old, dim glass: a cold tint and dark edges.
    ctx.fillStyle = "rgba(10,18,30,0.28)";
    ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  if (G.alpha < 0.005 || G.msize === 0) return;

  // Draw the ghost on its own layer, then cut out the people standing in front of it.
  if (ghostCanvas.width !== stage.width || ghostCanvas.height !== stage.height) {
    ghostCanvas.width = stage.width;
    ghostCanvas.height = stage.height;
  }
  gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  gctx.clearRect(0, 0, W, H);
  const flicker = 0.85 + 0.15 * Math.random();
  const lunging = G.phase === "lunge";
  const shake = lunging ? (Math.random() - 0.5) * G.msize * 0.02 : 0;
  drawCharacter(settings.character, gctx, {
    dark: !settings.mirrorFeed,
    x: G.mx + shake,
    y: G.my + 0.31 * G.msize + 0.01 * G.msize * Math.sin(G.animT * 1.4) + shake,
    size: G.msize,
    t: G.animT,
    turn: 0,
    stone: 0,
    alpha: (lunging ? 1 : settings.mirrorFeed ? 0.75 : 1) * G.alpha * flicker,
    look: G.look,
    menace: G.menace,
    mouth: G.mouth,
    sway: 0.4 + 0.4 * G.menace,
    brightness: settings.bright,
  });
  if (hasMask && !lunging) {
    gctx.globalCompositeOperation = "destination-out";
    gctx.save();
    gctx.translate(W, 0);
    gctx.scale(-1, 1);
    gctx.drawImage(maskCanvas, c.ox, c.oy, c.vw * c.k, c.vh * c.k);
    gctx.restore();
    gctx.globalCompositeOperation = "source-over";
  }
  ctx.drawImage(ghostCanvas, 0, 0, W, H);
}

// ---------------------------------------------------------------- haunted window
// Projected on the inside of a front window. Passers-by see a dim room. While
// they aren't looking, something comes out of the doorway at the back and
// follows them toward the glass. When they look, it's gone (or freezes, or
// turns away) and it's just a room again.
const room = new Room();
let previewT = 0; // seconds left showing where the ghost will appear

// Where the ghost first appears: chosen by tapping on a room photo, or the
// painted room's doorway.
const entry = () => (room.photo ? settings.photoEntry : DEFAULT_ENTRY);

// The room photo is kept in the browser (IndexedDB) so it survives reloads.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("watcher", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function storeFile(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("files", "readwrite");
    if (val == null) tx.objectStore("files").delete(key);
    else tx.objectStore("files").put(val, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function loadFile(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction("files").objectStore("files").get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function blobToImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("unreadable image")); };
    img.src = url;
  });
}

// Shrink to at most 1920px, save, and show it.
function useRoomImage(src) {
  const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
  const k = Math.min(1, 1920 / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  room.setPhoto(c);
  // Save in the background; no need to wait for it.
  c.toBlob((blob) => storeFile("roomPhoto", blob).catch((e) => console.warn("Could not save the room photo", e)), "image/jpeg", 0.9);
}

async function restoreRoomPhoto() {
  try {
    const blob = await loadFile("roomPhoto");
    if (blob) room.setPhoto(await blobToImage(blob));
  } catch (e) {
    console.warn("No saved room photo", e);
  }
}

let toastTimer;
function toast(msg, ms = 4000) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

async function captureRoomWithCamera() {
  togglePanel(false);
  for (let n = 5; n > 0; n--) {
    toast(`Point the camera into the room… ${n}`, 0);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await useRoomImage(video);
  toast("Room captured. Now tap where the ghost should appear.", 5000);
  startPickingEntry();
}

let pickingEntry = false;
function startPickingEntry() {
  if (settings.mode !== "window") setMode("window");
  togglePanel(false);
  pickingEntry = true;
  toast("Tap the spot on the floor where the ghost should first appear (a doorway or the far end of a hall).", 0);
}
function pickEntry(e) {
  pickingEntry = false;
  let x = e.clientX / W;
  if (settings.windowFlip) x = 1 - x; // the picture is drawn flipped for people outside
  settings.photoEntry = { ...settings.photoEntry, x, y: e.clientY / H };
  save();
  previewT = 4;
  toast("Here it comes from. Adjust its size under Settings → Haunted window.", 4000);
}

function updateWindow(dt) {
  const { wasObserved } = trackWatching(dt);
  const here = presentFor > 0.4 || (absentFor < 2.5 && G.phase !== "hidden");
  G.unseenFor = observed ? 0 : G.unseenFor + dt;
  G.stone = 0;

  const how = settings.windowWatched;
  if (G.phase === "hidden") {
    G.alpha = approach(G.alpha, 0, 3, dt);
    if (here && presentFor > 0.4 && !(how === "vanish" && observed)) {
      G.phase = "active";
      G.dist = 0;
      G.x = entry().x;
      G.turn = how === "turn" && observed ? Math.PI : 0;
    }
  } else if (G.phase === "active") {
    if (!here) {
      // They've gone: drift back into the dark doorway.
      G.turn = approach(G.turn, Math.PI, 3, dt);
      G.dist = Math.max(0, G.dist - dt / 3);
      if (G.dist < 0.15) G.alpha = approach(G.alpha, 0, 2, dt);
      if (G.alpha < 0.02) resetGhost();
    } else {
      if (how === "vanish") {
        // Gone the instant you look; back a moment after you look away.
        G.alpha = observed ? approach(G.alpha, 0, 40, dt) : G.unseenFor > 0.5 ? approach(G.alpha, 1, 2.5, dt) : G.alpha;
        G.turn = 0;
      } else {
        G.alpha = approach(G.alpha, 1, 1.5, dt);
        if (how === "turn") {
          const step = 7 * dt;
          G.turn += clamp((observed ? Math.PI : 0) - G.turn, -step, step);
          if (observed !== wasObserved) audio.whoosh();
        } else {
          G.turn = 0;
        }
      }
      const frozen = observed || (how === "turn" && G.turn > 0.25) || (how === "vanish" && G.alpha < 0.5);
      if (!frozen) {
        G.dist = clamp(G.dist + dt / settings.windowCreep);
        const maxV = (0.2 + 0.6 * G.dist) * dt;
        G.x += clamp(targetX - G.x, -maxV, maxV);
        G.menace = approach(G.menace, ease(G.dist), 2, dt);
        G.mouth = approach(G.mouth, G.dist > 0.8 ? (G.dist - 0.8) * 2 : 0, 3, dt);
      }
      if (G.dist >= 1 && !frozen && settings.jumpscare) {
        G.phase = "lunge";
        G.lungeT = 0;
        audio.scream();
      }
    }
  } else if (G.phase === "lunge") {
    G.lungeT += dt;
    G.alpha = 1;
    G.turn = 0;
    G.mouth = approach(G.mouth, 1, 12, dt);
    G.menace = 1;
    if (G.lungeT > 1.0) {
      G.phase = "cooldown";
      G.coolT = 0;
      G.flash = 1;
      G.alpha = 0;
    }
  } else if (G.phase === "cooldown") {
    G.coolT += dt;
    if (G.coolT > 6) resetGhost();
  }

  // "Freeze" stops it dead, cloth and all.
  const still = how === "freeze" && observed && G.phase === "active";
  G.animT += dt * (G.phase === "lunge" ? 3 : still ? 0 : 1);
  if (!still) G.look = approach(G.look, clamp((targetX - G.x) * 5, -1, 1), 4, dt);
  G.flash = approach(G.flash, 0, 5, dt);

  previewT = Math.max(0, previewT - dt);
  const shown = G.phase === "active" || G.phase === "lunge" ? G.alpha : 0;
  audio.update(shown, G.phase === "lunge" || (G.phase === "active" && !observed), G.dist);
}

function renderWindow() {
  ctx.save();
  if (settings.windowFlip) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const visible = G.phase === "active" || G.phase === "lunge";
  // The lights dim as it gets closer.
  const dim = visible ? 1 - 0.35 * G.menace * G.alpha : 1;
  room.build(W, H);
  room.draw(ctx, performance.now() / 1000, settings.roomBright * dim);

  const en = entry();
  const preview = previewT > 0; // showing where it will appear, whatever the ghost is doing
  if (preview || (visible && G.alpha > 0.005)) {
    const e = preview ? 0 : ease(G.dist);
    let size = lerp(en.size, 1.5, e) * H;
    let feet = floorY(e, H, en.y);
    let x = lerp(en.x * W, (preview ? en.x : G.x) * W, lerp(0.25, 1, e));
    if (G.phase === "lunge") {
      const k = ease(clamp(G.lungeT / 0.4));
      size *= lerp(1, 2, k);
      feet += k * size * 0.25;
      x = lerp(x, W / 2, k * 0.5);
    }
    const cy = feet - 0.45 * size + 0.012 * size * Math.sin(G.animT * 1.6);
    const flicker = 0.9 + 0.1 * Math.random();
    const shake = G.phase === "lunge" ? (Math.random() - 0.5) * size * 0.02 : 0;

    // Its cold light spills onto the room; a shadow figure darkens it instead.
    // The girl is solid enough not to glow at all.
    const a = (preview ? 1 : G.alpha);
    const shadowy = settings.character === "shadow";
    ctx.save();
    ctx.globalCompositeOperation = shadowy ? "source-over" : "lighter";
    const glow = ctx.createRadialGradient(x, cy, 0, x, cy, size * 0.9);
    glow.addColorStop(0, shadowy ? `rgba(0,0,0,${0.35 * a})`
      : `rgba(90,140,200,${(settings.character === "girl" ? 0 : 0.18) * a * settings.bright})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - size, cy - size, size * 2, size * 2);
    ctx.restore();

    drawCharacter(settings.character, ctx, {
      dark: false,
      x: x + shake,
      y: cy + shake,
      size,
      t: G.animT,
      turn: G.turn,
      stone: 0,
      alpha: (preview ? 1 : G.alpha) * flicker,
      // The picture is flipped for outside viewers, so flip where it looks too.
      look: settings.windowFlip ? -G.look : G.look,
      menace: G.menace,
      mouth: G.mouth,
      sway: 0.6 + 0.4 * G.menace,
      brightness: settings.bright,
    });
  }
  ctx.restore();

  if (G.flash > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.8})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------------------------------------------------------------- eyes in the dark
const eyes = new Eyes();

function updateEyes(dt) {
  trackWatching(dt);
  const event = eyes.update(dt, {
    present: presentFor > 0.4 || (absentFor < 1.5 && eyes.count > 0), // ride out tracking dropouts
    observed,
    targetX,
    creep: settings.creep,
    jumpscare: settings.jumpscare,
  });
  if (event === "scream") {
    audio.scream();
    G.flash = 1;
  }
  G.flash = approach(G.flash, 0, 5, dt);
  audio.update(eyes.big ? 1 : eyes.level, !observed, eyes.level);
}

// ---------------------------------------------------------------- render
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = stage.clientWidth;
  H = stage.clientHeight;
  stage.width = Math.round(W * DPR);
  stage.height = Math.round(H * DPR);
}
window.addEventListener("resize", resize);

function render(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (settings.mode === "mirror") {
    renderMirror();
  } else if (settings.mode === "window") {
    return renderWindow();
  } else if (settings.mode === "eyes") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    eyes.draw(ctx, W, H, settings.bright);
    if (G.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }
    return;
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
  }

  const visible = settings.mode !== "mirror" && (G.phase === "active" || G.phase === "lunge");
  fog.draw(ctx, W, H, dt, visible ? G.alpha * settings.bright : 0);

  if (visible && G.alpha > 0.005) {
    const base = Math.min(H, W * 1.4);
    let size = base * lerp(0.38, 1.3, ease(G.dist));
    let headY = lerp(0.40, 0.36, G.dist) * H;
    if (G.phase === "lunge") {
      const k = ease(clamp(G.lungeT / 0.5));
      size *= lerp(1, 2.6, k);
      headY = lerp(headY, H * 0.45, k);
    }
    const bob = (0.012 + 0.01 * G.menace) * size * Math.sin(G.animT * 1.6);
    const flicker = G.stone > 0.5 ? 1 : 0.93 + 0.07 * Math.random();
    const shake = G.phase === "lunge" ? (Math.random() - 0.5) * size * 0.02 : 0;
    drawCharacter(settings.character, ctx, {
      dark: true,
      x: G.x * W + shake,
      y: headY + 0.32 * size + bob + shake,
      size,
      t: G.animT,
      turn: G.turn,
      stone: G.stone,
      alpha: G.alpha * flicker,
      look: G.look,
      menace: G.menace,
      mouth: G.mouth,
      sway: 0.6 + 0.4 * G.menace,
      brightness: settings.bright,
    });
  }

  if (G.flash > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.8})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function renderDebug(fps) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  const dw = 240, dh = Math.round((240 * vh) / vw);
  if (dbgCanvas.width !== dw * 2) { dbgCanvas.width = dw * 2; dbgCanvas.height = dh * 2; }
  const k = (dw * 2) / vw;
  dbg.save();
  if (settings.mirror || settings.mode === "mirror" || settings.mode === "window") { dbg.translate(dw * 2, 0); dbg.scale(-1, 1); }
  dbg.drawImage(video, 0, 0, dw * 2, dh * 2);
  dbg.fillStyle = "#0ff";
  for (const lm of lastPoses) for (const p of lm) {
    if ((p.visibility ?? 1) < 0.5) continue;
    dbg.fillRect(p.x * vw * k - 2, p.y * vh * k - 2, 4, 4);
  }
  dbg.lineWidth = 3;
  for (const p of people) {
    dbg.strokeStyle = p.looking ? "#3f6" : "#f43";
    dbg.strokeRect((p.head.x - p.head.s * 0.75) * k, (p.head.y - p.head.s * 0.8) * k, p.head.s * 1.5 * k, p.head.s * 1.5 * k);
  }
  dbg.restore();
  $("debugText").textContent =
    `people   ${people.length}  (${people.map((p) => (p.looking ? "LOOK" : "away")).join(" ") || "-"})\n` +
    `watched  ${watched.toFixed(2)}  ${observed ? "OBSERVED" : "unseen"}\n` +
    (settings.mode === "eyes" ? `eyes     ${eyes.count} pairs  ${eyes.big ? "JUMP SCARE" : ""}\n` : "") +
    `ghost    ${G.phase}  dist ${G.dist.toFixed(2)}  x ${G.x.toFixed(2)}${settings.mode === "mirror" ? `  mask ${hasMask ? "yes" : "no"}` : ""}\n` +
    `fps      ${fps.toFixed(0)}  detect ${detectMs.toFixed(0)}ms  cam ${vw}x${vh}`;
}

// ---------------------------------------------------------------- loop
let last = performance.now(), fpsAvg = 30;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAvg = lerp(fpsAvg, 1 / Math.max(dt, 1e-3), 0.05);
  if (pose && !switchingMasks && video.readyState >= 2 && now - lastDetect > 50) {
    lastDetect = now;
    try { detect(now); } catch (e) { console.error(e); }
  }
  update(dt);
  render(dt);
  if (settings.debug) renderDebug(fpsAvg);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- ui
function bindSettings() {
  const bindCheck = (id, key, after) => {
    const el = $(id);
    el.checked = settings[key];
    el.addEventListener("change", () => { settings[key] = el.checked; save(); after?.(); });
  };
  const bindRange = (id, key, label, fmt) => {
    const el = $(id), v = $(label);
    el.value = settings[key];
    v.textContent = fmt(settings[key]);
    el.addEventListener("input", () => {
      settings[key] = parseFloat(el.value);
      v.textContent = fmt(settings[key]);
      save();
      if (key === "vol") audio.setVolume(settings.vol);
    });
  };
  const ch = $("set-character");
  ch.value = settings.character;
  ch.addEventListener("change", () => { settings.character = ch.value; save(); });
  const mode = $("set-mode");
  mode.value = settings.mode;
  mode.addEventListener("change", () => setMode(mode.value));
  bindCheck("set-mirror", "mirror");
  bindCheck("set-mirrorfeed", "mirrorFeed");
  bindCheck("set-windowflip", "windowFlip");
  const ww = $("set-windowwatched");
  ww.value = settings.windowWatched;
  ww.addEventListener("change", () => { settings.windowWatched = ww.value; save(); });
  bindCheck("set-jumpscare", "jumpscare");
  bindCheck("set-sound", "sound", () => audio.setEnabled(settings.sound));
  bindCheck("set-posefallback", "poseFallback");
  bindCheck("set-debug", "debug", applyDebug);
  bindRange("set-creep", "creep", "v-creep", (v) => `${v}s`);
  bindRange("set-windowcreep", "windowCreep", "v-windowcreep", (v) => `${v}s`);
  bindRange("set-roombright", "roomBright", "v-roombright", (v) => `${Math.round(v * 100)}%`);
  const es = $("set-entrysize"), esv = $("v-entrysize");
  es.value = settings.photoEntry.size;
  esv.textContent = `${Math.round(settings.photoEntry.size * 100)}%`;
  es.addEventListener("input", () => {
    settings.photoEntry = { ...settings.photoEntry, size: parseFloat(es.value) };
    esv.textContent = `${Math.round(settings.photoEntry.size * 100)}%`;
    previewT = 2;
    save();
  });
  $("photoBtn").addEventListener("click", () => $("photoFile").click());
  $("photoFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      await useRoomImage(await blobToImage(f));
      startPickingEntry();
    } catch {
      toast("Couldn't read that photo. Save it as a JPEG (on iPhone: Settings → Camera → Formats → Most Compatible) and try again.", 8000);
    }
  });
  $("captureBtn").addEventListener("click", captureRoomWithCamera);
  $("entryBtn").addEventListener("click", () => {
    if (!room.photo) return toast("Add a photo of your room first. The painted room already has its doorway.", 5000);
    startPickingEntry();
  });
  $("paintedBtn").addEventListener("click", async () => {
    room.setPhoto(null);
    try { await storeFile("roomPhoto", null); } catch {}
    toast("Back to the painted room.", 3000);
  });
  bindRange("set-sens", "sens", "v-sens", (v) => v.toFixed(2));
  bindRange("set-facing", "facing", "v-facing", (v) => v.toFixed(2));
  bindRange("set-vol", "vol", "v-vol", (v) => `${Math.round(v * 100)}%`);
  bindRange("set-bright", "bright", "v-bright", (v) => `${Math.round(v * 100)}%`);
  $("set-camera").addEventListener("change", async (e) => {
    settings.cameraId = e.target.value;
    save();
    try { await startCamera(); } catch (err) { alert("Could not switch camera: " + err.message); }
  });
  $("closePanel").addEventListener("click", () => togglePanel(false));
  $("fsBtn").addEventListener("click", toggleFullscreen);
  $("resetBtn").addEventListener("click", resetGhost);
}

function setMode(m) {
  settings.mode = m;
  $("set-mode").value = m;
  save();
  resetGhost();
  G.lookFor = 0;
  G.msize = 0;
  eyes.reset();
  syncMasks();
}

function applyDebug() { $("debug").classList.toggle("hidden", !settings.debug); }
function togglePanel(show) {
  const panel = $("panel");
  panel.classList.toggle("hidden", show === undefined ? !panel.classList.contains("hidden") : !show);
}

function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else {
    const el = d.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  }
}

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const k = e.key.toLowerCase();
  if (k === "s") togglePanel();
  else if (k === "d") { settings.debug = !settings.debug; $("set-debug").checked = settings.debug; save(); applyDebug(); }
  else if (k === "f") toggleFullscreen();
  else if (k === "r") resetGhost();
  else if (k === "c") {
    settings.character = CHARACTERS[(CHARACTERS.indexOf(settings.character) + 1) % CHARACTERS.length];
    $("set-character").value = settings.character;
    save();
    toast(`Character: ${$("set-character").selectedOptions[0].textContent}`, 2000);
  } else if (k === "m") setMode({ turn: "stone", stone: "eyes", eyes: "mirror", mirror: "window", window: "turn" }[settings.mode] || "turn");
});

// Double-tap anywhere on the stage opens settings (works on iPhone too).
let lastTap = 0;
stage.addEventListener("pointerup", (e) => {
  if (pickingEntry) return pickEntry(e);
  const now = performance.now();
  if (now - lastTap < 350) { togglePanel(); lastTap = 0; } else lastTap = now;
  audio.resume();
});

// Hide the mouse cursor when idle (for the projector).
let cursorTimer;
window.addEventListener("pointermove", () => {
  document.body.classList.remove("hide-cursor");
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add("hide-cursor"), 2000);
});

// Keep the screen awake.
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { keepAwake(); audio.resume(); }
});

// ---------------------------------------------------------------- start
window.watcher = { G, settings, eyes, get people() { return people; } }; // for poking at from the console
bindSettings();
applyDebug();
resize();
restoreRoomPhoto();

$("startBtn").addEventListener("click", async () => {
  const btn = $("startBtn"), msg = $("introMsg");
  btn.disabled = true;
  audio.start();
  audio.setVolume(settings.vol);
  audio.setEnabled(settings.sound);
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("The camera needs HTTPS (or localhost). Open this page from an https:// address.");
    }
    msg.textContent = "Asking for the camera…";
    await startCamera();
    await loadModels((s) => (msg.textContent = s));
    keepAwake();
    $("intro").classList.add("hidden");
    requestAnimationFrame(frame);
  } catch (e) {
    console.error(e);
    msg.textContent = e.name === "NotAllowedError" ? "Camera permission was denied. Allow it in your browser settings and reload." : e.message || String(e);
    btn.disabled = false;
  }
});
