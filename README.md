# The Watcher

A Halloween projection, with haunted mirror and haunted window modes. The screen stays black until a camera sees someone. Then
a figure (a hooded spectre, a shadow figure, a pale lady, or a long-haired girl)
fades in and drifts toward them. It only moves while nobody is looking at it.
When someone looks, it turns its back or freezes into stone, depending on the
mode. If it gets all the way to you unseen, you get
a jump scare.

It's a single web page with no build step. Body and face tracking run on the
device using Google's MediaPipe. That library and its models are included in
this repo, so the page works without internet once it's loaded.

## Characters

Pick one under **Character** in settings, or press `C` to cycle through them.
Every character works in every mode.

- **Hooded spectre:** the original glowing ghost.
- **Shadow figure:** a tall, faceless silhouette with long arms. In a room it
  looks like a person-shaped hole in the light. On a black screen it shows as a
  faint cold outline, and its eyes glow red as it gets closer.
- **Pale lady in white:** a veiled woman in a long, ragged white dress, with
  hollow eyes behind the veil. She slowly raises her arms toward you.
- **Long-haired girl:** a small figure in a grubby nightgown with black hair
  hanging over her face. She moves in jerky stop-motion steps, her head
  twitches, and when she's close one eye peers through her hair.

The newer characters are drawn soft-focus with a little film grain, so they
look less like drawings, especially projected on a sheet or behind a window.

## Haunted mirror mode

Pick **Haunted mirror** under *Mode* (or press `M` until it comes up). The
screen becomes a mirror showing the live camera image, slightly dimmed and cold.

- Look into the mirror for a few seconds and a ghost fades in just behind one of
  your shoulders. You stand in front of it, so it's hidden behind your body and
  really seems to be in the room behind you.
- Turn around to check and it's gone instantly. Look back and after a moment
  it's there again, and closer than before. Its eyes go red and its hands reach
  for you.
- If you keep looking long enough (the **Creep time** setting), it lunges with a
  scream (if **Jump scare** is on).

Two ways to set it up:

- **Screen as the mirror (easiest):** a TV, monitor, or iPad in an old picture
  frame, with the webcam hidden in the top edge of the frame. Leave **show the
  camera image** on. For iPhone testing, just hold the phone like a mirror.
- **Real two-way mirror:** put a monitor directly behind two-way mirror glass
  (or mirror film on glass) and turn **show the camera image** off. The screen
  stays black, so you see your real reflection, and only the ghost shines
  through. Keep the room in front dim and the camera close to the middle of the
  mirror's top edge. The ghost's position is worked out from the camera's view,
  so it lines up best for someone standing about 1–2 m back. Expect it to be
  slightly off.

## Haunted window mode

For a front window facing the sidewalk. Pick **Haunted window** under
*Mode*. People walking by see a dim, candle-lit room inside the house.
While they aren't looking at the window, a ghost drifts out of a dark doorway at
the back of the room. It follows them sideways as they walk and gets bigger as
it comes up to the glass. When they look at the window, it disappears and they
see an ordinary room. (Under *Haunted window → When someone looks in*, you can
make it freeze or turn its back instead.)

### Setting it up

1. **Screen on the glass.** Cover the inside of the window with rear-projection
   film, frosted window film, or a white shower curtain or sheer fabric stretched
   tight across the frame. A light-coloured roller shade can work if light passes
   through it. Thinner material gives a brighter picture outside.
2. **Projector inside, behind the screen,** pointing at the window. Stand it
   back far enough to fill the window. Keep **Flip picture for rear projection**
   on. If your projector has its own "rear" setting, use that instead and turn
   the flip off. The window grilles end up in front of the picture, which
   makes it look like a real window.
3. **Webcam looking out at the sidewalk.** Keep it outside the projected area,
   for example in a corner pane with no film, or on the porch. Press the lens
   right against the glass and surround it with black tape or cloth, so the
   camera doesn't see the projector's glow reflected in the window.
4. **Light the sidewalk.** The tracker needs to see people. A porch light or
   streetlight is usually enough. Without one, people in the dark won't be
   detected.
5. Turn on **Debug view** and walk past. Check that you get a box on your head.
   It should turn green when you look at the window and red when you look ahead.
   People on a sidewalk are far from the camera. If looks aren't detected, lower
   **Face detection threshold** and turn on **Also use body pose to guess
   "looking"**. A 1080p webcam helps a lot.
6. Set **Seconds to reach the glass** to match how long people are in view.
   Someone walking past is usually in view for 5–10 seconds, so 6–8 works well.

If the ghost moves away from people instead of following them, toggle **Flip
picture for rear projection**.

### Using a photo of your real room

Instead of the painted room, you can project a photo of your actual room. The
app darkens it and gives it a cold, night-time look.

**Taking the photo**

- Take it at night, with the lights set how they'll be on Halloween (one or two
  lamps on, overhead lights off). Do this before the screen and projector go up.
- Stand right at the window with your back to the glass and the phone at chest
  height, pointing into the room. This is the view someone on the sidewalk would
  have.
- Hold the phone sideways (landscape). Use the normal 1× lens, not the
  ultra-wide, which bends straight lines. Frame it to roughly match the window's
  shape. The app crops the edges to fill the screen.
- A doorway, staircase, or hallway in the shot gives the ghost somewhere to come
  from.
- If the laptop can't open the photo, set the iPhone to *Settings → Camera →
  Formats → Most Compatible* so it saves JPEGs, then retake it. Or AirDrop it to
  a Mac, which converts it.

**Loading it**

1. In settings, under *Haunted window*, tap **Use a photo…** and pick the image.
   Or tap **Take one with the camera**: you get a 5-second countdown to point
   the webcam into the room.
2. Tap the spot on the floor where the ghost should first appear, such as the
   bottom of a doorway. A preview ghost shows up there.
3. Adjust **Ghost size where it appears** until it looks the right size for that
   spot. A ghost in a far doorway should be about as tall as the doorway.

The photo is saved in that browser, so it's still there after a restart. To go
back to the painted room, tap **Painted room**.

For both front windows, run two laptops (or a laptop plus a mini PC), each with
its own projector and webcam.

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
| `C` | Next character |
| `M` | Next mode: black screen (turns away) → black screen (statue) → haunted mirror → haunted window |
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
- `characters.js`: the shadow figure, pale lady and long-haired girl
- `room.js`: the candle-lit room for the haunted window
- `audio.js`: synthesized sounds
- `vendor/mediapipe/`: MediaPipe Tasks Vision 1.1.1 (Apache-2.0)
- `models/`: pose landmarker (lite) and BlazeFace short-range models
