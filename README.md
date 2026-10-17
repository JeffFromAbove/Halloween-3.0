# The Watcher

A Halloween projection. The screen stays black until a camera sees someone. Then
a hooded spectre fades in and drifts toward them. It only moves while nobody is
looking at it. When someone looks, it turns its back (ghost mode) or freezes
into a stone statue (statue mode). If it gets all the way to you unseen, you get
a jump scare.

It's a single web page with no build step. Body and face tracking run on the
device using Google's MediaPipe. That library and its models are included in
this repo, so the page works without internet once it's loaded.

## How it decides you're "looking"

1. A body tracker finds up to 3 people. It works across a room.
2. For each person, the page zooms in on their head and runs a face detector. A
   face counts as looking at the screen only when the nose sits between the eyes
   (a frontal face). A profile or the back of a head doesn't count.
3. If **anyone** is looking, it stays still. It follows the biggest (closest)
   person.

## Test it on an iPhone

The camera only works over HTTPS, so the easiest way to test is GitHub Pages:

1. In the GitHub repo, go to **Settings → Pages**. Set **Source** to *Deploy
   from a branch*, pick `master` and `/ (root)`, and save.
2. After a minute or so, open `https://jefffromabove.github.io/Halloween-3.0/`
   in Safari on the iPhone.
3. Tap **Begin** and allow the camera. The front (selfie) camera is used, so
   hold the phone up and look at it, then look away.
   - Look at the screen: it turns away or freezes.
   - Look away (turn your head, not just your eyes): it creeps closer.
4. Optional: **Share → Add to Home Screen**. The page then opens full screen
   with no Safari toolbar.

Tips: turn on **Debug view** (double-tap → settings) to see the camera feed with
a green box (looking) or red box (not looking) on each head. Set **Creep time**
to about 8 seconds to reach the jump scare quickly while testing.

## Run it for real: projector + webcam

1. Plug a webcam and the projector into a laptop. Put the webcam at the bottom
   or top edge of the projected image, pointing at where people will stand.
2. Open the GitHub Pages URL in Chrome, or run it locally (no internet needed):
   ```
   cd Halloween-3.0
   python3 -m http.server 8000
   ```
   Then open `http://localhost:8000`. `localhost` counts as secure, so the camera
   works.
3. Click **Begin**, then press `S` and choose the webcam under **Camera**.
4. Press `F` for fullscreen. The mouse cursor hides itself after 2 seconds.
5. Use **Debug view** to check that people are detected from where they'll be
   standing. If faces aren't picked up from far away, lower **Face detection
   threshold**. You can also turn on **Also use body pose to guess "looking"**.

Settings are saved in the browser.

### Keyboard / touch

| Key | Action |
| --- | --- |
| `S` or double-tap | Settings panel |
| `D` | Debug view (camera feed + tracking) |
| `F` | Fullscreen |
| `M` | Switch between ghost and statue |
| `R` | Reset the ghost |

### Projection tips

- Everything except the ghost is pure black, so nothing shows up on the wall
  until it appears. Projecting onto a sheer curtain, a scrim, or fog looks
  great.
- **Mirror** (on by default) keeps the ghost on the same side as the person
  when the camera faces them. Turn it off if the ghost drifts the wrong way.
- Sound (a low drone, whispers, and a scream for the jump scare) is
  synthesized. Use a speaker; the silence when you look at it is part of the
  effect.

## Files

- `index.html`, `style.css`: the page and settings UI
- `app.js`: camera, detection, and ghost behavior
- `ghost.js`: drawing the spectre and fog
- `audio.js`: synthesized sounds
- `vendor/mediapipe/`: MediaPipe Tasks Vision 1.1.1 (Apache-2.0)
- `models/`: pose landmarker (lite) and BlazeFace short-range models
