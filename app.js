import { PoseLandmarker, FaceDetector } from "./vendor/mediapipe/vision_bundle.mjs";
import { drawGhost, Fog } from "./ghost.js";
import { Spooky } from "./audio.js";

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  mode: "turn",        // "turn" = ghost turns its back, "stone" = freezes into a statue
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
  status("Loading face detector…");
  faces = await FaceDetector.createFromOptions(WASM, {
    baseOptions: { modelAssetPath: "models/blaze_face_short_range.tflite", delegate: "CPU" },
    runningMode: "IMAGE",
    minDetectionConfidence: 0.2,
  });
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

  const poses = pose.detectForVideo(video, ts).landmarks || [];
  const frameFaces = (faces.detect(video).detections || []).filter(goodFace).map(faceInfo);

  const toScreenX = (x) => (settings.mirror ? 1 - x : x);
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
};
let presentFor = 0, absentFor = 99, watched = 0, observed = false, targetX = 0.5;
const fog = new Fog();
const audio = new Spooky();

function resetGhost() {
  G.phase = "hidden";
  G.alpha = 0; G.dist = 0; G.menace = 0; G.mouth = 0;
}

function update(dt) {
  const present = people.length > 0;
  if (present) { presentFor += dt; absentFor = 0; } else { absentFor += dt; presentFor = 0; }
  const here = presentFor > 0.4 || (absentFor < 2.5 && G.phase !== "hidden");

  // Being watched: snaps on quickly, lets go slowly (so a blink doesn't free it).
  const anyLooking = people.some((p) => p.looking);
  watched = anyLooking ? approach(watched, 1, 14, dt) : approach(watched, 0, 3, dt);
  const wasObserved = observed;
  observed = observed ? watched > 0.35 : watched > 0.6;

  if (present) {
    const main = people.reduce((a, b) => (b.size > a.size ? b : a));
    targetX = approach(targetX, main.x, 6, dt);
  }

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
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const visible = G.phase === "active" || G.phase === "lunge";
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
    drawGhost(ctx, {
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
  if (settings.mirror) { dbg.translate(dw * 2, 0); dbg.scale(-1, 1); }
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
    `ghost    ${G.phase}  dist ${G.dist.toFixed(2)}  x ${G.x.toFixed(2)}\n` +
    `fps      ${fps.toFixed(0)}  detect ${detectMs.toFixed(0)}ms  cam ${vw}x${vh}`;
}

// ---------------------------------------------------------------- loop
let last = performance.now(), fpsAvg = 30;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAvg = lerp(fpsAvg, 1 / Math.max(dt, 1e-3), 0.05);
  if (pose && video.readyState >= 2 && now - lastDetect > 50) {
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
  const mode = $("set-mode");
  mode.value = settings.mode;
  mode.addEventListener("change", () => { settings.mode = mode.value; save(); });
  bindCheck("set-mirror", "mirror");
  bindCheck("set-jumpscare", "jumpscare");
  bindCheck("set-sound", "sound", () => audio.setEnabled(settings.sound));
  bindCheck("set-posefallback", "poseFallback");
  bindCheck("set-debug", "debug", applyDebug);
  bindRange("set-creep", "creep", "v-creep", (v) => `${v}s`);
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
  else if (k === "m") { settings.mode = settings.mode === "turn" ? "stone" : "turn"; $("set-mode").value = settings.mode; save(); }
});

// Double-tap anywhere on the stage opens settings (works on iPhone too).
let lastTap = 0;
stage.addEventListener("pointerup", (e) => {
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
window.watcher = { G, settings, get people() { return people; } }; // for poking at from the console
bindSettings();
applyDebug();
resize();

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
